import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, resolveGatewayOrigin } from "@/lib/x402-gate";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";
import { APOLLO_PRODUCTS } from "@/verticals/option-a-apollo/catalog";

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * GET /openapi.json
 * Canonical OpenAPI 3.1.0 discovery contract for x402scan, AgentCash, and autonomous agents.
 * Implements the exact x402scan discovery specification (https://www.x402scan.com/discovery/spec).
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const fixedUsdAmount = Number(cfg.priceUsd).toFixed(6);

  const paths: Record<string, any> = {};

  for (const product of APOLLO_PRODUCTS) {
    if (product.id === "enrich_person") {
      // Keep exact legacy specification for live verified endpoint
      paths["/api/v1/enrich/person"] = {
        post: {
          operationId: "enrichPerson",
          summary: "Enrich B2B person profile and find verified work email via Apollo.io ($0.03 USDC — Free on Miss)",
          description: PERSON_ENRICH_JSON_SCHEMA.input.description,
          tags: ["B2B Enrichment", "Email Finder", "Apollo", "Free on Miss"],
          "x-payment-info": {
            price: {
              mode: "fixed",
              currency: "USD",
              amount: fixedUsdAmount,
            },
            freeOnMiss: true,
            protocols: [{ x402: {} }],
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: PERSON_ENRICH_JSON_SCHEMA.input.description,
                  anyOf: PERSON_ENRICH_JSON_SCHEMA.input.anyOf,
                  properties: PERSON_ENRICH_JSON_SCHEMA.input.properties,
                  additionalProperties: true,
                },
                example: {
                  first_name: "Fidji",
                  last_name: "Simo",
                  domain: "instacart.com",
                },
                examples: {
                  by_name_and_domain: {
                    summary: "Enrich by first/last name + domain",
                    value: {
                      first_name: "Fidji",
                      last_name: "Simo",
                      domain: "instacart.com",
                    },
                  },
                  by_name_and_fuzzy_company: {
                    summary: "Enrich by full name + fuzzy company name",
                    value: {
                      name: "Mark Zuckerberg",
                      company: "Meta",
                    },
                  },
                  by_linkedin_url: {
                    summary: "Enrich by LinkedIn URL only",
                    value: {
                      linkedin_url: "https://www.linkedin.com/in/tim-zheng",
                    },
                  },
                  by_email: {
                    summary: "Reverse-enrich by email address only",
                    value: {
                      email: "tim@apollo.io",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful B2B person enrichment response (Free on Miss: payment_settled=false and $0.00 charged if no deliverable email is found)",
              content: {
                "application/json": {
                  schema: PERSON_ENRICH_JSON_SCHEMA.output,
                },
              },
            },
            "402": {
              description: "Payment Required",
            },
            "422": {
              description: "Invalid input parameters",
            },
          },
        },
      };
      continue;
    }

    const unitPrice = product.pricing.unitUsd();
    const formattedPrice = Number(unitPrice).toFixed(6);

    paths[product.path] = {
      post: {
        operationId: toCamelCase(product.id),
        summary: `${product.title} ($${unitPrice} USDC / ${product.pricing.per} — Free on Miss)`,
        description: product.description,
        tags: product.tags,
        "x-payment-info": {
          price:
            product.funnelStage === "bulk_enrich"
              ? {
                  mode: "dynamic",
                  currency: "USD",
                  min: Number(unitPrice).toFixed(6),
                  max: (Number(unitPrice) * (product.pricing.maxUnits || 10)).toFixed(6),
                }
              : {
                  mode: "fixed",
                  currency: "USD",
                  amount: formattedPrice,
                },
          freeOnMiss: true,
          protocols: [{ x402: {} }],
          ...(product.funnelStage === "bulk_enrich"
            ? { "x-pricing-note": product.pricing.billingRule }
            : {}),
        },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: product.inputSchema,
              example: product.exampleInput,
            },
          },
        },
        responses: {
          "200": {
            description: `Successful execution (${product.pricing.billingRule})`,
            content: {
              "application/json": {
                schema: product.outputSchema,
              },
            },
          },
          "402": {
            description: "Payment Required (x402 challenge)",
          },
          "422": {
            description: "Invalid input parameters",
          },
        },
      },
    };
  }

  const openApiSpec = {
    openapi: "3.1.0",
    "x-agentcash-owner": cfg.payTo,
    "x-discovery": {
      ownershipProofs: cfg.ownershipProofs,
    },
    "x-agentcash-provenance": {
      ownershipProofs: cfg.ownershipProofs,
    },
    info: {
      title: "Apollo.io B2B Data API — People & Company Search, Person & Organization Enrichment, Bulk Enrichment (x402)",
      version: "1.2.0",
      description:
        `Zero-signup, pay-per-call B2B data API powered by Apollo.io on Base Mainnet via x402 v2. Full-funnel intelligence: Search Organizations ($0.02) -> Search People ($0.01) -> Enrich Person ($0.03) / Bulk Enrich People ($0.025/ea); Enrich Organization ($0.02) / Bulk Enrich Organizations ($0.015/ea). Free-on-Miss: $0.00 charged if no deliverable match is found.`,
      contact: {
        email: "info@nrorvem.com",
      },
      "x-guidance":
        `Full-Funnel B2B Workflow for AI Agents: (1) Use POST /api/v1/search/organizations to discover target companies by keywords, industry, or employee count. (2) Use POST /api/v1/search/people with target domains or organization IDs to find relevant decision makers (0 credits upstream). (3) Use POST /api/v1/enrich/person or /api/v1/enrich/people/bulk with person IDs, LinkedIn URLs, or names + domains to resolve verified deliverable work emails. (4) Use POST /api/v1/enrich/organization to fetch complete firmographics, funding history, and tech stacks. Free-on-Miss guarantee: payments are verified first and ONLY settled on-chain when verified deliverable data is returned ($0.00 charged on misses). Unauthenticated calls return HTTP 402 with PAYMENT-REQUIRED header.`,
    },
    servers: [
      {
        url: origin,
        description: "EnrichMatch Full-Funnel B2B Gateway",
      },
    ],
    paths,
  };

  return NextResponse.json(openApiSpec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
