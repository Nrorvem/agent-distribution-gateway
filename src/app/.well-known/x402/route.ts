import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, buildX402Challenge, resolveGatewayOrigin } from "@/lib/x402-gate";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";

/**
 * GET /.well-known/x402
 * Machine-readable x402 resource discovery manifest for x402scan, Bazaar crawlers,
 * and autonomous agent payment routers.
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const enrichUrl = `${origin}/api/v1/enrich/person`;
  const description =
    `Apollo.io B2B Person Enrichment & Verified Work Email Finder ($${cfg.priceUsd} USDC on Base — Free-on-Miss: $0.00 charged if no deliverable email is found)`;

  return NextResponse.json(
    {
      // Manifest format version (x402scan / AgentCash `/.well-known/x402` spec, e.g. stableenrich.dev).
      // NOT the protocol version — keep at 1. Protocol version is `x402Version` below.
      version: 1,
      x402Version: 2,
      seller: {
        name: "Apollo.io B2B Person Enrichment & Verified Work Email Finder (x402)",
        description,
        url: origin,
      },
      ownershipProofs: cfg.ownershipProofs,
      resources: [
        `${origin}/api/v1/enrich/person`,
        `${origin}/api/mcp`,
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
          freeOnMiss: true,
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
