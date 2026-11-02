/**
 * Single Source of Truth Product Catalog for Option A (Apollo.io Gateway)
 *
 * Defines the complete Search -> Enrich funnel metadata, pricing rules, JSON schemas,
 * and Bazaar extensions across all discovery surfaces:
 * - OpenAPI 3.1.0 (/openapi.json)
 * - x402 Discovery (/.well-known/x402)
 * - A2A Agent Card (/.well-known/agent.json)
 * - MCP Server Card & tools/list (/api/mcp)
 * - Documentation (/llms.txt)
 * - Catalog Endpoint (/api/v1/catalog)
 */

import { PERSON_ENRICH_JSON_SCHEMA } from "./schema.ts";
import {
  PERSON_ENRICH_BAZAAR_EXTENSION,
  type PaidResourceSpec,
} from "../../lib/x402-gate.ts";
import {
  unitPriceUsd,
  totalPriceUsd,
  type ApolloProductId,
} from "./pricing.ts";

export interface ApolloProduct {
  id: ApolloProductId;
  path: string;
  method: "POST";
  mcpTool: string;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  funnelStage: "search" | "enrich" | "bulk_enrich" | "signals" | "composite";
  pricing: {
    unitUsd: () => string;
    per: "call" | "page" | "record" | "lead";
    maxUnits: number;
    billingRule: string;
  };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  exampleInput: Record<string, unknown>;
  exampleOutput: Record<string, unknown>;
  bazaar: () => Record<string, unknown>;
}

// 1. People Search Schemas & Examples
const PEOPLE_SEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
  description: "Search 275M+ professionals by title, seniority, company domain, keywords, or location.",
  properties: {
    person_titles: {
      type: "array",
      items: { type: "string" },
      description: "Job titles to filter by (e.g. ['CEO', 'VP Sales']).",
    },
    person_seniorities: {
      type: "array",
      items: {
        type: "string",
        enum: ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern"],
      },
      description: "Seniority levels.",
    },
    organization_domains: {
      type: "array",
      items: { type: "string" },
      description: "Company primary domains (e.g. ['apollo.io', 'stripe.com']).",
    },
    organization_ids: {
      type: "array",
      items: { type: "string" },
      description: "Apollo organization IDs from search_organizations.",
    },
    person_locations: {
      type: "array",
      items: { type: "string" },
      description: "Geographic locations (e.g. ['San Francisco', 'United States']).",
    },
    employee_ranges: {
      type: "array",
      items: { type: "string" },
      description: "Headcount ranges (e.g. ['1,10', '51,200', '1001,5000']).",
    },
    keywords: { type: "string", description: "Keyword search across bio and experience." },
    page: { type: "integer", minimum: 1, maximum: 5, default: 1 },
    per_page: { type: "integer", minimum: 1, maximum: 25, default: 10 },
  },
};

const PEOPLE_SEARCH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["matched", "source", "pagination", "people"],
  properties: {
    matched: { type: "boolean" },
    source: { type: "string", enum: ["apollo_live", "apollo_mock"] },
    pagination: {
      type: "object",
      properties: {
        page: { type: "integer" },
        per_page: { type: "integer" },
        total_entries: { type: "integer" },
        total_pages: { type: "integer" },
      },
    },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          apollo_id: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: ["string", "null"] },
          last_name_obfuscated: { type: ["string", "null"] },
          full_name: { type: ["string", "null"] },
          title: { type: "string" },
          seniority: { type: ["string", "null"] },
          linkedin_url: { type: ["string", "null"] },
          has_email: { type: "boolean" },
          location: {
            type: "object",
            properties: { city: { type: ["string", "null"] }, state: { type: ["string", "null"] }, country: { type: ["string", "null"] } },
          },
          organization: {
            type: "object",
            properties: { id: { type: ["string", "null"] }, name: { type: ["string", "null"] }, primary_domain: { type: ["string", "null"] } },
          },
          next_step: { type: "object" },
        },
      },
    },
    unlock: {
      type: "object",
      properties: {
        tool: { type: "string" },
        rest: { type: "string" },
        args: { type: "object" },
        remaining_batches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              details: { type: "array" },
            },
          },
        },
        estimated_price_usd: { type: "string" },
        description: { type: "string" },
      },
    },
  },
};

// 2. Organization Search Schemas & Examples
const ORG_SEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
  description: "Search 73M+ companies by name, domain, industry, location, or headcount.",
  properties: {
    organization_name: { type: "string", description: "Company name search (e.g. 'Instacart')." },
    domains: { type: "array", items: { type: "string" }, description: "Specific company domains." },
    keywords: { type: "string", description: "Keywords or tags." },
    organization_locations: { type: "array", items: { type: "string" }, description: "HQ locations." },
    employee_ranges: { type: "array", items: { type: "string" }, description: "Headcount ranges (e.g. ['51,200'])." },
    page: { type: "integer", minimum: 1, maximum: 5, default: 1 },
    per_page: { type: "integer", minimum: 1, maximum: 25, default: 10 },
  },
};

const ORG_SEARCH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["matched", "source", "pagination", "organizations"],
  properties: {
    matched: { type: "boolean" },
    source: { type: "string", enum: ["apollo_live", "apollo_mock"] },
    pagination: {
      type: "object",
      properties: {
        page: { type: "integer" },
        per_page: { type: "integer" },
        total_entries: { type: "integer" },
        total_pages: { type: "integer" },
      },
    },
    organizations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          primary_domain: { type: ["string", "null"] },
          website_url: { type: ["string", "null"] },
          industry: { type: ["string", "null"] },
          estimated_num_employees: { type: ["number", "null"] },
          linkedin_url: { type: ["string", "null"] },
          founded_year: { type: ["number", "null"] },
          city: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
          next_step: { type: "object" },
        },
      },
    },
  },
};

// 3. Organization Enrich Schemas & Examples
const ORG_ENRICH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
  description: "Company domain (required) to resolve full firmographics, funding, and tech stack.",
  properties: {
    domain: { type: "string", description: "Company primary domain (e.g. 'instacart.com')." },
    organization_name: { type: "string", description: "Company brand name (fallback)." },
  },
  anyOf: [{ required: ["domain"] }, { required: ["organization_name"] }],
};

const ORG_ENRICH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["matched", "source", "organization"],
  properties: {
    matched: { type: "boolean" },
    payment_settled: { type: "boolean" },
    source: { type: "string", enum: ["apollo_live", "apollo_mock"] },
    organization: {
      type: "object",
      properties: {
        apollo_id: { type: "string" },
        name: { type: "string" },
        primary_domain: { type: "string" },
        website_url: { type: "string" },
        industry: { type: "string" },
        industries: { type: "array", items: { type: "string" } },
        estimated_num_employees: { type: "number" },
        founded_year: { type: "number" },
        annual_revenue: { type: "number" },
        annual_revenue_printed: { type: "string" },
        total_funding: { type: "number" },
        total_funding_printed: { type: "string" },
        latest_funding_stage: { type: "string" },
        latest_funding_round_date: { type: "string" },
        phone: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        country: { type: "string" },
        short_description: { type: "string" },
        technologies: { type: "array", items: { type: "string" } },
        next_step: { type: "object" },
      },
    },
  },
};

// 4. Bulk People Enrich Schemas & Examples
const BULK_PERSON_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
  description: "Person identifiers: linkedin_url, email, id, or name + domain/organization_name.",
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
    name: { type: "string" },
    domain: { type: "string" },
    organization_name: { type: "string" },
    company: { type: "string" },
    email: { type: "string" },
    linkedin_url: { type: "string" },
    id: { type: "string" },
  },
};

const BULK_PERSON_ENRICH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["details"],
  description: "Batch of 1 to 10 person records to enrich with verified deliverable emails.",
  properties: {
    details: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: BULK_PERSON_ITEM_SCHEMA,
      description: "Array of 1 to 10 person identifier objects.",
    },
    reveal_personal_emails: { type: "boolean", default: false },
  },
};

const BULK_PERSON_ENRICH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["matched", "submitted_count", "matched_count", "billable_count", "results"],
  properties: {
    matched: { type: "boolean" },
    payment_settled: { type: "boolean" },
    submitted_count: { type: "integer" },
    matched_count: { type: "integer" },
    billable_count: { type: "integer" },
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          original_indices: {
            type: "array",
            items: { type: "integer" },
            description: "Original 0-based indices from the submitted batch that map to this record.",
          },
          input_echo: { type: "object" },
          matched: { type: "boolean" },
          person: { type: ["object", "null"] },
        },
      },
    },
  },
};

// 5. Bulk Organization Enrich Schemas & Examples
const BULK_ORG_ENRICH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["domains"],
  description: "Batch of 1 to 10 company domains to enrich firmographics.",
  properties: {
    domains: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string" },
      description: "Array of 1 to 10 company domains (e.g. ['apollo.io', 'stripe.com']).",
    },
  },
};

const BULK_ORG_ENRICH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["matched", "submitted_count", "matched_count", "results"],
  properties: {
    matched: { type: "boolean" },
    payment_settled: { type: "boolean" },
    submitted_count: { type: "integer" },
    matched_count: { type: "integer" },
    skipped: { type: "array", items: { type: "string" } },
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          domain: { type: "string" },
          matched: { type: "boolean" },
          organization: { type: ["object", "null"] },
        },
      },
    },
  },
};

function createCompactBazaarSpec(
  exampleInput: Record<string, unknown>,
  exampleOutput: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>
): Record<string, unknown> {
  return {
    info: {
      input: {
        type: "http",
        method: "POST",
        bodyType: "json",
        discoverable: true,
        body: exampleInput,
      },
      output: {
        type: "json",
        example: exampleOutput,
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
            body: inputSchema,
          },
        },
        output: {
          type: "object",
          required: ["type", "example"],
          properties: {
            type: { type: "string", const: "json" },
            example: outputSchema,
          },
        },
      },
    },
  };
}

export const APOLLO_PRODUCTS: ApolloProduct[] = [
  // 1. People Search
  {
    id: "search_people",
    path: "/api/v1/search/people",
    method: "POST",
    mcpTool: "search_people",
    title: "Apollo.io B2B People Search — Find Decision-Maker IDs by Title, Seniority & Company (no emails; enrich to unlock)",
    summary: "Search 275M+ verified professionals to find Apollo IDs by title, seniority, company, or headcount ($0.01 USDC / page, Free on Miss).",
    description: "Search professionals across 275M+ profiles. Returns partial identities with masked last names and no emails; use next_step (enrich_person) or unlock (bulk_enrich_people) with the returned Apollo IDs to resolve verified deliverable work emails. Free-on-Miss: settled only if at least one result has reachable email (has_email: true); $0.00 charged if zero reachable leads found.",
    tags: ["b2b", "prospecting", "lead-generation", "people-search", "apollo", "x402"],
    funnelStage: "search",
    pricing: {
      unitUsd: () => unitPriceUsd("search_people"),
      per: "page",
      maxUnits: 1,
      billingRule: "Priced at $0.01 USDC per page; settled on-chain only if at least one result has has_email: true ($0.00 charged if zero reachable leads found).",
    },
    inputSchema: PEOPLE_SEARCH_INPUT_SCHEMA,
    outputSchema: PEOPLE_SEARCH_OUTPUT_SCHEMA,
    exampleInput: {
      organization_domains: ["apollo.io"],
      person_titles: ["CEO", "Founder"],
      per_page: 2,
    },
    exampleOutput: {
      matched: true,
      source: "apollo_live",
      pagination: { page: 1, per_page: 2, total_entries: 2, total_pages: 1 },
      people: [
        {
          apollo_id: "64a7ff0cc4dfae00013df1a5",
          first_name: "Tim",
          last_name: "Zheng",
          full_name: "Tim Zheng",
          title: "CEO & Founder",
          has_email: true,
          organization: { id: "5e66b6381e05b4008c8331b8", name: "Apollo.io", primary_domain: "apollo.io" },
          next_step: { tool: "enrich_person", rest: "POST /api/v1/enrich/person", args: { id: "64a7ff0cc4dfae00013df1a5" } },
        },
      ],
    },
    bazaar: () =>
      createCompactBazaarSpec(
        { organization_domains: ["apollo.io"], person_titles: ["CEO"] },
        {
          matched: true,
          people: [
            {
              apollo_id: "64a7ff0cc4dfae00013df1a5",
              first_name: "Tim",
              title: "CEO",
              has_email: true,
              organization: { name: "Apollo.io" },
            },
          ],
        },
        PEOPLE_SEARCH_INPUT_SCHEMA,
        PEOPLE_SEARCH_OUTPUT_SCHEMA
      ),
  },

  // 2. Organization Search
  {
    id: "search_organizations",
    path: "/api/v1/search/organizations",
    method: "POST",
    mcpTool: "search_organizations",
    title: "Apollo.io B2B Company & Organization Search",
    summary: "Search 73M+ companies by name, domain, industry, location, or employee headcount ($0.02 USDC / page, Free on Miss).",
    description: "Discover target accounts by name, keywords, domain list, locations, and headcount. Returns firmographic summaries and primary domains with next_step links to company firmographics or people search.",
    tags: ["b2b", "account-intelligence", "company-search", "firmographics", "apollo", "x402"],
    funnelStage: "search",
    pricing: {
      unitUsd: () => unitPriceUsd("search_organizations"),
      per: "page",
      maxUnits: 1,
      billingRule: "Settled ($0.02) only if ≥ 1 company returned; $0.00 if zero results.",
    },
    inputSchema: ORG_SEARCH_INPUT_SCHEMA,
    outputSchema: ORG_SEARCH_OUTPUT_SCHEMA,
    exampleInput: {
      organization_name: "Instacart",
      per_page: 2,
    },
    exampleOutput: {
      matched: true,
      source: "apollo_live",
      pagination: { page: 1, per_page: 2, total_entries: 1, total_pages: 1 },
      organizations: [
        {
          id: "5f1a2b3c4d5e6f0001112222",
          name: "Instacart",
          primary_domain: "instacart.com",
          industry: "information technology & services",
          estimated_num_employees: 3000,
          city: "San Francisco",
          country: "United States",
          next_step: { tool: "enrich_organization", rest: "POST /api/v1/enrich/organization", args: { domain: "instacart.com" } },
        },
      ],
    },
    bazaar: () =>
      createCompactBazaarSpec(
        { organization_name: "Instacart" },
        {
          matched: true,
          organizations: [
            {
              id: "5f1a2b3c4d5e6f0001112222",
              name: "Instacart",
              primary_domain: "instacart.com",
            },
          ],
        },
        ORG_SEARCH_INPUT_SCHEMA,
        ORG_SEARCH_OUTPUT_SCHEMA
      ),
  },

  // 3. Person Enrich (Original live endpoint)
  {
    id: "enrich_person",
    path: "/api/v1/enrich/person",
    method: "POST",
    mcpTool: "enrich_person",
    title: "Apollo.io B2B Person Enrichment & Verified Work Email Finder",
    summary: "Enrich person profile and uncover verified work email by LinkedIn URL, email, or name + company ($0.03 USDC, Free on Miss).",
    description: "High-precision B2B person enrichment. Resolves deliverable work email, job title, seniority, department, company firmographics, and full employment history. Free-on-Miss: $0.00 charged if no deliverable email is returned.",
    tags: ["b2b", "lead-enrichment", "email-finder", "apollo", "x402"],
    funnelStage: "enrich",
    pricing: {
      unitUsd: () => unitPriceUsd("enrich_person"),
      per: "call",
      maxUnits: 1,
      billingRule: "Settled ($0.03) only if a deliverable work email is found; $0.00 on miss.",
    },
    inputSchema: PERSON_ENRICH_JSON_SCHEMA.input as Record<string, unknown>,
    outputSchema: PERSON_ENRICH_JSON_SCHEMA.output as Record<string, unknown>,
    exampleInput: {
      first_name: "Fidji",
      last_name: "Simo",
      domain: "instacart.com",
    },
    exampleOutput: {
      matched: true,
      person: {
        apollo_id: "64a1b2c3d4e5f60001234567",
        full_name: "Fidji Simo",
        title: "CEO & Chair",
        email: "fidji@instacart.com",
        email_status: "verified",
      },
    },
    bazaar: () => PERSON_ENRICH_BAZAAR_EXTENSION,
  },

  // 4. Organization Enrich
  {
    id: "enrich_organization",
    path: "/api/v1/enrich/organization",
    method: "POST",
    mcpTool: "enrich_organization",
    title: "Apollo.io B2B Company Firmographics & Tech Stack Enrichment",
    summary: "Enrich company firmographics, funding, revenue, headcount, and technologies by domain ($0.02 USDC, Free on Miss).",
    description: "Enriches full organization profile by company domain. Returns founded year, employee count, industry, funding history, annual revenue, tech stack, departmental headcount, and HQ phone line. Free-on-Miss: $0.00 charged if domain not found.",
    tags: ["b2b", "firmographics", "company-enrichment", "tech-stack", "apollo", "x402"],
    funnelStage: "enrich",
    pricing: {
      unitUsd: () => unitPriceUsd("enrich_organization"),
      per: "call",
      maxUnits: 1,
      billingRule: "Settled ($0.02) only if organization is resolved; $0.00 if not found.",
    },
    inputSchema: ORG_ENRICH_INPUT_SCHEMA,
    outputSchema: ORG_ENRICH_OUTPUT_SCHEMA,
    exampleInput: {
      domain: "apollo.io",
    },
    exampleOutput: {
      matched: true,
      source: "apollo_live",
      organization: {
        apollo_id: "5e66b6381e05b4008c8331b8",
        name: "Apollo.io",
        primary_domain: "apollo.io",
        website_url: "http://www.apollo.io",
        industry: "information technology & services",
        estimated_num_employees: 800,
        city: "San Francisco",
        country: "United States",
        next_step: { tool: "search_people", rest: "POST /api/v1/search/people", args: { organization_domains: ["apollo.io"] } },
      },
    },
    bazaar: () =>
      createCompactBazaarSpec(
        { domain: "apollo.io" },
        {
          matched: true,
          organization: {
            apollo_id: "5e66b6381e05b4008c8331b8",
            name: "Apollo.io",
            primary_domain: "apollo.io",
          },
        },
        ORG_ENRICH_INPUT_SCHEMA,
        ORG_ENRICH_OUTPUT_SCHEMA
      ),
  },

  // 5. Bulk People Enrich (<=10)
  {
    id: "bulk_enrich_people",
    path: "/api/v1/enrich/people/bulk",
    method: "POST",
    mcpTool: "bulk_enrich_people",
    title: "Apollo.io B2B Bulk Person Enrichment (Up to 10 Profiles)",
    summary: "Batch-enrich up to 10 people in a single call ($0.025 USDC / record, Free on Miss if zero emails found).",
    description: "Batch person enrichment for high-throughput agents (1 to 10 profiles per call). Free-on-Miss: settled only if at least one record returns a deliverable email; $0.00 if zero deliverable emails found.",
    tags: ["b2b", "bulk-enrichment", "lead-generation", "batch-email-finder", "apollo", "x402"],
    funnelStage: "bulk_enrich",
    pricing: {
      unitUsd: () => unitPriceUsd("bulk_enrich_people"),
      per: "record",
      maxUnits: 10,
      billingRule: "Priced per record submitted ($0.025 each); settled only if at least one record returns a deliverable email; $0.00 if none.",
    },
    inputSchema: BULK_PERSON_ENRICH_INPUT_SCHEMA,
    outputSchema: BULK_PERSON_ENRICH_OUTPUT_SCHEMA,
    exampleInput: {
      details: [
        { first_name: "Tim", last_name: "Zheng", domain: "apollo.io" },
      ],
    },
    exampleOutput: {
      matched: true,
      submitted_count: 1,
      matched_count: 1,
      billable_count: 1,
      results: [
        {
          index: 0,
          input_echo: { first_name: "Tim", last_name: "Zheng", domain: "apollo.io" },
          matched: true,
          person: {
            apollo_id: "64a7ff0cc4dfae00013df1a5",
            full_name: "Tim Zheng",
            title: "CEO & Founder",
            email: "tim@apollo.io",
          },
        },
      ],
    },
    bazaar: () =>
      createCompactBazaarSpec(
        { details: [{ first_name: "Tim", last_name: "Zheng", domain: "apollo.io" }] },
        {
          matched: true,
          submitted_count: 1,
          billable_count: 1,
          results: [{ index: 0, matched: true, person: { full_name: "Tim Zheng", email: "tim@apollo.io" } }],
        },
        BULK_PERSON_ENRICH_INPUT_SCHEMA,
        BULK_PERSON_ENRICH_OUTPUT_SCHEMA
      ),
  },

  // 6. Bulk Organization Enrich (<=10)
  {
    id: "bulk_enrich_organizations",
    path: "/api/v1/enrich/organizations/bulk",
    method: "POST",
    mcpTool: "bulk_enrich_organizations",
    title: "Apollo.io B2B Bulk Organization Firmographics (Up to 10 Domains)",
    summary: "Batch-enrich up to 10 company domains firmographics ($0.015 USDC / domain, Free on Miss if zero matches).",
    description: "Batch company enrichment for high-throughput agents (1 to 10 domains per call). Free-on-Miss: settled only if at least one organization is found; $0.00 if zero organizations resolved.",
    tags: ["b2b", "bulk-firmographics", "account-intelligence", "company-data", "apollo", "x402"],
    funnelStage: "bulk_enrich",
    pricing: {
      unitUsd: () => unitPriceUsd("bulk_enrich_organizations"),
      per: "record",
      maxUnits: 10,
      billingRule: "Priced per domain submitted ($0.015 each); settled only if at least one organization is found; $0.00 if none.",
    },
    inputSchema: BULK_ORG_ENRICH_INPUT_SCHEMA,
    outputSchema: BULK_ORG_ENRICH_OUTPUT_SCHEMA,
    exampleInput: {
      domains: ["apollo.io", "stripe.com"],
    },
    exampleOutput: {
      matched: true,
      submitted_count: 2,
      matched_count: 2,
      skipped: [],
      results: [
        {
          domain: "apollo.io",
          matched: true,
          organization: { apollo_id: "5e66b6381e05b4008c8331b8", name: "Apollo.io", primary_domain: "apollo.io" },
        },
      ],
    },
    bazaar: () =>
      createCompactBazaarSpec(
        { domains: ["apollo.io"] },
        {
          matched: true,
          submitted_count: 1,
          matched_count: 1,
          results: [{ domain: "apollo.io", matched: true, organization: { name: "Apollo.io", primary_domain: "apollo.io" } }],
        },
        BULK_ORG_ENRICH_INPUT_SCHEMA,
        BULK_ORG_ENRICH_OUTPUT_SCHEMA
      ),
  },
];

/** Lookup helper by product ID */
export function getProductById(id: ApolloProductId): ApolloProduct | undefined {
  return APOLLO_PRODUCTS.find((p) => p.id === id);
}

/** Lookup helper by MCP tool name */
export function getProductByMcpTool(mcpTool: string): ApolloProduct | undefined {
  return APOLLO_PRODUCTS.find((p) => p.mcpTool === mcpTool);
}

/** Lookup helper by REST path */
export function getProductByPath(path: string): ApolloProduct | undefined {
  return APOLLO_PRODUCTS.find((p) => p.path === path);
}

/** Generates standard MCP tool descriptors across all catalog products */
export function getMcpToolsList() {
  return [
    {
      name: "get_enrichment_quote",
      description:
        "FREE pre-flight discovery tool: Inspect live x402 pricing ($0.03 USDC on Base, Free-on-Miss), deterministic JSON input/output schema, SLA latency telemetry, and recent verifiable Base settlement txHashes for Apollo.io B2B Person Enrichment & Work Email Lookup.",
      inputSchema: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Optional tool name to inspect pricing and schema for a specific product.",
          },
        },
      },
    },
    ...APOLLO_PRODUCTS.map((p) => {
      if (p.id === "enrich_person") {
        return {
          name: "enrich_person",
          description:
            "PAID ($0.03 USDC via x402 on Base — Free-on-Miss: $0.00 charged if no deliverable email is found): Verified B2B Person Enrichment, Work Email Finder & LinkedIn-to-Email Resolver powered by Apollo.io. Accepts partial identifiers—(1) first_name + last_name + company domain or organization_name, (2) LinkedIn profile URL (linkedin_url), or (3) email (reverse email lookup)—and returns a deterministic JSON profile with deliverable work email, verification status, job title, seniority (founder, C-suite, VP, director), company firmographics (headcount, industry, founded year), and full employment history. Zero signup or API key required.",
          inputSchema: {
            ...p.inputSchema,
            properties: {
              ...((p.inputSchema.properties as Record<string, unknown>) || {}),
              _x402_payment: {
                type: "string",
                description:
                  "Optional x402 signed payment payload (if not passed via HTTP X-PAYMENT header)",
              },
            },
          },
        };
      }
      return {
        name: p.mcpTool,
        description: `PAID ($${p.pricing.unitUsd()} USDC / ${p.pricing.per} via x402 on Base — Free-on-Miss: ${p.pricing.billingRule}): ${p.description}`,
        inputSchema: {
          ...p.inputSchema,
          properties: {
            ...((p.inputSchema.properties as Record<string, unknown>) || {}),
            _x402_payment: {
              type: "string",
              description: "Optional x402 signed payment payload (if not passed via HTTP X-PAYMENT header)",
            },
          },
        },
      };
    }),
  ];
}
