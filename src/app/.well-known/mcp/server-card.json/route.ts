import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, resolveGatewayOrigin } from "@/lib/x402-gate";
import { getMcpToolsList } from "@/verticals/option-a-apollo/catalog";

/**
 * Layer 4: MCP Static Server Card Discovery
 * Endpoint: GET /.well-known/mcp/server-card.json
 *
 * Used by Smithery.ai URL scanner and remote MCP registries to automatically
 * extract serverInfo and tool schemas over HTTPS without needing a public GitHub repo.
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);

  return NextResponse.json({
    serverInfo: {
      name: "apollo-b2b-full-funnel-gateway-x402",
      title: "Apollo.io Full-Funnel B2B Data Gateway (x402)",
      version: "0.4.0",
      description:
        "Full-funnel B2B data suite: Company Search, People Search, Person Enrichment & Work Email Lookup, Firmographics & Bulk Operations powered by Apollo.io on Base via x402 v2 (Free-on-Miss).",
      homepage: origin,
    },
    transport: {
      type: "streamable-http",
      endpoint: `${origin}/api/mcp`,
    },
    payment: {
      protocol: "x402",
      x402Version: 2,
      network: cfg.networkCaip2,
      priceUsd: cfg.priceUsd,
      priceUsdMin: "0.01",
      priceUsdMax: "0.03",
      freeOnMiss: true,
      currency: "USDC",
      recipientWallet: cfg.payTo,
    },
    tools: getMcpToolsList(),
  });
}
