/**
 * Machine Schemas, TypeScript Types, and Pre-Payment Validators for Apollo Search
 *
 * Implements Top-of-Funnel validation for:
 * 1. People Search (/api/v1/search/people, tool: search_people)
 * 2. Organization Search (/api/v1/search/organizations, tool: search_organizations)
 *
 * Guaranteed Invariants:
 * - Deterministic JSON Schemas
 * - Unwrap generic LLM wrappers ('input', 'params', 'arguments', etc.)
 * - Hard-capped page (max 5) and per_page (max 25)
 * - Strict enum checks for seniorities
 * - next_step chaining hints in every result record
 */

import { cleanDomainCandidate, looksLikeDomain } from "./schema.ts";

export const ALLOWED_SENIORITIES = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
  "senior",
  "entry",
  "intern",
] as const;

export type PersonSeniority = typeof ALLOWED_SENIORITIES[number];

export interface PeopleSearchInput {
  person_titles?: string[];
  person_seniorities?: PersonSeniority[];
  organization_domains?: string[];
  organization_ids?: string[];
  person_locations?: string[];
  employee_ranges?: string[];
  keywords?: string;
  page?: number;
  per_page?: number;
}

export interface PersonSearchResultItem {
  apollo_id: string;
  first_name: string;
  last_name: string | null;
  last_name_obfuscated: string | null;
  full_name: string | null;
  title: string;
  seniority: string | null;
  linkedin_url: string | null;
  has_email: boolean;
  location: {
    city: string | null;
    state: string | null;
    country: string | null;
  };
  organization: {
    id: string | null;
    name: string | null;
    primary_domain: string | null;
  };
  next_step: {
    tool: "enrich_person";
    rest: "POST /api/v1/enrich/person";
    args: { id: string };
  };
}

export interface PeopleSearchOutput {
  matched: boolean;
  source: "apollo_live" | "apollo_mock";
  timestamp: string;
  latency_ms: number;
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
  people: PersonSearchResultItem[];
  unlock?: {
    tool: "bulk_enrich_people";
    rest: "POST /api/v1/enrich/people/bulk";
    args: { details: Array<{ id: string }> };
    remaining_batches: Array<{ details: Array<{ id: string }> }>;
    estimated_price_usd: string;
    description: string;
  };
}

export interface OrgSearchInput {
  organization_name?: string;
  domains?: string[];
  keywords?: string;
  organization_locations?: string[];
  employee_ranges?: string[];
  revenue_min?: number;
  revenue_max?: number;
  technologies?: string[];
  page?: number;
  per_page?: number;
}

export interface OrgSearchResultItem {
  id: string;
  name: string;
  primary_domain: string | null;
  website_url: string | null;
  industry: string | null;
  estimated_num_employees: number | null;
  linkedin_url: string | null;
  founded_year: number | null;
  city: string | null;
  country: string | null;
  next_step: {
    enrich_organization: {
      tool: "enrich_organization";
      rest: "POST /api/v1/enrich/organization";
      args: { domain: string };
    };
    search_people: {
      tool: "search_people";
      rest: "POST /api/v1/search/people";
      args: { organization_ids: string[] };
    };
  };
}

export interface OrgSearchOutput {
  matched: boolean;
  source: "apollo_live" | "apollo_mock";
  timestamp: string;
  latency_ms: number;
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
  organizations: OrgSearchResultItem[];
}

function unwrapLlmWrappers(raw: Record<string, unknown>): Record<string, unknown> {
  let current = { ...raw };
  for (const wrapperKey of ["input", "params", "arguments", "data", "body", "filters", "filter"]) {
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

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === "string" ? item.trim() : String(item).trim()))
      .filter((s) => s.length > 0);
  }
  if (typeof val === "string" && val.trim().length > 0) {
    if (val.includes(",") && !val.includes(" ")) {
      return val.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [val.trim()];
  }
  return [];
}

/**
 * Validates and normalizes People Search input payload.
 */
export function validatePeopleSearchInput(
  rawInput: Record<string, unknown>
): { valid: boolean; data?: PeopleSearchInput; error?: string } {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  const raw = unwrapLlmWrappers(rawInput);

  // Extract titles
  const titles = toStringArray(raw.person_titles ?? raw.titles ?? raw.title);

  // Extract seniorities & validate enum
  const rawSeniorities = toStringArray(raw.person_seniorities ?? raw.seniorities ?? raw.seniority);
  const validatedSeniorities: PersonSeniority[] = [];
  for (const s of rawSeniorities) {
    const lower = s.toLowerCase().trim() as PersonSeniority;
    if (!ALLOWED_SENIORITIES.includes(lower)) {
      return {
        valid: false,
        error: `Invalid seniority '${s}'. Allowed values: ${ALLOWED_SENIORITIES.join(", ")}`,
      };
    }
    if (!validatedSeniorities.includes(lower)) {
      validatedSeniorities.push(lower);
    }
  }

  // Extract domains
  const rawDomains = toStringArray(
    raw.organization_domains ?? raw.domains ?? raw.company_domains ?? raw.domain ?? raw.company_domain
  );
  const cleanedDomains = rawDomains
    .map((d) => cleanDomainCandidate(d))
    .filter((d) => looksLikeDomain(d) || d.includes("."));

  // Extract organization IDs
  const orgIds = toStringArray(raw.organization_ids ?? raw.org_ids ?? raw.organization_id ?? raw.org_id);

  // Extract locations
  const locations = toStringArray(raw.person_locations ?? raw.locations ?? raw.location);

  // Extract employee ranges
  const employeeRanges = toStringArray(
    raw.employee_ranges ?? raw.ranges ?? raw.organization_num_employees_ranges
  );

  // Extract keywords
  const keywords = typeof raw.keywords === "string" ? raw.keywords.trim() : undefined;

  // Pagination with hard caps
  const pageRaw = Number(raw.page ?? 1);
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 5) : 1;

  const perPageRaw = Number(raw.per_page ?? raw.limit ?? 10);
  const perPage = Number.isInteger(perPageRaw) && perPageRaw >= 1 ? Math.min(perPageRaw, 25) : 10;

  // Guardrail: Require at least one filter
  const hasFilter =
    titles.length > 0 ||
    validatedSeniorities.length > 0 ||
    cleanedDomains.length > 0 ||
    orgIds.length > 0 ||
    locations.length > 0 ||
    employeeRanges.length > 0 ||
    Boolean(keywords && keywords.length > 0);

  if (!hasFilter) {
    return {
      valid: false,
      error:
        "At least one filter is required: person_titles, person_seniorities, organization_domains, organization_ids, person_locations, employee_ranges, or keywords.",
    };
  }

  return {
    valid: true,
    data: {
      person_titles: titles.length > 0 ? titles : undefined,
      person_seniorities: validatedSeniorities.length > 0 ? validatedSeniorities : undefined,
      organization_domains: cleanedDomains.length > 0 ? cleanedDomains : undefined,
      organization_ids: orgIds.length > 0 ? orgIds : undefined,
      person_locations: locations.length > 0 ? locations : undefined,
      employee_ranges: employeeRanges.length > 0 ? employeeRanges : undefined,
      keywords: keywords || undefined,
      page,
      per_page: perPage,
    },
  };
}

/**
 * Validates and normalizes Organization Search input payload.
 */
export function validateOrgSearchInput(
  rawInput: Record<string, unknown>
): { valid: boolean; data?: OrgSearchInput; error?: string } {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  const raw = unwrapLlmWrappers(rawInput);

  const organizationName = typeof raw.organization_name === "string"
    ? raw.organization_name.trim()
    : typeof raw.name === "string"
    ? raw.name.trim()
    : typeof raw.company === "string"
    ? raw.company.trim()
    : undefined;

  const rawDomains = toStringArray(raw.domains ?? raw.domain ?? raw.company_domains);
  const cleanedDomains = rawDomains
    .map((d) => cleanDomainCandidate(d))
    .filter((d) => looksLikeDomain(d) || d.includes("."));

  const keywords = typeof raw.keywords === "string" ? raw.keywords.trim() : undefined;
  const locations = toStringArray(raw.organization_locations ?? raw.locations ?? raw.location);
  const employeeRanges = toStringArray(
    raw.employee_ranges ?? raw.ranges ?? raw.organization_num_employees_ranges
  );
  const technologies = toStringArray(raw.technologies ?? raw.tech_stack ?? raw.technology_names);

  const pageRaw = Number(raw.page ?? 1);
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 5) : 1;

  const perPageRaw = Number(raw.per_page ?? raw.limit ?? 10);
  const perPage = Number.isInteger(perPageRaw) && perPageRaw >= 1 ? Math.min(perPageRaw, 25) : 10;

  const hasFilter =
    Boolean(organizationName && organizationName.length > 0) ||
    cleanedDomains.length > 0 ||
    Boolean(keywords && keywords.length > 0) ||
    locations.length > 0 ||
    employeeRanges.length > 0 ||
    technologies.length > 0;

  if (!hasFilter) {
    return {
      valid: false,
      error:
        "At least one filter is required: organization_name, domains, keywords, organization_locations, employee_ranges, or technologies.",
    };
  }

  return {
    valid: true,
    data: {
      organization_name: organizationName || undefined,
      domains: cleanedDomains.length > 0 ? cleanedDomains : undefined,
      keywords: keywords || undefined,
      organization_locations: locations.length > 0 ? locations : undefined,
      employee_ranges: employeeRanges.length > 0 ? employeeRanges : undefined,
      technologies: technologies.length > 0 ? technologies : undefined,
      page,
      per_page: perPage,
    },
  };
}
