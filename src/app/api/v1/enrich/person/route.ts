import { NextRequest, NextResponse } from "next/server";
import {
  validatePersonEnrichInput,
  PERSON_ENRICH_JSON_SCHEMA,
} from "@/verticals/option-a-apollo/schema";
import { enrichPersonWithApollo } from "@/verticals/option-a-apollo/connector";
import {
  buildX402Challenge,
  verifyX402Payment,
  recordAuditLog,
  getGateConfig,
} from "@/lib/x402-gate";

/**
 * GET /api/v1/enrich/person
 * Returns deterministic tool specification, SLA, and x402 pricing metadata
 * so visiting agents can inspect the schema for free before invoking POST.
 */
export async function GET(req: NextRequest) {
  const cfg = getGateConfig();
  const resourceUrl = req.nextUrl.toString();

  return NextResponse.json({
    service: "option-a-apollo-person-enrichment",
    status: "operational",
    pricing: {
      protocol: "x402",
      network: cfg.network,
      asset: cfg.asset,
      symbol: "USDC",
      price_usd: cfg.priceUsd,
      atomic_units: cfg.atomicUnits,
      recipient: cfg.payTo,
      zero_signup: true,
    },
    sla: {
      p95_latency_ms: 850,
      phone_reveal_disabled: true,
      deterministic_json: true,
    },
    schema: PERSON_ENRICH_JSON_SCHEMA,
    x402_challenge_preview: buildX402Challenge(
      resourceUrl,
      "Apollo.io Verified B2B Person Enrichment (1 profile lookup)"
    ),
  });
}

/**
 * POST /api/v1/enrich/person
 * Zero-signup x402-gated Person Enrichment endpoint.
 */
export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const resourceUrl = req.nextUrl.toString();
  const description = "Apollo.io Verified B2B Person Enrichment (1 profile lookup)";
  const paymentHeader =
    req.headers.get("x-payment") || req.headers.get("X-PAYMENT");

  const isEmptyProbe =
    body &&
    typeof body === "object" &&
    Object.keys(body as Record<string, unknown>).length === 0;

  // If this is an empty-body discovery probe without X-PAYMENT (used by x402 Bazaar validators),
  // immediately return the HTTP 402 Payment Required challenge + Bazaar schema metadata.
  if (!paymentHeader && isEmptyProbe) {
    const challenge = buildX402Challenge(resourceUrl, description);
    return NextResponse.json(challenge, {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "X-Payment-Protocol": "x402",
      },
    });
  }

  // Validate input schema BEFORE requesting payment so agents never pay for invalid inputs
  const validation = validatePersonEnrichInput(body);
  if (!validation.valid || !validation.data) {
    return NextResponse.json(
      {
        error: validation.error,
        expected_schema: PERSON_ENRICH_JSON_SCHEMA.input,
      },
      { status: 422 }
    );
  }

  // If no X-PAYMENT header is attached, return HTTP 402 Payment Required
  if (!paymentHeader) {
    const challenge = buildX402Challenge(resourceUrl, description);
    return NextResponse.json(challenge, {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "X-Payment-Protocol": "x402",
      },
    });
  }

  // Step 3: Verify and settle the x402 payment proof
  const paymentResult = await verifyX402Payment(
    paymentHeader,
    resourceUrl,
    description
  );

  if (!paymentResult.verified) {
    const challenge = buildX402Challenge(resourceUrl, description);
    return NextResponse.json(
      {
        ...challenge,
        error: paymentResult.error || "Payment verification failed",
      },
      { status: 402 }
    );
  }

  // Step 4: Execute Supply Connector (Apollo.io /api/v1/people/match)
  try {
    const enrichment = await enrichPersonWithApollo(validation.data);
    const cfg = getGateConfig();

    // Step 5: Record immutable audit log (Stage 6 of Agentic Commerce Lifecycle)
    const receipt = recordAuditLog({
      vertical: "option-a-apollo",
      tool: "enrich_person",
      payer: paymentResult.payer || "unknown",
      amount_usd: cfg.priceUsd,
      network: cfg.network,
      tx_hash: paymentResult.txHash || `0xsim_${Date.now().toString(16)}`,
      verification_mode: paymentResult.mode || "dev_bypass_token",
      matched: enrichment.matched,
      latency_ms: enrichment.latency_ms,
    });

    const paymentResponseHeader = Buffer.from(
      JSON.stringify({
        success: true,
        receipt_id: receipt.receipt_id,
        txHash: paymentResult.txHash,
        network: cfg.network,
      })
    ).toString("base64");

    return NextResponse.json(
      {
        ...enrichment,
        receipt: {
          receipt_id: receipt.receipt_id,
          tx_hash: paymentResult.txHash,
          amount_usd: cfg.priceUsd,
          network: cfg.network,
          verification_mode: paymentResult.mode,
        },
      },
      {
        status: 200,
        headers: {
          "X-PAYMENT-RESPONSE": paymentResponseHeader,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: `Upstream supply error: ${err?.message || String(err)}`,
      },
      { status: 502 }
    );
  }
}
