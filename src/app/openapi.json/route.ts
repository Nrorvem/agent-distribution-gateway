import { NextResponse } from "next/server";
import { getGateConfig } from "@/lib/x402-gate";
import { PERSON_ENRICH_JSON_SCHEMA } from "@/verticals/option-a-apollo/schema";

const PUBLIC_ORIGIN =
  process.env.PUBLIC_GATEWAY_ORIGIN || "https://agent-distribution-gateway.vercel.app";

/**
 * GET /openapi.json
 * Canonical OpenAPI 3.1.0 discovery contract for x402scan, AgentCash, and autonomous agents.
 * Implements the exact x402scan discovery specification (https://www.x402scan.com/discovery/spec).
 */
export async function GET() {
  const cfg = getGateConfig();
  const fixedUsdAmount = Number(cfg.priceUsd).toFixed(6);

  const openApiSpec = {
    openapi: "3.1.0",
    info: {
      title: "Apollo.io B2B Person Enrichment & Verified Work Email Finder",
      version: "1.0.0",
      description:
        "Zero-signup, pay-per-call B2B Person Enrichment, Executive Work Email Finder, and LinkedIn-to-Email Resolver powered by Apollo.io. Settled per call ($0.10 USDC on Base Mainnet) via x402 v2.",
      "x-guidance":
        "Use POST /api/v1/enrich/person to enrich a B2B professional profile and resolve their verified work email, job title, seniority, LinkedIn URL, and current employer via Apollo.io. Provide a JSON body containing at least one of: (1) linkedin_url, (2) email, or (3) first_name + last_name + domain (or organization_name). Calls without payment return an HTTP 402 x402 v2 challenge in the PAYMENT-REQUIRED header and JSON body ($0.10 USDC on Base Mainnet eip155:8453). Retry with your signed x402 payload in PAYMENT-SIGNATURE (or X-PAYMENT).",
    },
    servers: [
      {
        url: PUBLIC_ORIGIN,
        description: "Production Agent Distribution Gateway",
      },
    ],
    paths: {
      "/api/v1/enrich/person": {
        post: {
          operationId: "enrichPerson",
          summary: "Enrich B2B person profile and find verified work email via Apollo.io",
          description: PERSON_ENRICH_JSON_SCHEMA.description,
          tags: ["B2B Enrichment", "Email Finder", "Apollo"],
          "x-payment-info": {
            price: {
              mode: "fixed",
              currency: "USD",
              amount: fixedUsdAmount,
            },
            protocols: [{ x402: {} }],
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: PERSON_ENRICH_JSON_SCHEMA.input.properties,
                  required: ["first_name", "last_name", "domain"],
                  additionalProperties: false,
                },
                example: {
                  first_name: "Fidji",
                  last_name: "Simo",
                  domain: "instacart.com",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful B2B person enrichment response",
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
