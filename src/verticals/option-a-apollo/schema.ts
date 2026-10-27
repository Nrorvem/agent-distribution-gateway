/**
 * Layer 2: Machine Schema (Option A — Apollo.io Person Enrichment)
 *
 * Agents select providers based on deterministic certainty and attribute completeness.
 * This file defines the strict input/output TypeScript interfaces and JSON Schemas
 * exposed via MCP, REST x402, and /.well-known/agent.json.
 */

export interface PersonEnrichInput {
  /** Unique Apollo person ID (if known) */
  id?: string;
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
  /** Company name (e.g., "Stripe" or "Meta") */
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
 * Known brand / parent-company mappings where agents commonly pass a brand name
 * or parent domain that differs from the primary corporate domain.
 */
export const KNOWN_COMPANY_BRAND_MAP: Record<
  string,
  { domain: string; altDomains?: string[]; organization_name: string }
> = {
  meta: {
    domain: "meta.com",
    altDomains: ["fb.com", "facebook.com"],
    organization_name: "Meta",
  },
  "meta platforms": {
    domain: "meta.com",
    altDomains: ["fb.com", "facebook.com"],
    organization_name: "Meta",
  },
  facebook: {
    domain: "meta.com",
    altDomains: ["facebook.com", "fb.com"],
    organization_name: "Meta",
  },
  google: {
    domain: "google.com",
    altDomains: ["abc.xyz"],
    organization_name: "Google",
  },
  alphabet: {
    domain: "google.com",
    altDomains: ["abc.xyz"],
    organization_name: "Google",
  },
  "abc.xyz": {
    domain: "google.com",
    altDomains: ["abc.xyz"],
    organization_name: "Google",
  },
  x: {
    domain: "x.com",
    altDomains: ["twitter.com"],
    organization_name: "X",
  },
  twitter: {
    domain: "x.com",
    altDomains: ["twitter.com"],
    organization_name: "X",
  },
  block: {
    domain: "block.xyz",
    altDomains: ["squareup.com"],
    organization_name: "Block",
  },
  square: {
    domain: "squareup.com",
    altDomains: ["block.xyz"],
    organization_name: "Block",
  },
  instacart: {
    domain: "instacart.com",
    organization_name: "Instacart",
  },
  maplebear: {
    domain: "instacart.com",
    organization_name: "Instacart",
  },
  openai: {
    domain: "openai.com",
    organization_name: "OpenAI",
  },
  anthropic: {
    domain: "anthropic.com",
    organization_name: "Anthropic",
  },
  coinbase: {
    domain: "coinbase.com",
    organization_name: "Coinbase",
  },
  stripe: {
    domain: "stripe.com",
    organization_name: "Stripe",
  },
  apollo: {
    domain: "apollo.io",
    organization_name: "Apollo.io",
  },
  "apollo.io": {
    domain: "apollo.io",
    organization_name: "Apollo.io",
  },
  microsoft: {
    domain: "microsoft.com",
    organization_name: "Microsoft",
  },
  apple: {
    domain: "apple.com",
    organization_name: "Apple",
  },
  amazon: {
    domain: "amazon.com",
    organization_name: "Amazon",
  },
  aws: {
    domain: "amazon.com",
    organization_name: "Amazon Web Services",
  },
  "amazon web services": {
    domain: "amazon.com",
    organization_name: "Amazon Web Services",
  },
};

const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

/**
 * Checks whether a candidate string looks like a valid hostname/domain (e.g., "stripe.com", "apollo.io")
 * rather than a plain company name (e.g., "Meta", "Google", "Stripe Inc").
 */
export function looksLikeDomain(value: string): boolean {
  const cleaned = cleanDomainCandidate(value);
  if (!cleaned || cleaned.includes(" ") || !cleaned.includes(".")) {
    return false;
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(cleaned);
}

/**
 * Strips protocol, www., paths, query params, and trailing punctuation from a URL or domain candidate.
 */
export function cleanDomainCandidate(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^mailto:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

/**
 * Strips legal entity suffixes ("Inc.", "LLC", "Corp.", etc.) from a company name
 * so fuzzy brand lookups and Apollo organization matching succeed cleanly.
 */
export function normalizeCompanyName(raw: string): string {
  return raw
    .trim()
    .replace(
      /[,\s]+(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.?|company|plc|gmbh|ag|s\.a\.|b\.v\.|holdings?)\s*$/i,
      ""
    )
    .trim();
}

/**
 * Normalizes a LinkedIn profile URL (adds https://, strips tracking query params).
 */
function normalizeLinkedInUrl(raw: string): string {
  let trimmed = raw.trim();
  if (/^(www\.)?linkedin\.com\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  } else if (/^http:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^http:\/\//i, "https://");
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase().includes("linkedin.com")) {
      const cleanPath = parsed.pathname.replace(/\/+$/, "");
      return `https://www.linkedin.com${cleanPath}`;
    }
  } catch {
    // Fallback to raw trimmed string
  }
  return trimmed;
}

/**
 * Validate and normalize incoming person enrichment parameters.
 *
 * Uses the flexible multi-modal resolution pattern (used by Locus / StableEnrich):
 * 1. Accepts partial inputs: only `linkedin_url`, only `email`, only `id`,
 *    `name` / `first_name` / `last_name` + `domain` / `organization_name`,
 *    or even full name (`first_name` + `last_name` or multi-word `name`) alone.
 * 2. Maps common agent field aliases (`company`, `company_name`, `organization`, `website`,
 *    `company_domain`, `linkedin`, `profile`, `profile_url`, `full_name`, `apollo_id`, etc.).
 * 3. Automatically disambiguates fuzzy company names passed in `domain` (e.g., `domain: "Meta"`)
 *    vs. domains/URLs passed in `organization_name`/`company` (e.g., `company: "https://stripe.com"`).
 */
export function validatePersonEnrichInput(input: unknown): {
  valid: boolean;
  data?: PersonEnrichInput;
  error?: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  let raw = input as Record<string, unknown>;
  // Unwrap common nested wrapper keys sent by generic LLM tool routers
  for (const wrapperKey of ["input", "params", "arguments", "person", "data", "body"]) {
    const candidate = raw[wrapperKey];
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      Object.keys(raw).length <= 2
    ) {
      raw = { ...raw, ...(candidate as Record<string, unknown>) };
      break;
    }
  }

  // 1. Extract fields across canonical names + common agent aliases
  const rawId = firstNonEmptyString(raw.id, raw.apollo_id, raw.person_id, raw.apolloId);
  let rawFirstName = firstNonEmptyString(raw.first_name, raw.firstName, raw.given_name);
  let rawLastName = firstNonEmptyString(raw.last_name, raw.lastName, raw.family_name, raw.surname);
  let rawFullName = firstNonEmptyString(
    raw.name,
    raw.full_name,
    raw.fullName,
    raw.person_name
  );
  let rawEmail = firstNonEmptyString(
    raw.email,
    raw.email_address,
    raw.emailAddress,
    raw.work_email
  );
  let rawLinkedIn = firstNonEmptyString(
    raw.linkedin_url,
    raw.linkedin,
    raw.linkedinUrl,
    raw.linkedin_profile_url,
    raw.profile_url,
    raw.profile
  );
  let rawDomain = firstNonEmptyString(
    raw.domain,
    raw.website,
    raw.company_domain,
    raw.companyDomain,
    raw.company_url,
    raw.website_url
  );
  let rawOrgName = firstNonEmptyString(
    raw.organization_name,
    raw.organizationName,
    raw.company,
    raw.company_name,
    raw.companyName,
    raw.organization,
    raw.employer
  );

  // Check generic `url` alias if present
  const rawGenericUrl = firstNonEmptyString(raw.url);
  if (rawGenericUrl) {
    if (/linkedin\.com\/in\//i.test(rawGenericUrl) && !rawLinkedIn) {
      rawLinkedIn = rawGenericUrl;
    } else if (!rawDomain) {
      rawDomain = rawGenericUrl;
    }
  }

  // Auto-detect misplaced LinkedIn URLs or emails in domain/organization_name/name fields
  for (const candidate of [rawDomain, rawOrgName, rawFullName]) {
    if (!candidate) continue;
    if (!rawLinkedIn && /linkedin\.com\/in\//i.test(candidate)) {
      rawLinkedIn = candidate;
      if (candidate === rawDomain) rawDomain = undefined;
      if (candidate === rawOrgName) rawOrgName = undefined;
      if (candidate === rawFullName) rawFullName = undefined;
    } else if (!rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      rawEmail = candidate.toLowerCase();
      if (candidate === rawDomain) rawDomain = undefined;
      if (candidate === rawOrgName) rawOrgName = undefined;
      if (candidate === rawFullName) rawFullName = undefined;
    }
  }

  // Normalize LinkedIn URL
  const linkedin_url = rawLinkedIn ? normalizeLinkedInUrl(rawLinkedIn) : undefined;

  // Normalize Email
  const email = rawEmail ? rawEmail.toLowerCase().trim() : undefined;

  // Normalize Names: handle full name passed in `first_name` or `name` without split
  if (rawFirstName && !rawLastName && rawFirstName.includes(" ")) {
    if (!rawFullName) {
      rawFullName = rawFirstName;
    }
    const parts = rawFirstName.trim().split(/\s+/);
    rawFirstName = parts[0];
    rawLastName = parts.slice(1).join(" ");
  }
  if (rawFullName && (!rawFirstName || !rawLastName)) {
    const parts = rawFullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      if (!rawFirstName) rawFirstName = parts[0];
      if (!rawLastName) rawLastName = parts.slice(1).join(" ");
    } else if (parts.length === 1 && !rawFirstName) {
      rawFirstName = parts[0];
    }
  }
  if (!rawFullName && (rawFirstName || rawLastName)) {
    rawFullName = [rawFirstName, rawLastName].filter(Boolean).join(" ");
  }

  // Disambiguate fuzzy company name vs. domain
  let domain: string | undefined;
  let organization_name: string | undefined = rawOrgName;

  if (rawDomain) {
    if (/linkedin\.com\/company\//i.test(rawDomain)) {
      const slug = rawDomain.split(/linkedin\.com\/company\//i)[1]?.split(/[/?#]/)[0];
      if (slug && !organization_name) {
        organization_name = slug.replace(/-/g, " ");
      }
    } else if (looksLikeDomain(rawDomain)) {
      domain = cleanDomainCandidate(rawDomain);
    } else {
      // Agent passed a company name (e.g. "Meta" or "Google") inside `domain`
      if (!organization_name) {
        organization_name = rawDomain.trim();
      }
    }
  }

  // If `organization_name` is actually a URL or domain (e.g. "https://stripe.com" or "stripe.com")
  if (organization_name && looksLikeDomain(organization_name)) {
    const extractedDomain = cleanDomainCandidate(organization_name);
    if (!domain) {
      domain = extractedDomain;
    }
    const domainStem = extractedDomain.split(".")[0];
    const brandMatch =
      KNOWN_COMPANY_BRAND_MAP[extractedDomain] ||
      (domainStem ? KNOWN_COMPANY_BRAND_MAP[domainStem] : undefined);
    organization_name = brandMatch ? brandMatch.organization_name : undefined;
  } else if (organization_name) {
    organization_name = normalizeCompanyName(organization_name);
  }

  // Apply known brand / parent-company mapping (e.g. "Meta" -> meta.com, "Google" -> google.com / abc.xyz)
  const normalizedOrgKey = organization_name
    ? normalizeCompanyName(organization_name).toLowerCase()
    : undefined;
  const rawDomainKey = rawDomain ? rawDomain.trim().toLowerCase() : undefined;
  const domainStemKey = domain ? domain.split(".")[0]?.toLowerCase() : undefined;

  const brandHit =
    (normalizedOrgKey ? KNOWN_COMPANY_BRAND_MAP[normalizedOrgKey] : undefined) ||
    (rawDomainKey ? KNOWN_COMPANY_BRAND_MAP[rawDomainKey] : undefined) ||
    (domain ? KNOWN_COMPANY_BRAND_MAP[domain] : undefined) ||
    (domainStemKey ? KNOWN_COMPANY_BRAND_MAP[domainStemKey] : undefined);

  if (brandHit) {
    if (!domain || domain === "abc.xyz") {
      domain = brandHit.domain;
    }
    if (!organization_name || looksLikeDomain(organization_name)) {
      organization_name = brandHit.organization_name;
    }
  }

  // If email is a corporate email and no domain was provided, infer domain from email
  if (email && !domain && email.includes("@")) {
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (emailDomain && !FREE_EMAIL_PROVIDERS.has(emailDomain)) {
      domain = emailDomain;
    }
  }

  const cleaned: PersonEnrichInput = {
    id: rawId,
    first_name: rawFirstName,
    last_name: rawLastName,
    name: rawFullName,
    email,
    domain,
    organization_name,
    linkedin_url,
    reveal_personal_emails: Boolean(raw.reveal_personal_emails),
  };

  // Validate that at least one usable identifier is present:
  // 1. Direct unique identifier: `email`, `linkedin_url`, or Apollo `id`
  // 2. Any name (`name`, `first_name`, or `last_name`) + any company (`domain` or `organization_name`)
  // 3. Full name (`first_name` + `last_name` or multi-word `name`) even without a company/domain
  const hasDirectId = Boolean(cleaned.email || cleaned.linkedin_url || cleaned.id);
  const hasAnyName = Boolean(cleaned.name || cleaned.first_name || cleaned.last_name);
  const hasFullName = Boolean(
    (cleaned.first_name && cleaned.last_name) ||
      (cleaned.name && cleaned.name.trim().includes(" "))
  );
  const hasCompany = Boolean(cleaned.domain || cleaned.organization_name);

  if (!hasDirectId && !(hasAnyName && hasCompany) && !hasFullName) {
    return {
      valid: false,
      error:
        "Insufficient identifiers. Provide any of: (1) 'linkedin_url' (or 'linkedin'), (2) 'email', (3) 'id' (Apollo person ID), (4) a name ('name', 'first_name', or 'last_name') with a company ('domain', 'organization_name', or 'company'), or (5) a full name ('first_name' + 'last_name' or 'name').",
    };
  }

  return { valid: true, data: cleaned };
}

/**
 * Standardized JSON Schema advertised to MCP registries, OpenAPI, and A2A Agent Cards.
 *
 * Designed using the flexible multi-modal input pattern (no rigid `required: ["first_name", "last_name", "domain"]`
 * and `additionalProperties: true`) so strict client-side schema validators allow:
 * - LinkedIn-only lookups (`{ "linkedin_url": "..." }`)
 * - Reverse-email lookups (`{ "email": "..." }`)
 * - Name + Company Name or Domain (`{ "name": "...", "company": "Meta" }` or `{ "first_name": "...", "last_name": "...", "domain": "..." }`)
 * - Apollo ID lookups (`{ "id": "..." }`)
 */
export const PERSON_ENRICH_JSON_SCHEMA = {
  input: {
    type: "object",
    additionalProperties: true,
    description:
      "B2B Person Enrichment & Verified Work Email Finder (Apollo.io): Accepts flexible partial person identifiers—such as (1) LinkedIn profile URL only ('linkedin_url' or 'linkedin'), (2) work or personal email only ('email' for reverse email lookup), (3) name ('name' or 'first_name' + 'last_name') with company domain OR fuzzy company name ('domain', 'organization_name', or 'company', e.g. 'Meta' or 'meta.com'), or (4) Apollo person ID ('id')—and resolves a deterministic B2B executive/prospect profile with verified work email, job title, seniority, department, location, company firmographics, and employment history.",
    properties: {
      first_name: {
        type: "string",
        description:
          "Target person's first name (e.g., 'Tim'). Optional if 'name', 'linkedin_url', 'email', or 'id' is provided.",
      },
      last_name: {
        type: "string",
        description:
          "Target person's last name (e.g., 'Zheng'). Optional if 'name', 'linkedin_url', 'email', or 'id' is provided.",
      },
      name: {
        type: "string",
        description:
          "Target person's full name (e.g., 'Tim Zheng'). Automatically split into first_name and last_name if needed.",
      },
      domain: {
        type: "string",
        description:
          "Company website domain or URL (e.g., 'apollo.io', 'stripe.com'). Also accepts a company name (e.g., 'Meta', 'Google') and automatically resolves the canonical domain.",
      },
      organization_name: {
        type: "string",
        description:
          "Company or organization name (e.g., 'Apollo.io', 'Meta', 'Google', 'Stripe') if exact domain is unknown.",
      },
      company: {
        type: "string",
        description:
          "Alias for organization_name or domain (e.g., 'Meta', 'Stripe', 'instacart.com').",
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
      id: {
        type: "string",
        description:
          "Optional Apollo.io person ID for direct profile hydration.",
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


