/**
 * Supply Connector for Bulk Person Enrichment
 *
 * Implements:
 * - Upstream POST /api/v1/people/bulk_match
 * - Automatic parallel single enrich fallback if bulk endpoint returns 403 on current key
 * - Mock mode fallback with index alignment and 'nomatch.invalid' triggers
 */

import { apolloRequest, isApolloMockMode } from "./apollo-client.ts";
import { enrichPersonWithApollo } from "./connector.ts";
import { normalizeApolloPerson } from "./person-normalizer.ts";
import type {
  BulkPersonInput,
  BulkPersonOutput,
  BulkPersonResultItem,
} from "./bulk-person-schema.ts";

export function buildMockBulkPerson(input: BulkPersonInput): BulkPersonOutput {
  const start = Date.now();
  const results: BulkPersonResultItem[] = input.details.map((d, index) => {
    const isMiss =
      d.domain === "nomatch.invalid" ||
      d.email?.includes("nomatch.invalid") ||
      d.first_name === "nomatch.invalid";

    const originalIndices = input.original_indices_map?.[index] ?? [index];
    if (isMiss) {
      return {
        index,
        original_indices: originalIndices,
        input_echo: d as Record<string, unknown>,
        matched: false,
        person: null,
      };
    }

    const firstName = d.first_name || (d.name ? d.name.split(" ")[0] : "Alex");
    const lastName = d.last_name || (d.name && d.name.includes(" ") ? d.name.split(" ")[1] : "Taylor");
    const domain = d.domain || (d.organization_name ? `${d.organization_name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com` : "company.com");
    const apolloId = d.id || `mock_person_${index + 1}_${domain.replace(/[^a-z0-9]/g, "")}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;

    return {
      index,
      original_indices: originalIndices,
      input_echo: d as Record<string, unknown>,
      matched: true,
      person: {
        apollo_id: apolloId,
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        title: "VP of Product",
        headline: `VP of Product at ${domain}`,
        seniority: "vp",
        departments: ["product"],
        email,
        email_status: "verified",
        linkedin_url: d.linkedin_url || `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
        twitter_url: null,
        github_url: null,
        location: {
          city: "San Francisco",
          state: "California",
          country: "United States",
        },
        organization: {
          id: `mock_org_${domain.replace(/[^a-z0-9]/g, "")}`,
          name: d.organization_name || domain.split(".")[0],
          website_url: `https://${domain}`,
          primary_domain: domain,
          industry: "information technology & services",
          estimated_num_employees: 350,
          linkedin_url: `https://www.linkedin.com/company/${domain.split(".")[0]}`,
          founded_year: 2018,
        },
        employment_history: [
          {
            title: "VP of Product",
            organization_name: d.organization_name || domain.split(".")[0],
            start_date: "2021-01-01",
            end_date: "present",
            current: true,
          },
        ],
      },
    };
  });

  const matchedCount = results.filter((r) => r.matched).length;
  const billableCount = results.filter(
    (r) =>
      r.matched &&
      r.person?.email &&
      r.person.email.trim().length > 0 &&
      r.person.email_status !== "unavailable"
  ).length;

  return {
    matched: billableCount >= 1,
    source: "apollo_mock",
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - start + 25,
    submitted_count: input.submitted_count ?? input.details.length,
    matched_count: matchedCount,
    billable_count: billableCount,
    results,
  };
}

export async function bulkEnrichPeopleWithApollo(
  input: BulkPersonInput
): Promise<BulkPersonOutput> {
  if (isApolloMockMode()) {
    return buildMockBulkPerson(input);
  }

  const start = Date.now();

  // Try bulk_match upstream; if 403 (scope denied on this key tier), fall back to parallel single enrich calls
  try {
    const raw = await apolloRequest<{
      matches?: Array<Record<string, any>>;
      people?: Array<Record<string, any>>;
    }>("POST", "/api/v1/people/bulk_match", {
      body: {
        details: input.details,
        reveal_personal_emails: Boolean(input.reveal_personal_emails),
        reveal_phone_number: false,
      },
    });

    const rawList = Array.isArray(raw.matches) ? raw.matches : Array.isArray(raw.people) ? raw.people : [];

    const results: BulkPersonResultItem[] = input.details.map((inputEcho, index) => {
      const rawPerson = rawList[index];
      const originalIndices = input.original_indices_map?.[index] ?? [index];
      if (rawPerson && rawPerson.id) {
        const person = normalizeApolloPerson(rawPerson);
        return {
          index,
          original_indices: originalIndices,
          input_echo: inputEcho as Record<string, unknown>,
          matched: true,
          person,
        };
      }
      return {
        index,
        original_indices: originalIndices,
        input_echo: inputEcho as Record<string, unknown>,
        matched: false,
        person: null,
      };
    });

    const matchedCount = results.filter((r) => r.matched).length;
    const billableCount = results.filter(
      (r) =>
        r.matched &&
        r.person?.email &&
        r.person.email.trim().length > 0 &&
        r.person.email_status !== "unavailable"
    ).length;

    return {
      matched: billableCount >= 1,
      source: "apollo_live",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      submitted_count: input.submitted_count ?? input.details.length,
      matched_count: matchedCount,
      billable_count: billableCount,
      results,
    };
  } catch (err: any) {
    if (/HTTP 403|HTTP 404/.test(err?.message ?? "")) {
      console.warn(`Apollo bulk_match upstream 403/404, falling back to parallel single enrich: ${err?.message}`);
      // Parallel single enrichment (bounded at max 10 records)
      const settled = await Promise.allSettled(input.details.map((d) => enrichPersonWithApollo(d)));
      const allRejected = settled.every((s) => s.status === "rejected");
      if (allRejected) {
        throw new Error(`All parallel single person lookups failed: ${(settled[0] as PromiseRejectedResult).reason?.message}`);
      }

      const results: BulkPersonResultItem[] = input.details.map((inputEcho, index) => {
        const item = settled[index];
        const originalIndices = input.original_indices_map?.[index] ?? [index];
        if (item.status === "fulfilled") {
          return {
            index,
            original_indices: originalIndices,
            input_echo: inputEcho as Record<string, unknown>,
            matched: item.value.matched,
            person: item.value.person,
          };
        }
        return {
          index,
          original_indices: originalIndices,
          input_echo: inputEcho as Record<string, unknown>,
          matched: false,
          person: null,
        };
      });

      const matchedCount = results.filter((r) => r.matched).length;
      const billableCount = results.filter(
        (r) =>
          r.matched &&
          r.person?.email &&
          r.person.email.trim().length > 0 &&
          r.person.email_status !== "unavailable"
      ).length;

      return {
        matched: billableCount >= 1,
        source: "apollo_live",
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - start,
        submitted_count: input.submitted_count ?? input.details.length,
        matched_count: matchedCount,
        billable_count: billableCount,
        results,
      };
    }
    // On 429, 5xx, or network timeout, re-throw so the endpoint returns 502 with no settlement
    throw err;
  }
}
