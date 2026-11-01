/**
 * Organization Enrichment Schema, Normalizer & Validator
 *
 * Defines machine schemas, TypeScript types, and normalizers for:
 * 1. Single Organization Enrich (GET /api/v1/organizations/enrich?domain=...)
 * 2. Bulk Organization Enrich (POST /api/v1/organizations/bulk_enrich)
 */

import {
  cleanDomainCandidate,
  looksLikeDomain,
  normalizeCompanyName,
  KNOWN_COMPANY_BRAND_MAP,
  FREE_EMAIL_PROVIDERS,
} from "./schema.ts";

export interface OrgEnrichInput {
  domain: string;
  organization_name?: string;
}

export interface OrganizationDetail {
  apollo_id: string;
  name: string;
  primary_domain: string;
  website_url: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  facebook_url: string | null;
  logo_url: string | null;
  industry: string | null;
  industries: string[];
  keywords: string[];
  estimated_num_employees: number | null;
  founded_year: number | null;
  annual_revenue: number | null;
  annual_revenue_printed: string | null;
  total_funding: number | null;
  total_funding_printed: string | null;
  latest_funding_stage: string | null;
  latest_funding_round_date: string | null;
  publicly_traded_symbol: string | null;
  publicly_traded_exchange: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  short_description: string | null;
  technologies: string[];
  departmental_head_count: Record<string, number>;
  next_step: {
    tool: "search_people";
    rest: "POST /api/v1/search/people";
    args: { organization_ids: string[] };
  };
}

export interface OrgEnrichOutput {
  matched: boolean;
  payment_settled?: boolean;
  source: "apollo_live" | "apollo_mock";
  timestamp: string;
  latency_ms: number;
  organization: OrganizationDetail | null;
}

/**
 * Resolves fuzzy company brand names to canonical primary domains via brand map & Clearbit suggest.
 */
export async function resolveCompanyDomainFuzzy(
  organizationName: string
): Promise<string | undefined> {
  const cleanedName = normalizeCompanyName(organizationName);
  if (!cleanedName) return undefined;

  const brandHit = KNOWN_COMPANY_BRAND_MAP[cleanedName.toLowerCase()];
  if (brandHit) {
    return brandHit.domain;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(cleanedName)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return undefined;

    const suggestions = (await res.json()) as Array<{
      name?: string;
      domain?: string;
    }>;
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return undefined;
    }

    const targetLower = cleanedName.toLowerCase();
    const exactMatch = suggestions.find(
      (s) =>
        s.domain &&
        s.name &&
        normalizeCompanyName(s.name).toLowerCase() === targetLower
    );
    const chosen = exactMatch || suggestions[0];
    if (chosen?.domain && looksLikeDomain(chosen.domain)) {
      return cleanDomainCandidate(chosen.domain);
    }
  } catch {
    // Non-fatal
  }
  return undefined;
}

/**
 * Normalizes raw Apollo organization JSON payload into a strict OrganizationDetail contract.
 */
export function normalizeApolloOrganization(raw: Record<string, any>): OrganizationDetail {
  const apolloId = String(raw.id || raw.apollo_id || "");
  const primaryDomain = cleanDomainCandidate(raw.primary_domain || raw.domain || raw.website_url || "");
  const name = String(raw.name || "");

  const techNames: string[] = [];
  if (Array.isArray(raw.technology_names)) {
    techNames.push(...raw.technology_names.map(String));
  } else if (Array.isArray(raw.current_technologies)) {
    for (const t of raw.current_technologies) {
      if (t && typeof t === "object" && t.name) techNames.push(String(t.name));
    }
  }

  const rawKeywords = Array.isArray(raw.keywords) ? raw.keywords.map(String) : [];
  const keywords = rawKeywords.slice(0, 20);

  const rawIndustries = Array.isArray(raw.industries) ? raw.industries.map(String) : [];
  if (raw.industry && !rawIndustries.includes(raw.industry)) {
    rawIndustries.unshift(raw.industry);
  }

  const deptHeadcount: Record<string, number> = {};
  if (raw.departmental_head_count && typeof raw.departmental_head_count === "object") {
    for (const [k, v] of Object.entries(raw.departmental_head_count)) {
      if (typeof v === "number") deptHeadcount[k] = v;
    }
  }

  const shortDesc = raw.short_description ? String(raw.short_description).slice(0, 500) : null;

  return {
    apollo_id: apolloId,
    name,
    primary_domain: primaryDomain,
    website_url: raw.website_url || (primaryDomain ? `https://${primaryDomain}` : null),
    linkedin_url: raw.linkedin_url || null,
    twitter_url: raw.twitter_url || null,
    facebook_url: raw.facebook_url || null,
    logo_url: raw.logo_url || null,
    industry: raw.industry || null,
    industries: rawIndustries,
    keywords,
    estimated_num_employees: typeof raw.estimated_num_employees === "number" ? raw.estimated_num_employees : null,
    founded_year: typeof raw.founded_year === "number" ? raw.founded_year : null,
    annual_revenue: typeof raw.annual_revenue === "number" ? raw.annual_revenue : null,
    annual_revenue_printed: raw.annual_revenue_printed || raw.organization_revenue_printed || null,
    total_funding: typeof raw.total_funding === "number" ? raw.total_funding : null,
    total_funding_printed: raw.total_funding_printed || null,
    latest_funding_stage: raw.latest_funding_stage || null,
    latest_funding_round_date: raw.latest_funding_round_date || null,
    publicly_traded_symbol: raw.publicly_traded_symbol || null,
    publicly_traded_exchange: raw.publicly_traded_exchange || null,
    phone: raw.phone || raw.sanitized_phone || null,
    street_address: raw.street_address || null,
    city: raw.city || null,
    state: raw.state || null,
    country: raw.country || null,
    postal_code: raw.postal_code || null,
    short_description: shortDesc,
    technologies: Array.from(new Set(techNames)).slice(0, 25),
    departmental_head_count: deptHeadcount,
    next_step: {
      tool: "search_people",
      rest: "POST /api/v1/search/people",
      args: { organization_ids: [apolloId] },
    },
  };
}

function unwrapLlmWrappers(raw: Record<string, unknown>): Record<string, unknown> {
  let current = { ...raw };
  for (const wrapperKey of ["input", "params", "arguments", "data", "body", "organization", "company"]) {
    const candidate = current[wrapperKey];
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      Object.keys(current).length <= 2
    ) {
      current = { ...current, ...(candidate as Record<string, unknown>) };
      break;
    }
  }
  return current;
}

/**
 * Validates OrgEnrichInput.
 */
export function validateOrgEnrichInput(
  rawInput: Record<string, unknown>
): { valid: boolean; data?: OrgEnrichInput; error?: string } {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  const raw = unwrapLlmWrappers(rawInput);

  let rawDomain = typeof raw.domain === "string"
    ? raw.domain.trim()
    : typeof raw.website === "string"
    ? raw.website.trim()
    : typeof raw.url === "string"
    ? raw.url.trim()
    : typeof raw.company_domain === "string"
    ? raw.company_domain.trim()
    : undefined;

  const rawOrgName = typeof raw.organization_name === "string"
    ? raw.organization_name.trim()
    : typeof raw.company === "string"
    ? raw.company.trim()
    : typeof raw.name === "string"
    ? raw.name.trim()
    : undefined;

  if (rawDomain) {
    const cleaned = cleanDomainCandidate(rawDomain);
    if (FREE_EMAIL_PROVIDERS.has(cleaned)) {
      return {
        valid: false,
        error: `Domain '${cleaned}' is a public consumer email provider (e.g. Gmail), not a company domain.`,
      };
    }
    return {
      valid: true,
      data: {
        domain: cleaned,
        organization_name: rawOrgName,
      },
    };
  }

  if (rawOrgName) {
    // If only organization_name is provided, check known brand map synchronously
    const brandHit = KNOWN_COMPANY_BRAND_MAP[normalizeCompanyName(rawOrgName).toLowerCase()];
    if (brandHit) {
      return {
        valid: true,
        data: {
          domain: brandHit.domain,
          organization_name: rawOrgName,
        },
      };
    }

    return {
      valid: true,
      data: {
        domain: "",
        organization_name: rawOrgName,
      },
    };
  }

  return {
    valid: false,
    error: "A company domain (or organization_name) is required.",
  };
}
