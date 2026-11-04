/**
 * Durable Storage & Concurrency Smoke Test Suite
 *
 * Verifies:
 * 1. In-memory nonce lock lifecycle (lock -> duplicate rejected -> release -> consumed).
 * 2. Parallel concurrency race (5 concurrent calls with same authorization -> exactly 1 lock, 4 rejected).
 * 3. Upstash Redis REST API protocol integration (simulated Upstash server):
 *    - Atomic SET NX EX locking
 *    - Permanent SET consumed marking
 *    - Pipeline LPUSH + LTRIM + SADD for settlement telemetry
 *    - LRANGE persistent telemetry retrieval surviving cold starts
 *    - High-concurrency race over simulated Redis (10 concurrent requests -> exactly 1 succeeds)
 * 4. Error resilience: memory fallback in local/preview; fail-closed (retryable) in production.
 * 5. Dev-bypass / simulated entries never reach Redis or published telemetry.
 * 6. Telemetry keys are environment-scoped; nonce locks are shared across environments.
 */

import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  lockPaymentAuthorization,
  checkPaymentAuthorizationLock,
  markPaymentAuthorizationConsumed,
  releasePaymentAuthorization,
  recordAuditLog,
  loadRecentAuditLogs,
  getVerifiableTelemetrySummary,
  isTxHashRedeemed,
} from "../src/lib/x402-storage.ts";

async function runTests() {
  // Isolate disk fallback (`.audit-logs.json` resolves from cwd) so tests never touch the real local file.
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "x402-storage-test-")));
  console.log("🧪 Running Durable Storage & Concurrency Test Suite...\n");

  // -------------------------------------------------------------------------
  // Test 1: In-Memory Nonce Lock Lifecycle
  // -------------------------------------------------------------------------
  console.log("1️⃣  Testing In-Memory Nonce Lock Lifecycle...");
  const payer1 = "0xInMemoryBuyer1";
  const nonce1 = `0xnonce_${Date.now()}_1`;
  const validBefore1 = Math.floor(Date.now() / 1000) + 300;

  const firstLock = await lockPaymentAuthorization(payer1, nonce1, validBefore1, null);
  assert.strictEqual(firstLock.allowed, true, "First lock should succeed");
  assert(firstLock.key.includes(payer1.toLowerCase()), "Key should contain payer");

  const dupLock = await lockPaymentAuthorization(payer1, nonce1, validBefore1, null);
  assert.strictEqual(dupLock.allowed, false, "Duplicate lock must be rejected");
  assert.strictEqual(dupLock.error, "Payment authorization already used");

  // Release lock
  await releasePaymentAuthorization(firstLock.key, null);
  const reLock = await lockPaymentAuthorization(payer1, nonce1, validBefore1, null);
  assert.strictEqual(reLock.allowed, true, "Lock should succeed after release");

  // Mark consumed
  await markPaymentAuthorizationConsumed(reLock.key, validBefore1, null);
  const afterConsumed = await lockPaymentAuthorization(payer1, nonce1, validBefore1, null);
  assert.strictEqual(afterConsumed.allowed, false, "Consumed authorization cannot be relocked");
  console.log("   ✅ In-Memory lifecycle passed.\n");

  // -------------------------------------------------------------------------
  // Test 2: In-Memory High-Concurrency Race (5 parallel requests)
  // -------------------------------------------------------------------------
  console.log("2️⃣  Testing In-Memory Parallel Concurrency Race (5 simultaneous callers)...");
  const payer2 = "0xRaceBuyerInMemory";
  const nonce2 = `0xnonce_race_${Date.now()}`;
  const validBefore2 = Math.floor(Date.now() / 1000) + 300;

  const parallelResults = await Promise.all([
    lockPaymentAuthorization(payer2, nonce2, validBefore2, null),
    lockPaymentAuthorization(payer2, nonce2, validBefore2, null),
    lockPaymentAuthorization(payer2, nonce2, validBefore2, null),
    lockPaymentAuthorization(payer2, nonce2, validBefore2, null),
    lockPaymentAuthorization(payer2, nonce2, validBefore2, null),
  ]);

  const inMemSuccesses = parallelResults.filter((r) => r.allowed).length;
  const inMemRejections = parallelResults.filter((r) => !r.allowed && r.error === "Payment authorization already used").length;

  assert.strictEqual(inMemSuccesses, 1, `Expected exactly 1 success, got ${inMemSuccesses}`);
  assert.strictEqual(inMemRejections, 4, `Expected exactly 4 rejections, got ${inMemRejections}`);
  console.log("   ✅ Exactly 1 won race, 4 rejected.\n");

  // -------------------------------------------------------------------------
  // Test 3: Upstash Redis REST Protocol Simulation
  // -------------------------------------------------------------------------
  console.log("3️⃣  Testing Upstash Redis REST Protocol Simulation...");

  // Mock Upstash Redis state
  const mockKvStore = new Map<string, { value: string; expiresAt?: number }>();
  const mockLists = new Map<string, string[]>();
  const mockSets = new Map<string, Set<string>>();

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      assert(req.headers.authorization?.startsWith("Bearer "), "Missing Bearer auth");
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/pipeline") {
        const commands = JSON.parse(body) as (string | number)[][];
        const results = commands.map((cmd) => {
          const [op, ...args] = cmd;
          if (op === "LPUSH") {
            const listKey = String(args[0]);
            const val = String(args[1]);
            if (!mockLists.has(listKey)) mockLists.set(listKey, []);
            mockLists.get(listKey)!.unshift(val);
            return { result: mockLists.get(listKey)!.length };
          }
          if (op === "LTRIM") {
            const listKey = String(args[0]);
            const start = Number(args[1]);
            const stop = Number(args[2]);
            const list = mockLists.get(listKey) || [];
            mockLists.set(listKey, list.slice(start, stop + 1));
            return { result: "OK" };
          }
          if (op === "SADD") {
            const setKey = String(args[0]);
            const val = String(args[1]);
            if (!mockSets.has(setKey)) mockSets.set(setKey, new Set());
            const set = mockSets.get(setKey)!;
            const added = set.has(val) ? 0 : 1;
            set.add(val);
            return { result: added };
          }
          return { error: `Unsupported pipeline command ${op}` };
        });
        res.end(JSON.stringify(results));
        return;
      }

      // Single command
      const [op, ...args] = JSON.parse(body) as (string | number)[];
      if (op === "SET") {
        const key = String(args[0]);
        const val = String(args[1]);
        const hasNx = args.includes("NX");
        const exIdx = args.indexOf("EX");
        const ttlSec = exIdx !== -1 ? Number(args[exIdx + 1]) : undefined;

        if (hasNx && mockKvStore.has(key)) {
          // NX condition failed
          res.end(JSON.stringify({ result: null }));
          return;
        }

        mockKvStore.set(key, {
          value: val,
          expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : undefined,
        });
        res.end(JSON.stringify({ result: "OK" }));
        return;
      }

      if (op === "GET") {
        const key = String(args[0]);
        const entry = mockKvStore.get(key);
        res.end(JSON.stringify({ result: entry ? entry.value : null }));
        return;
      }

      if (op === "DEL") {
        const key = String(args[0]);
        const deleted = mockKvStore.delete(key) ? 1 : 0;
        res.end(JSON.stringify({ result: deleted }));
        return;
      }

      if (op === "LRANGE") {
        const listKey = String(args[0]);
        const start = Number(args[1]);
        const stop = Number(args[2]);
        const list = mockLists.get(listKey) || [];
        res.end(JSON.stringify({ result: list.slice(start, stop === -1 ? undefined : stop + 1) }));
        return;
      }

      if (op === "SISMEMBER") {
        const setKey = String(args[0]);
        const val = String(args[1]);
        const set = mockSets.get(setKey);
        res.end(JSON.stringify({ result: set && set.has(val) ? 1 : 0 }));
        return;
      }

      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Unknown command ${op}` }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as any;
  const mockRedisConfig = {
    url: `http://127.0.0.1:${address.port}`,
    token: "mock_upstash_secret_token",
  };

  try {
    // 3a: Redis SET NX lock
    const payerRedis = "0xRedisBuyer";
    const nonceRedis = `0xredis_nonce_${Date.now()}`;
    const validBeforeRedis = Math.floor(Date.now() / 1000) + 300;

    const rLock1 = await lockPaymentAuthorization(payerRedis, nonceRedis, validBeforeRedis, mockRedisConfig);
    assert.strictEqual(rLock1.allowed, true, "Redis SET NX should acquire lock");

    const rLock2 = await lockPaymentAuthorization(payerRedis, nonceRedis, validBeforeRedis, mockRedisConfig);
    assert.strictEqual(rLock2.allowed, false, "Redis SET NX duplicate must fail");
    assert.strictEqual(rLock2.error, "Payment authorization already used");

    // 3b: 10 parallel callers racing for the same authorization against Redis
    const raceNonce = `0xredis_race_${Date.now()}`;
    const raceCalls = Array.from({ length: 10 }, () =>
      lockPaymentAuthorization("0xMultiPayer", raceNonce, validBeforeRedis, mockRedisConfig)
    );
    const raceRes = await Promise.all(raceCalls);
    const rSuccess = raceRes.filter((r) => r.allowed).length;
    const rReject = raceRes.filter((r) => !r.allowed).length;

    assert.strictEqual(rSuccess, 1, `Expected exactly 1 Redis lock success, got ${rSuccess}`);
    assert.strictEqual(rReject, 9, `Expected exactly 9 Redis lock rejections, got ${rReject}`);
    console.log("   ✅ 10 parallel callers against Redis: exactly 1 won, 9 rejected.");

    // 3c: Mark consumed
    await markPaymentAuthorizationConsumed(rLock1.key, validBeforeRedis, mockRedisConfig);
    const checkAfterConsumed = await checkPaymentAuthorizationLock(payerRedis, nonceRedis, mockRedisConfig);
    assert.strictEqual(checkAfterConsumed.allowed, false, "Consumed authorization rejected in check");

    // 3d: Settlement telemetry via pipeline LPUSH + LTRIM + SADD
    const sampleReceipt = await recordAuditLog(
      {
        vertical: "option-a-apollo",
        tool: "enrich_person",
        payer: "0xPersistentPayer",
        amount_usd: "0.03",
        network: "eip155:8453",
        tx_hash: "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
        verification_mode: "facilitator_onchain",
        matched: true,
        latency_ms: 450,
      },
      mockRedisConfig
    );

    assert(sampleReceipt.receipt_id.startsWith("rcpt_"), "Receipt ID should be generated");

    // Verify SISMEMBER for redeemed tx hash
    const isRedeemed = await isTxHashRedeemed(
      "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      mockRedisConfig
    );
    assert.strictEqual(isRedeemed, true, "txHash should be marked redeemed in Redis");

    // Verify LRANGE retrieval and telemetry summary
    const telemetry = await getVerifiableTelemetrySummary(mockRedisConfig);
    assert(telemetry.totalCompletedTransactions >= 1, "Should count completed transactions");
    assert(telemetry.recentSettlementTxHashes.includes(sampleReceipt.tx_hash), "Telemetry should include recent txHash");
    assert.strictEqual(telemetry.recentSettlementProofs[0].tx_hash, sampleReceipt.tx_hash);
    console.log("   ✅ Pipeline settlement & persistent telemetry retrieval verified.\n");

    // -----------------------------------------------------------------------
    // Test 4: Fault Tolerance (Redis down -> fallback to local memory)
    // -----------------------------------------------------------------------
    console.log("4️⃣  Testing Fault Tolerance (unreachable Redis host)...");
    const badConfig = {
      url: "http://127.0.0.1:1", // guaranteed unreachable port
      token: "dummy",
    };

    const origVercelEnv = process.env.VERCEL_ENV;
    try {
      // 4a: local dev / preview keep the in-memory fallback
      for (const env of [undefined, "preview"]) {
        if (env === undefined) delete process.env.VERCEL_ENV;
        else process.env.VERCEL_ENV = env;
        const fallbackLock = await lockPaymentAuthorization(
          "0xFallbackBuyer",
          `0xfallback_nonce_${env}_${Date.now()}`,
          Math.floor(Date.now() / 1000) + 300,
          badConfig
        );
        assert.strictEqual(fallbackLock.allowed, true, `Should fall back to in-memory lock when Redis fails (env=${env})`);
      }
      console.log("   ✅ Local/preview: graceful in-memory fallback verified.");

      // 4b: production fails closed, marked retryable, and takes no lock
      process.env.VERCEL_ENV = "production";
      const prodNonce = `0xfailclosed_nonce_${Date.now()}`;
      const prodValidBefore = Math.floor(Date.now() / 1000) + 300;
      const closed = await lockPaymentAuthorization("0xFailClosedBuyer", prodNonce, prodValidBefore, badConfig);
      assert.strictEqual(closed.allowed, false, "Production must fail closed when Redis is unreachable");
      assert.strictEqual(closed.unavailable, true, "Fail-closed result must be flagged unavailable/retryable");
      assert.strictEqual(closed.error, "Payment lock unavailable, retry");

      // The failed attempt must not have left an in-memory lock behind: the same authorization
      // must be lockable once Redis is healthy again.
      const retry = await lockPaymentAuthorization("0xFailClosedBuyer", prodNonce, prodValidBefore, mockRedisConfig);
      assert.strictEqual(retry.allowed, true, "Retry after Redis recovers must succeed (no stale lock)");

      // Redis unconfigured (null) in production still uses memory (explicit no-Redis deployment)
      const noRedis = await lockPaymentAuthorization("0xNoRedisBuyer", `0xnoredis_${Date.now()}`, prodValidBefore, null);
      assert.strictEqual(noRedis.allowed, true, "Unconfigured Redis keeps the in-memory lock");
      console.log("   ✅ Production: fails closed (retryable), no stale lock, recovers on retry.\n");

      // -----------------------------------------------------------------------
      // Test 5: Only real on-chain settlements are stored and published
      // -----------------------------------------------------------------------
      console.log("5️⃣  Testing dev-bypass / simulated entries are never published...");
      delete process.env.VERCEL_ENV;
      const listKey = "x402:local:settlements";
      const before = (mockLists.get(listKey) || []).length;
      const base = {
        vertical: "option-a-apollo" as const,
        tool: "enrich_person",
        payer: "0xDevPayer",
        amount_usd: "0.03",
        network: "eip155:8453",
        matched: true,
        latency_ms: 10,
      };
      await recordAuditLog({ ...base, tx_hash: "0xsim_19a5c3d2", verification_mode: "dev_bypass_token" }, mockRedisConfig);
      await recordAuditLog({ ...base, tx_hash: "0xsim_19a5c3d3", verification_mode: "facilitator_onchain" }, mockRedisConfig);
      await recordAuditLog(
        { ...base, tx_hash: "0x" + "ab".repeat(32), verification_mode: "dev_bypass_token" },
        mockRedisConfig
      );
      assert.strictEqual((mockLists.get(listKey) || []).length, before, "No simulated entry may reach Redis");

      const summary = await getVerifiableTelemetrySummary(mockRedisConfig);
      const published = summary.recentSettlementTxHashes.join(",");
      assert(!published.includes("0xsim_"), "Simulated hashes must not be published");
      assert(!summary.recentSettlementTxHashes.includes("0x" + "ab".repeat(32)), "Dev-bypass entries must not be published");
      assert(
        summary.recentSettlementProofs.every((p) => /^0x[0-9a-f]{64}$/i.test(p.tx_hash)),
        "Every published proof must carry a real 32-byte tx hash"
      );
      // The disk/memory fallback is filtered the same way (no Redis configured)
      const noRedisSummary = await getVerifiableTelemetrySummary(null);
      assert(!noRedisSummary.recentSettlementTxHashes.join(",").includes("0xsim_"), "Fallback telemetry must also filter");
      console.log("   ✅ Simulated and dev-bypass entries excluded from Redis and from published telemetry.\n");

      // -----------------------------------------------------------------------
      // Test 6: Telemetry keys are environment-scoped; auth locks are shared
      // -----------------------------------------------------------------------
      console.log("6️⃣  Testing environment-scoped telemetry keys...");
      process.env.VERCEL_ENV = "production";
      const prodTx = "0x" + "cd".repeat(32);
      await recordAuditLog({ ...base, tx_hash: prodTx, verification_mode: "facilitator_onchain" }, mockRedisConfig);
      assert((mockLists.get("x402:production:settlements") || []).length >= 1, "Production writes x402:production:settlements");
      assert.strictEqual(await isTxHashRedeemed(prodTx, mockRedisConfig), true);

      // Simulate a different serverless instance: it shares neither this process's memory nor its disk cache.
      const resetInstance = () => {
        (globalThis as any).__x402AuditLogs = [];
        fs.rmSync(path.resolve(process.cwd(), ".audit-logs.json"), { force: true });
      };
      resetInstance();
      process.env.VERCEL_ENV = "preview";
      const previewSummary = await getVerifiableTelemetrySummary(mockRedisConfig);
      assert(!previewSummary.recentSettlementTxHashes.includes(prodTx), "Preview must not read production telemetry");

      resetInstance();
      delete process.env.VERCEL_ENV;
      const localSummary = await getVerifiableTelemetrySummary(mockRedisConfig);
      assert(!localSummary.recentSettlementTxHashes.includes(prodTx), "Local must not read production telemetry");

      // Auth locks are intentionally NOT env-scoped: same signature in two envs must still collide
      const sharedNonce = `0xshared_nonce_${Date.now()}`;
      process.env.VERCEL_ENV = "preview";
      const l1 = await lockPaymentAuthorization("0xSharedBuyer", sharedNonce, prodValidBefore, mockRedisConfig);
      process.env.VERCEL_ENV = "production";
      const l2 = await lockPaymentAuthorization("0xSharedBuyer", sharedNonce, prodValidBefore, mockRedisConfig);
      assert.strictEqual(l1.allowed, true);
      assert.strictEqual(l2.allowed, false, "Same EIP-3009 nonce must be rejected across environments");
      console.log("   ✅ Telemetry isolated per environment; nonce locks shared across environments.\n");
    } finally {
      if (origVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = origVercelEnv;
    }

  } finally {
    server.close();
  }

  console.log("🎉 All Durable Storage & Concurrency Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
