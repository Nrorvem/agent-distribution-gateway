/**
 * Full-Funnel Automated Smoke Test Suite
 *
 * Runs tests S1 through S12 against the live gateway or local dev server:
 * S1: POST with no body, no payment -> HTTP 402 with x402Version: 2 and expected amount
 * S2: POST with garbage body, no payment -> HTTP 402 (Invariant #1: must probe 402 before 422)
 * S3: POST with invalid body + dev payment -> HTTP 422 with expected_schema
 * S4: POST with valid example body + dev payment -> HTTP 200 with payment_settled: true & receipt
 * S5: Bulk dynamic pricing check -> 3 records unauth quoted 3 * unit, settled on 200
 * S6: GET on each route -> HTTP 200 with schema & x402_challenge_preview
 * S7: MCP tools/list -> contains all tools + get_enrichment_quote
 * S8: Discovery surface validation across all 6 manifests
 * S9: Header size check (< 7 KB base64)
 * S10: Free-on-Miss check (mock nomatch.invalid -> HTTP 200 with payment_settled: false and $0.00)
 * S11: B1 safety smoke -> invalid upstream key returns 502 with no settlement (run via --only S11)
 * S12: Nonce lock unit test -> rejects reused authorization
 *
 * Usage:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/smoke-full-funnel.ts [--base http://localhost:3000] [--only <id>] [--unpaid-only]
 */

import { APOLLO_PRODUCTS } from "../src/verticals/option-a-apollo/catalog.ts";
import {
  usdToAtomicUnits,
  lockPaymentAuthorization,
  isMockOutputBlockedInProduction,
} from "../src/lib/x402-gate.ts";
import { isApolloMockMode } from "../src/verticals/option-a-apollo/apollo-client.ts";
import { enrichPersonWithApollo } from "../src/verticals/option-a-apollo/connector.ts";

const args = process.argv.slice(2);
let baseUrl = "http://localhost:3000";
let onlyTestId: string | undefined;
let unpaidOnly = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base" && args[i + 1]) {
    baseUrl = args[i + 1].replace(/\/+$/, "");
    i++;
  } else if (args[i] === "--only" && args[i + 1]) {
    onlyTestId = args[i + 1].toUpperCase();
    i++;
  } else if (args[i] === "--unpaid-only") {
    unpaidOnly = true;
  }
}

const DEV_BYPASS_TOKEN = "dev_test_payment_proof_2026";

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function assertRejects(fn: () => Promise<unknown>, expectedRegex: RegExp): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err: any) {
    threw = true;
    assert(
      expectedRegex.test(err?.message || ""),
      `Expected error message matching ${expectedRegex}, got "${err?.message}"`
    );
  }
  assert(threw, "Expected function to reject, but it resolved");
}

function shouldRun(testId: string): boolean {
  if (onlyTestId) {
    return onlyTestId === testId;
  }
  if (unpaidOnly) {
    return ["S1", "S2", "S6", "S7", "S8", "S9"].includes(testId);
  }
  // S11 and S13 are only run when explicitly targeted
  if (testId === "S11" || testId === "S13") return false;
  return true;
}

async function run() {
  console.log(`\n🚀 Starting Full-Funnel Gateway Smoke Test Suite against ${baseUrl}...`);
  if (onlyTestId) console.log(`   (Filtered to test: ${onlyTestId})`);
  if (unpaidOnly) console.log(`   (Filtered to unpaid tests: S1, S2, S6, S7, S8, S9)`);
  console.log();

  // --- S12: Nonce lock unit test ---
  if (shouldRun("S12")) {
    try {
      const nonce = `0xunit_test_nonce_${Date.now()}`;
      const payer = "0xUnitTestBuyerWallet";
      const validBefore = Math.floor(Date.now() / 1000) + 300;

      const first = lockPaymentAuthorization(payer, nonce, validBefore);
      assert(first.allowed === true, `Expected first lock to succeed, got ${JSON.stringify(first)}`);

      const second = lockPaymentAuthorization(payer, nonce, validBefore);
      assert(second.allowed === false, "Expected second lock to be rejected");
      assert(second.error === "Payment authorization already used", `Unexpected error: ${second.error}`);

      results.push({ id: "S12", name: "EIP-3009 nonce lock helper rejects reused authorization", passed: true });
    } catch (err: any) {
      results.push({ id: "S12", name: "EIP-3009 nonce lock helper rejects reused authorization", passed: false, error: err.message });
    }
  }

  // --- S7: MCP tools/list ---
  if (shouldRun("S7")) {
    try {
      const mcpRes = await fetch(`${baseUrl}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      assert(mcpRes.ok, `MCP tools/list failed with HTTP ${mcpRes.status}`);
      const mcpData = await mcpRes.json();
      const toolNames = (mcpData.result?.tools || []).map((t: any) => t.name);

      assert(toolNames.includes("get_enrichment_quote"), "Missing get_enrichment_quote");
      for (const p of APOLLO_PRODUCTS) {
        assert(toolNames.includes(p.mcpTool), `Missing MCP tool ${p.mcpTool}`);
      }
      results.push({ id: "S7", name: "MCP tools/list contains all product tools", passed: true });
    } catch (err: any) {
      results.push({ id: "S7", name: "MCP tools/list contains all product tools", passed: false, error: err.message });
    }
  }

  // --- S8: Discovery surfaces check ---
  if (shouldRun("S8")) {
    try {
      const surfaces = [
        { name: "OpenAPI", path: "/openapi.json" },
        { name: "x402 Manifest", path: "/.well-known/x402" },
        { name: "A2A Agent Card", path: "/.well-known/agent.json" },
        { name: "MCP Server Card", path: "/.well-known/mcp/server-card.json" },
        { name: "LLM Manifest", path: "/llms.txt" },
        { name: "Catalog", path: "/api/v1/catalog" },
      ];

      for (const s of surfaces) {
        const res = await fetch(`${baseUrl}${s.path}`);
        assert(res.ok, `${s.name} (${s.path}) failed with HTTP ${res.status}`);
        const text = await res.text();
        for (const p of APOLLO_PRODUCTS) {
          assert(
            text.includes(p.path) || text.includes(p.mcpTool),
            `${s.name} missing reference to ${p.path} / ${p.mcpTool}`
          );
        }
      }
      results.push({ id: "S8", name: "All 6 discovery surfaces mention every product path/tool", passed: true });
    } catch (err: any) {
      results.push({ id: "S8", name: "All 6 discovery surfaces mention every product path/tool", passed: false, error: err.message });
    }
  }

  // --- Per-product tests (S1 - S4, S6, S9, S10) ---
  for (const product of APOLLO_PRODUCTS) {
    const route = product.path;
    const tag = `[${product.id}]`;

    // S1: POST with no body, no payment -> 402
    if (shouldRun("S1")) {
      try {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        assert(res.status === 402, `Expected 402, got ${res.status}`);
        const paymentReqHeader = res.headers.get("payment-required");
        assert(Boolean(paymentReqHeader), "Missing PAYMENT-REQUIRED header");
        const decodedJson = JSON.parse(Buffer.from(paymentReqHeader!, "base64").toString("utf-8"));
        assert(decodedJson.x402Version === 2, `Expected x402Version: 2, got ${decodedJson.x402Version}`);

        const expectedAmount = product.funnelStage === "bulk_enrich"
          ? (BigInt(usdToAtomicUnits(product.pricing.unitUsd())) * 10n).toString()
          : usdToAtomicUnits(product.pricing.unitUsd());

        assert(
          decodedJson.accepts[0].amount === expectedAmount,
          `Expected amount ${expectedAmount}, got ${decodedJson.accepts[0].amount}`
        );
        results.push({ id: "S1", name: `${tag} POST empty body without payment -> HTTP 402 with valid challenge`, passed: true });
      } catch (err: any) {
        results.push({ id: "S1", name: `${tag} POST empty body without payment -> HTTP 402 with valid challenge`, passed: false, error: err.message });
      }
    }

    // S2: POST with garbage body, no payment -> 402 (NOT 422)
    if (shouldRun("S2")) {
      try {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ garbage_key_xyz: 12345 }),
        });
        assert(res.status === 402, `Invariant #1 violation: Expected 402 on garbage unauth body, got ${res.status}`);
        results.push({ id: "S2", name: `${tag} POST garbage body without payment -> HTTP 402 (probe invariant)`, passed: true });
      } catch (err: any) {
        results.push({ id: "S2", name: `${tag} POST garbage body without payment -> HTTP 402 (probe invariant)`, passed: false, error: err.message });
      }
    }

    // S3: POST with invalid body + dev payment -> 422 with expected_schema
    if (shouldRun("S3")) {
      try {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": DEV_BYPASS_TOKEN,
          },
          body: JSON.stringify({ invalid_filter: true }),
        });
        assert(res.status === 422, `Expected 422 on invalid body with payment, got ${res.status}`);
        const data = await res.json();
        assert(Boolean(data.expected_schema), "Missing expected_schema in 422 response");
        results.push({ id: "S3", name: `${tag} POST invalid body with payment -> HTTP 422 with schema`, passed: true });
      } catch (err: any) {
        results.push({ id: "S3", name: `${tag} POST invalid body with payment -> HTTP 422 with schema`, passed: false, error: err.message });
      }
    }

    // S4: POST with valid example body + dev payment -> 200 with payment_settled: true
    if (shouldRun("S4")) {
      try {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": DEV_BYPASS_TOKEN,
          },
          body: JSON.stringify(product.exampleInput),
        });
        assert(res.status === 200, `Expected 200 on valid execution, got ${res.status}`);
        const data = await res.json();
        assert(data.payment_settled === true, `Expected payment_settled: true, got ${data.payment_settled}`);
        assert(Boolean(data.receipt), "Missing receipt in 200 response");
        assert(Boolean(data.receipt.receipt_id), "Missing receipt_id in receipt");
        results.push({ id: "S4", name: `${tag} POST valid body with payment -> HTTP 200 fulfilled with receipt`, passed: true });

        // F2 verification: search_people with per_page: 25 must cap unlock.args.details to <= 10
        if (product.id === "search_people") {
          try {
            const p25Res = await fetch(`${baseUrl}/api/v1/search/people`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-PAYMENT": DEV_BYPASS_TOKEN,
              },
              body: JSON.stringify({ organization_domains: ["apollo.io"], per_page: 25 }),
            });
            assert(p25Res.status === 200, `Expected 200 for 25-item search, got ${p25Res.status}`);
            const p25Data = await p25Res.json();
            assert(Boolean(p25Data.unlock), "Missing unlock object in 25-item people search");
            assert(
              p25Data.unlock.args.details.length <= 10,
              `Expected unlock.args.details.length <= 10, got ${p25Data.unlock.args.details.length}`
            );
            assert(
              Array.isArray(p25Data.unlock.remaining_batches),
              "Expected unlock.remaining_batches array"
            );
            assert(
              p25Data.unlock.remaining_batches.length > 0,
              "Expected at least 1 remaining batch for 25-item search"
            );
            results.push({
              id: "S4",
              name: `[search_people] per_page: 25 chunking caps unlock batch to <= 10 (got ${p25Data.unlock.args.details.length}, ${p25Data.unlock.remaining_batches.length} remaining batches)`,
              passed: true,
            });
          } catch (err: any) {
            results.push({
              id: "S4",
              name: "[search_people] per_page: 25 chunking caps unlock batch to <= 10",
              passed: false,
              error: err.message,
            });
          }
        }
      } catch (err: any) {
        results.push({ id: "S4", name: `${tag} POST valid body with payment -> HTTP 200 fulfilled with receipt`, passed: false, error: err.message });
      }
    }

    // S6: GET on each route -> 200
    if (shouldRun("S6")) {
      try {
        const res = await fetch(`${baseUrl}${route}`);
        assert(res.status === 200, `Expected GET 200, got ${res.status}`);
        const data = await res.json();
        assert(Boolean(data.schema), "Missing schema preview in GET response");
        assert(Boolean(data.x402_challenge_preview), "Missing x402_challenge_preview in GET response");
        results.push({ id: "S6", name: `${tag} GET route -> HTTP 200 schema & pricing preview`, passed: true });
      } catch (err: any) {
        results.push({ id: "S6", name: `${tag} GET route -> HTTP 200 schema & pricing preview`, passed: false, error: err.message });
      }
    }

    // S9: Header size check (< 8 KB base64)
    if (shouldRun("S9")) {
      try {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const header = res.headers.get("payment-required") || "";
        const sizeBytes = Buffer.byteLength(header, "utf-8");
        const MAX_HEADER_SIZE_BYTES = 8000;
        assert(sizeBytes < MAX_HEADER_SIZE_BYTES, `Header size ${sizeBytes} bytes exceeds ${MAX_HEADER_SIZE_BYTES} B limit`);
        results.push({ id: "S9", name: `${tag} PAYMENT-REQUIRED header size < 8 KB (${sizeBytes} bytes)`, passed: true });
      } catch (err: any) {
        results.push({ id: "S9", name: `${tag} PAYMENT-REQUIRED header size < 8 KB`, passed: false, error: err.message });
      }
    }

    // S10: Free-on-Miss test
    if (shouldRun("S10")) {
      try {
        let missPayload: unknown;
        if (product.id === "search_people") {
          missPayload = { keywords: "nomatch.invalid" };
        } else if (product.id === "search_organizations") {
          missPayload = { keywords: "nomatch.invalid" };
        } else if (product.id === "enrich_organization") {
          missPayload = { domain: "nomatch.invalid" };
        } else if (product.id === "enrich_person") {
          missPayload = { first_name: "Tim", last_name: "Zheng", domain: "nomatch.invalid" };
        } else if (product.id === "bulk_enrich_people") {
          missPayload = { details: [{ first_name: "Tim", last_name: "Zheng", domain: "nomatch.invalid" }] };
        } else if (product.id === "bulk_enrich_organizations") {
          missPayload = { domains: ["nomatch.invalid"] };
        }

        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": DEV_BYPASS_TOKEN,
          },
          body: JSON.stringify(missPayload),
        });
        assert(res.status === 200, `Expected 200 on Free-on-Miss, got ${res.status}`);
        const data = await res.json();
        assert(data.payment_settled === false, `Expected payment_settled: false on miss, got ${data.payment_settled}`);
        assert(data.receipt?.amount_usd === "0.00", `Expected amount_usd: '0.00', got ${data.receipt?.amount_usd}`);
        results.push({ id: "S10", name: `${tag} Free-on-Miss -> HTTP 200 with payment_settled: false & $0.00`, passed: true });
      } catch (err: any) {
        results.push({ id: "S10", name: `${tag} Free-on-Miss -> HTTP 200 with payment_settled: false & $0.00`, passed: false, error: err.message });
      }
    }
  }

  // S5: Bulk dynamic pricing check (bulk only)
  if (shouldRun("S5")) {
    try {
      const bulkPeoplePayload = {
        details: [
          { first_name: "Alice", last_name: "Smith", domain: "apollo.io" },
          { first_name: "Bob", last_name: "Jones", domain: "stripe.com" },
          { first_name: "Charlie", last_name: "Brown", domain: "linear.app" },
        ],
      };

      // Probe with 3 records without payment -> quoted 3 * 25000 = 75000
      const probeRes = await fetch(`${baseUrl}/api/v1/enrich/people/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulkPeoplePayload),
      });
      assert(probeRes.status === 402, `Expected 402, got ${probeRes.status}`);
      const probeHeader = probeRes.headers.get("payment-required");
      const probeChallenge = JSON.parse(Buffer.from(probeHeader!, "base64").toString("utf-8"));
      assert(
        probeChallenge.accepts[0].amount === "75000",
        `Expected bulk amount 75000, got ${probeChallenge.accepts[0].amount}`
      );

      // Call with payment -> 200
      const paidRes = await fetch(`${baseUrl}/api/v1/enrich/people/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": DEV_BYPASS_TOKEN,
        },
        body: JSON.stringify(bulkPeoplePayload),
      });
      assert(paidRes.status === 200, `Expected 200, got ${paidRes.status}`);
      const paidData = await paidRes.json();
      assert(paidData.submitted_count === 3, `Expected submitted_count: 3, got ${paidData.submitted_count}`);
      results.push({ id: "S5", name: "Bulk Person dynamic pricing: 3 records quoted 75000 units and settled", passed: true });
    } catch (err: any) {
      results.push({ id: "S5", name: "Bulk Person dynamic pricing check", passed: false, error: err.message });
    }
  }

  // S11: Live mode with invalid key -> 502 with no settlement (run via --only S11)
  if (shouldRun("S11")) {
    const testRoutes = [
      { route: "/api/v1/search/people", body: { organization_domains: ["stripe.com"] } },
      { route: "/api/v1/search/organizations", body: { organization_name: "Stripe" } },
      { route: "/api/v1/enrich/person", body: { domain: "stripe.com", first_name: "Patrick", last_name: "Collison" } },
      { route: "/api/v1/enrich/organization", body: { domain: "stripe.com" } },
      { route: "/api/v1/enrich/people/bulk", body: { details: [{ domain: "stripe.com", first_name: "Patrick" }] } },
      { route: "/api/v1/enrich/organizations/bulk", body: { domains: ["stripe.com"] } },
    ];

    for (const t of testRoutes) {
      try {
        const res = await fetch(`${baseUrl}${t.route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": DEV_BYPASS_TOKEN,
          },
          body: JSON.stringify(t.body),
        });
        assert(res.status === 502, `Expected 502 on invalid API key, got ${res.status}`);
        const settledHeader = res.headers.get("x-payment-settled");
        assert(settledHeader !== "true", `Expected X-Payment-Settled not true, got ${settledHeader}`);
        results.push({ id: "S11", name: `[${t.route}] Invalid upstream key returns 502 with no settlement`, passed: true });
      } catch (err: any) {
        results.push({ id: "S11", name: `[${t.route}] Invalid upstream key returns 502 with no settlement`, passed: false, error: err.message });
      }
    }
  }

  // S13: Production mode with missing/empty key -> in-process F1 guards + unpaid probe returns 402 (run via --only S13)
  if (shouldRun("S13")) {
    // In-process unit assertions: connector throws and mock output is blocked in production
    try {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalVercelEnv = process.env.VERCEL_ENV;
      const originalKey = process.env.APOLLO_API_KEY;
      const originalMock = process.env.APOLLO_MOCK_MODE;

      try {
        (process.env as any).NODE_ENV = "production";
        delete process.env.APOLLO_MOCK_MODE;
        delete process.env.APOLLO_API_KEY;
        delete process.env.VERCEL_ENV;

        assert(
          isApolloMockMode() === false,
          "Expected isApolloMockMode() === false in production with empty key"
        );
        await assertRejects(
          () => enrichPersonWithApollo({ first_name: "A", last_name: "B", domain: "stripe.com" }),
          /APOLLO_API_KEY/
        );
        assert(
          isMockOutputBlockedInProduction({ source: "apollo_mock" }) === true,
          "Expected isMockOutputBlockedInProduction({ source: 'apollo_mock' }) === true in production"
        );
        assert(
          isMockOutputBlockedInProduction({ source: "apollo" }) === false,
          "Expected isMockOutputBlockedInProduction({ source: 'apollo' }) === false for live data"
        );

        results.push({
          id: "S13",
          name: "In-process F1: enrichPersonWithApollo throws without key & mock output blocked in production",
          passed: true,
        });
      } finally {
        (process.env as any).NODE_ENV = originalNodeEnv;
        if (originalVercelEnv !== undefined) process.env.VERCEL_ENV = originalVercelEnv; else delete process.env.VERCEL_ENV;
        if (originalKey !== undefined) process.env.APOLLO_API_KEY = originalKey; else delete process.env.APOLLO_API_KEY;
        if (originalMock !== undefined) process.env.APOLLO_MOCK_MODE = originalMock; else delete process.env.APOLLO_MOCK_MODE;
      }
    } catch (err: any) {
      results.push({
        id: "S13",
        name: "In-process F1: enrichPersonWithApollo throws without key & mock output blocked in production",
        passed: false,
        error: err.message,
      });
    }

    // Endpoint test against running server:
    // In production, DEV_BYPASS_TOKEN is disabled, so unpaid probe returns 402
    try {
      const res = await fetch(`${baseUrl}/api/v1/enrich/person`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": DEV_BYPASS_TOKEN,
        },
        body: JSON.stringify({
          first_name: "Patrick",
          last_name: "Collison",
          domain: "stripe.com",
        }),
      });

      assert(
        res.status === 402,
        `Expected 402 for unpaid probe in production, got ${res.status}`
      );
      const data = await res.json().catch(() => ({}));
      assert(
        data.payment_settled !== true,
        "Invariant violation: payment_settled was true in production mode without key"
      );
      results.push({
        id: "S13",
        name: "Unpaid probe returns 402 in production (bypass token disabled under NODE_ENV=production)",
        passed: true,
      });
    } catch (err: any) {
      results.push({
        id: "S13",
        name: "Unpaid probe returns 402 in production (bypass token disabled under NODE_ENV=production)",
        passed: false,
        error: err.message,
      });
    }
  }

  // Print results summary table
  console.log("\n==========================================================================================");
  console.log("SMOKE TEST RESULTS SUMMARY");
  console.log("==========================================================================================");
  let passedCount = 0;
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    if (r.passed) passedCount++;
    console.log(`${status} [${r.id}] ${r.name}`);
    if (r.error) console.log(`       Error: ${r.error}`);
  }
  console.log("==========================================================================================");
  console.log(`TOTAL: ${results.length} tests | ${passedCount} passed | ${results.length - passedCount} failed\n`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Smoke runner fatal error:", err);
  process.exit(1);
});
