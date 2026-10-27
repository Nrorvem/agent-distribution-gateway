/**
 * Layer 1: Supply Connector (Option A — Apollo.io Person Enrichment)
 *
 * Wraps `POST https://api.apollo.io/api/v1/people/match` with:
 * 1. Credit guardrails: Always sets `reveal_phone_number: false` so calls never trigger
 *    Apollo's 8-credit mobile phone reveal surcharge.
 * 2. Deterministic schema translation: Strips noisy internal fields and returns a
 *    guaranteed `PersonEnrichOutput` payload.
 * 3. Safe mock fallback (`APOLLO_MOCK_MODE=true` or when testing locally without an API key)
 *    so agent discovery and 402 payment flows can be tested end-to-end with zero credit burn.
 */

import {
  KNOWN_COMPANY_BRAND_MAP,
  normalizeCompanyName,
  looksLikeDomain,
  cleanDomainCandidate,
  type PersonEnrichInput,
  type PersonEnrichOutput,
  type EmploymentHistoryEntry,
} from "./schema.ts";

const APOLLO_MATCH_ENDPOINT = "https://api.apollo.io/api/v1/people/match";
const CLEARBIT_AUTOCOMPLETE_URL =
  "https://autocomplete.clearbit.com/v1/companies/suggest?query=";

/**
 * Resolves a fuzzy company name (e.g., "Hugging Face", "Linear", "Scale AI")
 * to its canonical primary domain via Clearbit's public autocomplete API.
 * Uses a strict 1200ms timeout so it never stalls enrichment if unreachable.
 */
async function resolveCompanyDomainFuzzy(
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
      `${CLEARBIT_AUTOCOMPLETE_URL}${encodeURIComponent(cleanedName)}`,
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
    // Non-fatal: proceed with organization_name only
  }
  return undefined;
}

async function callApolloMatchApi(
  apiKey: string,
  payload: Record<string, unknown>
): Promise<Record<string, any> | null> {
  const response = await fetch(APOLLO_MATCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Apollo API returned HTTP ${response.status}: ${errText}`);
  }

  const rawData = (await response.json()) as Record<string, any>;
  return rawData?.person && rawData.person.id ? rawData.person : null;
}

export async function enrichPersonWithApollo(
  input: PersonEnrichInput
): Promise<PersonEnrichOutput> {
  const startTime = Date.now();
  const apiKey = process.env.APOLLO_API_KEY;
  const mockMode =
    process.env.APOLLO_MOCK_MODE === "true" ||
    !apiKey ||
    apiKey === "your_apollo_master_api_key_here";

  // If caller provided organization_name without domain, resolve canonical domain
  let resolvedDomain = input.domain;
  if (!resolvedDomain && input.organization_name && !mockMode) {
    resolvedDomain = await resolveCompanyDomainFuzzy(input.organization_name);
  }

  if (mockMode) {
    return buildMockEnrichment(
      { ...input, domain: resolvedDomain || input.domain },
      startTime
    );
  }

  // Construct payload with strict credit guardrails:
  // reveal_phone_number MUST be false to avoid ~8x credit consumption.
  const basePayload: Record<string, unknown> = {
    reveal_phone_number: false,
    reveal_personal_emails: Boolean(input.reveal_personal_emails),
  };

  if (input.id) basePayload.id = input.id;
  if (input.first_name) basePayload.first_name = input.first_name;
  if (input.last_name) basePayload.last_name = input.last_name;
  if (input.name) basePayload.name = input.name;
  if (input.email) basePayload.email = input.email;
  if (resolvedDomain) basePayload.domain = resolvedDomain;
  if (input.organization_name) basePayload.organization_name = input.organization_name;
  if (input.linkedin_url) basePayload.linkedin_url = input.linkedin_url;

  let p = await callApolloMatchApi(apiKey, basePayload);

  // Zero-credit fallback retries if initial match returned null:
  // (Apollo does not charge credits when a match attempt returns no person)
  if (!p) {
    const orgKey = input.organization_name
      ? normalizeCompanyName(input.organization_name).toLowerCase()
      : undefined;
    const domainKey = resolvedDomain?.toLowerCase();
    const brandEntry =
      (orgKey ? KNOWN_COMPANY_BRAND_MAP[orgKey] : undefined) ||
      (domainKey ? KNOWN_COMPANY_BRAND_MAP[domainKey] : undefined);

    // Retry 1: Try known alternate brand domains (e.g., meta.com -> fb.com / facebook.com, google.com -> abc.xyz)
    if (brandEntry?.altDomains) {
      for (const altDomain of brandEntry.altDomains) {
        if (altDomain === resolvedDomain) continue;
        p = await callApolloMatchApi(apiKey, {
          ...basePayload,
          domain: altDomain,
        });
        if (p) break;
      }
    }

    // Retry 2: If both domain and organization_name were supplied and conflicted,
    // retry with organization_name only (without domain constraint)
    if (!p && basePayload.domain && basePayload.organization_name) {
      const orgOnlyPayload: Record<string, unknown> = { ...basePayload };
      delete orgOnlyPayload.domain;
      p = await callApolloMatchApi(apiKey, orgOnlyPayload);
    }

    // Retry 3: If domain was supplied without organization_name and failed,
    // derive organization_name from the domain stem and retry
    if (!p && basePayload.domain && !basePayload.organization_name) {
      const stem = String(basePayload.domain).split(".")[0];
      if (stem && stem.length >= 2) {
        const stemPayload: Record<string, unknown> = {
          ...basePayload,
          organization_name: stem,
        };
        delete stemPayload.domain;
        p = await callApolloMatchApi(apiKey, stemPayload);
      }
    }
  }

  const latency_ms = Date.now() - startTime;

  if (!p || !p.id) {
    return {
      matched: false,
      timestamp: new Date().toISOString(),
      latency_ms,
      source: "apollo_live",
      person: null,
    };
  }

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
    matched: true,
    timestamp: new Date().toISOString(),
    latency_ms,
    source: "apollo_live",
    person: {
      apollo_id: String(p.id),
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
    },
  };
}

function buildMockEnrichment(
  input: PersonEnrichInput,
  startTime: number
): PersonEnrichOutput {
  const firstName = input.first_name || (input.name ? input.name.split(" ")[0] : "Tim");
  const lastName =
    input.last_name || (input.name ? input.name.split(" ").slice(1).join(" ") : "Zheng");
  const domain = input.domain || "apollo.io";
  const orgName =
    input.organization_name ||
    domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);

  return {
    matched: true,
    timestamp: new Date().toISOString(),
    latency_ms: Math.max(12, Date.now() - startTime),
    source: "apollo_mock",
    person: {
      apollo_id: "mock_apollo_64f1b2c9e8d7a10001",
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      title: "Founder & CEO",
      headline: `Building ${orgName} | B2B Go-To-Market & Agentic Commerce`,
      seniority: "founder",
      departments: ["executive", "engineering"],
      email: input.email || `${firstName.toLowerCase()}@${domain}`,
      email_status: "verified",
      linkedin_url:
        input.linkedin_url ||
        `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
      twitter_url: null,
      github_url: null,
      location: {
        city: "San Francisco",
        state: "California",
        country: "United States",
      },
      organization: {
        id: "mock_org_98a7b6c5",
        name: orgName,
        website_url: `https://${domain}`,
        primary_domain: domain,
        industry: "Information Technology & Services",
        estimated_num_employees: 450,
        linkedin_url: `https://www.linkedin.com/company/${domain.split(".")[0]}`,
        founded_year: 2015,
      },
      employment_history: [
        {
          title: "Founder & CEO",
          organization_name: orgName,
          start_date: "2016-01-01",
          end_date: null,
          current: true,
        },
      ],
    },
  };
}
