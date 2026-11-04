import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, getVerifiableTelemetrySummary, resolveGatewayOrigin } from "@/lib/x402-gate";
import { APOLLO_PRODUCTS } from "@/verticals/option-a-apollo/catalog";

/**
 * Layer 4: Open-Web Protocol Discovery — A2A Agent Card
 * Endpoint: GET /.well-known/agent.json
 *
 * Full-funnel edition with:
 * - Complete A2A skills across Search Organizations, Search People, Enrich Person, Enrich Org, Bulk
 * - Verifiable On-Chain Telemetry (BaseScan URLs)
 * - Free-on-Miss cryptographic settlement guarantees
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const telemetry = await getVerifiableTelemetrySummary();

  const endpointsMap: Record<string, string> = {
    mcp: `${origin}/api/mcp`,
    catalog: `${origin}/api/v1/catalog`,
    openapi_json: `${origin}/openapi.json`,
    llms_txt: `${origin}/llms.txt`,
  };
  for (const p of APOLLO_PRODUCTS) {
    endpointsMap[`rest_${p.id}`] = `${origin}${p.path}`;
  }

  const skills = APOLLO_PRODUCTS.map((p) => {
    return {
      id: p.id.replace(/_/g, "-"),
      name: p.title,
      description: `${p.description} Free-on-Miss: ${p.pricing.billingRule}`,
      tags: [...p.tags, "x402", "free-on-miss", "mcp", "base-usdc"],
      matchingIntents: [
        `Execute ${p.title} without an Apollo subscription`,
        `Pay-per-call ${p.mcpTool} via x402 on Base`,
        `Full-funnel B2B workflow step: ${p.funnelStage}`,
      ],
      pricing: {
        model: "free_on_miss",
        unitPriceUsd: p.pricing.unitUsd(),
        per: p.pricing.per,
        currency: "USDC",
        network: cfg.networkCaip2,
        freeOnMiss: true,
      },
      sla: {
        p95LatencyMs: 850,
        averageLatencyMs: telemetry.averageLatencyMs,
        uptimeTarget: "99.9%",
        attributeCompletenessTarget: "95%+",
        fulfillmentSuccessRate: telemetry.fulfillmentSuccessRate,
        freeOnMiss: true,
        recentCompletedTransactions: telemetry.totalCompletedTransactions,
        verifiedOnChainSettlements: telemetry.verifiedOnChainSettlements,
        recentSettlementTxHashes: telemetry.recentSettlementTxHashes,
        recentSettlementProofs: telemetry.recentSettlementProofs,
      },
      inputSchema: p.inputSchema,
      outputSchema: p.outputSchema,
    };
  });

  return NextResponse.json({
    schema_version: "a2a-1.0",
    name: "Apollo.io Full-Funnel B2B Data Gateway (x402)",
    description:
      "Zero-signup, pay-per-call full-funnel B2B intelligence for AI agents: Company Search ($0.02), People Search ($0.01), Person Enrichment & Work Email Resolution ($0.03), Company Firmographics & Tech Stack ($0.02), and Bulk Batch Processing ($0.015-$0.025/ea) on Base Mainnet via x402 v2 — Free-on-Miss ($0.00 charged if zero billable results found).",
    url: origin,
    provider: {
      organization: "Apollo.io B2B Enrichment Gateway",
      contact: "info@nrorvem.com",
    },
    version: "0.4.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
      zeroSignupExecution: true,
      prePaymentInputValidation: true,
      freeOnMiss: true,
    },
    authentication: {
      schemes: ["x402"],
      credentialsRequired: false,
      description:
        "Payment IS the credential. Send requests directly to REST endpoints or /api/mcp; settle the HTTP 402 challenge with USDC on Base via the PAYMENT-SIGNATURE (or X-PAYMENT) header. Free-on-Miss: payments are only settled on-chain when verified deliverable results are found.",
    },
    paymentRails: [
      {
        protocol: "x402",
        version: 2,
        x402Version: 2,
        network: cfg.networkCaip2,
        legacyNetwork: cfg.network,
        asset: cfg.asset,
        symbol: "USDC",
        priceUsdMin: "0.01",
        priceUsdMax: "0.03",
        freeOnMiss: true,
        recipientWallet: cfg.payTo,
        facilitatorUrl: cfg.facilitatorUrl,
      },
    ],
    endpoints: endpointsMap,
    skills,
  });
}
