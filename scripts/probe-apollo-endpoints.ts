/**
 * Apollo Endpoint Prober (Phase 0)
 *
 * Verifies live endpoint paths, request/response shapes, and credit consumption
 * for full-funnel expansion:
 * 1. People Search (`mixed_people/api_search` or fallback `mixed_people/search`)
 * 2. Organization Search (`mixed_companies/search`)
 * 3. Organization Enrich (`organizations/enrich?domain=...`)
 * 4. Bulk Organization Enrich (`organizations/bulk_enrich`)
 * 5. Bulk Person Match (`people/bulk_match`)
 * 6. (Stretch) Organization Job Postings (`organizations/{id}/job_postings`)
 *
 * Usage:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/probe-apollo-endpoints.ts
 */

import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  for (const file of [".env.local", ".env.local.example", ".env"]) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}

interface ProbeResult {
  endpoint: string;
  method: string;
  status: number;
  rateLimitHeaders: Record<string, string>;
  topLevelKeys: string[];
  firstResultSample?: Record<string, unknown>;
  errorText?: string;
}

async function probeRequest(
  apiKey: string,
  method: string,
  url: string,
  body?: unknown
): Promise<ProbeResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "x-api-key": apiKey,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const rateLimitHeaders: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase().includes("rate") || k.toLowerCase().includes("usage") || k.toLowerCase().includes("credit")) {
      rateLimitHeaders[k] = v;
    }
  }

  const status = res.status;
  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    return {
      endpoint: url,
      method,
      status,
      rateLimitHeaders,
      topLevelKeys: [],
      errorText: errorText.slice(0, 400),
    };
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  const topLevelKeys = Object.keys(json);

  let firstResultSample: Record<string, unknown> | undefined;
  for (const key of ["people", "organizations", "matches", "job_postings", "jobs", "accounts"]) {
    if (Array.isArray(json[key]) && json[key].length > 0) {
      const sample = json[key][0];
      if (typeof sample === "object" && sample !== null) {
        firstResultSample = Object.keys(sample).reduce((acc, k) => {
          const val = sample[k];
          acc[k] = typeof val === "object" && val !== null ? (Array.isArray(val) ? `Array(${val.length})` : "Object") : typeof val;
          return acc;
        }, {} as Record<string, unknown>);
      }
      break;
    }
  }

  if (!firstResultSample && json.organization && typeof json.organization === "object") {
    firstResultSample = Object.keys(json.organization).reduce((acc, k) => {
      const val = json.organization[k];
      acc[k] = typeof val === "object" && val !== null ? (Array.isArray(val) ? `Array(${val.length})` : "Object") : typeof val;
      return acc;
    }, {} as Record<string, unknown>);
  }

  return {
    endpoint: url,
    method,
    status,
    rateLimitHeaders,
    topLevelKeys,
    firstResultSample,
  };
}

async function main() {
  loadEnv();
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey || apiKey === "mock_key" || apiKey === "test_api_key") {
    console.error("No valid APOLLO_API_KEY found in environment or .env.local");
    process.exit(1);
  }

  console.log("=== Apollo Endpoints Probe Starting ===");
  const results: ProbeResult[] = [];
  let capturedOrgId: string | undefined;

  // 1. People Search: try mixed_people/api_search first
  console.log("\n1. Probing People Search (mixed_people/api_search)...");
  let peopleRes = await probeRequest(
    apiKey,
    "POST",
    "https://api.apollo.io/api/v1/mixed_people/api_search",
    {
      q_organization_domains_list: ["apollo.io"],
      person_titles: ["ceo"],
      per_page: 2,
    }
  );

  if (peopleRes.status === 404 || peopleRes.status === 403) {
    console.log(`mixed_people/api_search returned ${peopleRes.status}, falling back to mixed_people/search...`);
    peopleRes = await probeRequest(
      apiKey,
      "POST",
      "https://api.apollo.io/api/v1/mixed_people/search",
      {
        q_organization_domains_list: ["apollo.io"],
        person_titles: ["ceo"],
        per_page: 2,
      }
    );
  }
  results.push(peopleRes);
  console.log(`Status: ${peopleRes.status}, Top keys: ${peopleRes.topLevelKeys.join(", ")}`);
  if (peopleRes.errorText) console.log(`Error: ${peopleRes.errorText}`);

  // 2. Organization Search: mixed_companies/search
  console.log("\n2. Probing Organization Search (mixed_companies/search)...");
  const orgSearchRes = await probeRequest(
    apiKey,
    "POST",
    "https://api.apollo.io/api/v1/mixed_companies/search",
    {
      q_organization_domains_list: ["apollo.io"],
      per_page: 2,
    }
  );
  results.push(orgSearchRes);
  console.log(`Status: ${orgSearchRes.status}, Top keys: ${orgSearchRes.topLevelKeys.join(", ")}`);
  if (orgSearchRes.errorText) console.log(`Error: ${orgSearchRes.errorText}`);

  // 3. Organization Enrich: organizations/enrich?domain=apollo.io
  console.log("\n3. Probing Organization Enrich (organizations/enrich)...");
  const orgEnrichRes = await probeRequest(
    apiKey,
    "GET",
    "https://api.apollo.io/api/v1/organizations/enrich?domain=apollo.io"
  );
  results.push(orgEnrichRes);
  console.log(`Status: ${orgEnrichRes.status}, Top keys: ${orgEnrichRes.topLevelKeys.join(", ")}`);
  if (orgEnrichRes.errorText) console.log(`Error: ${orgEnrichRes.errorText}`);

  // Extract org id for job postings probe if present
  try {
    const rawRes = await fetch("https://api.apollo.io/api/v1/organizations/enrich?domain=apollo.io", {
      headers: { "x-api-key": apiKey },
    });
    if (rawRes.ok) {
      const data = await rawRes.json();
      capturedOrgId = data.organization?.id;
    }
  } catch {
    // ignore
  }

  // 4. Bulk Organization Enrich: organizations/bulk_enrich
  console.log("\n4. Probing Bulk Organization Enrich (organizations/bulk_enrich)...");
  const bulkOrgRes = await probeRequest(
    apiKey,
    "POST",
    "https://api.apollo.io/api/v1/organizations/bulk_enrich",
    {
      domains: ["apollo.io", "stripe.com"],
    }
  );
  results.push(bulkOrgRes);
  console.log(`Status: ${bulkOrgRes.status}, Top keys: ${bulkOrgRes.topLevelKeys.join(", ")}`);
  if (bulkOrgRes.errorText) console.log(`Error: ${bulkOrgRes.errorText}`);

  // 5. Bulk Person Match: people/bulk_match
  console.log("\n5. Probing Bulk Person Match (people/bulk_match)...");
  const bulkPersonRes = await probeRequest(
    apiKey,
    "POST",
    "https://api.apollo.io/api/v1/people/bulk_match",
    {
      details: [
        {
          first_name: "Tim",
          last_name: "Zheng",
          domain: "apollo.io",
        },
      ],
      reveal_personal_emails: false,
      reveal_phone_number: false,
    }
  );
  results.push(bulkPersonRes);
  console.log(`Status: ${bulkPersonRes.status}, Top keys: ${bulkPersonRes.topLevelKeys.join(", ")}`);
  if (bulkPersonRes.errorText) console.log(`Error: ${bulkPersonRes.errorText}`);

  // 6. (Stretch) Organization Job Postings
  if (capturedOrgId) {
    console.log(`\n6. Probing Job Postings for org ${capturedOrgId}...`);
    const jobPostingsRes = await probeRequest(
      apiKey,
      "GET",
      `https://api.apollo.io/api/v1/organizations/${capturedOrgId}/job_postings`
    );
    results.push(jobPostingsRes);
    console.log(`Status: ${jobPostingsRes.status}, Top keys: ${jobPostingsRes.topLevelKeys.join(", ")}`);
    if (jobPostingsRes.errorText) console.log(`Error: ${jobPostingsRes.errorText}`);
  } else {
    console.log("\n6. Skipping Job Postings probe (no captured org ID).");
  }

  console.log("\n=== Summary of Probe Results ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("Probe script error:", err);
  process.exit(1);
});
