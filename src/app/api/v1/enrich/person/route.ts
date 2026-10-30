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
  settleVerifiedX402Payment,
  recordAuditLog,
  getGateConfig,
  resolveGatewayOrigin,
} from "@/lib/x402-gate";

/**
 * GET /api/v1/enrich/person
 * Returns deterministic tool specification, SLA, and x402 pricing metadata
 * so visiting agents can inspect the schema for free before invoking POST.
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const resourceUrl = `${origin}/api/v1/enrich/person`;

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
      billing_policy: "pay_per_match_free_on_miss",
      free_on_miss: true,
    },
    sla: {
      p95_latency_ms: 850,
      phone_reveal_disabled: true,
      deterministic_json: true,
      free_on_miss: true,
    },
    schema: PERSON_ENRICH_JSON_SCHEMA,
    x402_challenge_preview: buildX402Challenge(
      resourceUrl,
      "Apollo.io Verified B2B Person Enrichment & Work Email Finder ($0.03 USDC on Match — Free on Miss)"
    ),
  });
}

/**
 * POST /api/v1/enrich/person
 * Zero-signup x402-gated Person Enrichment endpoint (supports x402 v2 & v1).
 * Uses a 2-Phase "Verify -> Enrich -> Settle Only on Match" ("Free-on-Miss") flow:
 * 1. Verifies the EIP-3009 payment signature & balance via `/verify` (without settling on-chain yet).
 * 2. Executes Apollo.io person enrichment.
 * 3. Only settles on-chain via `/settle` when `matched === true` AND a deliverable email is returned.
 *    If no match or no email is found, `/settle` is skipped and the agent is charged $0.00.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    const parsed = text.trim() ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  // Also merge URL query parameters as fallback if an agent passed identifiers in the query string
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    if (body[key] === undefined && value.trim().length > 0) {
      body[key] = value;
    }
  }

  const origin = resolveGatewayOrigin(req);
  const resourceUrl = `${origin}/api/v1/enrich/person`;
  const description =
    "Apollo.io Verified B2B Person Enrichment & Work Email Finder ($0.03 USDC on Match — Free on Miss)";
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

  // 2. Validate input schema BEFORE verifying/settling payment so a paying agent is never
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

  // 3. Phase 1 of 2-Phase "Free-on-Miss" Payment Flow:
  // Verify the x402 payment signature and balance WITHOUT settling on-chain yet.
  const paymentVerifyResult = await verifyX402Payment(
    paymentHeader,
    resourceUrl,
    description,
    { verifyOnly: true }
  );

  if (!paymentVerifyResult.verified) {
    const challenge = {
      ...buildX402Challenge(resourceUrl, description),
      error: paymentVerifyResult.error || "Payment verification failed",
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

  // 4. Execute Supply Connector (Apollo.io /api/v1/people/match)
  try {
    const enrichment = await enrichPersonWithApollo(validation.data);
    const cfg = getGateConfig();

    const hasDeliverableEmail = Boolean(
      enrichment.matched &&
        enrichment.person?.email &&
        enrichment.person.email.trim().length > 0 &&
        enrichment.person.email_status !== "unavailable"
    );

    // Free-on-Miss: If Apollo could not resolve a verified match with a deliverable email,
    // skip `/settle` so the buyer agent's EIP-3009 authorization is never settled on-chain ($0.00 charged).
    if (!hasDeliverableEmail) {
      return NextResponse.json(
        {
          ...enrichment,
          payment_settled: false,
          receipt: {
            receipt_id: `miss_${Date.now()}`,
            tx_hash: null,
            amount_usd: "0.00",
            network: cfg.network,
            verification_mode: paymentVerifyResult.mode || "facilitator_onchain",
            facilitator: paymentVerifyResult.facilitator,
            free_on_miss: true,
            note: "Free-on-Miss: No deliverable email found for the supplied identifiers. Your x402 payment was verified but NOT settled on-chain ($0.00 charged).",
          },
        },
        {
          status: 200,
          headers: {
            "X-Payment-Settled": "false",
          },
        }
      );
    }

    // 5. Phase 2 of 2-Phase Payment Flow: Match + deliverable email found -> Settle on-chain now!
    let settledTxHash = paymentVerifyResult.txHash;
    let activeFacilitator = paymentVerifyResult.facilitator;
    let settledPayer = paymentVerifyResult.payer;

    if (paymentVerifyResult.settlementContext) {
      const settleResult = await settleVerifiedX402Payment(
        paymentVerifyResult.settlementContext
      );
      if (!settleResult.verified || !settleResult.settled) {
        const challenge = {
          ...buildX402Challenge(resourceUrl, description),
          error: settleResult.error || "On-chain payment settlement failed",
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
      settledTxHash = settleResult.txHash;
      activeFacilitator = settleResult.facilitator;
      settledPayer = settleResult.payer || settledPayer;
    } else if (paymentVerifyResult.mode === "dev_bypass_token" && !settledTxHash) {
      settledTxHash = `0xsim_${Date.now().toString(16)}`;
    }

    // 6. Record immutable audit log (Stage 6 of Agentic Commerce Lifecycle)
    const receipt = recordAuditLog({
      vertical: "option-a-apollo",
      tool: "enrich_person",
      payer: settledPayer || "unknown",
      amount_usd: cfg.priceUsd,
      network: cfg.network,
      tx_hash: settledTxHash || `0xsim_${Date.now().toString(16)}`,
      verification_mode: paymentVerifyResult.mode || "dev_bypass_token",
      matched: enrichment.matched,
      latency_ms: enrichment.latency_ms,
    });

    const paymentResponseHeader = Buffer.from(
      JSON.stringify({
        success: true,
        receipt_id: receipt.receipt_id,
        txHash: settledTxHash,
        network: cfg.network,
        facilitator: activeFacilitator,
      })
    ).toString("base64");

    return NextResponse.json(
      {
        ...enrichment,
        payment_settled: true,
        receipt: {
          receipt_id: receipt.receipt_id,
          tx_hash: settledTxHash,
          amount_usd: cfg.priceUsd,
          network: cfg.network,
          verification_mode: paymentVerifyResult.mode,
          facilitator: activeFacilitator,
          free_on_miss: true,
        },
      },
      {
        status: 200,
        headers: {
          "X-PAYMENT-RESPONSE": paymentResponseHeader,
          "X-Payment-Settled": "true",
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
