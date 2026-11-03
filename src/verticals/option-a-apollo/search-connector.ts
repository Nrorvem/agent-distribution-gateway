/**
 * Supply Connector for Apollo.io Search Endpoints
 *
 * Implements:
 * 1. searchPeopleWithApollo: POST /api/v1/mixed_people/api_search (0-credit live verified search)
 * 2. searchOrganizationsWithApollo: POST /api/v1/mixed_companies/search (with mock / live fallback)
 *
 * Includes mock mode fallback with deterministic synthetic records and 'nomatch.invalid' triggers.
 */

import { apolloRequest, isApolloMockMode } from "./apollo-client.ts";
import { totalPriceUsd } from "./pricing.ts";
import { BULK_PERSON_MAX_ITEMS } from "./bulk-person-schema.ts";
import type {
  PeopleSearchInput,
  PeopleSearchOutput,
  PersonSearchResultItem,
  OrgSearchInput,
  OrgSearchOutput,
  OrgSearchResultItem,
} from "./search-schema.ts";

function isNomatchTrigger(input: PeopleSearchInput | OrgSearchInput): boolean {
  if ("keywords" in input && input.keywords === "nomatch.invalid") return true;
  if ("organization_domains" in input && input.organization_domains?.includes("nomatch.invalid")) return true;
  if ("domains" in input && input.domains?.includes("nomatch.invalid")) return true;
  if ("organization_name" in input && input.organization_name === "nomatch.invalid") return true;
  return false;
}

/**
 * Builds the chunked bulk-unlock hint from searchable people profiles.
 * Sourced directly from BULK_PERSON_MAX_ITEMS to keep batch limits strictly aligned.
 */
export function buildUnlockHint(
  people: PersonSearchResultItem[]
): PeopleSearchOutput["unlock"] {
  const emailablePeople = people.filter((p) => p.has_email && p.apollo_id);
  if (emailablePeople.length === 0) return undefined;

  const ids = emailablePeople.map((p) => ({ id: p.apollo_id }));
  const chunks = Array.from(
    { length: Math.ceil(ids.length / BULK_PERSON_MAX_ITEMS) },
    (_, i) => ids.slice(i * BULK_PERSON_MAX_ITEMS, (i + 1) * BULK_PERSON_MAX_ITEMS)
  );

  return {
    tool: "bulk_enrich_people",
    rest: "POST /api/v1/enrich/people/bulk",
    args: { details: chunks[0] },
    remaining_batches: chunks.slice(1).map((details) => ({ details })),
    estimated_price_usd: totalPriceUsd("bulk_enrich_people", ids.length),
    description: `Enrich ${ids.length} reachable profile(s) in ${chunks.length} call(s) of ≤${BULK_PERSON_MAX_ITEMS}`,
  };
}

export function buildMockPeopleSearch(input: PeopleSearchInput): PeopleSearchOutput {
  const start = Date.now();
  if (isNomatchTrigger(input)) {
    return {
      matched: false,
      source: "apollo_mock",
      timestamp: new Date().toISOString(),
      latency_ms: 12,
      pagination: { page: input.page || 1, per_page: input.per_page || 10, total_entries: 0, total_pages: 0 },
      people: [],
    };
  }

  const domain = input.organization_domains?.[0] || "example.com";
  const orgName = domain.split(".")[0];
  const capOrg = orgName.charAt(0).toUpperCase() + orgName.slice(1);
  const titles = input.person_titles?.length ? input.person_titles : ["VP of Engineering", "Head of Product", "Chief Technology Officer"];
  const count = Math.min(Math.max(input.per_page || 10, 1), 25);
  const firstNames = ["Alex", "Morgan", "Jordan", "Taylor", "Casey", "Riley", "Sam", "Jamie"];
  const lastNames = ["Chen", "Taylor", "Vance", "Smith", "Johnson", "Williams", "Brown", "Jones"];

  const mockPeople: PersonSearchResultItem[] = Array.from({ length: count }, (_, idx) => {
    const id = `mock_person_${idx + 1}_${orgName}`;
    const firstName = firstNames[idx % firstNames.length];
    const lastName = lastNames[idx % lastNames.length];
    const lastNameObfuscated = `${lastName.slice(0, 1)}***${lastName.slice(-1)}`;
    const title = titles[idx % titles.length] || "VP of Engineering";
    return {
      apollo_id: id,
      first_name: firstName,
      last_name: lastName,
      last_name_obfuscated: lastNameObfuscated,
      full_name: `${firstName} ${lastName}`,
      title,
      seniority: "vp",
      linkedin_url: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
      has_email: true,
      location: {
        city: "San Francisco",
        state: "California",
        country: "United States",
      },
      organization: {
        id: `mock_org_${orgName}`,
        name: capOrg,
        primary_domain: domain,
      },
      next_step: {
        tool: "enrich_person",
        rest: "POST /api/v1/enrich/person",
        args: { id },
      },
    };
  });

  const unlock = buildUnlockHint(mockPeople);

  return {
    matched: true,
    source: "apollo_mock",
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - start + 15,
    pagination: {
      page: input.page || 1,
      per_page: input.per_page || 10,
      total_entries: mockPeople.length,
      total_pages: 1,
    },
    people: mockPeople,
    unlock,
  };
}

export function buildMockOrgSearch(input: OrgSearchInput): OrgSearchOutput {
  const start = Date.now();
  if (isNomatchTrigger(input)) {
    return {
      matched: false,
      source: "apollo_mock",
      timestamp: new Date().toISOString(),
      latency_ms: 10,
      pagination: { page: input.page || 1, per_page: input.per_page || 10, total_entries: 0, total_pages: 0 },
      organizations: [],
    };
  }

  const baseName = input.organization_name || input.domains?.[0]?.split(".")[0] || "Acme";
  const mockOrgs: OrgSearchResultItem[] = [1, 2, 3].map((idx) => {
    const name = idx === 1 ? baseName : `${baseName} Solutions ${idx}`;
    const domain = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
    const id = `mock_org_${idx}_${domain.replace(/\./g, "_")}`;
    return {
      id,
      name,
      primary_domain: domain,
      website_url: `https://${domain}`,
      industry: "information technology & services",
      estimated_num_employees: idx * 150,
      linkedin_url: `https://www.linkedin.com/company/${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      founded_year: 2010 + idx,
      city: "San Francisco",
      country: "United States",
      next_step: {
        enrich_organization: {
          tool: "enrich_organization",
          rest: "POST /api/v1/enrich/organization",
          args: { domain },
        },
        search_people: {
          tool: "search_people",
          rest: "POST /api/v1/search/people",
          args: { organization_ids: [id] },
        },
      },
    };
  });

  return {
    matched: true,
    source: "apollo_mock",
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - start + 12,
    pagination: {
      page: input.page || 1,
      per_page: input.per_page || 10,
      total_entries: mockOrgs.length,
      total_pages: 1,
    },
    organizations: mockOrgs,
  };
}

/**
 * Searches Apollo.io People directory via live POST /api/v1/mixed_people/api_search
 */
export async function searchPeopleWithApollo(
  input: PeopleSearchInput
): Promise<PeopleSearchOutput> {
  if (isApolloMockMode()) {
    return buildMockPeopleSearch(input);
  }

  const start = Date.now();

  const payload: Record<string, unknown> = {
    page: input.page || 1,
    per_page: input.per_page || 10,
  };

  if (input.organization_domains?.length) {
    payload.q_organization_domains_list = input.organization_domains;
  }
  if (input.person_titles?.length) {
    payload.person_titles = input.person_titles;
  }
  if (input.person_seniorities?.length) {
    payload.person_seniorities = input.person_seniorities;
  }
  if (input.person_locations?.length) {
    payload.person_locations = input.person_locations;
  }
  if (input.organization_ids?.length) {
    payload.organization_ids = input.organization_ids;
  }
  if (input.employee_ranges?.length) {
    payload.organization_num_employees_ranges = input.employee_ranges;
  }
  if (input.keywords) {
    payload.q_keywords = input.keywords;
  }

  try {
    const raw = await apolloRequest<{
      total_entries?: number;
      pagination?: { total_entries?: number; total_pages?: number };
      people?: Array<Record<string, any>>;
    }>("POST", "/api/v1/mixed_people/api_search", { body: payload });

    const rawPeople = Array.isArray(raw.people) ? raw.people : [];
    const totalEntries = raw.total_entries ?? raw.pagination?.total_entries ?? rawPeople.length;
    const perPage = input.per_page || 10;
    const totalPages = Math.ceil(totalEntries / perPage) || 1;

    const people: PersonSearchResultItem[] = rawPeople.map((p) => {
      const apolloId = String(p.id || p.apollo_id || "");
      const firstName = String(p.first_name || "");
      const lastName = p.last_name ?? null;
      const lastNameObfuscated = p.last_name_obfuscated ?? null;
      const fullName = p.name || (lastName ? `${firstName} ${lastName}`.trim() : (firstName || null));

      return {
        apollo_id: apolloId,
        first_name: firstName,
        last_name: lastName,
        last_name_obfuscated: lastNameObfuscated,
        full_name: fullName,
        title: String(p.title || ""),
        seniority: p.seniority || null,
        linkedin_url: p.linkedin_url || null,
        has_email: Boolean(p.has_email || p.email),
        location: {
          city: p.city || null,
          state: p.state || null,
          country: p.country || null,
        },
        organization: {
          id: p.organization?.id || p.organization_id || null,
          name: p.organization?.name || null,
          primary_domain: p.organization?.primary_domain || null,
        },
        next_step: {
          tool: "enrich_person",
          rest: "POST /api/v1/enrich/person",
          args: { id: apolloId },
        },
      };
    });

    const unlock = buildUnlockHint(people);

    return {
      matched: people.length > 0,
      source: "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      pagination: {
        page: input.page || 1,
        per_page: perPage,
        total_entries: totalEntries,
        total_pages: totalPages,
      },
      people,
      unlock,
    };
  } catch (err: any) {
    if (/HTTP 404/.test(err?.message ?? "")) {
      return {
        matched: false,
        source: "apollo_live",
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - start,
        pagination: {
          page: input.page || 1,
          per_page: input.per_page || 10,
          total_entries: 0,
          total_pages: 0,
        },
        people: [],
      };
    }
    throw err;
  }
}

/**
 * Searches Apollo.io Organizations directory.
 * Note: If mixed_companies/search returns 403 on the configured key, falls back to mock.
 */
export async function searchOrganizationsWithApollo(
  input: OrgSearchInput
): Promise<OrgSearchOutput> {
  if (isApolloMockMode()) {
    return buildMockOrgSearch(input);
  }

  const start = Date.now();

  const payload: Record<string, unknown> = {
    page: input.page || 1,
    per_page: input.per_page || 10,
  };

  if (input.organization_name) {
    payload.q_organization_name = input.organization_name;
  }
  if (input.domains?.length) {
    payload.q_organization_domains_list = input.domains;
  }
  if (input.keywords) {
    payload.q_organization_keyword_tags = [input.keywords];
  }
  if (input.organization_locations?.length) {
    payload.organization_locations = input.organization_locations;
  }
  if (input.employee_ranges?.length) {
    payload.organization_num_employees_ranges = input.employee_ranges;
  }

  try {
    const raw = await apolloRequest<{
      total_entries?: number;
      pagination?: { total_entries?: number; total_pages?: number };
      organizations?: Array<Record<string, any>>;
      accounts?: Array<Record<string, any>>;
    }>("POST", "/api/v1/mixed_companies/search", { body: payload });

    const rawOrgs = Array.isArray(raw.organizations)
      ? raw.organizations
      : Array.isArray(raw.accounts)
      ? raw.accounts
      : [];

    const totalEntries = raw.total_entries ?? raw.pagination?.total_entries ?? rawOrgs.length;
    const perPage = input.per_page || 10;
    const totalPages = Math.ceil(totalEntries / perPage) || 1;

    const organizations: OrgSearchResultItem[] = rawOrgs.map((org) => {
      const id = String(org.id || "");
      const domain = org.primary_domain || org.domain || null;
      return {
        id,
        name: String(org.name || ""),
        primary_domain: domain,
        website_url: org.website_url || (domain ? `https://${domain}` : null),
        industry: org.industry || null,
        estimated_num_employees: typeof org.estimated_num_employees === "number" ? org.estimated_num_employees : null,
        linkedin_url: org.linkedin_url || null,
        founded_year: typeof org.founded_year === "number" ? org.founded_year : null,
        city: org.city || null,
        country: org.country || null,
        next_step: {
          enrich_organization: {
            tool: "enrich_organization",
            rest: "POST /api/v1/enrich/organization",
            args: { domain: domain || "" },
          },
          search_people: {
            tool: "search_people",
            rest: "POST /api/v1/search/people",
            args: { organization_ids: [id] },
          },
        },
      };
    });

    return {
      matched: organizations.length > 0,
      source: "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      pagination: {
        page: input.page || 1,
        per_page: perPage,
        total_entries: totalEntries,
        total_pages: totalPages,
      },
      organizations,
    };
  } catch (err: any) {
    if (/HTTP 404/.test(err?.message ?? "")) {
      return {
        matched: false,
        source: "apollo_live",
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - start,
        pagination: {
          page: input.page || 1,
          per_page: input.per_page || 10,
          total_entries: 0,
          total_pages: 0,
        },
        organizations: [],
      };
    }
    throw err;
  }
}
