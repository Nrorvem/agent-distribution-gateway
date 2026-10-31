/**
 * Staggered Settlement Runner (Random gaps between 2m and 25m)
 *
 * Usage:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/staggered-settlements.ts
 *   nohup /opt/homebrew/bin/node --experimental-strip-types scripts/staggered-settlements.ts > scripts/staggered-settlements.log 2>&1 &
 */

import fs from "node:fs";
import path from "node:path";
import { buildSignedX402PaymentHeader } from "../src/lib/eip3009-signer.ts";
import { checkUsdcBalances } from "./generate-test-wallets.ts";
import type { TestWallet } from "./generate-test-wallets.ts";

const WALLETS_FILE = path.resolve(process.cwd(), ".test-buyer-wallets.json");
const LOG_FILE = path.resolve(process.cwd(), "scripts/staggered-settlements.log");
const PRODUCTION_ENDPOINT =
  process.env.GATEWAY_ENDPOINT || "https://enrichmatch.dev/api/v1/enrich/person";

const PROFILES = [
  { first_name: "Dara", last_name: "Khosrowshahi", domain: "uber.com" },
  { first_name: "Alexis", last_name: "Ohanian", domain: "776.org" },
  { first_name: "Drew", last_name: "Houston", domain: "dropbox.com" },
];

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

function getRandomGapSec(minMin = 2, maxMin = 25): number {
  const minSec = minMin * 60;
  const maxSec = maxMin * 60;
  return Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
}

async function settleOne(wallet: TestWallet, profile: (typeof PROFILES)[0], txNum: number, total: number) {
  log(`--------------------------------------------------------------------------------`);
  log(`▶️  Executing [${txNum}/${total}]: Wallet #${wallet.index} (${wallet.address})`);
  log(`   Prospect: ${profile.first_name} ${profile.last_name} (${profile.domain})`);

  try {
    const chRes = await fetch(PRODUCTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });

    if (chRes.status !== 402) {
      throw new Error(`Expected HTTP 402, got HTTP ${chRes.status}`);
    }

    const challenge = (await chRes.json()) as Record<string, any>;
    const terms = challenge.accepts?.[0];
    const atomicAmount = String(terms?.amount || "30000");

    const signed = buildSignedX402PaymentHeader({
      privateKeyHex: wallet.privateKey,
      network: terms.network || "eip155:8453",
      usdcAddress: terms.asset,
      payTo: terms.payTo,
      valueAtomic: atomicAmount,
      resourceUrl: challenge.resource?.url || PRODUCTION_ENDPOINT,
      description: challenge.resource?.description,
      tokenName: terms.extra?.name || "USD Coin",
      tokenVersion: terms.extra?.version || "2",
      extensions: challenge.extensions,
    });

    const enrichRes = await fetch(PRODUCTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": signed.headerBase64,
      },
      body: JSON.stringify(profile),
    });

    const enrichData = (await enrichRes.json()) as Record<string, any>;

    if (enrichRes.status === 200 && enrichData.payment_settled) {
      const txHash = enrichData.receipt?.tx_hash;
      const email = enrichData.person?.email;
      log(`   ✅ Succeeded! Match: ${enrichData.person?.full_name} (${email})`);
      log(`   🪙 Settled $0.03 USDC to Ledger: ${terms.payTo}`);
      log(`   🔗 Tx Hash  : ${txHash}`);
      log(`   🌐 BaseScan : https://basescan.org/tx/${txHash}`);
      return { success: true, txHash, email, wallet };
    } else {
      const err = enrichData.error || `HTTP ${enrichRes.status}`;
      log(`   ❌ Settlement failed: ${err}`);
      return { success: false, error: err, wallet };
    }
  } catch (err: any) {
    log(`   ❌ Error: ${err.message}`);
    return { success: false, error: err.message, wallet };
  }
}

async function main() {
  if (!fs.existsSync(WALLETS_FILE)) {
    log("❌ No .test-buyer-wallets.json found.");
    process.exit(1);
  }

  const wallets: TestWallet[] = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
  log(`================================================================================`);
  log(`🌐 STAGGERED SETTLEMENT RUNNER: ${PRODUCTION_ENDPOINT}`);
  log(`================================================================================`);

  const balances = await checkUsdcBalances(wallets);
  const funded = balances.filter((b) => b.balanceAtomic >= 30000n);

  if (funded.length < 3) {
    log(`⚠️  Need at least 3 funded wallets, found ${funded.length}.`);
    process.exit(1);
  }

  const targets = funded.slice(0, 3);
  log(`Selected 3 funded wallets for staggered execution:`);
  for (let i = 0; i < targets.length; i++) {
    log(`  [${i + 1}] Wallet #${targets[i].wallet.index} (${targets[i].wallet.address}) - $${targets[i].balanceUsd}`);
  }

  // Pre-calculate random gaps between 2m (120s) and 25m (1500s)
  const gap1Sec = getRandomGapSec(2, 25);
  const gap2Sec = getRandomGapSec(2, 25);

  log(`\nSchedule plan:`);
  log(`• Settlement #1: Executing IMMEDIATELY`);
  log(`• Gap #1: ${(gap1Sec / 60).toFixed(1)} minutes (${gap1Sec}s)`);
  log(`• Settlement #2: Scheduled at ~${new Date(Date.now() + gap1Sec * 1000).toLocaleTimeString()}`);
  log(`• Gap #2: ${(gap2Sec / 60).toFixed(1)} minutes (${gap2Sec}s)`);
  log(`• Settlement #3: Scheduled at ~${new Date(Date.now() + (gap1Sec + gap2Sec) * 1000).toLocaleTimeString()}\n`);

  // Execute Tx 1
  const res1 = await settleOne(targets[0].wallet, PROFILES[0], 1, 3);

  // Wait Gap 1
  log(`⏳ Waiting ${(gap1Sec / 60).toFixed(1)}m (${gap1Sec}s) before Settlement #2...`);
  await new Promise((r) => setTimeout(r, gap1Sec * 1000));

  // Execute Tx 2
  const res2 = await settleOne(targets[1].wallet, PROFILES[1], 2, 3);

  // Wait Gap 2
  log(`⏳ Waiting ${(gap2Sec / 60).toFixed(1)}m (${gap2Sec}s) before Settlement #3...`);
  await new Promise((r) => setTimeout(r, gap2Sec * 1000));

  // Execute Tx 3
  const res3 = await settleOne(targets[2].wallet, PROFILES[2], 3, 3);

  log(`\n================================================================================`);
  log(`🎉 STAGGERED SETTLEMENT COMPLETE`);
  log(`================================================================================`);
  log(`Settlement #1 (Wallet #${targets[0].wallet.index}): https://basescan.org/tx/${res1.txHash}`);
  log(`Settlement #2 (Wallet #${targets[1].wallet.index}): https://basescan.org/tx/${res2.txHash}`);
  log(`Settlement #3 (Wallet #${targets[2].wallet.index}): https://basescan.org/tx/${res3.txHash}`);
  log(`Total USDC recycled to Ledger: $0.09 USDC`);
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  console.error(err);
});
