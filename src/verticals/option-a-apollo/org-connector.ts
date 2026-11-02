/**
 * Supply Connector for Organization Enrichment
 *
 * Implements:
 * 1. enrichOrganizationWithApollo: GET /api/v1/organizations/enrich?domain=... (Verified live 200 OK)
 * 2. bulkEnrichOrganizationsWithApollo: POST /api/v1/organizations/bulk_enrich (with parallel enrich fallback)
 *
 * Includes mock mode fallback and 'nomatch.invalid' triggers.
 */

import { apolloRequest, isApolloMockMode } from "./apollo-client.ts";
import {
  normalizeApolloOrganization,
  resolveCompanyDomainFuzzy,
  type OrgEnrichInput,
  type OrgEnrichOutput,
  type OrganizationDetail,
} from "./org-schema.ts";

export interface BulkOrgEnrichOutput {
  matched: boolean;
  payment_settled?: boolean;
  source: "apollo_live" | "apollo_mock";
  timestamp: string;
  latency_ms: number;
  submitted_count: number;
  matched_count: number;
  skipped: string[];
  results: Array<{
    domain: string;
    matched: boolean;
    organization: OrganizationDetail | null;
  }>;
}

export function buildMockOrgEnrich(domain: string, orgName?: string): OrgEnrichOutput {
  const start = Date.now();
  if (domain === "nomatch.invalid") {
    return {
      matched: false,
      source: "apollo_mock",
      timestamp: new Date().toISOString(),
      latency_ms: 10,
      organization: null,
    };
  }

  const baseName = orgName || domain.split(".")[0];
  const capName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const apolloId = `mock_org_${domain.replace(/[^a-z0-9]/gi, "_")}`;

  const detail: OrganizationDetail = {
    apollo_id: apolloId,
    name: capName,
    primary_domain: domain,
    website_url: `https://${domain}`,
    linkedin_url: `https://www.linkedin.com/company/${baseName.toLowerCase()}`,
    twitter_url: `https://twitter.com/${baseName.toLowerCase()}`,
    facebook_url: null,
    logo_url: `https://logo.clearbit.com/${domain}`,
    industry: "information technology & services",
    industries: ["information technology & services", "software"],
    keywords: ["b2b", "enterprise", "cloud", "saas", "api"],
    estimated_num_employees: 450,
    founded_year: 2016,
    annual_revenue: 50000000,
    annual_revenue_printed: "$50M",
    total_funding: 85000000,
    total_funding_printed: "$85M",
    latest_funding_stage: "Series C",
    latest_funding_round_date: "2023-04-15T00:00:00.000Z",
    publicly_traded_symbol: null,
    publicly_traded_exchange: null,
    phone: "(415) 555-0199",
    street_address: "500 Howard St",
    city: "San Francisco",
    state: "California",
    country: "United States",
    postal_code: "94105",
    short_description: `${capName} is a leading enterprise technology company providing next-generation software platforms.`,
    technologies: ["React", "Node.js", "TypeScript", "PostgreSQL", "AWS", "Docker", "Datadog"],
    departmental_head_count: { engineering: 180, sales: 120, marketing: 40, operations: 30 },
    next_step: {
      tool: "search_people",
      rest: "POST /api/v1/search/people",
      args: { organization_ids: [apolloId] },
    },
  };

  return {
    matched: true,
    source: "apollo_mock",
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - start + 20,
    organization: detail,
  };
}

/**
 * Enriches single organization profile by company domain.
 */
export async function enrichOrganizationWithApollo(
  input: OrgEnrichInput
): Promise<OrgEnrichOutput> {
  let domain = input.domain;

  if ((!domain || domain.trim().length === 0) && input.organization_name) {
    const fuzzy = await resolveCompanyDomainFuzzy(input.organization_name);
    if (fuzzy) domain = fuzzy;
  }

  if (!domain || domain.trim().length === 0) {
    return {
      matched: false,
      source: "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: 5,
      organization: null,
    };
  }

  if (domain === "nomatch.invalid") {
    return {
      matched: false,
      source: isApolloMockMode() ? "apollo_mock" : "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: 8,
      organization: null,
    };
  }

  if (isApolloMockMode()) {
    return buildMockOrgEnrich(domain, input.organization_name);
  }

  const start = Date.now();
  try {
    const raw = await apolloRequest<{ organization?: Record<string, any> }>(
      "GET",
      "/api/v1/organizations/enrich",
      { query: { domain } }
    );

    if (raw.organization && raw.organization.id) {
      const organization = normalizeApolloOrganization(raw.organization);
      return {
        matched: true,
        source: "apollo_live",
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - start,
        organization,
      };
    }

    return {
      matched: false,
      source: "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      organization: null,
    };
  } catch (err: any) {
    console.warn(`Apollo live org enrich error: ${err?.message}`);
    // If not found (404), return clean miss
    if (/HTTP 404/.test(err?.message ?? "")) {
      return {
        matched: false,
        source: "apollo_live",
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - start,
        organization: null,
      };
    }
    // Network or rate limit error -> re-throw to trigger 502 with no settlement
    throw err;
  }
}

/**
 * Batch-enriches up to 10 company domains firmographics.
 * In live mode, attempts POST /api/v1/organizations/bulk_enrich, and if 403,
 * falls back to parallel single lookups.
 */
export async function bulkEnrichOrganizationsWithApollo(
  domains: string[],
  skippedFreeMail: string[] = []
): Promise<BulkOrgEnrichOutput> {
  const start = Date.now();
  if (isApolloMockMode()) {
    const results = domains.map((d) => {
      const res = buildMockOrgEnrich(d);
      return {
        domain: d,
        matched: res.matched,
        organization: res.organization,
      };
    });
    const matchedCount = results.filter((r) => r.matched).length;
    return {
      matched: matchedCount > 0,
      source: "apollo_mock",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start + 25,
      submitted_count: domains.length,
      matched_count: matchedCount,
      skipped: skippedFreeMail,
      results,
    };
  }

  // Live execution: try bulk_enrich first; fallback to parallel single calls if 403
  try {
    const raw = await apolloRequest<{
      organizations?: Array<Record<string, any>>;
    }>("POST", "/api/v1/organizations/bulk_enrich", { body: { domains } });

    const rawOrgs = Array.isArray(raw.organizations) ? raw.organizations : [];
    let results: Array<{ domain: string; matched: boolean; organization: OrganizationDetail | null }>;

    if (rawOrgs.length === domains.length) {
      // Direct index-aligned mapping (verified live; see docs/apollo-endpoint-notes.md §4)
      results = domains.map((domain, i) => {
        const rawOrg = rawOrgs[i];
        if (rawOrg && rawOrg.id) {
          const normalized = normalizeApolloOrganization(rawOrg);
          return {
            domain,
            matched: true,
            organization: normalized,
          };
        }
        return {
          domain,
          matched: false,
          organization: null,
        };
      });
    } else {
      // Fallback matching: by primary_domain or website_url host (handles domain redirects, e.g. fb.com -> meta.com)
      const orgMap = new Map<string, OrganizationDetail>();
      for (const org of rawOrgs) {
        if (!org) continue;
        const normalized = normalizeApolloOrganization(org);
        if (normalized.primary_domain) {
          orgMap.set(normalized.primary_domain.toLowerCase(), normalized);
        }
        if (normalized.website_url) {
          try {
            const host = new URL(normalized.website_url).hostname.replace(/^www\./, "").toLowerCase();
            if (!orgMap.has(host)) orgMap.set(host, normalized);
          } catch {
            // ignore url parse error
          }
        }
      }

      results = domains.map((domain) => {
        const cleanDom = domain.toLowerCase().replace(/^www\./, "");
        const hit = orgMap.get(cleanDom) || null;
        return {
          domain,
          matched: Boolean(hit),
          organization: hit,
        };
      });
    }

    const matchedCount = results.filter((r) => r.matched).length;
    return {
      matched: matchedCount > 0,
      source: "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      submitted_count: domains.length,
      matched_count: matchedCount,
      skipped: skippedFreeMail,
      results,
    };
  } catch (err: any) {
    if (/HTTP 403|HTTP 404/.test(err?.message ?? "")) {
      // Fall back to bounded parallel single enrichment on scope regression
      console.warn(`Bulk org upstream 403/404, executing parallel single queries: ${err?.message}`);
      const settled = await Promise.allSettled(domains.map((domain) => enrichOrganizationWithApollo({ domain })));
      const rejected = settled.filter((s) => s.status === "rejected");
      if (rejected.length > 0) {
        throw new Error(
          `${rejected.length}/${settled.length} upstream lookups failed; not settling partial batch`
        );
      }

      const results = domains.map((domain, i) => {
        const item = settled[i];
        if (item.status === "fulfilled") {
          return {
            domain,
            matched: item.value.matched,
            organization: item.value.organization,
          };
        }
        return {
          domain,
          matched: false,
          organization: null,
        };
      });

      const matchedCount = results.filter((r) => r.matched).length;
      return {
        matched: matchedCount > 0,
        source: "apollo_live",
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - start,
        submitted_count: domains.length,
        matched_count: matchedCount,
        skipped: skippedFreeMail,
        results,
      };
    }
    // On 429, 5xx, or network timeout, re-throw so the endpoint returns 502 without settling
    throw err;
  }
}
