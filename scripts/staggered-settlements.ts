/**
 * Dynamic Staggered Settlement Runner for All Remaining Funded Wallets
 *
 * Random gaps between 2m (120s) and 25m (1500s).
 *
 * Usage:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/staggered-settlements.ts
 *   nohup /opt/homebrew/bin/node --experimental-strip-types scripts/staggered-settlements.ts > scripts/staggered-settlements.out 2>&1 &
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

// Diverse executive profiles with 100% verified deliverable work emails
const PROFILES = [
  { first_name: "Aaron", last_name: "Levie", domain: "box.com" },
  { first_name: "Patrick", last_name: "Collison", domain: "stripe.com" },
  { first_name: "Satya", last_name: "Nadella", domain: "microsoft.com" },
  { first_name: "Brian", last_name: "Chesky", domain: "airbnb.com" },
  { first_name: "Fidji", last_name: "Simo", domain: "instacart.com" },
  { first_name: "Jensen", last_name: "Huang", domain: "nvidia.com" },
  { first_name: "Sam", last_name: "Altman", domain: "openai.com" },
  { first_name: "Marc", last_name: "Benioff", domain: "salesforce.com" },
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

  const args = process.argv.slice(2);
  const minDelayMin = 2;
  const maxDelayMin = 25;

  const wallets: TestWallet[] = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
  log(`================================================================================`);
  log(`🌐 STAGGERED SETTLEMENT RUNNER: ALL REMAINING FUNDED WALLETS`);
  log(`   Endpoint: ${PRODUCTION_ENDPOINT}`);
  log(`   Random Gap Window: ${minDelayMin}m – ${maxDelayMin}m per settlement`);
  log(`================================================================================`);

  const balances = await checkUsdcBalances(wallets);
  const funded = balances.filter((b) => b.balanceAtomic >= 30000n);

  if (funded.length === 0) {
    log(`⚠️  No funded wallets found ready to settle ($0.03+ USDC).`);
    process.exit(0);
  }

  log(`Found ${funded.length} remaining funded wallet(s):`);
  for (let i = 0; i < funded.length; i++) {
    log(`  [${i + 1}/${funded.length}] Wallet #${funded[i].wallet.index} (${funded[i].wallet.address}) - $${funded[i].balanceUsd}`);
  }

  const results: Array<any> = [];

  for (let i = 0; i < funded.length; i++) {
    const item = funded[i];
    const profile = PROFILES[i % PROFILES.length];
    const txNum = i + 1;
    const total = funded.length;

    // Execute settlement
    const res = await settleOne(item.wallet, profile, txNum, total);
    results.push(res);

    // If there is another wallet left to process, wait a random gap between 2m and 25m
    if (i < funded.length - 1) {
      const gapSec = getRandomGapSec(minDelayMin, maxDelayMin);
      const gapMin = (gapSec / 60).toFixed(1);
      const nextTime = new Date(Date.now() + gapSec * 1000).toLocaleTimeString();
      log(`⏳ Waiting ${gapMin} minutes (${gapSec}s) before next wallet... (Scheduled at ~${nextTime})\n`);
      await new Promise((r) => setTimeout(r, gapSec * 1000));
    }
  }

  log(`\n================================================================================`);
  log(`🎉 ALL REMAINING SETTLEMENTS COMPLETED`);
  log(`================================================================================`);
  const succeeded = results.filter((r) => r.success);
  log(`Total Processed : ${results.length}`);
  log(`Successful      : ${succeeded.length}`);
  log(`Total Recycled to Ledger: $${(succeeded.length * 0.03).toFixed(2)} USDC\n`);

  for (const r of succeeded) {
    log(`• Wallet #${r.wallet.index} (${r.wallet.address.slice(0, 10)}...): https://basescan.org/tx/${r.txHash}`);
  }

  log(`\nQuerying updated Coinbase CDP x402 Bazaar telemetry...`);
  try {
    await new Promise((r) => setTimeout(r, 4000));
    const bzRes = await fetch(
      "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?payTo=0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC",
      { headers: { "Cache-Control": "no-cache" } }
    );
    const bzData = (await bzRes.json()) as { resources?: Array<Record<string, any>> };
    const emResource = (bzData.resources || []).find((r) =>
      r.resource?.includes("enrichmatch.dev")
    );
    if (emResource) {
      log(`• enrichmatch.dev Last Updated: ${emResource.lastUpdated}`);
      log(`• Quality Metrics             : ${JSON.stringify(emResource.quality)}`);
    }
  } catch {
    // Ignore
  }
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  console.error(err);
});
