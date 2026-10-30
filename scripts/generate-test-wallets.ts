/**
 * Generates 10 cryptographically secure Base/Ethereum buyer wallets
 * and saves them to .test-buyer-wallets.json (git-ignored).
 *
 * Usage:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/generate-test-wallets.ts
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/generate-test-wallets.ts --force
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { privateKeyToAddress } from "../src/lib/eip3009-signer.ts";

export interface TestWallet {
  index: number;
  label: string;
  address: string;
  privateKey: string;
}

const WALLETS_FILE = path.resolve(process.cwd(), ".test-buyer-wallets.json");
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MERCHANT_LEDGER = "0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC";

export function generateWallets(count = 10): TestWallet[] {
  const wallets: TestWallet[] = [];
  for (let i = 1; i <= count; i++) {
    const privHex = "0x" + crypto.randomBytes(32).toString("hex");
    const address = privateKeyToAddress(privHex);
    wallets.push({
      index: i,
      label: `Buyer Agent #${i.toString().padStart(2, "0")}`,
      address,
      privateKey: privHex,
    });
  }
  return wallets;
}

export async function checkUsdcBalances(
  wallets: TestWallet[]
): Promise<Array<{ wallet: TestWallet; balanceAtomic: bigint; balanceUsd: string }>> {
  const results = [];
  for (const w of wallets) {
    try {
      const addrClean = w.address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
      const data = "0x70a08231" + addrClean;
      const res = await fetch("https://mainnet.base.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: w.index,
          method: "eth_call",
          params: [{ to: USDC_BASE, data }, "latest"],
        }),
      });
      const json = (await res.json()) as { result?: string };
      const atomic = BigInt(json.result || "0x0");
      const usd = (Number(atomic) / 1_000_000).toFixed(6);
      results.push({ wallet: w, balanceAtomic: atomic, balanceUsd: usd });
    } catch {
      results.push({ wallet: w, balanceAtomic: 0n, balanceUsd: "0.000000" });
    }
  }
  return results;
}

async function main() {
  const force = process.argv.includes("--force");
  let wallets: TestWallet[] = [];

  if (fs.existsSync(WALLETS_FILE) && !force) {
    try {
      wallets = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
      console.log(`📁 Loaded ${wallets.length} existing test buyer wallets from .test-buyer-wallets.json`);
    } catch {
      wallets = [];
    }
  }

  if (wallets.length === 0) {
    wallets = generateWallets(10);
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2), "utf-8");
    console.log(`✨ Generated 10 new test buyer wallets and saved to .test-buyer-wallets.json`);
  }

  console.log("================================================================================");
  console.log("10 TEST BUYER AGENT WALLETS FOR ON-CHAIN PROOFS (Base Mainnet USDC)");
  console.log(`Target Receiving Wallet: ${MERCHANT_LEDGER} (User's Ledger Nano S Plus)`);
  console.log(`Each Settlement Amount : $0.03 USDC (30000 atomic units) — settles 100% to Ledger`);
  console.log("================================================================================\n");

  console.log("Fetching live Base Mainnet USDC balances...\n");
  const balances = await checkUsdcBalances(wallets);

  console.log("#  | Address                                    | USDC Balance  | Ready to Settle?");
  console.log("---+--------------------------------------------+---------------+-----------------");
  for (const b of balances) {
    const ready = b.balanceAtomic >= 30000n ? "✅ READY ($0.03+)" : "⏳ Needs 0.03 USDC";
    console.log(
      `${b.wallet.index.toString().padStart(2, "0")} | ${b.wallet.address} | $${b.balanceUsd.padEnd(12)} | ${ready}`
    );
  }

  console.log("\n================================================================================");
  console.log("HOW TO USE THESE WALLETS:");
  console.log("================================================================================");
  console.log("1. Send $0.03 USDC on Base Mainnet to any (or all) of the 10 addresses above.");
  console.log("   (Total for all 10 wallets = $0.30 USDC. Zero ETH gas needed for settling!)");
  console.log("2. Run the batch settlement runner:");
  console.log("   /opt/homebrew/bin/node --experimental-strip-types scripts/batch-settle-buyers.ts");
  console.log("3. Each funded wallet will execute an x402 v2 payment to enrichmatch.dev,");
  console.log("   and the $0.03 USDC will settle immediately into your Ledger wallet.");
  console.log("4. Coinbase CDP Bazaar and x402scan will record 10 unique buyers + 10 new tx proofs!");
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("generate-test-wallets.ts") ||
    process.argv[1].endsWith("generate-test-wallets"));

if (isDirectRun) {
  main().catch(console.error);
}
