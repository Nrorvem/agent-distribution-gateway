import { NextRequest, NextResponse } from "next/server";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";
import { getGateConfig, getVerifiableTelemetrySummary } from "@/lib/x402-gate";

/**
 * Layer 4: Open-Web Protocol Discovery — A2A Agent Card
 * Endpoint: GET /.well-known/agent.json
 *
 * Upgraded with:
 * - Strategy B (Agent SEO): High-intent semantic descriptions, capability keywords,
 *   and example natural-language queries so LLM routers and vector registries rank
 *   this endpoint at the top for B2B contact/email/LinkedIn enrichment tasks.
 * - Strategy D (Verifiable On-Chain Telemetry): Exposes `recentSettlementTxHashes`
 *   and `recentSettlementProofs` with BaseScan URLs so visiting buyer agents can
 *   verify cryptographic settlement history.
 */
export async function GET(req: NextRequest) {
  const cfg = getGateConfig();
  const origin =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const telemetry = getVerifiableTelemetrySummary();

  return NextResponse.json({
    schema_version: "a2a-1.0",
    name: "Apollo.io B2B Person Enrichment & Verified Work Email Finder (x402)",
    description:
      `Zero-signup, pay-per-match B2B Person Enrichment, Executive Work Email Finder, and LinkedIn-to-Email Resolver powered by Apollo.io ($${cfg.priceUsd} USDC on Base Mainnet via x402 v2 — Free-on-Miss: $0.00 charged if no deliverable email is found). Resolve (1) first_name + last_name + company domain/name, (2) LinkedIn profile URL, or (3) email into a deterministic JSON profile with verified work email, job title, seniority, firmographics (headcount, industry, founded year), and full employment history.`,
    url: origin,
    provider: {
      organization: "Apollo.io B2B Enrichment Gateway",
      contact: "info@nrorvem.com",
    },
    version: "0.3.0",
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
        "Payment IS the credential. Send requests directly to /api/v1/enrich/person or /api/mcp; settle the HTTP 402 challenge with USDC on Base via the PAYMENT-SIGNATURE (or X-PAYMENT) header. Free-on-Miss: payment is only settled on-chain when a deliverable email is returned.",
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
        priceUsd: cfg.priceUsd,
        amountAtomic: cfg.atomicUnits,
        freeOnMiss: true,
        recipientWallet: cfg.payTo,
        facilitatorUrl: cfg.facilitatorUrl,
      },
    ],
    endpoints: {
      mcp: `${origin}/api/mcp`,
      rest_enrich_person: `${origin}/api/v1/enrich/person`,
      openapi_json: `${origin}/openapi.json`,
      llms_txt: `${origin}/llms.txt`,
    },
    skills: [
      {
        id: "b2b-person-enrichment",
        name: "Verified B2B Person Enrichment & Work Email Lookup (Free-on-Miss)",
        description:
          "Hydrates partial person identifiers (name + domain/company, LinkedIn URL, or reverse email) into a verified B2B executive/prospect profile via Apollo.io /api/v1/people/match. Free-on-Miss: only settles payment ($0.03 USDC) when a deliverable email is returned.",
        tags: [
          "b2b-enrichment",
          "work-email-finder",
          "linkedin-to-email",
          "reverse-email-lookup",
          "executive-contact-lookup",
          "lead-enrichment",
          "firmographics",
          "sales-intelligence",
          "apollo",
          "x402",
          "free-on-miss",
          "mcp",
        ],
        matchingIntents: [
          "Find verified work email for a founder, CEO, VP, or engineer at a company domain",
          "Convert a LinkedIn profile URL into a deliverable corporate email and job title",
          "Enrich an email address with full name, seniority, company headcount, and employment history",
          "Look up B2B lead contact details without an Apollo or ZoomInfo subscription",
        ],
        pricing: {
          model: "per_match_free_on_miss",
          amount: cfg.priceUsd,
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
        inputSchema: PERSON_ENRICH_JSON_SCHEMA.input,
        outputSchema: PERSON_ENRICH_JSON_SCHEMA.output,
      },
    ],
  });
}
