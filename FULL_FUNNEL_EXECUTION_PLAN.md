# Full-Funnel Apollo Gateway — Execution Plan

**Executor:** Gemini 3.8 Flash (or any coding agent)
**Repo:** `/Users/bentspoon/Documents/Agent_Distribution` (Next.js 15 App Router, TypeScript, deployed to Vercel from `main`)
**Read first:** `AGENTS.md` (project memory + invariants). This plan assumes you've read it.
**Goal:** Turn `enrichmatch.dev` from a single-tool person-enrichment endpoint into a complete **Search → Enrich** B2B data origin, so an agent can find companies, find people, and enrich both (single and bulk) on this origin alone, without starting at an aggregator like Locus or Orthogonal.

---

## 0. Rules of Engagement (read before touching code)

1. **Do not change the behavior of `POST /api/v1/enrich/person` or the `enrich_person` MCP tool.** They are live, verified on x402scan, and earning. Any shared-code refactor must leave their challenge bytes, price, and responses identical. Phase 1 has a regression check for this.
2. **Invariant #1 from AGENTS.md applies to every new paid route:**
   no payment header → `HTTP 402` immediately (even with an empty or invalid body) → if a payment header IS present, validate the body (`HTTP 422`, no settlement) → `verifyX402Payment(..., { verifyOnly: true })` → call Apollo → settle only if billable → audit log → `HTTP 200`.
3. **Never call Apollo before payment is verified** (except in Phase 0's probe script, which runs locally with the owner's key).
4. **Never set `reveal_phone_number: true`** anywhere. Phone reveals cost about 8 credits and need a webhook.
5. **Typecheck before every commit:** `/opt/homebrew/bin/node ./node_modules/typescript/bin/tsc --noEmit`
6. **Never read, print, commit, or modify `.env.local`.** Read env vars through `process.env` only.
7. **Commit locally at the end of each phase** (conventional commit messages, as in `git log`). **Do NOT `git push`**, because pushing to `main` deploys to production. Stop at Phase 7 and ask the human for approval.
8. **Do NOT run anything that spends real USDC or real Apollo credits** (`scripts/live-onchain-buyer.ts`, `batch-settle-buyers.ts`, `staggered-settlements.ts`, live Apollo calls) unless the human explicitly approves that step. The only exception is the Phase 0 probe, and it needs approval too.
9. Use `/opt/homebrew/bin/node` for all scripts. Scripts run with `--experimental-strip-types`. Follow the existing import style (relative `./x.ts` imports inside `src/verticals/**`, `@/` aliases inside `src/app/**`).
10. If an Apollo endpoint or response shape differs from what this plan describes, **trust the live response and Apollo's docs (https://docs.apollo.io/reference), not this plan**. Record the discrepancy in `docs/apollo-endpoint-notes.md`.

---

## 1. Target Product Surface

| # | Product | REST route (POST) | MCP tool | Apollo upstream | Default price | Billing rule ("billable" = settle) |
|---|---|---|---|---|---|---|
| — | Quote / catalog | `GET` on every route + `/api/v1/catalog` | `get_enrichment_quote` (extend) | none | FREE | n/a |
| 1 | **People Search** | `/api/v1/search/people` | `search_people` | `POST /api/v1/mixed_people/api_search` | $0.01 / page | ≥ 1 result returned |
| 2 | **Organization Search** | `/api/v1/search/organizations` | `search_organizations` | `POST /api/v1/mixed_companies/search` | $0.02 / page | ≥ 1 result returned |
| 3 | Person Enrich (**exists**) | `/api/v1/enrich/person` | `enrich_person` | `POST /api/v1/people/match` | $0.03 | match + deliverable email |
| 4 | **Organization Enrich** | `/api/v1/enrich/organization` | `enrich_organization` | `GET /api/v1/organizations/enrich?domain=` | $0.02 | organization found |
| 5 | **Bulk Person Enrich** (≤10) | `/api/v1/enrich/people/bulk` | `bulk_enrich_people` | `POST /api/v1/people/bulk_match` | $0.025 × records submitted | ≥ 1 record with deliverable email |
| 6 | **Bulk Organization Enrich** (≤10) | `/api/v1/enrich/organizations/bulk` | `bulk_enrich_organizations` | `POST /api/v1/organizations/bulk_enrich` | $0.015 × domains submitted | ≥ 1 organization found |
| 7 | **Company Job Postings** (stretch) | `/api/v1/organizations/job-postings` | `get_organization_job_postings` | `GET /api/v1/organizations/{id}/job_postings` | $0.01 | ≥ 1 posting |
| 8 | **Prospect (one-shot funnel)** (stretch) | `/api/v1/prospect` | `prospect` | api_search → bulk_match | $0.03 × `limit` (≤10) | ≥ 1 lead with deliverable email |

All prices must be **env-overridable** (e.g. `X402_PRICE_SEARCH_PEOPLE_USD`) and default to the values above. Keep `X402_ENRICH_PRICE_USD` as the person-enrich override so nothing changes for the live endpoint.

### Funnel contract (this is what makes it "full funnel")
Every search result must carry the identifier the next step needs, with no reformatting:
- `search_organizations` result → `organization.id`, `primary_domain` → feeds `enrich_organization {domain}`, `bulk_enrich_organizations {domains}`, `search_people {organization_ids | q_organization_domains}`, `get_organization_job_postings {organization_id}`.
- `search_people` result → `apollo_id` → feeds `enrich_person {id}` and `bulk_enrich_people {details:[{id}]}` (the person validator already accepts `id`).
- Each result object includes a `next_step` hint, e.g. `{"tool":"enrich_person","args":{"id":"..."}}`. Agents chain much more reliably when they get one.

### Bulk billing model (read this, it's subtle)
The x402 `exact` scheme settles the **full signed amount or nothing**. It cannot settle "3 of 10 matched". So:
- The bulk price is **computed from the validated request body** (`unit × N`). The 402 challenge for a request with a body quotes that exact amount. An unauthenticated probe with an empty/invalid body is quoted the **max batch (N = 10)**.
- `verifyX402Payment` must rebuild the challenge from **the same validated body** so the `paymentRequirements.amount` it sends to `/verify` equals what the agent signed. If the agent signed a different amount, `/verify` rejects it. That's correct behavior.
- Settle only if ≥ 1 record is billable. Zero billable records → `$0.00` (Free-on-Miss).
- Disclose this plainly in every description: *"Priced per record submitted; settled only if at least one record returns a deliverable email; $0.00 if none."* The bulk discount ($0.025 vs $0.03) offsets partial misses.
- **Optional upgrade (Phase 8):** if the facilitator advertises the `upto` scheme in `GET {facilitator}/supported`, switch bulk to `upto` and settle `unit × billable_count`. Do not implement `upto` before confirming support.

---

## 2. Phase 0 — Verify Apollo Upstreams (≈ 30 min, needs human approval for live calls)

**Why:** this plan's Apollo endpoint paths and shapes come from memory of Apollo's docs. Confirm them before building schemas on top.

1. Create `scripts/probe-apollo-endpoints.ts` (modeled on `scripts/test-apollo-direct.ts`). It should load `APOLLO_API_KEY` from `.env.local` the same way existing scripts do, without printing the key.
2. Make **one minimal call** to each upstream, using tiny pages (`per_page: 2`) and a well-known domain (`apollo.io`):
   - `POST https://api.apollo.io/api/v1/mixed_people/api_search` with `{ q_organization_domains_list: ["apollo.io"], person_titles: ["ceo"], per_page: 2 }`
     If 404/403, try `POST /api/v1/mixed_people/search` and note which one works. `api_search` is expected to cost **no credits** and to return **no emails** (it may obfuscate last names). Record exactly which fields come back.
   - `POST /api/v1/mixed_companies/search` with `{ q_organization_domains_list: ["apollo.io"], per_page: 2 }`
   - `GET /api/v1/organizations/enrich?domain=apollo.io`
   - `POST /api/v1/organizations/bulk_enrich` with `{ domains: ["apollo.io","stripe.com"] }`
   - `POST /api/v1/people/bulk_match` with `{ details: [{first_name:"Tim",last_name:"Zheng",domain:"apollo.io"}], reveal_personal_emails: false, reveal_phone_number: false }`
   - (stretch) `GET /api/v1/organizations/{org_id_from_above}/job_postings`
3. For each call, log: HTTP status, top-level keys, the first result's keys, any `credits_consumed` / rate-limit headers (`x-rate-limit-*`, `x-minute-usage`, etc.).
4. Write findings to `docs/apollo-endpoint-notes.md`: working path, auth (`x-api-key` header), request shape, response shape, credit cost, max page size, max batch size.

**Run:** ask the human first: *"Phase 0 will spend roughly 3–5 Apollo credits. OK to run?"* Then:
`/opt/homebrew/bin/node --experimental-strip-types scripts/probe-apollo-endpoints.ts`

**Acceptance:** `docs/apollo-endpoint-notes.md` exists and every row of the §1 table is either confirmed or corrected. Commit: `chore(apollo): probe and document full-funnel upstream endpoints`.

> If the human declines live calls, continue with the shapes in this plan, build everything in mock mode, and leave a `TODO(verify-live)` marker in each connector.

---

## 3. Phase 1 — Per-Resource Pricing in the x402 Gate (core refactor)

**File:** `src/lib/x402-gate.ts`

**Problem:** `buildX402Challenge(resourceUrl, description)` always uses `getGateConfig().atomicUnits` and always embeds the person-enrich Bazaar example/schema. `verifyX402Payment` rebuilds that same challenge to form `paymentRequirements`. New products need their own price and Bazaar metadata.

### 1a. Add a resource spec type and a USD→atomic helper
```ts
export interface PaidResourceSpec {
  /** USD price as a decimal string, e.g. "0.02". */
  priceUsd: string;
  /** Per-resource `extensions.bazaar` block. Omit to keep the legacy person-enrich block. */
  bazaar?: Record<string, unknown>;
  /** Overrides the challenge `error` text (billing-policy wording). */
  challengeMessage?: string;
}

export function usdToAtomicUnits(priceUsd: string): string {
  // String-based to avoid float drift; USDC has 6 decimals.
  const [whole, frac = ""] = priceUsd.trim().split(".");
  return (BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6))).toString();
}
```

### 1b. Make the challenge builder spec-aware (backwards compatible)
- Signature: `buildX402Challenge(resourceUrl: string, description: string, spec?: PaidResourceSpec)`.
- When `spec` is **undefined**, the output must be **byte-identical** to today's.
- When `spec` is provided: `accepts[0].amount = usdToAtomicUnits(spec.priceUsd)`, `extensions.bazaar = spec.bazaar ?? <legacy block>`, `error = spec.challengeMessage ?? <legacy text>`.
- Move the existing inline person Bazaar block into a named const `PERSON_ENRICH_BAZAAR_EXTENSION` so it can be reused.

### 1c. Thread the spec through verification
- `verifyX402Payment(header, resourceUrl, description, options?: { verifyOnly?: boolean; spec?: PaidResourceSpec })`
- Inside, call `buildX402Challenge(resourceUrl, description, options?.spec)`.
- For the v1 `paymentRequirements` branch, use `maxAmountRequired: options?.spec ? usdToAtomicUnits(options.spec.priceUsd) : cfg.atomicUnits`.
- Leave Path A (`verifyDirectOnChainTxHash`) alone. It's disabled in production.

### 1d. Add a pricing table
**New file:** `src/verticals/option-a-apollo/pricing.ts`
```ts
export type ApolloProductId =
  | "search_people" | "search_organizations" | "enrich_person"
  | "enrich_organization" | "bulk_enrich_people" | "bulk_enrich_organizations"
  | "get_organization_job_postings" | "prospect";

const DEFAULTS: Record<ApolloProductId, { envVar: string; unitUsd: string }> = {
  search_people:                 { envVar: "X402_PRICE_SEARCH_PEOPLE_USD",        unitUsd: "0.01" },
  search_organizations:          { envVar: "X402_PRICE_SEARCH_ORGS_USD",          unitUsd: "0.02" },
  enrich_person:                 { envVar: "X402_ENRICH_PRICE_USD",               unitUsd: "0.03" },
  enrich_organization:           { envVar: "X402_PRICE_ENRICH_ORG_USD",           unitUsd: "0.02" },
  bulk_enrich_people:            { envVar: "X402_PRICE_BULK_PERSON_UNIT_USD",     unitUsd: "0.025" },
  bulk_enrich_organizations:     { envVar: "X402_PRICE_BULK_ORG_UNIT_USD",        unitUsd: "0.015" },
  get_organization_job_postings: { envVar: "X402_PRICE_JOB_POSTINGS_USD",         unitUsd: "0.01" },
  prospect:                      { envVar: "X402_PRICE_PROSPECT_UNIT_USD",        unitUsd: "0.03" },
};

export function unitPriceUsd(id: ApolloProductId): string { /* env override or default */ }
/** Multiplies a unit price by a count without floats; returns a decimal USD string with up to 6 dp. */
export function totalPriceUsd(id: ApolloProductId, count: number): string { /* via usdToAtomicUnits */ }
```

### Regression check (mandatory)
Create `scripts/check-challenge-regression.ts`. It imports `buildX402Challenge` and asserts that
`JSON.stringify(buildX402Challenge(url, desc))` equals the output from **before** the refactor. Capture a snapshot with `git stash` or by checking out `HEAD~` into a temp file before you edit anything. Also assert `usdToAtomicUnits("0.03") === "30000"`, `("0.025") === "25000"`, `("0.15") === "150000"`.

**Acceptance:** tsc passes, regression script prints `OK`, person route untouched. Commit: `refactor(x402): per-resource pricing and bazaar specs in challenge + verify`.

---

## 4. Phase 2 — Shared Paid-Route Helper + Product Catalog

### 2a. Paid route helper
**New file:** `src/lib/paid-route.ts`. It encodes Invariant #1 once, so new routes can't get the order wrong.

```ts
export interface PaidRouteOptions<TInput, TOutput> {
  req: NextRequest;
  resourcePath: string;                      // e.g. "/api/v1/enrich/organization"
  description: string;                       // human/Bazaar description incl. price + billing rule
  vertical: string;                          // "option-a-apollo"
  tool: string;                              // audit-log tool name, e.g. "enrich_organization"
  validate: (raw: Record<string, unknown>) => { valid: boolean; data?: TInput; error?: string };
  expectedSchema: unknown;                   // returned in 422 body
  /** Price spec. Receives the validated input when available, or null for unauth/invalid probes. */
  spec: (input: TInput | null) => PaidResourceSpec;
  execute: (input: TInput) => Promise<TOutput>;
  isBillable: (output: TOutput) => boolean;
  /** Fields merged into the receipt, e.g. { billable_count, submitted_count }. */
  receiptExtras?: (output: TOutput) => Record<string, unknown>;
}
export async function handlePaidPost<TInput, TOutput>(o: PaidRouteOptions<TInput, TOutput>): Promise<NextResponse>
```
Behavior, in order (mirror `src/app/api/v1/enrich/person/route.ts` exactly):
1. Parse the body tolerantly (same try/catch as the person route) and merge query params as a fallback.
2. Read `payment-signature` / `x-payment` header.
3. **No header:** try `validate(body)`. If valid, use `spec(data)`, else `spec(null)`. Return `402` with the JSON challenge + `PAYMENT-REQUIRED` + `X-Payment-Protocol: x402`. Never return 422 here.
4. **Header present:** `validate(body)`. Invalid → `422 { error, expected_schema }`.
5. `const spec = o.spec(data)`, then `verifyX402Payment(header, url, description, { verifyOnly: true, spec })`. Failure → `402` with challenge + `error`.
6. `execute(data)` inside try/catch. Upstream throw → `502` (nothing settled).
7. `isBillable(output)` false → `200` with `payment_settled: false`, a `miss_*` receipt, `amount_usd: "0.00"`, header `X-Payment-Settled: false`.
8. Billable → `settleVerifiedX402Payment(ctx)` (or the dev-bypass simulated hash, as in the person route). Settle failure → `402`.
9. `recordAuditLog({ vertical, tool, payer, amount_usd: spec.priceUsd, network, tx_hash, verification_mode, matched: true, latency_ms })`.
10. `200` with `payment_settled: true`, receipt, `X-PAYMENT-RESPONSE` (base64 JSON, same shape as the person route), `X-Payment-Settled: true`.

Also export `handlePaidGet(req, resourcePath, description, spec, schema)`. It returns the free schema/pricing preview and a `x402_challenge_preview` (mirror the person route's `GET`).

> Do **not** migrate the existing person route to this helper in this project. Leave it as-is.

### 2b. Catalog: single source of truth for discovery
**New file:** `src/verticals/option-a-apollo/catalog.ts`

One entry per product (§1 table). Every discovery surface (OpenAPI, `/.well-known/x402`, agent card, MCP server card, `llms.txt`, MCP `tools/list`, `/api/v1/catalog`) **must iterate this array** instead of hand-writing entries.
```ts
export interface ApolloProduct {
  id: ApolloProductId;
  path: string;                 // REST path
  method: "POST";
  mcpTool: string;
  title: string;                // canonical high-intent B2B title (AGENTS.md invariant #4)
  summary: string;              // one line incl. price + billing rule
  description: string;          // long, keyword-rich, mentions funnel position
  tags: string[];
  funnelStage: "search" | "enrich" | "bulk_enrich" | "signals" | "composite";
  pricing: { unitUsd: () => string; per: "call" | "page" | "record" | "lead"; maxUnits: number; billingRule: string };
  inputSchema: object;          // JSON Schema
  outputSchema: object;
  exampleInput: object;
  exampleOutput: object;        // compact; used in bazaar.info.output.example
  bazaar: () => Record<string, unknown>; // built from the fields above, kept compact
}
export const APOLLO_PRODUCTS: ApolloProduct[] = [ /* include enrich_person, built from PERSON_ENRICH_JSON_SCHEMA */ ];
```
**Header size guard:** `PAYMENT-REQUIRED` is a base64 header. Keep each product's bazaar block small enough that the encoded challenge stays **< 7 KB**. Add an assertion for every product in `scripts/check-challenge-regression.ts`.

### 2c. Shared Apollo HTTP client
**New file:** `src/verticals/option-a-apollo/apollo-client.ts`
- `apolloRequest<T>(method, path, { query?, body? }): Promise<T>` with base `https://api.apollo.io`, headers `x-api-key`, `Content-Type: application/json`, `Cache-Control: no-cache`, an 8 s `AbortController` timeout, and error text truncated to 300 chars (never echo the key).
- `isApolloMockMode()`: same rule as in `connector.ts` (`APOLLO_MOCK_MODE === "true"`, missing key, or the placeholder key).
- **Don't** rewrite `connector.ts` to use it (keeps the person path untouched). New connectors use it.

**Acceptance:** tsc passes. Commit: `feat(gateway): shared paid-route handler, product catalog, apollo client`.

---

## 5. Phase 3 — Search Products (top of funnel)

### Files
- `src/verticals/option-a-apollo/search-schema.ts`: input/output TS types, JSON Schemas, `validatePeopleSearchInput`, `validateOrgSearchInput`.
- `src/verticals/option-a-apollo/search-connector.ts`: `searchPeopleWithApollo`, `searchOrganizationsWithApollo`, plus mock builders.
- `src/app/api/v1/search/people/route.ts` and `src/app/api/v1/search/organizations/route.ts`: thin `GET`/`POST` wrappers around `handlePaidGet` / `handlePaidPost`.

### People Search input (agent-friendly names → Apollo params)
| Agent field | Apollo param | Notes |
|---|---|---|
| `person_titles: string[]` | `person_titles[]` | also accept `titles`, `title` (string → array) |
| `person_seniorities: string[]` | `person_seniorities[]` | enum: `owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern` |
| `person_locations: string[]` | `person_locations[]` | |
| `organization_domains: string[]` | `q_organization_domains_list[]` | accept `domains`, `company_domains`, `domain`; clean with `cleanDomainCandidate` |
| `organization_ids: string[]` | `organization_ids[]` | output of org search |
| `organization_locations: string[]` | `organization_locations[]` | |
| `employee_ranges: string[]` | `organization_num_employees_ranges[]` | format `"1,10"`, `"51,200"` |
| `keywords: string` | `q_keywords` | |
| `page` (default 1, max 5) | `page` | |
| `per_page` (default 10, max 25) | `per_page` | hard cap: no more than 25 regardless of input |

Validation: require **at least one** filter (titles, domains, ids, keywords, or locations). Reject unknown seniority values with a helpful 422. Unwrap the same LLM wrapper keys as `validatePersonEnrichInput` (`input`, `params`, `arguments`, …).

### Organization Search input
`keywords` → `q_organization_keyword_tags[]`, `organization_name` → `q_organization_name`, `organization_locations[]`, `employee_ranges[]` → `organization_num_employees_ranges[]`, `revenue_min/max` → `revenue_range[min|max]`, `technologies[]` → `currently_using_any_of_technology_uids[]` (only if Phase 0 confirms), `domains[]` → `q_organization_domains_list[]`, `page` (max 5), `per_page` (default 10, max 25). Require at least one filter.

### Output (deterministic, nullable fields)
```jsonc
// search_people
{ "matched": true, "source": "apollo_live", "timestamp": "...", "latency_ms": 312,
  "pagination": { "page": 1, "per_page": 10, "total_entries": 1342, "total_pages": 135 },
  "people": [{
    "apollo_id": "…", "first_name": "…", "last_name": "…|null", "full_name": "…|null",
    "title": "…", "seniority": "…|null", "linkedin_url": "…|null",
    "has_email": true, "location": { "city": null, "state": null, "country": null },
    "organization": { "id": "…", "name": "…", "primary_domain": "…|null" },
    "next_step": { "tool": "enrich_person", "rest": "POST /api/v1/enrich/person", "args": { "id": "…" } }
  }] }
```
Org search uses the same pattern: an `organizations[]` array with `id, name, primary_domain, website_url, industry, estimated_num_employees, linkedin_url, founded_year, city, country` and `next_step` → `enrich_organization {domain}` + `search_people {organization_ids:[id]}`.

`matched` = results length > 0. `isBillable` = `matched`. Spec price = `unitPriceUsd(id)` (per page, fixed).

### Mock mode
Return 3 deterministic fake records derived from the input (as `buildMockEnrichment` does) with `source: "apollo_mock"`.

**Acceptance (local, mock mode):** see §10 smoke tests S1–S4 for these routes. Commit: `feat(search): x402 people and organization search endpoints`.

---

## 6. Phase 4 — Organization Enrich (single)

### Files
- `src/verticals/option-a-apollo/org-schema.ts`: `OrgEnrichInput { domain }`, `OrgEnrichOutput`, `validateOrgEnrichInput`, JSON schema, and a shared `normalizeApolloOrganization(raw)` mapper (reused by bulk).
- `src/verticals/option-a-apollo/org-connector.ts`: `enrichOrganizationWithApollo`, `bulkEnrichOrganizationsWithApollo` (Phase 5), mocks.
- `src/app/api/v1/enrich/organization/route.ts`

### Input
`domain` (required, accept `website`, `url`, `company_domain`; clean via `cleanDomainCandidate`). If only `organization_name`/`company` is given, resolve the domain with `KNOWN_COMPANY_BRAND_MAP` first, then fall back to the Clearbit autocomplete approach used in `connector.ts`. Extract `resolveCompanyDomainFuzzy` into a small exported helper (copy, don't move, so `connector.ts` stays untouched). Reject free-mail domains (`gmail.com`, etc.) using the existing `FREE_EMAIL_PROVIDERS` set (export it from `schema.ts`; exporting is a non-behavioral change).

### Output (`organization` object)
`apollo_id, name, primary_domain, website_url, linkedin_url, twitter_url, facebook_url, logo_url, industry, industries[], keywords[] (max 20), estimated_num_employees, founded_year, annual_revenue, annual_revenue_printed, total_funding, total_funding_printed, latest_funding_stage, latest_funding_round_date, publicly_traded_symbol, publicly_traded_exchange, phone (company HQ line, which is free; not a personal phone), street_address, city, state, country, postal_code, short_description (≤ 500 chars), technologies[] (names only, max 25), departmental_head_count {}`, then `next_step` → `search_people { organization_ids:[apollo_id] }`.

All fields nullable/array-defaulted. `matched` = organization with id returned. `isBillable` = `matched`.

**Acceptance:** S1–S4 pass for this route. Commit: `feat(enrich): x402 organization enrichment endpoint`.

---

## 7. Phase 5 — Bulk Enrichment

### Bulk People: `src/app/api/v1/enrich/people/bulk/route.ts`
- **Input:** `{ details: PersonEnrichInput[] (1..10), reveal_personal_emails?: boolean }`. Accept aliases `people`, `records`, `persons`. Validate **each** record with the existing `validatePersonEnrichInput`. If any record is invalid, return 422 listing `{ index, error }` for each bad record (the agent isn't charged and fixes its batch). Dedupe identical records before counting.
- **Price:** `totalPriceUsd("bulk_enrich_people", details.length)`. With no body / invalid body → quote `maxUnits = 10`.
- **Upstream:** `POST /api/v1/people/bulk_match` with `{ details, reveal_personal_emails, reveal_phone_number: false }`. Resolve fuzzy `organization_name` → domain per record (brand map only, not Clearbit, to stay inside the latency budget).
- **Output:** `{ submitted_count, matched_count, billable_count, results: [{ index, input_echo, matched, person|null }] }`. `results` stays **index-aligned** with the input. `person` uses the same shape as `PersonEnrichOutput.person`. **Extract the person-normalization block from `connector.ts` into an exported `normalizeApolloPerson(p)` in a new file and use it here.** Leave `connector.ts` itself unchanged (duplicating the mapping is acceptable if extracting would touch the person path).
- **Billable:** `billable_count ≥ 1`, where billable = matched AND email non-empty AND `email_status !== "unavailable"` (same rule as the person route).
- **Receipt extras:** `submitted_count, billable_count, pricing_note`.

### Bulk Organizations: `src/app/api/v1/enrich/organizations/bulk/route.ts`
- **Input:** `{ domains: string[] (1..10) }`; aliases `websites`, `companies` (if objects, take `.domain`). Clean, dedupe, drop free-mail domains (report them in a `skipped[]` array, which doesn't count toward the price).
- **Price:** `totalPriceUsd("bulk_enrich_organizations", cleanedDomains.length)`; probe quote = 10.
- **Upstream:** `POST /api/v1/organizations/bulk_enrich` `{ domains }`.
- **Output:** `{ submitted_count, matched_count, results: [{ domain, matched, organization|null }], skipped: [] }`, using `normalizeApolloOrganization`.
- **Billable:** `matched_count ≥ 1`.

**Critical:** the `spec(input)` function must be **deterministic** for a given validated body. The 402 challenge an agent receives with body B and the `paymentRequirements` built at verify time with body B must be byte-identical. Add an assertion for this in the smoke tests (S5).

**Acceptance:** S1–S5 pass for both routes. Commit: `feat(enrich): x402 bulk person and organization enrichment (≤10 per call)`.

---

## 8. Phase 6 — MCP Server, Catalog Endpoint, and All Discovery Surfaces

### 6a. MCP (`src/app/api/mcp/route.ts`)
- Add a `src/lib/paid-mcp.ts` helper equivalent to `handlePaidPost`, but returning JSON-RPC envelopes. Mirror how `enrich_person` currently returns its 402 challenge and results; read lines ~150–300 of the MCP route and copy that envelope format exactly. Payment proof sources are the same: headers, then `arguments._x402_payment`, then `params._meta.payment`.
- Build the new tool definitions **from `APOLLO_PRODUCTS`** (add `_x402_payment` to each `inputSchema`, as `enrich_person` does). Keep the existing `get_enrichment_quote` and `enrich_person` entries and their handler code exactly as they are, and append the new tools.
- Extend `get_enrichment_quote`: accept an optional `tool` argument. With no argument it returns the existing payload **plus** a `catalog` array (every product's price, billing rule, funnel stage, schemas). This keeps backward compatibility and adds the full menu.
- Add a `server instructions` / description string (in `initialize` result, if the current code has one) describing the funnel: *"search_organizations → search_people → enrich_person / bulk_enrich_people; enrich_organization for firmographics."*
- Bump `serverInfo.version` to `0.4.0` everywhere it appears (`grep -rn "0.3.0" src smithery.yaml server.json glama.json`).

### 6b. Free catalog endpoint
`src/app/api/v1/catalog/route.ts` (`GET`, free, `Cache-Control: public, max-age=60`, CORS `*`) returns `{ origin, network, asset, payTo, products: APOLLO_PRODUCTS.map(...) , workflow: [...] }`, where `workflow` documents the recommended Search → Enrich chain with example bodies.

### 6c. Discovery surfaces (iterate `APOLLO_PRODUCTS`; don't hand-write entries)
| File | Change |
|---|---|
| `src/app/openapi.json/route.ts` | One `paths` entry per product: `operationId` (camelCase of id), `summary`, `description`, `tags`, `x-payment-info` (`price.mode: "fixed"`, `amount` = unit price to 6 dp for fixed products; for bulk use `mode: "dynamic"` **only if** the x402scan spec allows it, otherwise `fixed` with the per-record price and an `x-pricing-note`), `requestBody` schema, `200`/`402`/`422` responses. Keep the existing person path entry's content identical. Update `info.title` to `"Apollo.io B2B Data API — People & Company Search, Person & Organization Enrichment, Bulk Enrichment (x402)"`, append the funnel to `info.x-guidance`, and bump `info.version` to `1.2.0`. Check the current x402scan discovery spec at https://www.x402scan.com/discovery/spec before using any field name you aren't sure of. |
| `src/app/.well-known/x402/route.ts` | Add every product URL to `resources` and an `endpoints[]` entry per product (same fields as the existing one; `challenge` built with that product's spec). Keep `version: 1`. |
| `src/app/.well-known/agent.json/route.ts` | Add one A2A skill per product (`id`, `name`, `description`, `tags`, `examples`, `inputModes/outputModes` matching existing skill). |
| `src/app/.well-known/mcp/server-card.json/route.ts` | Generate `tools` from the same list the MCP route uses; update `payment` to show a price range (`priceUsdMin`/`priceUsdMax`) while keeping `priceUsd` = person price for compatibility. |
| `src/app/llms.txt/route.ts` | Add a "Full Funnel Workflow" section with a curl example per product and a worked 3-step chain (org search → people search → bulk enrich). |
| `src/app/page.tsx` | Add a product table (read from `APOLLO_PRODUCTS`). Keep styling consistent with what's there. |
| `smithery.yaml`, `server.json`, `glama.json` | Update descriptions/tool lists/version if they enumerate tools. |

### 6d. Docs
- `AGENTS.md` §2 Layer 4 table: add the new routes. Add `pricing.ts`, `catalog.ts`, `paid-route.ts` to the codebase map. Update §5 playbook step 2 to say "use `handlePaidPost` + add a catalog entry".
- `ROADMAP.md`: mark Option A Phase 1b "Full Funnel" as shipped (prices in that file are stale at $0.10; correct them to the catalog values).
- `.env.example`: add all `X402_PRICE_*` vars with defaults, and fix the stale `X402_ENRICH_PRICE_USD=0.10` → `0.03`.

**Acceptance:** S6–S8 pass. Commit: `feat(discovery): expose full-funnel catalog across MCP, OpenAPI, x402, A2A, llms.txt`.

---

## 9. Phase 7 — Verify, Then Hand Off for Deploy

1. `/opt/homebrew/bin/node ./node_modules/typescript/bin/tsc --noEmit` passes.
2. `npx next build` passes locally (catches route-level errors tsc misses).
3. Run the full smoke suite (§10) against `next dev` in mock mode. All green.
4. Run `scripts/check-challenge-regression.ts`. The person challenge is unchanged.
5. `git log --oneline` shows one commit per phase. `git status` is clean. `.env.local` is not tracked (`git ls-files | grep env.local` prints nothing).
6. **STOP. Report to the human:** list of commits, smoke results, the env vars to add to Vercel (if they want non-default prices), and ask:
   - *"Ready to `git push origin main` (deploys to enrichmatch.dev)?"*
   - *"Run a live paid test? Estimated cost: ~$0.10 USDC (settles to your own Ledger) + ~5 Apollo credits."*
7. **Only after approval:** push. Then verify production:
   ```bash
   for p in search/people search/organizations enrich/organization enrich/people/bulk enrich/organizations/bulk enrich/person; do
     printf "%s " $p; curl -s -o /dev/null -w "%{http_code}\n" -X POST https://enrichmatch.dev/api/v1/$p -H 'content-type: application/json' -d '{}'
   done   # every line must print 402
   curl -s https://enrichmatch.dev/openapi.json | jq '.paths | keys'
   curl -s https://enrichmatch.dev/.well-known/x402 | jq '.resources'
   curl -s -X POST https://enrichmatch.dev/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '[.result.tools[].name]'
   ```
8. **Only after approval:** live paid test. Extend `scripts/live-onchain-buyer.ts` with `--endpoint <path>` and `--body '<json>'` flags. It must read the amount from the live 402 challenge (it may already; check), never from a hard-coded constant. Run a single call against `/api/v1/enrich/organization` with `{"domain":"stripe.com"}` and record the BaseScan tx hash.
9. Re-trigger discovery indexing: the human may want to re-submit `https://enrichmatch.dev` on x402scan. Running `scripts/register-x402bazaar.ts` re-registers on x402bazaar.org (it may need a per-resource loop; inspect it first and ask before running). CDP Bazaar auto-indexes on the first settled payment per resource.

---

## 10. Smoke Test Suite — `scripts/smoke-full-funnel.ts`

Runs against `--base http://localhost:3000` (default). Start the server with:
```bash
APOLLO_MOCK_MODE=true /opt/homebrew/bin/node ./node_modules/next/dist/bin/next dev
```
Dev bypass payment token (non-production only): header `X-PAYMENT: dev_test_payment_proof_2026` (see `getGateConfig().devBypassToken`).

For **every paid product** (including the existing `enrich/person`, as a regression check):
| ID | Test | Expect |
|---|---|---|
| S1 | `POST` with **no body, no payment** | `402`; `PAYMENT-REQUIRED` header decodes to JSON with `x402Version: 2` and `accepts[0].amount` = expected atomic units (bulk: 10 × unit) |
| S2 | `POST` with **garbage body** (`{"foo":1}`), no payment | `402`, not `422` |
| S3 | `POST` with invalid body **and** dev payment | `422` with `expected_schema` |
| S4 | `POST` with valid example body (from catalog `exampleInput`) and dev payment | `200`, `payment_settled: true`, receipt present, and output validates loosely against `outputSchema` (required keys present) |
| S5 | (bulk only) valid body with 3 records, no payment | `402` with amount = 3 × unit; then the same body with dev payment → `200` |
| S6 | `GET` on each route | `200` with `schema` and `x402_challenge_preview` |
| S7 | MCP `tools/list` | contains all product tool names + `get_enrichment_quote` |
| S8 | `/openapi.json`, `/.well-known/x402`, `/.well-known/agent.json`, `/llms.txt`, `/api/v1/catalog`, `/.well-known/mcp/server-card.json` | each mentions every product path or tool |
| S9 | Header size | every decoded `PAYMENT-REQUIRED` header is < 7 KB base64 |
| S10 | Free-on-Miss (mock) | Add a mock trigger, e.g. domain `nomatch.invalid` → mock returns `matched:false`. With dev payment → `200`, `payment_settled: false`, `amount_usd: "0.00"` |

Exit code is non-zero on any failure. Print a pass/fail table.

---

## 11. Phase 8 (Optional, later) — Upgrades

- **`upto` scheme for bulk/prospect:** `curl {facilitator}/supported`. If `scheme: "upto"` on `eip155:8453` is listed for the CDP facilitator, add `accepts[1]` with `upto` for bulk routes and settle `unit × billable_count`. Keep `exact` as `accepts[0]` for client compatibility.
- **Prospect composite (`/api/v1/prospect`):** `{ ...people_search_filters, limit ≤ 10 }` → api_search (per_page = limit) → bulk_match on the returned ids → return only leads with deliverable emails. Price `0.03 × limit`. This is the "one call, finished lead list" product that most directly competes with aggregators.
- **Job postings + news signals** (`get_organization_job_postings`, Apollo `news_articles/search`) as cheap "signals" tools.
- **Response caching:** cache org enrich by domain for 7 days (Vercel Runtime Cache) to cut Apollo credit spend on repeat lookups, keeping the same price (margin).
- **Persistent audit log:** `/tmp` is per-instance. Move audit logs and telemetry to a Marketplace KV/Postgres store so `recentSettlementProofs` in the agent card covers all products.

---

## 12. Definition of Done

- [ ] Five new paid REST endpoints live (people search, org search, org enrich, bulk people, bulk orgs), each passing S1–S6 and S10.
- [ ] Every new endpoint is also an MCP tool, and every one appears in OpenAPI, `/.well-known/x402`, the A2A agent card, the MCP server card, `llms.txt`, and `/api/v1/catalog`, all generated from `APOLLO_PRODUCTS`.
- [ ] Every search result carries a `next_step` with the exact args for the next tool.
- [ ] Existing `enrich_person` (REST + MCP) is byte-identical in its 402 challenge and unchanged in behavior.
- [ ] No route calls Apollo before payment verification. No route can reveal phone numbers. All page sizes and batch sizes are hard-capped.
- [ ] tsc + `next build` pass. One commit per phase. Nothing pushed without human approval.
- [ ] `AGENTS.md`, `ROADMAP.md`, and `.env.example` updated.
