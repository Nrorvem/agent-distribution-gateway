/**
 * Shared Paid MCP Tool Handler
 *
 * Provides JSON-RPC 2.0 enveloped execution for x402-gated MCP tools.
 * Matches the exact challenge and receipt formats established by enrich_person.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildX402Challenge,
  verifyX402Payment,
  settleVerifiedX402Payment,
  recordAuditLog,
  getGateConfig,
  resolveGatewayOrigin,
  markPaymentAuthorizationConsumed,
  isMockOutputBlockedInProduction,
  type PaidResourceSpec,
} from "./x402-gate.ts";

export interface PaidMcpCallOptions<TInput, TOutput> {
  req: NextRequest;
  id: string | number | null;
  tool: string;
  description: string;
  rawArgs: Record<string, unknown>;
  params?: Record<string, any>;
  validate: (raw: Record<string, unknown>) => { valid: boolean; data?: TInput; error?: string };
  expectedSchema: unknown;
  spec: (input: TInput | null) => PaidResourceSpec;
  execute: (input: TInput) => Promise<TOutput>;
  isBillable: (output: TOutput) => boolean;
  receiptExtras?: (output: TOutput) => Record<string, unknown>;
}

export async function handlePaidMcpCall<TInput, TOutput>(
  o: PaidMcpCallOptions<TInput, TOutput>
): Promise<NextResponse> {
  const origin = resolveGatewayOrigin(o.req);
  const resourceUrl = `${origin}/api/mcp`;

  const paymentProof =
    o.req.headers.get("payment-signature") ||
    o.req.headers.get("PAYMENT-SIGNATURE") ||
    o.req.headers.get("x-payment") ||
    o.req.headers.get("X-PAYMENT") ||
    (typeof o.rawArgs._x402_payment === "string" ? o.rawArgs._x402_payment : null) ||
    (typeof o.params?._meta?.payment === "string" ? o.params._meta.payment : null);

  // 1. Unauthenticated probe -> return 402 with challenge envelope
  if (!paymentProof) {
    const probeVal = o.validate(o.rawArgs);
    const spec = probeVal.valid && probeVal.data !== undefined
      ? o.spec(probeVal.data)
      : o.spec(null);

    const challenge = buildX402Challenge(resourceUrl, o.description, spec);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: o.id,
        result: {
          isError: true,
          _meta: { x402: challenge },
          content: [
            {
              type: "text",
              text: JSON.stringify(challenge, null, 2),
            },
          ],
        },
      },
      {
        status: 402,
        headers: { "X-Payment-Protocol": "x402" },
      }
    );
  }

  // 2. Validate input schema before verification
  const validation = o.validate(o.rawArgs);
  if (!validation.valid || validation.data === undefined) {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: o.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: validation.error,
              expected_schema: o.expectedSchema,
            }),
          },
        ],
      },
    });
  }

  // 3. Phase 1 verify
  const spec = o.spec(validation.data);
  const verification = await verifyX402Payment(
    paymentProof,
    resourceUrl,
    o.description,
    { verifyOnly: true, spec }
  );

  if (!verification.verified) {
    const challenge = {
      ...buildX402Challenge(resourceUrl, o.description, spec),
      error: verification.error || "Payment verification failed",
    };
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: o.id,
        result: {
          isError: true,
          _meta: { x402: challenge },
          content: [
            {
              type: "text",
              text: JSON.stringify(challenge, null, 2),
            },
          ],
        },
      },
      { status: 402 }
    );
  }

  // 4. Execute tool
  let output: TOutput;
  try {
    output = await o.execute(validation.data);
  } catch (err: any) {
    if (verification.authKey) {
      markPaymentAuthorizationConsumed(verification.authKey);
    }
    return NextResponse.json({
      jsonrpc: "2.0",
      id: o.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: `Upstream supply error: ${err?.message || String(err)}`,
          },
        ],
      },
    });
  }

  // Guard against settling mock data in production (Defense-in-Depth B1 / F1)
  if (isMockOutputBlockedInProduction(output)) {
    if (verification.authKey) {
      markPaymentAuthorizationConsumed(verification.authKey);
    }
    return NextResponse.json({
      jsonrpc: "2.0",
      id: o.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: "Mock data cannot be settled in production.",
          },
        ],
      },
    });
  }

  const cfg = getGateConfig();
  const billable = o.isBillable(output);
  const extras = o.receiptExtras ? o.receiptExtras(output) : {};

  // 5. Free-on-Miss
  if (!billable) {
    if (verification.authKey) {
      markPaymentAuthorizationConsumed(verification.authKey);
    }
    return NextResponse.json({
      jsonrpc: "2.0",
      id: o.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...(typeof output === "object" && output !== null ? output : { result: output }),
                payment_settled: false,
                receipt: {
                  receipt_id: `miss_${Date.now()}`,
                  tx_hash: null,
                  amount_usd: "0.00",
                  network: cfg.network,
                  free_on_miss: true,
                  note: "Free-on-Miss: Query yielded zero billable results. Payment was verified but NOT settled on-chain ($0.00 charged).",
                  ...extras,
                },
              },
              null,
              2
            ),
          },
        ],
      },
    });
  }

  // 6. Phase 2 settle
  let settledTxHash = verification.txHash;
  let settledPayer = verification.payer;

  if (verification.settlementContext) {
    const settleResult = await settleVerifiedX402Payment(
      verification.settlementContext
    );
    if (!settleResult.verified || !settleResult.settled) {
      const challenge = {
        ...buildX402Challenge(resourceUrl, o.description, spec),
        error: settleResult.error || "On-chain payment settlement failed",
      };
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: o.id,
          result: {
            isError: true,
            _meta: { x402: challenge },
            content: [
              {
                type: "text",
                text: JSON.stringify(challenge, null, 2),
              },
            ],
          },
        },
        { status: 402 }
      );
    }
    settledTxHash = settleResult.txHash;
    settledPayer = settleResult.payer || settledPayer;
  } else if (verification.mode === "dev_bypass_token" && !settledTxHash) {
    settledTxHash = `0xsim_${Date.now().toString(16)}`;
  }

  const receipt = recordAuditLog({
    vertical: "option-a-apollo",
    tool: `mcp:${o.tool}`,
    payer: settledPayer || "unknown",
    amount_usd: spec.priceUsd,
    network: cfg.network,
    tx_hash: settledTxHash || `0xsim_${Date.now().toString(16)}`,
    verification_mode: verification.mode || "dev_bypass_token",
    matched: true,
    latency_ms: (output as any)?.latency_ms || 0,
  });

  return NextResponse.json({
    jsonrpc: "2.0",
    id: o.id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...(typeof output === "object" && output !== null ? output : { result: output }),
              payment_settled: true,
              receipt: {
                receipt_id: receipt.receipt_id,
                tx_hash: settledTxHash,
                amount_usd: spec.priceUsd,
                network: cfg.network,
                free_on_miss: true,
                ...extras,
              },
            },
            null,
            2
          ),
        },
      ],
    },
  });
}
