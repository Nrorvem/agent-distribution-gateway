/**
 * Shared Paid Route Handler for x402 Endpoints
 *
 * Enforces Invariant #1 from AGENTS.md across all paid routes:
 * 1. Parse body tolerantly and merge query params.
 * 2. Unauthenticated probes (missing PAYMENT-SIGNATURE / X-PAYMENT) MUST return
 *    HTTP 402 with PAYMENT-REQUIRED header before body validation ever rejects the request.
 * 3. Authenticated requests validate body first (HTTP 422 if invalid, avoiding on-chain burn).
 * 4. Phase 1 verify (without settlement).
 * 5. Execute upstream supply.
 * 6. Free-on-Miss: If result is not billable, return HTTP 200 with payment_settled: false and $0.00.
 * 7. Phase 2 settle on-chain only when billable.
 * 8. Record audit log and return HTTP 200 with X-PAYMENT-RESPONSE header.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildX402Challenge,
  encodePaymentRequiredHeader,
  verifyX402Payment,
  settleVerifiedX402Payment,
  recordAuditLog,
  getGateConfig,
  resolveGatewayOrigin,
  usdToAtomicUnits,
  markPaymentAuthorizationConsumed,
  isMockOutputBlockedInProduction,
  type PaidResourceSpec,
} from "./x402-gate.ts";

export interface PaidRouteOptions<TInput, TOutput> {
  req: NextRequest;
  resourcePath: string; // e.g. "/api/v1/enrich/organization"
  description: string; // human/Bazaar description incl. price + billing rule
  vertical: "option-a-apollo"; // audit vertical identifier
  tool: string; // audit-log tool name, e.g. "enrich_organization"
  validate: (raw: Record<string, unknown>) => { valid: boolean; data?: TInput; error?: string };
  expectedSchema: unknown; // returned in 422 body
  /** Price spec. Receives the validated input when available, or null for unauth/invalid probes. */
  spec: (input: TInput | null) => PaidResourceSpec;
  execute: (input: TInput) => Promise<TOutput>;
  isBillable: (output: TOutput) => boolean;
  /** Fields merged into the receipt, e.g. { billable_count, submitted_count }. */
  receiptExtras?: (output: TOutput) => Record<string, unknown>;
}

export async function handlePaidPost<TInput, TOutput>(
  o: PaidRouteOptions<TInput, TOutput>
): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    const text = await o.req.text();
    const parsed = text.trim() ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  // Merge query parameters as fallback
  for (const [key, value] of o.req.nextUrl.searchParams.entries()) {
    if (body[key] === undefined && value.trim().length > 0) {
      body[key] = value;
    }
  }

  const origin = resolveGatewayOrigin(o.req);
  const resourceUrl = `${origin}${o.resourcePath}`;

  const paymentHeader =
    o.req.headers.get("payment-signature") ||
    o.req.headers.get("PAYMENT-SIGNATURE") ||
    o.req.headers.get("x-payment") ||
    o.req.headers.get("X-PAYMENT");

  // Invariant #1: No payment header -> immediately return HTTP 402 challenge
  if (!paymentHeader) {
    const probeValidation = o.validate(body);
    const spec = probeValidation.valid && probeValidation.data !== undefined
      ? o.spec(probeValidation.data)
      : o.spec(null);

    const challenge = buildX402Challenge(resourceUrl, o.description, spec);
    return NextResponse.json(challenge, {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        "X-Payment-Protocol": "x402",
      },
    });
  }

  // Header present -> Validate request body before settlement / verification
  const validation = o.validate(body);
  if (!validation.valid || validation.data === undefined) {
    return NextResponse.json(
      {
        error: validation.error || "Invalid request payload",
        expected_schema: o.expectedSchema,
      },
      { status: 422 }
    );
  }

  // Phase 1: Verify payment signature and balance without settling on-chain yet
  const spec = o.spec(validation.data);
  const paymentVerifyResult = await verifyX402Payment(
    paymentHeader,
    resourceUrl,
    o.description,
    { verifyOnly: true, spec }
  );

  if (!paymentVerifyResult.verified) {
    if (paymentVerifyResult.retryable) {
      return NextResponse.json(
        { error: paymentVerifyResult.error || "Payment lock unavailable, retry", retryable: true },
        { status: 503, headers: { "Retry-After": "2", "Content-Type": "application/json" } }
      );
    }
    const challenge = {
      ...buildX402Challenge(resourceUrl, o.description, spec),
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

  // Execute supply connector
  let output: TOutput;
  try {
    output = await o.execute(validation.data);
  } catch (err: any) {
    if (paymentVerifyResult.authKey) {
      await markPaymentAuthorizationConsumed(paymentVerifyResult.authKey);
    }
    return NextResponse.json(
      {
        error: `Upstream supply error: ${err?.message || String(err)}`,
      },
      { status: 502 }
    );
  }

  // Guard against settling mock data in production (Defense-in-Depth B1 / F1)
  if (isMockOutputBlockedInProduction(output)) {
    if (paymentVerifyResult.authKey) {
      await markPaymentAuthorizationConsumed(paymentVerifyResult.authKey);
    }
    return NextResponse.json(
      {
        error: "Mock data cannot be settled in production.",
      },
      { status: 502 }
    );
  }

  const cfg = getGateConfig();
  const billable = o.isBillable(output);
  const extras = o.receiptExtras ? o.receiptExtras(output) : {};

  // Free-on-Miss: If not billable, skip settlement ($0.00 charged)
  if (!billable) {
    if (paymentVerifyResult.authKey) {
      await markPaymentAuthorizationConsumed(paymentVerifyResult.authKey);
    }
    return NextResponse.json(
      {
        ...(typeof output === "object" && output !== null ? output : { result: output }),
        payment_settled: false,
        receipt: {
          receipt_id: `miss_${Date.now()}`,
          tx_hash: null,
          amount_usd: "0.00",
          network: cfg.network,
          verification_mode: paymentVerifyResult.mode || "facilitator_onchain",
          facilitator: paymentVerifyResult.facilitator,
          free_on_miss: true,
          note: "Free-on-Miss: Query yielded zero billable results. Your x402 payment was verified but NOT settled on-chain ($0.00 charged).",
          ...extras,
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

  // Phase 2: Settle on-chain
  let settledTxHash = paymentVerifyResult.txHash;
  let activeFacilitator = paymentVerifyResult.facilitator;
  let settledPayer = paymentVerifyResult.payer;

  if (paymentVerifyResult.settlementContext) {
    const settleResult = await settleVerifiedX402Payment(
      paymentVerifyResult.settlementContext
    );
    if (!settleResult.verified || !settleResult.settled) {
      const challenge = {
        ...buildX402Challenge(resourceUrl, o.description, spec),
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

  // Record audit log
  const auditReceipt = await recordAuditLog({
    vertical: o.vertical,
    tool: o.tool,
    payer: settledPayer || "unknown",
    amount_usd: spec.priceUsd,
    network: cfg.network,
    tx_hash: settledTxHash || `0xsim_${Date.now().toString(16)}`,
    verification_mode: paymentVerifyResult.mode || "dev_bypass_token",
    matched: true,
    latency_ms: (output as any)?.latency_ms || 0,
  });

  const paymentResponseHeader = Buffer.from(
    JSON.stringify({
      success: true,
      receipt_id: auditReceipt.receipt_id,
      txHash: settledTxHash,
      network: cfg.network,
      facilitator: activeFacilitator,
    })
  ).toString("base64");

  return NextResponse.json(
    {
      ...(typeof output === "object" && output !== null ? output : { result: output }),
      payment_settled: true,
      receipt: {
        receipt_id: auditReceipt.receipt_id,
        tx_hash: settledTxHash,
        amount_usd: spec.priceUsd,
        network: cfg.network,
        verification_mode: paymentVerifyResult.mode,
        facilitator: activeFacilitator,
        free_on_miss: true,
        ...extras,
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
}

export function handlePaidGet(
  req: NextRequest,
  resourcePath: string,
  description: string,
  spec: PaidResourceSpec,
  schema: unknown
): NextResponse {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const resourceUrl = `${origin}${resourcePath}`;

  const serviceSlug = resourcePath.replace(/^\/api\/v1\//, "").replace(/\//g, "-");

  return NextResponse.json({
    service: `option-a-apollo-${serviceSlug}`,
    status: "operational",
    pricing: {
      protocol: "x402",
      x402Version: 2,
      network: cfg.networkCaip2,
      legacyNetwork: cfg.network,
      asset: cfg.asset,
      symbol: "USDC",
      price_usd: spec.priceUsd,
      atomic_units: usdToAtomicUnits(spec.priceUsd),
      recipient: cfg.payTo,
      zero_signup: true,
      billing_policy: "free_on_miss",
      free_on_miss: true,
    },
    sla: {
      p95_latency_ms: 850,
      phone_reveal_disabled: true,
      deterministic_json: true,
      free_on_miss: true,
    },
    schema,
    x402_challenge_preview: buildX402Challenge(resourceUrl, description, spec),
  });
}
