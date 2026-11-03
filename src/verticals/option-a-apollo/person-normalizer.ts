/**
 * Apollo Person Normalizer
 *
 * Deterministically maps raw Apollo API person JSON into the strict PersonEnrichOutput person schema.
 */

import type { EmploymentHistoryEntry, PersonEnrichOutput } from "./schema.ts";

export type NormalizedPerson = NonNullable<PersonEnrichOutput["person"]>;

export function normalizeApolloPerson(p: Record<string, any>): NormalizedPerson {
  const history: EmploymentHistoryEntry[] = Array.isArray(p.employment_history)
    ? p.employment_history.slice(0, 8).map((item: Record<string, any>) => ({
        title: item.title ?? null,
        organization_name: item.organization_name ?? null,
        start_date: item.start_date ?? null,
        end_date: item.end_date ?? null,
        current: Boolean(item.current),
      }))
    : [];

  const org = p.organization
    ? {
        id: p.organization.id ?? null,
        name: p.organization.name ?? null,
        website_url: p.organization.website_url ?? null,
        primary_domain: p.organization.primary_domain ?? null,
        industry: p.organization.industry ?? null,
        estimated_num_employees:
          typeof p.organization.estimated_num_employees === "number"
            ? p.organization.estimated_num_employees
            : null,
        linkedin_url: p.organization.linkedin_url ?? null,
        founded_year:
          typeof p.organization.founded_year === "number"
            ? p.organization.founded_year
            : null,
      }
    : null;

  return {
    apollo_id: String(p.id || p.apollo_id || ""),
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    full_name: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
    title: p.title ?? null,
    headline: p.headline ?? null,
    seniority: p.seniority ?? null,
    departments: Array.isArray(p.departments) ? p.departments : [],
    email: p.email ?? null,
    email_status: p.email_status ?? (p.email ? "verified" : "unavailable"),
    linkedin_url: p.linkedin_url ?? null,
    twitter_url: p.twitter_url ?? null,
    github_url: p.github_url ?? null,
    location: {
      city: p.city ?? null,
      state: p.state ?? null,
      country: p.country ?? null,
    },
    organization: org,
    employment_history: history,
  };
}
