/**
 * Regression Test: Ensures `buildX402Challenge` without a spec remains 100% byte-identical
 * to the original implementation, validates `usdToAtomicUnits` arithmetic,
 * and asserts that every product in the catalog produces a Base64 PAYMENT-REQUIRED header < 7 KB.
 */

import {
  buildX402Challenge,
  encodePaymentRequiredHeader,
  usdToAtomicUnits,
} from "../src/lib/x402-gate.ts";
import { APOLLO_PRODUCTS } from "../src/verticals/option-a-apollo/catalog.ts";

const EXPECTED_PERSON_CHALLENGE_JSON = JSON.stringify({
  x402Version: 2,
  error:
    "Payment Required. Attach a signed x402 USDC payment payload in the PAYMENT-SIGNATURE (or X-PAYMENT) header. Free-on-Miss: your payment is ONLY settled on-chain if a verified person profile with a deliverable email is found ($0.00 charged on misses).",
  resource: {
    url: "https://enrichmatch.dev/api/v1/enrich/person",
    description: "Apollo.io B2B Person Enrichment & Verified Work Email Finder",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "30000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC",
      maxTimeoutSeconds: 60,
      extra: {
        name: "USD Coin",
        version: "2",
      },
    },
  ],
  extensions: {
    bazaar: {
      info: {
        input: {
          type: "http",
          method: "POST",
          bodyType: "json",
          discoverable: true,
          body: {
            first_name: "Fidji",
            last_name: "Simo",
            domain: "instacart.com",
          },
        },
        output: {
          type: "json",
          example: {
            matched: true,
            payment_settled: true,
            timestamp: "2026-10-17T23:00:39.000Z",
            latency_ms: 420,
            source: "apollo_live",
            person: {
              apollo_id: "64a1b2c3d4e5f60001234567",
              full_name: "Fidji Simo",
              title: "CEO & Chair",
              seniority: "c_suite",
              departments: ["c_suite"],
              email: "fidji@instacart.com",
              email_status: "verified",
              linkedin_url: "https://www.linkedin.com/in/fidjisimo",
              location: {
                city: "San Francisco",
                state: "California",
                country: "United States",
              },
              organization: {
                id: "5f1a2b3c4d5e6f0001112222",
                name: "Instacart",
                website_url: "https://www.instacart.com",
                primary_domain: "instacart.com",
                industry: "information technology & services",
                estimated_num_employees: 3000,
                linkedin_url: "https://www.linkedin.com/company/instacart",
                founded_year: 2012,
              },
              employment_history: [
                {
                  title: "CEO & Chair",
                  organization_name: "Instacart",
                  start_date: "2021-08-01",
                  end_date: "present",
                  current: true,
                },
              ],
            },
          },
        },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["input", "output"],
        properties: {
          input: {
            type: "object",
            required: ["type", "method", "bodyType", "body"],
            properties: {
              type: { type: "string", const: "http" },
              method: { type: "string", enum: ["POST"] },
              bodyType: { type: "string", enum: ["json"] },
              discoverable: { type: "boolean" },
              body: {
                type: "object",
                additionalProperties: true,
                description:
                  "Provide at least one identifier: linkedin_url, email, id, name, or first_name + last_name + domain/organization_name/company. Free-on-Miss ($0.03 USDC settled only when deliverable email found).",
                anyOf: [
                  { required: ["linkedin_url"] },
                  { required: ["email"] },
                  { required: ["id"] },
                  { required: ["first_name", "last_name"] },
                  { required: ["name"] },
                  { required: ["first_name", "domain"] },
                  { required: ["first_name", "organization_name"] },
                  { required: ["first_name", "company"] },
                  { required: ["last_name", "domain"] },
                  { required: ["last_name", "organization_name"] },
                  { required: ["last_name", "company"] },
                ],
                properties: {
                  first_name: { type: "string", description: "First name (e.g., 'Fidji')." },
                  last_name: { type: "string", description: "Last name (e.g., 'Simo')." },
                  name: { type: "string", description: "Full name (e.g., 'Fidji Simo')." },
                  domain: { type: "string", description: "Company domain (e.g., 'instacart.com')." },
                  organization_name: { type: "string", description: "Company name (e.g., 'Instacart')." },
                  company: { type: "string", description: "Company name or domain alias." },
                  email: { type: "string", description: "Work or personal email for reverse lookup." },
                  linkedin_url: { type: "string", description: "Public LinkedIn profile URL." },
                  id: { type: "string", description: "Apollo.io person ID." },
                  reveal_personal_emails: {
                    type: "boolean",
                    description: "Include personal emails if work email unavailable.",
                  },
                },
              },
            },
          },
          output: {
            type: "object",
            required: ["type", "example"],
            properties: {
              type: { type: "string", const: "json" },
              example: {
                type: "object",
                required: ["matched", "timestamp", "latency_ms", "source", "person"],
                properties: {
                  matched: { type: "boolean", description: "True if verified person matched." },
                  payment_settled: { type: "boolean", description: "False ($0.00 charged) on miss." },
                  timestamp: { type: "string" },
                  latency_ms: { type: "number" },
                  source: { type: "string", enum: ["apollo_live", "apollo_mock"] },
                  person: {
                    type: "object",
                    description: "Hydrated B2B profile (null on miss).",
                    properties: {
                      apollo_id: { type: "string" },
                      first_name: { type: "string" },
                      last_name: { type: "string" },
                      full_name: { type: "string" },
                      title: { type: "string" },
                      headline: { type: "string" },
                      seniority: { type: "string" },
                      departments: { type: "array", items: { type: "string" } },
                      email: { type: "string", description: "Verified work email address." },
                      email_status: { type: "string" },
                      linkedin_url: { type: "string" },
                      location: {
                        type: "object",
                        properties: {
                          city: { type: "string" },
                          state: { type: "string" },
                          country: { type: "string" },
                        },
                      },
                      organization: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          website_url: { type: "string" },
                          primary_domain: { type: "string" },
                          industry: { type: "string" },
                          estimated_num_employees: { type: "number" },
                          linkedin_url: { type: "string" },
                          founded_year: { type: "number" },
                        },
                      },
                      employment_history: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            organization_name: { type: "string" },
                            start_date: { type: "string" },
                            end_date: { type: "string" },
                            current: { type: "boolean" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

function runAssertions() {
  console.log("Checking usdToAtomicUnits assertions...");
  if (usdToAtomicUnits("0.03") !== "30000") {
    throw new Error(`Expected usdToAtomicUnits("0.03") === "30000", got ${usdToAtomicUnits("0.03")}`);
  }
  if (usdToAtomicUnits("0.025") !== "25000") {
    throw new Error(`Expected usdToAtomicUnits("0.025") === "25000", got ${usdToAtomicUnits("0.025")}`);
  }
  if (usdToAtomicUnits("0.15") !== "150000") {
    throw new Error(`Expected usdToAtomicUnits("0.15") === "150000", got ${usdToAtomicUnits("0.15")}`);
  }

  console.log("Checking buildX402Challenge regression without spec...");
  const challenge = buildX402Challenge(
    "https://enrichmatch.dev/api/v1/enrich/person",
    "Apollo.io B2B Person Enrichment & Verified Work Email Finder"
  );
  const actualJson = JSON.stringify(challenge);

  if (actualJson !== EXPECTED_PERSON_CHALLENGE_JSON) {
    console.error("ACTUAL:\n", actualJson);
    console.error("\nEXPECTED:\n", EXPECTED_PERSON_CHALLENGE_JSON);
    throw new Error("Regression detected: buildX402Challenge output changed!");
  }

  console.log("Checking catalog product header sizes (< 7 KB limit)...");
  for (const product of APOLLO_PRODUCTS) {
    const spec = {
      priceUsd: product.pricing.unitUsd(),
      bazaar: product.bazaar(),
    };
    const prodChallenge = buildX402Challenge(
      `https://enrichmatch.dev${product.path}`,
      product.title,
      spec
    );
    const headerBase64 = encodePaymentRequiredHeader(prodChallenge);
    const headerSizeBytes = Buffer.byteLength(headerBase64, "utf-8");
    console.log(`  - [${product.id}] ${product.path}: ${headerSizeBytes} bytes`);
    if (headerSizeBytes >= 7168) {
      throw new Error(
        `PAYMENT-REQUIRED header for ${product.id} exceeds 7 KB: ${headerSizeBytes} bytes`
      );
    }
  }

  console.log("OK: All challenge regression and header size assertions passed!");
}

runAssertions();
