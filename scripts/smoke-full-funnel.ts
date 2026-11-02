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
import { usdToAtomicUnits, lockPaymentAuthorization } from "../src/lib/x402-gate.ts";

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

function shouldRun(testId: string): boolean {
  if (onlyTestId) {
    return onlyTestId === testId;
  }
  if (unpaidOnly) {
    return ["S1", "S2", "S6", "S7", "S8", "S9"].includes(testId);
  }
  // S11 is only run when explicitly targeted via --only S11
  if (testId === "S11") return false;
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

    // S9: Header size check (< 7 KB base64)
    if (shouldRun("S9")) {
      try {
        const res = await fetch(`${baseUrl}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const header = res.headers.get("payment-required") || "";
        const sizeBytes = Buffer.byteLength(header, "utf-8");
        assert(sizeBytes < 7168, `Header size ${sizeBytes} bytes exceeds 7 KB limit`);
        results.push({ id: "S9", name: `${tag} PAYMENT-REQUIRED header size < 7 KB (${sizeBytes} bytes)`, passed: true });
      } catch (err: any) {
        results.push({ id: "S9", name: `${tag} PAYMENT-REQUIRED header size < 7 KB`, passed: false, error: err.message });
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
