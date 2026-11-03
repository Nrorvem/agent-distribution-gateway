# Full-Funnel Build: Review 2.0 (Verification of Fix Round 1 + Remaining Corrections)

**Reviewed:** 2026-11-02, commits `3eb5df6..def0874` (fix round 1), on top of `4ecc667..57c7792`. `main` is **14 commits ahead of `origin/main`, not pushed**.
**Verdict:** 🟡 **Almost ready.** All three round-1 blockers are fixed and verified. Two small correctness bugs remain (F1, F2) and must be fixed before the preview deploy. F3–F5 are fast hardening items. F6 is a pricing decision for the human.
**Executor rules (unchanged):** read `AGENTS.md`, commit locally, **do not push**, and don't spend USDC or Apollo credits without the human's approval.

---

## 1. Verification results (run 2026-11-02)

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ pass |
| `next build` | ✅ pass. 16 routes, including the new `ƒ /api/v1/health` |
| `check-challenge-regression.ts` | ✅ pass. Person challenge unchanged, all headers under 7 KB (but see F5: very little headroom) |
| `smoke-full-funnel.ts` mock mode (`APOLLO_MOCK_MODE=true`, port 3311) | ✅ **46/46** (S1–S10, S12) |
| `smoke-full-funnel.ts --only S11` (`APOLLO_API_KEY=invalid_key_for_test`, port 3312) | ✅ **5/5**. Apollo returned `HTTP 401`, the gateway returned `502` with no `X-Payment-Settled`, and no credits were spent |
| Apollo key scopes (zero-credit probe, empty bodies) | ✅ `bulk_match` → 400 "missing details", `bulk_enrich` → 400 "missing domains", `mixed_companies/search` → 200, `usage_stats` → 200. **No 403s. B2 is unblocked.** |

### Round-1 items: status

| Item | Status | Notes |
|---|---|---|
| **B1** No mock data in production | ✅ for the 5 new products | All connectors re-throw non-404 errors. `paid-route.ts` / `paid-mcp.ts` refuse to settle `source: "apollo_mock"` in production. **Gap:** the person route isn't covered (F1). |
| **B2** Org Search upstream | ✅ | Scopes expanded, confirmed by probe. `docs/apollo-endpoint-notes.md` documents index-aligned bulk shapes. Per-endpoint **credit cost / margin** numbers are not recorded (F6). |
| **B3** EIP-3009 nonce lock | ✅ | `lockPaymentAuthorization` runs after `/verify` in `verifyX402Payment`, so it covers the person route too. Marked consumed on settle, miss, 502, and the mock guard. S12 unit test passes. |
| S1 OpenAPI bulk price | ✅ | `mode: "dynamic"` with `min`/`max` |
| S2 / S2.1 People Search honesty | ✅ mostly | `last_name_obfuscated`, `null`s instead of `""`, `isBillable` requires `has_email`, `unlock` hint. **Bug in `unlock`** (F2). |
| S3 Dedupe index alignment | ✅ | `original_indices` on every result |
| S4 `Promise.allSettled` | ✅ | Introduces a billing-fairness issue (F4) |
| S5 Bulk-org redirects | ✅ | Index-aligned when lengths match, otherwise `primary_domain` / `website_url` host |
| S6 Buyer `--body` | ✅ | |
| S7 Docs (AGENTS.md invariants #6, #7) | ✅ | Invariant #7 overstates coverage until F1 lands |
| Health check | ✅ | Returns only `{apollo, minute_usage_pct}`, cached 60 s |
| Smoke `--only` / `--unpaid-only` | ✅ | |

---

## 2. MUST FIX before preview deploy

### F1. The live earner (`enrich_person`) can still sell mock data in production

`src/verticals/option-a-apollo/connector.ts` has its own mock detection, separate from `isApolloMockMode()`:

```ts
const mockMode = process.env.APOLLO_MOCK_MODE === "true" || !apiKey || apiKey === "your_apollo_master_api_key_here";
```

If `APOLLO_API_KEY` is ever missing from Vercel Production (env var deleted, typo during the B2.1 key rotation, a new project link), `enrichPersonWithApollo` returns `buildMockEnrichment(...)` with `matched: true` and a fake email. Neither `src/app/api/v1/enrich/person/route.ts` nor the legacy `enrich_person` branch in `src/app/api/mcp/route.ts` (line ~411) has the `apollo_mock` guard, so the buyer's payment **settles on-chain for a fabricated contact**. This is the highest-traffic endpoint, and AGENTS.md invariant #7 currently claims it is covered.

**Fix** (the challenge bytes don't change, so the person-route-unchanged rule isn't violated in spirit; re-run `check-challenge-regression.ts` to confirm):
1. In `apollo-client.ts`, make mock mode impossible in production unless explicitly forced, so a missing key throws (→ 502, nothing settled) instead of silently mocking:
   ```ts
   export function isApolloMockMode(): boolean {
     if (process.env.APOLLO_MOCK_MODE === "true") return true;
     if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") return false;
     const key = process.env.APOLLO_API_KEY;
     return !key || key === "mock_key" || key === "test_api_key" || key === "your_apollo_master_api_key_here";
   }
   ```
2. In `connector.ts`, replace the local `mockMode` expression with `isApolloMockMode()`, so there is one definition.
3. Extract the guard into `src/lib/x402-gate.ts` as `isMockOutputBlockedInProduction(output)`. Call it from `paid-route.ts`, `paid-mcp.ts`, **the person REST route**, and **the legacy MCP `enrich_person` branch**, right before the Free-on-Miss / settle decision. On a hit, return `502` (REST) or `isError` (MCP) and do not settle.
4. Smoke S13 (local): run `next build && APOLLO_MOCK_MODE= APOLLO_API_KEY= next start -p 3313` and POST `/api/v1/enrich/person` with a bogus payment header. The test should get a 402 or 502, never a 200 with `payment_settled: true`. Also unit-assert that `isApolloMockMode()` returns `false` when `NODE_ENV=production` and the key is empty.

### F2. The People Search `unlock` hint can produce a request that `bulk_enrich_people` rejects

`search_people` allows `per_page` up to 25 (`catalog.ts:89`, `search-schema.ts`), but `unlock.args.details` includes **every** `has_email` result. `bulk_enrich_people` rejects more than 10 records (`bulk-person-schema.ts:72`). So an agent that follows the hint on a 25-result page gets `422`. Also, `estimated_price_usd` hard-codes `0.025` instead of reading the pricing table.

**Fix** in `search-connector.ts`:
```ts
const BULK_MAX = 10;
const ids = emailablePeople.map((p) => ({ id: p.apollo_id }));
const chunks = Array.from({ length: Math.ceil(ids.length / BULK_MAX) }, (_, i) => ids.slice(i * BULK_MAX, (i + 1) * BULK_MAX));
unlock = {
  tool: "bulk_enrich_people",
  rest: "POST /api/v1/enrich/people/bulk",
  args: { details: chunks[0] },            // first call, ready to send
  remaining_batches: chunks.slice(1).map((details) => ({ details })),
  estimated_price_usd: atomicToUsd(BigInt(unitAtomic("bulk_enrich_people")) * BigInt(ids.length)), // use pricing.ts helpers
  description: `Enrich ${ids.length} reachable profile(s) in ${chunks.length} call(s) of ≤10`,
};
```
Update the people-search output schema in `catalog.ts` and the mock builder to match. Add a mock-mode smoke step with `per_page: 25` that asserts `unlock.args.details.length <= 10`.

---

## 3. SHOULD FIX (hardening; bundle with F1/F2)

### F3. Bulk-person index mapping has no length guard
`bulkEnrichPeopleWithApollo` maps `rawList[index]` unconditionally. The probe notes say `matches` is index-aligned with `null` gaps, which is fine **today**. But if Apollo ever compacts the array (drops nulls), every person after the first gap gets attached to the **wrong input**, and the buyer pays for it. Bulk-org already guards on `rawOrgs.length === domains.length`. Mirror that:
```ts
if (rawList.length !== input.details.length) {
  throw new Error(`Apollo bulk_match returned ${rawList.length} rows for ${input.details.length} inputs; refusing to guess alignment`);
}
```
(Throwing → 502, nothing settled. That's safer than guessing.) Also remove the `// Direct index-aligned mapping (verified live)` comment in `org-connector.ts:221` or point it at the doc section.

### F4. Bulk fallback bills buyers for gateway-side failures
After S4, a record whose single lookup **rejects** (429, timeout, 5xx) becomes `matched: false`. But the x402 `exact` amount is fixed at `submitted × unit`. So if 9 of 10 lookups hit Apollo's rate limit and 1 returns an email, the buyer pays the full **$0.25** for one result, and the misses were our fault, not real misses.
**Fix** (both `bulk-person-connector.ts` and `org-connector.ts` fallbacks): a genuine "not found" stays a miss, but **any rejection** throws so the whole call returns 502 and nothing settles. The agent retries with a fresh authorization.
```ts
const rejected = settled.filter((s) => s.status === "rejected");
if (rejected.length > 0) throw new Error(`${rejected.length}/${settled.length} upstream lookups failed; not settling partial batch`);
```
Since the bulk scopes are now live, the fallback should be rare, so this costs little availability.

### F5. Challenge header size has almost no headroom
| Product | Size | Limit | Headroom |
|---|---|---|---|
| `bulk_enrich_people` | 7100 B (regression) / 7084 B (local) | 7168 B | **68 B** |
| `enrich_person` | 7096 B (regression) / **7144 B (local dev)** | 7168 B | **24–72 B** |

The size changes with the request environment (local dev was 48 B larger for person). The preview origin (`agent-distribution-gateway-git-<branch>-<team>.vercel.app`) is much longer than `enrichmatch.dev`. **Run S9 against the preview URL before trusting it**, and expect `enrich_person` may go over there.
**Fix:** cut ~500 B from the `bulk_enrich_people` bazaar spec (shorter `description`, one example instead of two, drop `examples` inside `input` schema properties). For `enrich_person`, leave the bytes alone (the round-1 invariant) but have `check-challenge-regression.ts` also compute sizes using the longest realistic origin (`https://agent-distribution-gateway.vercel.app`) and fail if any header is over 7168 B.

### F6. Margin check against measured credit cost (B2.2 step 2) isn't recorded
`docs/apollo-endpoint-notes.md` shows shapes but not per-call `credits_consumed` for `mixed_companies/search`, `bulk_match`, or `bulk_enrich`. Before production, add a table with **credits per call / per matched record × your $/credit** next to each price. `bulk_match` returns `credits_consumed` in its body, so record it from one probe call (about 2 credits, needs human approval).

### F7. Lock pre-check before `/verify` (small)
`lockPaymentAuthorization` runs **after** the facilitator `/verify`. So N concurrent replays of one header make N `/verify` calls to CDP before N−1 are rejected, which spends CDP rate limit. Call `checkPaymentAuthorizationLock(from, nonce)` **before** `/verify` (decode the payload first) and keep the real lock after. Behavior otherwise unchanged; S12 stays green.

### F8. Confirm the Apollo key has no write scope (human, 1 minute)
`usage_stats` lists rate limits for 71 endpoints, including `contacts/create`, `accounts/bulk_create`, and `tasks/create`. This may only be the account-wide rate-limit table, not proof of scope, but it **could** mean a master key was used. In **Apollo → Settings → Integrations → API Keys**, confirm the gateway key isn't flagged "master" and only has scopes #1–#7 from round 1 §B2.1. If it is a master key, create a scoped key and rotate it (`npx vercel env rm/add APOLLO_API_KEY production`).

---

## 4. HUMAN DECISION: bulk pricing on low hit rates (not a blocker)

Bulk charges `submitted × unit` whenever **≥ 1** record bills. A 1-of-10 hit costs **$0.25 for one email**, about 8× the single `enrich_person` price. That's technically Free-on-Miss but feels like overcharging, and price-aware agents will learn to avoid bulk. Options:

| Option | How | Trade-off |
|---|---|---|
| **A (recommended now)** Keep it, steer hit rate up | The `unlock` hint only includes `has_email: true` IDs, so funnel traffic should hit about 90%+. State the worst case in the description: "Charged for all submitted records if ≥1 email is found; submit `has_email` IDs from `search_people`." | Simple. Cold-list buyers can still overpay. |
| **B** Hit-rate threshold | Settle only if `billable_count / submitted ≥ 0.5`, otherwise free | Fairer, but you eat credit cost on low-hit batches |
| **C** Pay-for-what-you-get | x402 `upto` scheme (authorize max, settle actual `billable × unit`) **if** the CDP facilitator supports it on Base | Best UX; needs facilitator support checked, and adds a new code path in `settleVerifiedX402Payment` |

---

## 5. Verification gate for round 2

```bash
cd /Users/bentspoon/Documents/Agent_Distribution
N=/opt/homebrew/bin/node
$N ./node_modules/typescript/bin/tsc --noEmit
$N --experimental-strip-types scripts/check-challenge-regression.ts   # + new long-origin size check (F5)
$N ./node_modules/next/dist/bin/next build

APOLLO_MOCK_MODE=true $N ./node_modules/next/dist/bin/next dev -p 3311 &
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3311          # expect 47+/47+ incl. F2 unlock≤10
kill %1

APOLLO_API_KEY=invalid_key_for_test APOLLO_MOCK_MODE=false $N ./node_modules/next/dist/bin/next dev -p 3312 &
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3312 --only S11  # 5/5 (+ person route)
kill %1

# F1 / S13: production-mode, no key → never a settled 200
APOLLO_MOCK_MODE= APOLLO_API_KEY= $N ./node_modules/next/dist/bin/next start -p 3313 &
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3313 --only S13
kill %1
```

Suggested commits:
- `fix(apollo): unify mock detection and block mock settlement on person route` (F1)
- `fix(search): cap unlock hint to bulk batch size and use pricing table` (F2)
- `fix(bulk): strict index alignment and no partial-failure settlement` (F3, F4)
- `chore(x402): trim bulk bazaar spec and long-origin header check` (F5)
- `perf(x402): pre-check authorization lock before facilitator verify` (F7)
- `docs(apollo): record measured credit costs and margins` (F6)

Then **stop and report**. After the human approves, follow the round-1 runbook (§5 of `FULL_FUNNEL_REVIEW_FIXES.md`): preview push → unpaid smoke on the preview (**including S9 header sizes**, see F5) → about $0.10 of paid preview tests → production.
