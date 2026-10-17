/**
 * Layer 2: Machine Schema (Option A — Apollo.io Person Enrichment)
 *
 * Agents select providers based on deterministic certainty and attribute completeness.
 * This file defines the strict input/output TypeScript interfaces and JSON Schemas
 * exposed via MCP, REST x402, and /.well-known/agent.json.
 */

export interface PersonEnrichInput {
  /** First name of the person (recommended with last_name + domain/organization_name) */
  first_name?: string;
  /** Last name of the person */
  last_name?: string;
  /** Full name of the person (if first/last are not split) */
  name?: string;
  /** Known email address to reverse-enrich */
  email?: string;
  /** Company website domain (e.g., "stripe.com" or "apollo.io") */
  domain?: string;
  /** Company name (e.g., "Stripe") */
  organization_name?: string;
  /** Public LinkedIn profile URL (e.g., "https://www.linkedin.com/in/...") */
  linkedin_url?: string;
  /** Reveal personal emails if work email is unavailable (default: false) */
  reveal_personal_emails?: boolean;
}

export interface EmploymentHistoryEntry {
  title: string | null;
  organization_name: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
}

export interface PersonEnrichOutput {
  /** Deterministic status indicating whether a verified profile match was found */
  matched: boolean;
  /** Timestamp of enrichment execution (ISO 8601) */
  timestamp: string;
  /** Execution latency in milliseconds */
  latency_ms: number;
  /** Source mode ("apollo_live" | "apollo_mock") */
  source: "apollo_live" | "apollo_mock";
  /** Normalized person profile (null if matched === false) */
  person: {
    apollo_id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    title: string | null;
    headline: string | null;
    seniority: string | null;
    departments: string[];
    email: string | null;
    email_status: "verified" | "likely_to_engage" | "unverified" | "unavailable" | string;
    linkedin_url: string | null;
    twitter_url: string | null;
    github_url: string | null;
    location: {
      city: string | null;
      state: string | null;
      country: string | null;
    };
    organization: {
      id: string | null;
      name: string | null;
      website_url: string | null;
      primary_domain: string | null;
      industry: string | null;
      estimated_num_employees: number | null;
      linkedin_url: string | null;
      founded_year: number | null;
    } | null;
    employment_history: EmploymentHistoryEntry[];
  } | null;
}

/**
 * Validate that the caller provided enough identifying attributes to run a match.
 */
export function validatePersonEnrichInput(input: unknown): {
  valid: boolean;
  data?: PersonEnrichInput;
  error?: string;
} {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  const raw = input as Record<string, unknown>;
  const cleaned: PersonEnrichInput = {
    first_name: typeof raw.first_name === "string" ? raw.first_name.trim() : undefined,
    last_name: typeof raw.last_name === "string" ? raw.last_name.trim() : undefined,
    name: typeof raw.name === "string" ? raw.name.trim() : undefined,
    email: typeof raw.email === "string" ? raw.email.trim() : undefined,
    domain: typeof raw.domain === "string" ? raw.domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
    organization_name: typeof raw.organization_name === "string" ? raw.organization_name.trim() : undefined,
    linkedin_url: typeof raw.linkedin_url === "string" ? raw.linkedin_url.trim() : undefined,
    reveal_personal_emails: Boolean(raw.reveal_personal_emails),
  };

  const hasDirectId = Boolean(cleaned.email || cleaned.linkedin_url);
  const hasName = Boolean(cleaned.name || (cleaned.first_name && cleaned.last_name));
  const hasCompany = Boolean(cleaned.domain || cleaned.organization_name);

  if (!hasDirectId && !(hasName && hasCompany)) {
    return {
      valid: false,
      error:
        "Insufficient identifiers. Provide either (1) 'email', (2) 'linkedin_url', or (3) a name ('name' or 'first_name' + 'last_name') combined with a company ('domain' or 'organization_name').",
    };
  }

  return { valid: true, data: cleaned };
}

/**
 * Standardized JSON Schema advertised to MCP registries and A2A Agent Cards.
 * Optimized with high-intent semantic keywords (Strategy B: Agent SEO) so LLM
 * tool routers and vector registries match this endpoint across B2B lookup queries.
 */
export const PERSON_ENRICH_JSON_SCHEMA = {
  input: {
    type: "object",
    description:
      "B2B Person Enrichment & Verified Work Email Finder (Apollo.io): Resolve partial person identifiers—such as (1) first_name + last_name + company domain/organization_name, (2) LinkedIn profile URL (linkedin_url to email), or (3) work email (reverse email lookup)—into a deterministic B2B executive/prospect profile with verified work email, job title, seniority (founder, C-suite, VP, director), department, location, company firmographics (headcount, industry, founded year), and full employment history.",
    properties: {
      first_name: {
        type: "string",
        description:
          "Target person's first name (e.g., 'Tim'). Best combined with last_name and domain or organization_name.",
      },
      last_name: {
        type: "string",
        description:
          "Target person's last name (e.g., 'Zheng'). Best combined with first_name and domain or organization_name.",
      },
      name: {
        type: "string",
        description:
          "Target person's full name (e.g., 'Tim Zheng') if first_name and last_name are not separated.",
      },
      domain: {
        type: "string",
        description:
          "Company website domain without protocol (e.g., 'apollo.io', 'stripe.com'). Strongly improves match precision.",
      },
      organization_name: {
        type: "string",
        description:
          "Company or organization name (e.g., 'Apollo.io', 'Stripe') if exact domain is unknown.",
      },
      email: {
        type: "string",
        description:
          "Known work or personal email address for reverse-email enrichment into full LinkedIn, title, firmographics, and career history.",
      },
      linkedin_url: {
        type: "string",
        description:
          "Public LinkedIn profile URL (e.g., 'https://www.linkedin.com/in/tim-zheng') to resolve directly into a verified work email and company profile.",
      },
      reveal_personal_emails: {
        type: "boolean",
        description:
          "Whether to include verified personal emails if a corporate work email is unavailable (default: false).",
      },
    },
  },
  output: {
    type: "object",
    description:
      "Deterministic B2B Person Profile & Firmographic Payload with cryptographic x402 payment receipt.",
    required: ["matched", "timestamp", "latency_ms", "source", "person"],
    properties: {
      matched: {
        type: "boolean",
        description: "True if Apollo resolved the identifiers to a verified person record.",
      },
      timestamp: { type: "string", description: "ISO-8601 execution timestamp." },
      latency_ms: { type: "number", description: "End-to-end API execution latency in milliseconds." },
      source: { type: "string", enum: ["apollo_live", "apollo_mock"] },
      person: {
        type: ["object", "null"],
        description: "Hydrated prospect/executive record (or null if matched is false).",
        properties: {
          apollo_id: { type: "string", description: "Unique Apollo.io person identifier." },
          full_name: { type: ["string", "null"], description: "Full formatted name." },
          title: { type: ["string", "null"], description: "Current job title (e.g., 'Founder & CEO', 'VP of Engineering')." },
          seniority: { type: ["string", "null"], description: "Normalized seniority level (e.g., 'founder', 'c_suite', 'vp', 'director', 'manager')." },
          departments: { type: "array", items: { type: "string" }, description: "Functional departments (e.g., 'c_suite', 'engineering', 'sales')." },
          email: { type: ["string", "null"], description: "Deliverable B2B work email address." },
          email_status: { type: "string", description: "Deliverability verification status ('verified', 'likely_to_engage', 'unavailable')." },
          linkedin_url: { type: ["string", "null"], description: "Canonical LinkedIn profile URL." },
          location: {
            type: "object",
            description: "Geographic location (city, state, country) of the individual.",
          },
          organization: {
            type: ["object", "null"],
            description: "Current employer firmographics: company name, primary_domain, industry, estimated_num_employees (headcount), linkedin_url, and founded_year.",
          },
          employment_history: {
            type: "array",
            description: "Chronological work history of current and past roles, companies, and start/end dates.",
          },
        },
      },
    },
  },
} as const;

