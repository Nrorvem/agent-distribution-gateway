import { NextResponse } from "next/server";
import { getGateConfig, buildX402Challenge } from "@/lib/x402-gate";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";

const PUBLIC_ORIGIN =
  process.env.PUBLIC_GATEWAY_ORIGIN || "https://agent-distribution-gateway.vercel.app";

/**
 * GET /.well-known/x402
 * Machine-readable x402 resource discovery manifest for x402scan, Bazaar crawlers,
 * and autonomous agent payment routers.
 */
export async function GET() {
  const cfg = getGateConfig();
  const enrichUrl = `${PUBLIC_ORIGIN}/api/v1/enrich/person`;
  const description =
    "Apollo.io B2B Person Enrichment & Verified Work Email Finder (Zero-Signup, Pay-Per-Call via x402 on Base)";

  return NextResponse.json(
    {
      x402Version: 2,
      seller: {
        name: "Apollo.io B2B Person Enrichment & Verified Work Email Finder (x402)",
        description,
        url: PUBLIC_ORIGIN,
      },
      resources: [
        `${PUBLIC_ORIGIN}/api/v1/enrich/person`,
        `${PUBLIC_ORIGIN}/api/mcp`,
      ],
      endpoints: [
        {
          path: "/api/v1/enrich/person",
          url: enrichUrl,
          method: "POST",
          description,
          price: cfg.priceUsd,
          amount: cfg.atomicUnits,
          currency: "USDC",
          asset: cfg.asset,
          network: cfg.networkCaip2,
          networks: ["eip155:8453"],
          payTo: cfg.payTo,
          facilitatorUrl: cfg.facilitatorUrl,
          inputSchema: PERSON_ENRICH_JSON_SCHEMA.input,
          outputSchema: PERSON_ENRICH_JSON_SCHEMA.output,
          challenge: buildX402Challenge(enrichUrl, description),
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
