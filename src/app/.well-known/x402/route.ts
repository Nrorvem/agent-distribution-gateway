import { NextRequest, NextResponse } from "next/server";
import {
  getGateConfig,
  buildX402Challenge,
  resolveGatewayOrigin,
  usdToAtomicUnits,
} from "@/lib/x402-gate";
import { APOLLO_PRODUCTS } from "@/verticals/option-a-apollo/catalog";

/**
 * GET /.well-known/x402
 * Machine-readable x402 resource discovery manifest for x402scan, Bazaar crawlers,
 * and autonomous agent payment routers across the full Search -> Enrich funnel.
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);

  const resources = [
    `${origin}/api/mcp`,
    ...APOLLO_PRODUCTS.map((p) => `${origin}${p.path}`),
  ];

  const endpoints = APOLLO_PRODUCTS.map((product) => {
    const url = `${origin}${product.path}`;
    const unitPrice = product.pricing.unitUsd();
    // Probes (empty body) quote the per-unit price; bulk totals scale with submitted records.
    const probePriceUsd = unitPrice;
    const probeAtomic = usdToAtomicUnits(probePriceUsd);
    const spec = {
      priceUsd: probePriceUsd,
      bazaar: product.bazaar(),
    };

    return {
      path: product.path,
      url,
      method: product.method,
      description: `${product.title} ($${unitPrice} USDC / ${product.pricing.per} — Free on Miss: ${product.pricing.billingRule})`,
      price: probePriceUsd,
      priceUnit: unitPrice,
      amount: probeAtomic,
      currency: "USDC",
      asset: cfg.asset,
      network: cfg.networkCaip2,
      networks: ["eip155:8453"],
      payTo: cfg.payTo,
      freeOnMiss: true,
      facilitatorUrl: cfg.facilitatorUrl,
      inputSchema: product.inputSchema,
      outputSchema: product.outputSchema,
      challenge: buildX402Challenge(url, product.title, spec),
    };
  });

  return NextResponse.json(
    {
      version: 1,
      x402Version: 2,
      seller: {
        name: "Apollo.io Full-Funnel B2B Data Gateway (x402)",
        description:
          "Full-funnel B2B intelligence for AI agents: Organization Search, People Search, Person Enrichment, Organization Firmographics & Bulk Batches on Base Mainnet via x402 v2.",
        url: origin,
      },
      ownershipProofs: cfg.ownershipProofs,
      resources,
      endpoints,
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
