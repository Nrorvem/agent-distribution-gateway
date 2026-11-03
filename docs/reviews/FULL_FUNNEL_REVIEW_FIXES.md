# Full-Funnel Build: Review Findings & Required Corrections

**Reviewed:** 2026-11-02, commits `4ecc667..57c7792` (7 local commits on `main`, **not pushed**)
**Reviewer verdict:** ❌ **NOT READY TO DEPLOY.** Three blockers must be fixed first (§2). After that, finish the should-fix items (§3) and follow the deploy runbook (§5).
**Executor:** any coding agent. Read `AGENTS.md` and `FULL_FUNNEL_EXECUTION_PLAN.md` first. The Rules of Engagement in the plan (§0) still apply: commit locally, **do not push**, and don't spend USDC or Apollo credits without the human's approval.

---

## 1. What passed

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ pass |
| `next build` | ✅ pass (all 6 paid routes + discovery routes compile) |
| `scripts/check-challenge-regression.ts` | ✅ pass. Person challenge is byte-identical, and every header is under 7 KB (person is 7096 B, close to the 7168 B limit) |
| `scripts/smoke-full-funnel.ts` (mock mode) | ✅ 45/45 pass (S1–S10) |
| `src/app/api/v1/enrich/person/route.ts` | ✅ unchanged (empty diff) |
| Invariant #1 (402 before validation, 422 before verify) | ✅ enforced in `src/lib/paid-route.ts` and `src/lib/paid-mcp.ts` |
| `reveal_phone_number` | ✅ always `false`; no path enables it |
| Dev bypass token | ✅ disabled when `NODE_ENV=production` (also true on Vercel previews) |
| Discovery surfaces | ✅ OpenAPI 1.2.0, `/.well-known/x402`, agent card, MCP server card, `llms.txt`, `/api/v1/catalog` all list every product; MCP `serverInfo.version` is `0.4.0` |

The structure is good: shared paid-route handler, catalog-driven discovery, and deterministic per-body bulk pricing. The problems are in **runtime behavior against live Apollo**, which mock-mode smoke tests can't catch.

---

## 2. BLOCKERS (must fix before any push)

### B1. The connectors return fabricated mock data in production, and buyers pay real USDC for it

When a live Apollo call fails, several connectors silently return mock data. That mock data has `matched: true`, so `isBillable` is true and the buyer's payment **settles on-chain for fake records**.

| File | Location | Trigger in production |
|---|---|---|
| `src/verticals/option-a-apollo/search-connector.ts` | `searchPeopleWithApollo` `catch` → `buildMockPeopleSearch(input)` | Any Apollo error, timeout, or 429 |
| `src/verticals/option-a-apollo/search-connector.ts` | `searchOrganizationsWithApollo` `catch` → `buildMockOrgSearch(input)` | **Every call.** `docs/apollo-endpoint-notes.md` records that `mixed_companies/search` returns **403 API_INACCESSIBLE** on the current key. Every paid org search would sell 3 invented companies (`Acme Solutions 2`, …) for $0.02. |
| `src/verticals/option-a-apollo/org-connector.ts` | `enrichOrganizationWithApollo` `catch` (non-404) → `buildMockOrgEnrich(...)` | Timeout, 429, 5xx, 403. Returns fake revenue, funding, phone `(415) 555-0199`, and so on. |
| `src/verticals/option-a-apollo/org-connector.ts` | `bulkEnrichOrganizationsWithApollo` fallback | `bulk_enrich` is 403 on this key, so every call takes the per-domain fallback. Any per-domain error then yields mock data **labeled `source: "apollo_live"`**. |

**Required fix:**
1. Outside mock mode, a connector must **never** return mock data. In every `catch` that isn't a clean "not found", **re-throw**. `handlePaidPost` / `handlePaidMcpCall` already convert a throw into `502` / `isError` **with no settlement**, which is the correct outcome.
   ```ts
   } catch (err: any) {
     if (/HTTP 404/.test(err?.message ?? "")) return cleanMiss(); // only a genuine "not found" is a miss
     throw err;                                                   // → 502, nothing settled
   }
   ```
2. Mock builders may only be reachable via `if (isApolloMockMode()) return buildMock…(...)` at the top of each function.
3. Add a guard in `paid-route.ts` and `paid-mcp.ts`, right before settlement: if `output.source === "apollo_mock"` and `process.env.VERCEL_ENV === "production"`, **refuse to settle** and return `502`. This is defense in depth: mock data must never be sold in production.
4. Add a smoke test (S11) that sets `APOLLO_API_KEY=invalid_key_for_test` without `APOLLO_MOCK_MODE`, sends the dev payment, and asserts `502` and `X-Payment-Settled` absent for search/org/bulk routes. (Apollo returns 401/403 for a bad key, which is safe and costs no credits.) Run it locally only.

### B2. Organization Search has no working upstream on the current Apollo key

`POST /api/v1/mixed_companies/search` returns 403 for this key (see `docs/apollo-endpoint-notes.md` §2). Once B1 is fixed, every paid org search would return 502.

**Decision (human, 2026-11-02): expand the Apollo API key scope.** The human does this in the Apollo dashboard. The agent's work starts after the new key is in place.

#### B2.1 Required Apollo API key scopes (human action)
In Apollo, go to **Settings → Integrations → API → API Keys**. Edit the existing key, or create a new one named `enrichmatch-gateway-prod`, and select **exactly** these endpoints:

| # | Apollo endpoint | Used by | Status on current key | Needed |
|---|---|---|---|---|
| 1 | `POST /api/v1/people/match` (People Enrichment) | `enrich_person` (live earner), bulk-person fallback | ✅ works | **Required** |
| 2 | `POST /api/v1/mixed_people/api_search` (People API Search) | `search_people` | ✅ works | **Required** |
| 3 | `GET /api/v1/organizations/enrich` (Organization Enrichment) | `enrich_organization`, bulk-org fallback | ✅ works | **Required** |
| 4 | `POST /api/v1/mixed_companies/search` (Organization Search) | `search_organizations` | ❌ 403 | **Required — add** |
| 5 | `POST /api/v1/people/bulk_match` (Bulk People Enrichment) | `bulk_enrich_people` | ❌ 403 | **Required — add** (otherwise every bulk call runs 10 single calls against the rate limit) |
| 6 | `POST /api/v1/organizations/bulk_enrich` (Bulk Organization Enrichment) | `bulk_enrich_organizations` | ❌ 403 | **Required — add** |
| 7 | `POST /api/v1/usage_stats/api_usage_stats` (API Usage Stats) | Credit and rate-limit monitoring (new health check, below) | untested | **Recommended** |
| 8 | `GET /api/v1/organizations/{id}/job_postings` (Organization Job Postings) | Plan §11 stretch "signals" product | ❌ 403 | Optional (future) |
| 9 | `POST /api/v1/news_articles/search` (News Articles Search) | Plan §11 stretch "signals" product | untested | Optional (future) |

**Do not grant** write or CRM scopes (contacts, accounts, sequences, emailer campaigns, tasks, opportunities, deals, calls, notes, labels, custom fields). The gateway never writes to Apollo, so a leaked key should not be able to touch the CRM or send email.

**Master key:** only fall back to "Set as master key" if Apollo won't let you pick #2, #4, or #7 individually (some Apollo docs list them as master-key-only). If you do use a master key, keep it **only** in Vercel Production env and `.env.local`, and rotate it if it ever appears in a log.

**After the key is updated (human):**
1. If you created a new key, update `APOLLO_API_KEY` in `.env.local` and in Vercel Production (`npx vercel env rm APOLLO_API_KEY production` then `npx vercel env add APOLLO_API_KEY production`; type it at the prompt, don't put it in shell history). Editing the scopes of the existing key needs no env change.
2. Tell the agent the scopes are updated.

#### B2.2 Agent work after the scope change
1. **Re-probe (needs human approval; costs about 5–8 credits):** extend `scripts/probe-apollo-endpoints.ts` to cover #4–#7, then run it. For each endpoint, record in `docs/apollo-endpoint-notes.md`: status, response shape (first result's keys), **credits consumed** (compare `api_usage_stats` or the dashboard credit balance before and after), max `per_page`, and max batch size.
2. **Re-check the margin of every price against the measured credit cost.** In particular:
   - `mixed_companies/search` may consume credits per page. If one page costs more than about $0.01 of your Apollo credit value, raise `X402_PRICE_SEARCH_ORGS_USD` or lower the `per_page` cap.
   - `people/bulk_match` and `organizations/bulk_enrich` charge per matched record. Confirm $0.025 and $0.015 per record still clear credit cost on a 1-of-10 batch, which is the worst case for Free-on-Miss.
3. Update the connectors to the confirmed live response shapes. Remove the `TODO(verify-live)` markers. Bulk-person results should match by index if `bulk_match` returns an index-aligned `matches` array with `null` gaps; confirm this in the probe.
4. Keep the parallel single-call fallbacks for bulk, but only for HTTP 403/404 from the bulk endpoint (a scope regression). On 429/5xx, throw so the request returns 502 and nothing settles (see B1).
5. **New: Apollo health check.** Add `GET /api/v1/health` (free, not in the catalog). It calls `usage_stats/api_usage_stats` (#7), caches the result for 60 s, and returns only `{ apollo: "ok" | "degraded", minute_usage_pct }`. Never return the key, raw counts, or the credit balance. Use it in §5 deploy checks and for the human's uptime monitor.
6. Add a smoke test step (local, live key, human approval) that hits each Apollo upstream once and fails if any return 403. This catches future scope regressions before deploy.

### B3. A signed payment can be replayed across requests (Path B has no nonce lock)

`verifyX402Payment(..., { verifyOnly: true })` checks the EIP-3009 signature through the facilitator, but nothing records that the authorization was **used**. On a miss nothing settles, so the **same `X-PAYMENT` header stays valid until `validBefore`**. It can be replayed any number of times, and each replay calls Apollo and burns credits. On a hit, N concurrent replays all pass `/verify` and all call Apollo; only one settles, but N × credits are consumed.

This problem exists in the live person route today, but bulk makes it 10× worse (up to 10 Apollo calls per replay).

**Required fix** (in `src/lib/x402-gate.ts`, shared by all routes; the person route gets it too because it calls the same `verifyX402Payment`):
1. After a successful `/verify`, take the key `` `${authorization.from.toLowerCase()}:${authorization.nonce.toLowerCase()}` `` from the decoded payment payload.
2. Keep a module-level `Map<string, "in_flight" | "consumed">` on `globalThis`, following the existing `__x402InFlightTxHashes` pattern. If the key is already present, reject with `402 "Payment authorization already used"`. Otherwise mark it `in_flight`.
3. Mark it `consumed` after `/settle` succeeds **and** after a free-on-miss response. The buyer has to sign a fresh authorization for every request, which is the normal x402 client behavior anyway. Also mark it consumed after a 502, so a broken upstream can't be used as an oracle.
4. Expire entries after `validBefore`.
5. Add a note in `AGENTS.md` that this lock is per instance. A durable store (Upstash Redis / Marketplace KV) is the follow-up, already listed in plan §11.
6. Smoke test S12 (local, dev token can't exercise this). Unit-test the lock helper directly: the same key twice returns "already used".

> The person route behavior changes only for replays, which were never legitimate. Re-run `check-challenge-regression.ts` afterwards; the challenge bytes must stay identical.

---

## 3. SHOULD FIX (before or alongside deploy)

### S1. The OpenAPI bulk price disagrees with the 402 probe amount
`/openapi.json` declares bulk prices as `mode: "fixed", amount: "0.025000"` / `"0.015000"`. An unauthenticated probe gets a challenge for **10 × unit** (`250000` / `150000` atomic units). x402scan compares the declared price with the probed challenge, so it may list the wrong price or flag a mismatch.
**Fix:** check the current spec at https://www.x402scan.com/discovery/spec. If it supports a range or dynamic mode, declare `min = unit` and `max = 10 × unit`. If it only supports `fixed`, declare the **probe amount** (10 × unit) and keep the per-record explanation in `x-pricing-note` / `description`. Make the same change in the `/.well-known/x402` endpoint entries and in the MCP server card price range.

### S2. People-search output misrepresents obfuscated data
The live `api_search` returns `last_name_obfuscated` (e.g. `"Cu***l"`) and an `organization` object **without** `id` or `primary_domain`. Current mapping:
- puts `"Cu***l"` into `last_name` and `full_name`. Agents will then pass that string as a real surname.
- emits `organization.id: ""` and `name: ""` as empty strings.

**Fix** (in `searchPeopleWithApollo`): set `last_name: p.last_name ?? null`, add `last_name_obfuscated: p.last_name_obfuscated ?? null`, compute `full_name` only from real names, and use `null` instead of `""`. Add `last_name_obfuscated` to the people-search output JSON schema and note in the description that **search returns partial identities; use `next_step` (enrich by `id`) for full name and email.** Update the mock to match the live shape.

#### S2.1 Product decision: keep People Search as a paid, honestly labeled "discovery" step (recommended)
Apollo's `api_search` costs 0 credits, but it returns **masked last names, no email, and no LinkedIn URL**. Removing it would break the funnel, and making it free invites abuse. Decision:

- **Keep it paid at $0.01/page, Free-on-Miss.** What the buyer pays for is a **targeted list of Apollo person IDs** filtered by title, seniority, company, location, and headcount, plus `has_email` flags. Each ID feeds `enrich_person` / `bulk_enrich_people` directly. The name is not the product. Charging is also the abuse control: `api_search` shares Apollo's per-minute rate limit with the paid enrich calls that make the money, so a free search could be used to starve them.
- **Don't make it free.** Free search means anyone can burn the rate-limit budget at no cost, and x402 directories rank paid resources by settlements anyway.
- **Rename and re-describe it so nobody expects full contacts.** Title: `"Apollo.io B2B People Search — Find Decision-Maker IDs by Title, Seniority & Company (no emails; enrich to unlock)"`. Each result's `next_step` stays `enrich_person {id}`. Add a top-level `unlock` hint to the response: `{ "tool": "bulk_enrich_people", "args": { "details": [{ "id": … }, …] }, "estimated_price_usd": "<0.025 × n>" }`, prefilled with the IDs where `has_email: true`, so one paid follow-up call unlocks the whole page.
- **Billing rule change:** `isBillable` = at least one result with `has_email: true`. A page of people with no reachable email is a miss and costs $0.00. That's fairer and still Free-on-Miss.
- **Then build the plan §11 "Prospect" composite** (`/api/v1/prospect`, $0.03 × `limit`, ≤ 10). It runs search, then `bulk_match` on the `has_email` IDs, and returns **only fully unmasked leads with deliverable emails**, settled only if ≥ 1 lead comes back. Buyers who want finished leads in one call use this; buyers who want to browse cheaply use search. Do this after deploy, as a follow-up commit, once `people/bulk_match` (scope #5) is confirmed.
- **Probe check:** in the B2.2 re-probe, confirm whether the **new key returns the full `last_name`** from `api_search`. Some Apollo plans or master keys unmask it. If it does, drop the "no names" wording but keep everything else.

### S3. Bulk person dedupe breaks index alignment with the caller's input
`validateBulkPersonInput` dedupes records, and `results[].index` refers to the deduped list, not the original request. **Fix:** keep dedupe for pricing, but return `original_indices: number[]` on each result (or expand results back to the original positions). Document that duplicates are billed once.

### S4. One failing record fails the whole bulk-person fallback
The `people/bulk_match` fallback uses `Promise.all(input.details.map(enrichPersonWithApollo))`. If any single call throws, the whole batch returns 502 even when 9 records matched. **Fix:** use `Promise.allSettled`, treat a rejected record as `matched: false` with `error`, and throw only if **all** records rejected. Apply the same pattern to the bulk-org fallback.

### S5. Bulk-org matching by `primary_domain` drops redirects
`orgMap.get(domain)` misses whenever Apollo's `primary_domain` differs from the submitted domain (e.g. `fb.com` → `meta.com`). The credit is still consumed, but the record shows as a miss. **Fix:** if Apollo's bulk response is index-aligned, match by index. Otherwise fall back to matching `website_url` host, then `primary_domain`.

### S6. The buyer script can't test the new endpoints
`scripts/live-onchain-buyer.ts` already supports `--url` and reads the amount from the challenge (good), but the body is hard-coded to a person payload. **Fix:** add `--body '<json>'` (default: current person payload). Print `receipt.amount_usd`, `X-Payment-Settled`, and the BaseScan link.

### S7. Docs and hygiene
- `AGENTS.md`: add B3 (nonce lock) and B1 (no mock in prod) as invariants #6 and #7. Mark Organization Search per the B2 decision.
- `docs/apollo-endpoint-notes.md`: update after the B2 re-probe.
- Confirm `scripts/staggered-settlements.log` / `.out` stay git-ignored (they currently are).

---

## 4. Verification gate (all must be green before asking to push)

> The smoke script doesn't support `--only <id>` or `--unpaid-only` yet. Add both flags as part of this work. `--unpaid-only` runs S1, S2, S6, S7, S8, and S9, which need no dev token.

```bash
cd /Users/bentspoon/Documents/Agent_Distribution
/opt/homebrew/bin/node ./node_modules/typescript/bin/tsc --noEmit
/opt/homebrew/bin/node --experimental-strip-types scripts/check-challenge-regression.ts      # person challenge unchanged
/opt/homebrew/bin/node ./node_modules/next/dist/bin/next build

# mock-mode smoke (S1–S10)
APOLLO_MOCK_MODE=true /opt/homebrew/bin/node ./node_modules/next/dist/bin/next dev -p 3311 &
/opt/homebrew/bin/node --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3311

# B1 safety smoke (S11): live mode with an invalid key → must be 502, never 200/settled
APOLLO_API_KEY=invalid_key_for_test /opt/homebrew/bin/node ./node_modules/next/dist/bin/next dev -p 3312 &
/opt/homebrew/bin/node --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3312 --only S11
```
Commit each fix group separately (`fix(apollo): never serve mock data outside mock mode`, `fix(x402): one-time EIP-3009 authorization lock`, …). Then **stop and report** to the human.

---

## 5. Deploy & cross-platform verification runbook (run only after §2–§4 pass and the human approves)

### 5.1 Preview first (no production impact)
1. `git push origin main:feat/full-funnel`. Vercel builds a preview deployment.
2. If Deployment Protection blocks curl, use `npx vercel curl <path> --deployment <preview-url>` or a protection-bypass token.
3. Against the preview URL, run the **unpaid** smoke checks (S1, S2, S6, S7, S8, S9). The dev token is disabled on Vercel, so skip S3–S5/S10.
4. **Paid preview test (needs human approval, about $0.10 USDC that settles back to the Ledger):**
   ```bash
   N=/opt/homebrew/bin/node; F=--experimental-strip-types; P=<preview-url>
   $N $F scripts/live-onchain-buyer.ts --url $P/api/v1/enrich/organization --body '{"domain":"stripe.com"}'
   $N $F scripts/live-onchain-buyer.ts --url $P/api/v1/search/people --body '{"organization_domains":["stripe.com"],"person_titles":["cfo"],"per_page":3}'
   $N $F scripts/live-onchain-buyer.ts --url $P/api/v1/enrich/people/bulk --body '{"details":[{"first_name":"Patrick","last_name":"Collison","domain":"stripe.com"},{"first_name":"nomatch","last_name":"nobody","domain":"stripe.com"}]}'
   $N $F scripts/live-onchain-buyer.ts --url $P/api/v1/enrich/organizations/bulk --body '{"domains":["stripe.com","apollo.io"]}'
   # Free-on-Miss check: should return payment_settled:false and no tx
   $N $F scripts/live-onchain-buyer.ts --url $P/api/v1/enrich/organization --body '{"domain":"thisdomaindoesnotexist-zz9.com"}'
   # Replay check (B3): resend the exact same X-PAYMENT from the miss above → must be rejected
   ```
   Confirm on BaseScan that each `txHash` transfers the **exact** quoted amount to `0x7C38…0AbC`.
   Note: the preview's `resource.url` is the preview host. That's fine for testing, but **don't** submit preview URLs to any registry.

### 5.2 Production
5. With human approval: `git push origin main`. Wait for the Vercel production deploy to finish.
6. Unpaid production checks:
   ```bash
   for p in search/people search/organizations enrich/organization enrich/people/bulk enrich/organizations/bulk enrich/person; do
     printf "%-28s " $p; curl -s -o /dev/null -w "%{http_code}\n" -X POST https://enrichmatch.dev/api/v1/$p -H 'content-type: application/json' -d '{}'
   done                                   # all 402 (or 503 for a feature-flagged product)
   curl -s https://enrichmatch.dev/api/v1/enrich/person -X POST -d '{}' -D - -o /dev/null | grep -i payment-required   # person header present
   curl -s https://enrichmatch.dev/openapi.json | jq '.info.version, (.paths|keys)'
   curl -s https://enrichmatch.dev/.well-known/x402 | jq '.resources'
   curl -s https://enrichmatch.dev/.well-known/agent.json | jq '[.skills[].id]'
   curl -s -X POST https://enrichmatch.dev/api/mcp -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '[.result.tools[].name]'
   /opt/homebrew/bin/node --experimental-strip-types scripts/smoke-full-funnel.ts --base https://enrichmatch.dev --unpaid-only
   ```
7. Regression check on the live earner: run `scripts/live-onchain-buyer.ts` with no flags (person, $0.03). It must settle exactly as before.
8. One paid call per new product against `https://enrichmatch.dev` (same commands as 5.1 with `P=https://enrichmatch.dev`). Save each `txHash`. **This first settlement per resource is what triggers Coinbase CDP Bazaar indexing**, so confirm the facilitator in the receipt is CDP, not the PayAI fallback.

### 5.3 Discovery & verification parity with the person endpoint
| Platform | Action | Done when |
|---|---|---|
| **Coinbase CDP x402 Bazaar** | Automatic after step 8 settlements via the CDP facilitator | Each new resource URL appears in `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources` (filter by `payTo`) |
| **x402scan** | Re-submit / refresh `https://enrichmatch.dev` (origin verification reuses the existing `X402_OWNERSHIP_PROOFS`; no new signature needed) | All 6 resources listed under the verified origin with correct prices (check S1 is resolved) |
| **x402bazaar.org** | Inspect `scripts/register-x402bazaar.ts`. It registers one URL, so add a loop over `APOLLO_PRODUCTS` paths, keeping the **lowercase `ownerAddress`** quirk from AGENTS.md. Ask before running. | Each endpoint registered |
| **Smithery / Glama / MCP registry** | `smithery.yaml`, `glama.json`, and `server.json` are already at 0.4.0. Trigger a re-scan or republish (`server.json` → MCP registry publish) | Listings show all 7 tools |
| **A2A agent card** | `recentSettlementProofs` should include the new step-8 tx hashes. Proofs live in per-instance `/tmp`, so verify they appear, or hard-seed them | Card shows proofs for new skills |
| **AgentCash / Poncho** | They read `/openapi.json`; re-submit the origin if they don't auto-refresh | New paths visible |

9. Update `AGENTS.md` §1 (prices per product, live tx proofs) and `ROADMAP.md`. Commit `docs: full-funnel live in production`.

### 5.4 Rollback
If anything misbehaves in production: `npx vercel rollback` (instant, previous deployment), or `git revert` the offending commit and push. The person endpoint is unchanged code, so a rollback restores it exactly.
