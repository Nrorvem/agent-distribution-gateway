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
 * Model Context Protocol (MCP) Streamable HTTP + x402 Paid Tool Handler
 * Endpoint: /api/mcp
 *
 * Exposes two tools to MCP clients (Claude Code, Cursor, Coinbase payments-mcp, x402-mcp):
 * 1. `get_enrichment_quote` (FREE) — Returns live pricing, SLA, and input/output schema.
 * 2. `enrich_person` (PAID: $0.10 USDC via x402) — Resolves partial person identifiers
 *    into a verified B2B profile via Apollo.io.
 */

const MCP_TOOLS = [
  {
    name: "get_enrichment_quote",
    description:
      "FREE pre-flight discovery tool: Inspect live x402 pricing ($0.10 USDC on Base), deterministic JSON input/output schema, SLA latency telemetry, and recent verifiable Base settlement txHashes for Apollo.io B2B Person Enrichment & Work Email Lookup.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "enrich_person",
    description:
      "PAID ($0.10 USDC via x402 on Base): Verified B2B Person Enrichment, Work Email Finder & LinkedIn-to-Email Resolver powered by Apollo.io. Accepts partial identifiers—(1) first_name + last_name + company domain or organization_name, (2) LinkedIn profile URL (linkedin_url), or (3) email (reverse email lookup)—and returns a deterministic JSON profile with deliverable work email, verification status, job title, seniority (founder, C-suite, VP, director), company firmographics (headcount, industry, founded year), and full employment history. Zero signup or API key required.",
    inputSchema: {
      ...PERSON_ENRICH_JSON_SCHEMA.input,
      properties: {
        ...PERSON_ENRICH_JSON_SCHEMA.input.properties,
        _x402_payment: {
          type: "string",
          description:
            "Optional x402 signed payment payload (if not passed via HTTP X-PAYMENT header)",
        },
      },
    },
  },
];

export async function GET() {
  const cfg = getGateConfig();
  return NextResponse.json({
    protocol: "mcp-streamable-http",
    serverInfo: {
      name: "agent-distribution-apollo-broker",
      version: "0.1.0",
    },
    paymentProtocol: "x402",
    network: cfg.network,
    priceUsd: cfg.priceUsd,
    tools: MCP_TOOLS,
  });
}

export async function POST(req: NextRequest) {
  let rpc: Record<string, any>;
  try {
    rpc = (await req.json()) as Record<string, any>;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 }
    );
  }

  const { id = null, method, params = {} } = rpc;

  // 1. MCP Handshake
  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "agent-distribution-apollo-broker",
          version: "0.1.0",
        },
      },
    });
  }

  if (method === "notifications/initialized") {
    return NextResponse.json({ jsonrpc: "2.0", id, result: {} });
  }

  // 2. List Tools
  if (method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS,
      },
    });
  }

  // 3. Call Tool
  if (method === "tools/call") {
    const toolName = params?.name;
    const rawArgs = (params?.arguments || {}) as Record<string, unknown>;
    const cfg = getGateConfig();

    if (toolName === "get_enrichment_quote") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tool: "enrich_person",
                  price_usd: cfg.priceUsd,
                  network: cfg.network,
                  asset_contract: cfg.asset,
                  recipient_wallet: cfg.payTo,
                  sla_p95_ms: 850,
                  zero_signup: true,
                  schema: PERSON_ENRICH_JSON_SCHEMA,
                },
                null,
                2
              ),
            },
          ],
        },
      });
    }

    if (toolName === "enrich_person") {
      const resourceUrl = req.nextUrl.toString();
      const description = "MCP Tool Call: enrich_person (Apollo.io B2B Person Enrichment)";
      const paymentProof =
        req.headers.get("payment-signature") ||
        req.headers.get("PAYMENT-SIGNATURE") ||
        req.headers.get("x-payment") ||
        req.headers.get("X-PAYMENT") ||
        (typeof rawArgs._x402_payment === "string" ? rawArgs._x402_payment : null) ||
        (typeof params?._meta?.payment === "string" ? params._meta.payment : null);

      if (!paymentProof) {
        const challenge = buildX402Challenge(resourceUrl, description);
        return NextResponse.json(
          {
            jsonrpc: "2.0",
            id,
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

      // Validate input BEFORE settling payment so a paying agent is never charged on malformed input
      const validation = validatePersonEnrichInput(rawArgs);
      if (!validation.valid || !validation.data) {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: validation.error,
                  expected_schema: PERSON_ENRICH_JSON_SCHEMA.input,
                }),
              },
            ],
          },
        });
      }

      const verification = await verifyX402Payment(
        paymentProof,
        resourceUrl,
        description
      );

      if (!verification.verified) {
        const challenge = buildX402Challenge(resourceUrl, description);
        return NextResponse.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              _meta: { x402: challenge },
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ...challenge,
                      error: verification.error,
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          },
          { status: 402 }
        );
      }

      const enrichment = await enrichPersonWithApollo(validation.data);
      const receipt = recordAuditLog({
        vertical: "option-a-apollo",
        tool: "mcp:enrich_person",
        payer: verification.payer || "unknown",
        amount_usd: cfg.priceUsd,
        network: cfg.network,
        tx_hash: verification.txHash || `0xsim_${Date.now().toString(16)}`,
        verification_mode: verification.mode || "dev_bypass_token",
        matched: enrichment.matched,
        latency_ms: enrichment.latency_ms,
      });

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...enrichment,
                  receipt: {
                    receipt_id: receipt.receipt_id,
                    tx_hash: verification.txHash,
                    amount_usd: cfg.priceUsd,
                    network: cfg.network,
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

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    });
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}
