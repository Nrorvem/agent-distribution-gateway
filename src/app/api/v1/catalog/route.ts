/**
 * Full-Funnel Product Catalog Endpoint (FREE)
 * GET /api/v1/catalog
 *
 * Exposes complete product metadata, pricing, schemas, and chaining workflows
 * for autonomous AI agents and aggregators.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, resolveGatewayOrigin } from "@/lib/x402-gate";
import { APOLLO_PRODUCTS } from "@/verticals/option-a-apollo/catalog";

export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);

  const workflow = [
    {
      step: 1,
      stage: "Account Discovery (Search Organizations)",
      tool: "search_organizations",
      rest: "POST /api/v1/search/organizations",
      price_usd: "0.02",
      description: "Discover high-intent accounts by industry, employee count, keywords, or location.",
      example_body: {
        keywords: "sales intelligence",
        employee_ranges: ["51,200"],
        per_page: 5,
      },
      chains_to: ["search_people (via primary_domain or id)", "enrich_organization (via primary_domain)"],
    },
    {
      step: 2,
      stage: "Decision Maker Discovery (Search People)",
      tool: "search_people",
      rest: "POST /api/v1/search/people",
      price_usd: "0.01",
      description: "Find relevant leads at target domains by job titles or seniority levels (0 credits upstream).",
      example_body: {
        organization_domains: ["apollo.io"],
        person_titles: ["VP Sales", "Head of Growth"],
        per_page: 10,
      },
      chains_to: ["enrich_person (via apollo_id)", "bulk_enrich_people (via apollo_ids)"],
    },
    {
      step: 3,
      stage: "Lead Enrichment & Deliverable Work Email Resolution",
      tool: "enrich_person",
      rest: "POST /api/v1/enrich/person",
      price_usd: "0.03",
      description: "Resolve verified deliverable work email, employment history, and mobile status. Free-on-Miss ($0.00 on miss).",
      example_body: {
        id: "64a7ff0cc4dfae00013df1a5",
      },
      chains_to: ["enrich_organization (via company domain)"],
    },
    {
      step: 4,
      stage: "Account Firmographics & Tech Stack Resolution",
      tool: "enrich_organization",
      rest: "POST /api/v1/enrich/organization",
      price_usd: "0.02",
      description: "Enrich complete company firmographics, funding rounds, revenue, and tech stack by domain.",
      example_body: {
        domain: "apollo.io",
      },
      chains_to: ["search_people (via organization_ids)"],
    },
    {
      step: 5,
      stage: "High-Throughput Batch Operations",
      tool: "bulk_enrich_people",
      rest: "POST /api/v1/enrich/people/bulk",
      price_usd: "0.025 / record (up to 10)",
      description: "Batch person enrichment for high-throughput pipeline agents. Settled on-chain only if >= 1 deliverable email found.",
      example_body: {
        details: [
          { first_name: "Tim", last_name: "Zheng", domain: "apollo.io" },
        ],
      },
      chains_to: [],
    },
  ];

  const products = APOLLO_PRODUCTS.map((p) => ({
    id: p.id,
    tool: p.mcpTool,
    path: p.path,
    url: `${origin}${p.path}`,
    title: p.title,
    summary: p.summary,
    description: p.description,
    stage: p.funnelStage,
    tags: p.tags,
    pricing: {
      unit_usd: p.pricing.unitUsd(),
      per: p.pricing.per,
      max_units: p.pricing.maxUnits,
      billing_rule: p.pricing.billingRule,
      free_on_miss: true,
    },
    input_schema: p.inputSchema,
    example_input: p.exampleInput,
    example_output: p.exampleOutput,
  }));

  return NextResponse.json(
    {
      origin,
      network: cfg.networkCaip2,
      legacyNetwork: cfg.network,
      asset: cfg.asset,
      payTo: cfg.payTo,
      payment_protocol: "x402",
      x402_version: 2,
      facilitators: [
        cfg.facilitatorUrl,
        cfg.fallbackFacilitatorUrl,
      ],
      products,
      workflow,
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
