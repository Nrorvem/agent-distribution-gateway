/**
 * Batch Settlement Runner for Multiple Test Buyer Wallets
 *
 * Loops through the 10 test wallets in .test-buyer-wallets.json.
 * For each wallet with Base Mainnet USDC >= $0.03:
 * 1. Queries https://enrichmatch.dev/api/v1/enrich/person for x402 challenge terms.
 * 2. Signs EIP-3009 TransferWithAuthorization off-chain (gasless).
 * 3. Sends POST with PAYMENT-SIGNATURE header.
 * 4. Resolves enrichment match with Apollo & settles $0.03 USDC on-chain via Coinbase CDP Facilitator.
 * 5. Settles $0.03 USDC directly to user's Ledger (0x7C38...0AbC).
 * 6. Logs txHash, BaseScan link, and triggers Coinbase CDP Bazaar indexing.
 *
 * Usage:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/batch-settle-buyers.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildSignedX402PaymentHeader,
  privateKeyToAddress,
} from "../src/lib/eip3009-signer.ts";
import { checkUsdcBalances } from "./generate-test-wallets.ts";
import type { TestWallet } from "./generate-test-wallets.ts";

const WALLETS_FILE = path.resolve(process.cwd(), ".test-buyer-wallets.json");
const PRODUCTION_ENDPOINT =
  process.env.GATEWAY_ENDPOINT || "https://enrichmatch.dev/api/v1/enrich/person";

// 10 high-confidence executive profiles that Apollo resolves with 100% deliverable work emails
const PROFILES = [
  { first_name: "Fidji", last_name: "Simo", domain: "instacart.com" },
  { first_name: "Brian", last_name: "Chesky", domain: "airbnb.com" },
  { first_name: "Patrick", last_name: "Collison", domain: "stripe.com" },
  { first_name: "Marc", last_name: "Benioff", domain: "salesforce.com" },
  { first_name: "Jensen", last_name: "Huang", domain: "nvidia.com" },
  { first_name: "Satya", last_name: "Nadella", domain: "microsoft.com" },
  { first_name: "Sam", last_name: "Altman", domain: "openai.com" },
  { first_name: "Dara", last_name: "Khosrowshahi", domain: "uber.com" },
  { first_name: "Alexis", last_name: "Ohanian", domain: "776.org" },
  { first_name: "Drew", last_name: "Houston", domain: "dropbox.com" },
];

async function main() {
  if (!fs.existsSync(WALLETS_FILE)) {
    console.error("❌ No .test-buyer-wallets.json found. Run scripts/generate-test-wallets.ts first.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const countFlagIdx = args.findIndex((a) => a === "--count" || a === "--limit");
  const countLimit =
    countFlagIdx !== -1 && args[countFlagIdx + 1]
      ? parseInt(args[countFlagIdx + 1], 10)
      : undefined;

  const delayFlagIdx = args.findIndex((a) => a === "--delay" || a === "--cooldown");
  const delaySec =
    delayFlagIdx !== -1 && args[delayFlagIdx + 1]
      ? parseInt(args[delayFlagIdx + 1], 10)
      : 5;

  const walletFlagIdx = args.findIndex((a) => a === "--wallet" || a === "--target");
  const targetWalletIndex =
    walletFlagIdx !== -1 && args[walletFlagIdx + 1]
      ? parseInt(args[walletFlagIdx + 1], 10)
      : undefined;

  const repeatFlagIdx = args.findIndex((a) => a === "--repeat" || a === "--times");
  const repeatCount =
    repeatFlagIdx !== -1 && args[repeatFlagIdx + 1]
      ? parseInt(args[repeatFlagIdx + 1], 10)
      : 1;

  const wallets: TestWallet[] = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
  console.log("================================================================================");
  console.log(`🌐 BATCH SETTLEMENT RUNNER: ${PRODUCTION_ENDPOINT}`);
  console.log(`Loaded ${wallets.length} test buyer wallets (Limit: ${countLimit || "All"})`);
  console.log("================================================================================\n");

  console.log("1️⃣  Scanning test buyer wallet balances on Base Mainnet...");
  const balances = await checkUsdcBalances(wallets);
  let funded = balances.filter((b) => b.balanceAtomic >= 30000n);

  console.log(
    `Found ${funded.length} of ${wallets.length} wallets ready for on-chain settlement ($0.03+ USDC).\n`
  );

  if (funded.length === 0) {
    console.log("⚠️  No funded test wallets found.");
    console.log("Fund any of the addresses printed by `scripts/generate-test-wallets.ts` and re-run.");
    return;
  }

  // Single-wallet multi-transaction mode (e.g., --wallet 3 --repeat 5)
  if (targetWalletIndex !== undefined) {
    const target = wallets.find((w) => w.index === targetWalletIndex);
    if (!target) {
      console.error(`❌ Wallet #${targetWalletIndex} not found in .test-buyer-wallets.json.`);
      process.exit(1);
    }

    console.log(`🎯 Targeting Single Wallet #${target.index} (${target.address})`);
    console.log(`🔁 Repeating ${repeatCount} consecutive transaction(s) to simulate real multi-call buyer...\n`);

    const results: Array<{
      iteration: number;
      txHash?: string;
      email?: string;
      success: boolean;
      error?: string;
    }> = [];

    // Profiles 2 through 6 for variety
    const singleWalletProfiles = [
      { first_name: "Patrick", last_name: "Collison", domain: "stripe.com" },
      { first_name: "Marc", last_name: "Benioff", domain: "salesforce.com" },
      { first_name: "Jensen", last_name: "Huang", domain: "nvidia.com" },
      { first_name: "Satya", last_name: "Nadella", domain: "microsoft.com" },
      { first_name: "Sam", last_name: "Altman", domain: "openai.com" },
      { first_name: "Fidji", last_name: "Simo", domain: "instacart.com" },
      { first_name: "Brian", last_name: "Chesky", domain: "airbnb.com" },
      { first_name: "Dara", last_name: "Khosrowshahi", domain: "uber.com" },
    ];

    for (let i = 1; i <= repeatCount; i++) {
      const profile = singleWalletProfiles[(i - 1) % singleWalletProfiles.length];
      console.log("--------------------------------------------------------------------------------");
      console.log(
        `▶️  [Tx ${i}/${repeatCount}] Wallet #${target.index} -> Prospect: ${profile.first_name} ${profile.last_name} (${profile.domain})`
      );

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
          privateKeyHex: target.privateKey,
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
          console.log(`   ✅ Succeeded! Match: ${enrichData.person?.full_name} (${email})`);
          console.log(`   🪙 Settled $0.03 USDC to Ledger: ${terms.payTo}`);
          console.log(`   🔗 Tx Hash  : ${txHash}`);
          console.log(`   🌐 BaseScan : https://basescan.org/tx/${txHash}`);
          results.push({ iteration: i, txHash, email, success: true });
        } else {
          const err = enrichData.error || `HTTP ${enrichRes.status}`;
          console.log(`   ❌ Settlement failed: ${err}`);
          results.push({ iteration: i, success: false, error: err });
        }
      } catch (err: any) {
        console.log(`   ❌ Error: ${err.message}`);
        results.push({ iteration: i, success: false, error: err.message });
      }

      if (i < repeatCount && delaySec > 0) {
        console.log(`   ⏳ Pausing ${delaySec}s before next consecutive settlement...\n`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }

    console.log("\n================================================================================");
    console.log(`MULTI-CALL SUMMARY FOR WALLET #${target.index} (${target.address})`);
    console.log("================================================================================");
    const succeeded = results.filter((r) => r.success);
    console.log(`Total Settlements Attempted : ${results.length}`);
    console.log(`Successful Settlements      : ${succeeded.length}`);
    console.log(`Total USDC Recycled to Ledger : $${(succeeded.length * 0.03).toFixed(2)} USDC\n`);

    for (const r of succeeded) {
      console.log(`• Tx #${r.iteration}: https://basescan.org/tx/${r.txHash}`);
    }

    console.log("\nQuerying updated Coinbase CDP x402 Bazaar telemetry...");
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
        console.log(`• enrichmatch.dev Last Updated: ${emResource.lastUpdated}`);
        console.log(`• Quality Metrics             : ${JSON.stringify(emResource.quality)}`);
      }
    } catch {
      // Ignore
    }
    return;
  }

  const results: Array<{
    wallet: TestWallet;
    txHash?: string;
    email?: string;
    success: boolean;
    error?: string;
  }> = [];

  let profileIndex = 0;

  for (const item of funded) {
    const { wallet } = item;
    const profile = PROFILES[profileIndex % PROFILES.length];
    profileIndex++;

    console.log("--------------------------------------------------------------------------------");
    console.log(
      `▶️  Processing Wallet #${wallet.index} (${wallet.address}) -> Prospect: ${profile.first_name} ${profile.last_name} (${profile.domain})`
    );

    try {
      // 1. Fetch live challenge
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

      // 2. Sign EIP-3009 TransferWithAuthorization
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

      // 3. Submit payment
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
        console.log(`   ✅ Succeeded! Match: ${enrichData.person?.full_name} (${email})`);
        console.log(`   🪙 Settled $0.03 USDC to Ledger: ${terms.payTo}`);
        console.log(`   🔗 Tx Hash  : ${txHash}`);
        console.log(`   🌐 BaseScan : https://basescan.org/tx/${txHash}`);
        results.push({ wallet, txHash, email, success: true });
      } else {
        const err = enrichData.error || `HTTP ${enrichRes.status}`;
        console.log(`   ❌ Settlement failed: ${err}`);
        results.push({ wallet, success: false, error: err });
      }
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message}`);
      results.push({ wallet, success: false, error: err.message });
    }

    // Cooldown between on-chain facilitator settlements
    if (delaySec > 0) {
      console.log(`   ⏳ Pausing ${delaySec}s before next transaction...\n`);
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
  }

  console.log("\n================================================================================");
  console.log("BATCH SETTLEMENT SUMMARY");
  console.log("================================================================================");
  const succeeded = results.filter((r) => r.success);
  console.log(`Total Attempted : ${results.length}`);
  console.log(`Successful      : ${succeeded.length}`);
  console.log(`Failed          : ${results.length - succeeded.length}`);
  console.log(`Total USDC recycled to Ledger: $${(succeeded.length * 0.03).toFixed(2)} USDC\n`);

  for (const r of succeeded) {
    console.log(`• Wallet #${r.wallet.index} (${r.wallet.address.slice(0, 10)}...): https://basescan.org/tx/${r.txHash}`);
  }

  console.log("\nQuerying updated Coinbase CDP x402 Bazaar telemetry...");
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
      console.log(`• enrichmatch.dev Last Updated: ${emResource.lastUpdated}`);
      console.log(`• Quality Metrics             : ${JSON.stringify(emResource.quality)}`);
    }
  } catch {
    // Ignore
  }
}

main().catch(console.error);
