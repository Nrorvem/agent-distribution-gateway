import { NextRequest, NextResponse } from "next/server";
import {
  validatePersonEnrichInput,
  PERSON_ENRICH_JSON_SCHEMA,
} from "@/verticals/option-a-apollo/schema";
import { enrichPersonWithApollo } from "@/verticals/option-a-apollo/connector";
import {
  buildX402Challenge,
  encodePaymentRequiredHeader,
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
      x402Version: 2,
      network: cfg.networkCaip2,
      legacyNetwork: cfg.network,
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
 * Zero-signup x402-gated Person Enrichment endpoint (supports x402 v2 & v1).
 */
export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const resourceUrl = req.nextUrl.toString();
  const description = "Apollo.io Verified B2B Person Enrichment (1 profile lookup)";
  const paymentHeader =
    req.headers.get("payment-signature") ||
    req.headers.get("PAYMENT-SIGNATURE") ||
    req.headers.get("x-payment") ||
    req.headers.get("X-PAYMENT");

  // 1. If no payment header is attached, immediately return the x402 v2 402 challenge
  // (Per x402scan discovery spec: unauthenticated probes must reach the 402 challenge
  // before body validation rejects the request.)
  if (!paymentHeader) {
    const challenge = buildX402Challenge(resourceUrl, description);
    return NextResponse.json(challenge, {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        "X-Payment-Protocol": "x402",
      },
    });
  }

  // 2. Validate input schema BEFORE settling payment so a paying agent is never
  // charged if its request body is malformed.
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

  // 3. Verify and settle the x402 payment proof on Base Mainnet
  const paymentResult = await verifyX402Payment(
    paymentHeader,
    resourceUrl,
    description
  );

  if (!paymentResult.verified) {
    const challenge = {
      ...buildX402Challenge(resourceUrl, description),
      error: paymentResult.error || "Payment verification failed",
    };
    return NextResponse.json(challenge, {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        "X-Payment-Protocol": "x402",
      },
    });
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
