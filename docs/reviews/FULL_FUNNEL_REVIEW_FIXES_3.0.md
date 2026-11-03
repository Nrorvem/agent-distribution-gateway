# Full-Funnel Build: Review 3.0 (Verification of Fix Round 2 + Pre-Deploy Gate)

**Reviewed:** 2026-11-02, commits `ce9bc02..4e0ceb7` (fix round 2). `main` is **21 commits ahead of `origin/main`, not pushed**. Live production is still the Oct 31 single-endpoint build.
**Verdict:** 🟡 **Code is ready for a preview deploy after G1–G3. Production is blocked only on H1** (the domain registration was removed at the registrar). H2–H4 are resolved.
**Executor rules (unchanged):** read `AGENTS.md`, commit locally, **do not push**, and don't spend USDC or Apollo credits without the human's approval.

---

## 1. Verification results (run 2026-11-02)

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ pass |
| `next build` | ✅ pass (16 routes) |
| `check-challenge-regression.ts` | ✅ pass as written, but **it measures the wrong person challenge** (G1) |
| Smoke, mock mode (`next dev`, port 3311) | ✅ **47/47** (includes the new S4 `per_page: 25` unlock chunking: 10 + 2 remaining batches) |
| Smoke `--only S11`, invalid key (port 3312) | ✅ **6/6** (now includes `/enrich/person`) |
| Smoke `--only S13`, `next start` with no key (port 3313) | ✅ 2/2, but the endpoint half proves nothing (G2) |
| Smoke `--unpaid-only` against the **production build** (`next start`) | ✅ 26/26 |
| Direct F1 check: `NODE_ENV=production`, no key → `enrichPersonWithApollo()` | ✅ throws `Missing APOLLO_API_KEY` (→ 502, nothing settled). `isMockOutputBlockedInProduction` is true for `apollo_mock` and false for live output |
| Live DNS for `enrichmatch.dev` | ❌ **NXDOMAIN at the .dev registry; RDAP returns 404 "not found"** (H1) |
| Live `agent-distribution-gateway.vercel.app` | ✅ serves the old build; person `PAYMENT-REQUIRED` = **7176 B** |

### Round-2 items: status

| Item | Status | Notes |
|---|---|---|
| **F1** Mock in production (person route + legacy MCP) | ✅ | One `isApolloMockMode()`, which is never true in production unless forced. Guard extracted to `x402-gate.ts` and called from all 4 settle sites. Authorizations are marked consumed on miss, 502, and mock-block. Verified directly. |
| **F2** Unlock hint ≤ 10 | ✅ | `args.details` holds ≤ 10 IDs, `remaining_batches` holds the rest, price comes from `totalPriceUsd`. Schema and mock builder updated. |
| **F3** Bulk-person length guard | ✅ | Throws → 502 (the error text doesn't match the 403/404 fallback regex, so it isn't swallowed). |
| **F4** No partial-failure settlement | ✅ | Both fallbacks throw if any lookup rejects. |
| **F5** Header headroom | ⚠️ partial | Bulk-people trimmed 7100 → 3964 B ✅. Long-origin check added ✅. **But the person check is wrong** (G1). |
| **F6** Credit cost / margin | ❌ not done | The table *assumes* `$0.01/credit` and says measurement "requires a live probe". The commit title says "measured", but nothing was measured (H2). |
| **F7** Lock pre-check before `/verify` | ✅ | |
| **F8** Key has no write scope | ❓ human, unconfirmed (H3) |
| §4 Bulk pricing decision | ❓ open (H4) |

---

## 2. HUMAN ITEMS (updated 2026-11-02 with the human's answers)

### H1. `enrichmatch.dev` registration has disappeared 🔴 OPEN (only remaining production blocker)
**What happened:** the domain *was* registered and working. `npx vercel domains inspect enrichmatch.dev` shows Vercel attached it on **2026-10-30 10:35** with nameservers `dns1/dns2.registrar-servers.com` (**Namecheap**), and the Oct 30–31 tests passed through it. Today (2026-11-02):
- `.dev` registry RDAP (`pubapi.registry.google/rdap/domain/enrichmatch.dev`) returns **404 "not found"** (`google.dev` returns 200)
- the registry's own nameservers and 1.1.1.1 / 8.8.8.8 / 9.9.9.9 all return **NXDOMAIN**

A domain that's only expired or suspended still appears in RDAP, so a 404 there means the **registration itself was removed**. For a 3-day-old domain, this is almost always the registrar **cancelling the order inside the 5-day Add Grace Period**: a payment failure or chargeback, a new-account fraud review, an unverified contact email, or a manual cancel or refund. The code didn't cause it.
**Action (human, ~10 min):**
1. Log in to **Namecheap → Domain List / Order History**, and search your email (`info@nrorvem.com` and the account email) for Namecheap messages about "order", "cancelled", "refund", or "verification".
2. If the order is on hold or pending verification, finish the verification. If it was cancelled, **register `enrichmatch.dev` again**. It's available to anyone right now, so do this soon.
3. Keep Namecheap's default nameservers (`registrar-servers.com`) and add the Vercel records (`A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`), or switch the nameservers to `ns1/ns2.vercel-dns.com`. Then run `npx vercel domains verify enrichmatch.dev`.
4. The domain stays attached to the Vercel project, and the EIP-191 ownership proofs sign the hostname, not the registration, so **no code, proof, or env changes are needed** once it's back under your control.

### H2. Credit cost ✅ RESOLVED: $0.01/credit (human-confirmed)
The margin table in `docs/apollo-endpoint-notes.md` §7 is correct as written (person 66.7%, bulk people 60% per hit, bulk org 33–100%). Change the wording from "assumed" to "**confirmed by owner, 2026-11-02**". The optional 2-credit `bulk_match` probe to record `credits_consumed` is nice to have, not a blocker.

### H3. Apollo key scope ✅ RESOLVED
The human confirmed it isn't a master key and has no write scopes.

### H4. Bulk pricing ✅ DECIDED: Option A (keep the price, state the worst case) → apply **G3**
Future option: per-record "pay for what you get" through the x402 `upto` scheme (Option C in 2.0 §4). It's tracked as a later improvement, not part of this round.

---

## 3. CODE FIXES (bundle before the preview push)

### G1. The challenge regression check measures a different person challenge than production serves
`check-challenge-regression.ts` builds `enrich_person` with `product.title` + the catalog bazaar spec (**7096 / 7124 B**). The live route (`src/app/api/v1/enrich/person/route.ts:90-102`) calls `buildX402Challenge(resourceUrl, description)` with its own hard-coded, longer description, and that is **7144–7148 B** locally. Measured with the real description:

| Origin | Person header |
|---|---|
| `https://enrichmatch.dev` | 7148 B |
| `https://agent-distribution-gateway.vercel.app` | **7176 B (over the 7168 budget; already live, so not a regression)** |
| Preview `…-git-main-<team>.vercel.app` | **≈ 7212 B** (preview S9 will fail) |

**Fix:**
1. Export the route's description as a constant (e.g. `PERSON_ROUTE_DESCRIPTION` in the person route or `schema.ts`). Have the regression script build the person challenge with **exactly** the route's arguments, and add a preview-length origin (`https://agent-distribution-gateway-git-main-nrorvems-projects.vercel.app`) to `testOrigins`.
2. Pick a deliberate budget. 7168 B is self-imposed; the practical ceiling is about 8 KB per header (common nginx/proxy `proxy_buffer_size` defaults). Options: (a) raise the budget to **8000 B** and document why, keeping the person bytes frozen (recommended: no change to the live challenge, about 800 B headroom), or (b) shorten the person description (≈ 40 chars saves ≈ 55 B), which breaks the "person challenge unchanged" rule and needs the human's OK.
3. Better still, make S9 assert the **live** header from the server (it already does) against the same budget, and run it against the preview URL.

### G2. S13's endpoint assertion is vacuous
Under `next start`, `NODE_ENV=production`, so `devBypassToken` is `""` (`x402-gate.ts:433`). The bypass header is rejected with **402 before the connector runs**, so the test passes even if F1 were reverted. Replace it with in-process unit assertions in S13 (no server needed):
```ts
(process.env as any).NODE_ENV = "production"; delete process.env.APOLLO_API_KEY; delete process.env.APOLLO_MOCK_MODE;
await assertRejects(() => enrichPersonWithApollo({ first_name: "A", last_name: "B", domain: "stripe.com" }), /APOLLO_API_KEY/);
assert(isMockOutputBlockedInProduction({ source: "apollo_mock" }) === true);
assert(isMockOutputBlockedInProduction({ source: "apollo" }) === false);
```
Keep the HTTP check, but label it "unpaid probe returns 402 in production," which is what it actually tests.

### G3. State the bulk worst case (required: H4 = Option A)
`catalog.ts:625/633` and `llms.txt`: add "Charged for **all** submitted records if ≥ 1 email is found. Submit `has_email: true` IDs from `search_people`'s `unlock` hint." This is description-only, so check that bulk headers stay well under budget (currently ~3.9 KB).

### G4. (Nit) Deduplicate the unlock builder
The chunking block is copied into `buildMockPeopleSearch` and `searchPeopleWithApollo`, and `BULK_MAX = 10` is hard-coded twice. Extract `buildUnlockHint(people)` in `search-connector.ts` and source the max from `bulk-person-schema.ts` (the `maxItems: 10` / validator limit), so the two can't drift.

### G5. Docs
- `docs/apollo-endpoint-notes.md` §7: mark $0.01/credit as **owner-confirmed 2026-11-02** (H2).
- AGENTS.md §1: add a note that `enrichmatch.dev` is registered at Namecheap (third-party DNS), so registrar status is the first thing to check if it goes NXDOMAIN.
- The untracked `FULL_FUNNEL_REVIEW_FIXES*.md` files: move them to `docs/reviews/` or add them to `.gitignore`. Don't commit them to the repo root.

---

## 4. Verification gate for round 3

```bash
cd /Users/bentspoon/Documents/Agent_Distribution
N=/opt/homebrew/bin/node
$N ./node_modules/typescript/bin/tsc --noEmit
$N --experimental-strip-types scripts/check-challenge-regression.ts   # person measured with the ROUTE description, 3 origins incl. preview length
$N ./node_modules/next/dist/bin/next build

APOLLO_MOCK_MODE=true $N ./node_modules/next/dist/bin/next dev -p 3311 &
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3311          # 47/47
kill %1
APOLLO_API_KEY=invalid_key_for_test APOLLO_MOCK_MODE=false $N ./node_modules/next/dist/bin/next dev -p 3312 &
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3312 --only S11  # 6/6
kill %1
APOLLO_MOCK_MODE= APOLLO_API_KEY= $N ./node_modules/next/dist/bin/next start -p 3313 &
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3313 --only S13  # in-process F1 asserts (G2)
$N --experimental-strip-types scripts/smoke-full-funnel.ts --base http://localhost:3313 --unpaid-only  # 26/26
kill %1
```

Suggested commits:
- `test(x402): measure person challenge with route description and preview-length origin` (G1)
- `test(smoke): make S13 assert connector throw and mock guard in-process` (G2)
- `refactor(search): single unlock hint builder sourced from bulk max` (G4)
- `docs: mark margins as assumed pending measured credit cost` (G5)

## 5. Rollout (preview can start now; production after H1 is resolved and the human approves)
1. Push to a **preview branch** (not `main`). Run `--unpaid-only` against the preview URL, with S9 under the chosen budget (G1).
2. Paid preview tests (about $0.10 total, needs approval): `scripts/live-onchain-buyer.ts --body …` on one hit and one miss for person, people search, and bulk people. On the miss, confirm `payment_settled: false` and that no USDC moved.
3. Merge to `main`, then re-run the unpaid smoke against production plus one $0.03 person match. Confirm `/openapi.json`, `/.well-known/x402`, and `/api/mcp` list all 6 products.
