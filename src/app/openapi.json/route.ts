import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, resolveGatewayOrigin } from "@/lib/x402-gate";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";

/**
 * GET /openapi.json
 * Canonical OpenAPI 3.1.0 discovery contract for x402scan, AgentCash, and autonomous agents.
 * Implements the exact x402scan discovery specification (https://www.x402scan.com/discovery/spec).
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const fixedUsdAmount = Number(cfg.priceUsd).toFixed(6);

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
      title: "Apollo.io B2B Person Enrichment & Verified Work Email Finder",
      version: "1.1.0",
      description:
        `Zero-signup, pay-per-match B2B Person Enrichment, Executive Work Email Finder, and LinkedIn-to-Email Resolver powered by Apollo.io. Only $${cfg.priceUsd} USDC on Base Mainnet via x402 v2 — Free-on-Miss ($0.00 charged if no deliverable email is found).`,
      contact: {
        email: "info@nrorvem.com",
      },
      "x-guidance":
        `Use POST /api/v1/enrich/person to enrich a B2B professional profile and resolve their verified work email, job title, seniority, LinkedIn URL, and current employer via Apollo.io. Accepts flexible partial identifiers—provide any of: (1) linkedin_url (or linkedin), (2) email, (3) name (or first_name + last_name) with company/organization_name or domain (supports fuzzy company names like 'Meta' or 'Google' as well as domains like 'instacart.com'), or (4) Apollo person id. Free-on-Miss guarantee: payment ($${cfg.priceUsd} USDC on Base Mainnet eip155:8453) is verified first and ONLY settled on-chain when a verified person profile with a deliverable email is returned ($0.00 charged on misses). Calls without payment return an HTTP 402 x402 v2 challenge in the PAYMENT-REQUIRED header and JSON body. Retry with your signed x402 payload in PAYMENT-SIGNATURE (or X-PAYMENT).`,
    },
    servers: [
      {
        url: origin,
        description: "Production Agent Distribution Gateway",
      },
    ],
    paths: {
      "/api/v1/enrich/person": {
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
          },
        },
      },
    },
  };

  return NextResponse.json(openApiSpec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
