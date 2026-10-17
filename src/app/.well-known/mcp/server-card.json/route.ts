import { NextRequest, NextResponse } from "next/server";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";
import { getGateConfig } from "@/lib/x402-gate";

/**
 * Layer 4: MCP Static Server Card Discovery
 * Endpoint: GET /.well-known/mcp/server-card.json
 *
 * Used by Smithery.ai URL scanner and remote MCP registries to automatically
 * extract serverInfo and tool schemas over HTTPS without needing a public GitHub repo.
 */
export async function GET(req: NextRequest) {
  const cfg = getGateConfig();
  const origin =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  return NextResponse.json({
    serverInfo: {
      name: "apollo-b2b-person-enrichment-x402",
      title: "Apollo.io B2B Person Enrichment & Verified Email Finder (x402)",
      version: "0.2.0",
      description:
        "Zero-signup, pay-per-call B2B Person Enrichment, Work Email Finder & LinkedIn-to-Email Resolver powered by Apollo.io ($0.10 USDC on Base via x402).",
      homepage: origin,
    },
    transport: {
      type: "streamable-http",
      endpoint: `${origin}/api/mcp`,
    },
    payment: {
      protocol: "x402",
      network: cfg.network,
      priceUsd: cfg.priceUsd,
      currency: "USDC",
      recipientWallet: cfg.payTo,
    },
    tools: [
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
        inputSchema: PERSON_ENRICH_JSON_SCHEMA.input,
      },
    ],
  });
}
