/**
 * Live Production On-Chain Buyer Script
 *
 * Executes a real call against your live production gateway:
 *   https://agent-distribution-gateway.vercel.app/api/v1/enrich/person
 *
 * Step 1: Sends the enrichment request WITHOUT payment -> receives the live HTTP 402
 *         x402 challenge from Vercel.
 * Step 2: If you provide a settled Base USDC transaction hash (`TX_HASH=0x...`),
 *         retries the request with `X-PAYMENT: <TX_HASH>`, which our gateway verifies
 *         directly against the Base Mainnet RPC (`https://mainnet.base.org`),
 *         calls your live Apollo.io API, and records the real BaseScan txHash in
 *         your gateway's verifiable telemetry!
 *
 * Usage:
 *   # 1. Inspect the live HTTP 402 invoice from production:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/live-onchain-buyer.ts
 *
 *   # 2. Redeem an on-chain Base USDC transfer ($0.10 USDC to 0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC):
 *   TX_HASH=0xYourBaseTxHashHere /opt/homebrew/bin/node --experimental-strip-types scripts/live-onchain-buyer.ts
 */

const PRODUCTION_ENDPOINT =
  process.env.GATEWAY_ENDPOINT ||
  "https://agent-distribution-gateway.vercel.app/api/v1/enrich/person";

async function main() {
  const payload = {
    first_name: process.argv[2] || "Tim",
    last_name: process.argv[3] || "Zheng",
    domain: process.argv[4] || "apollo.io",
  };

  console.log("================================================================================");
  console.log(`🌐 CALLING LIVE PRODUCTION GATEWAY: ${PRODUCTION_ENDPOINT}`);
  console.log("================================================================================\n");

  // 1. Send initial unpaid request to trigger HTTP 402 Payment Required challenge
  console.log("1️⃣  Sending initial request (no X-PAYMENT header)...");
  const challengeRes = await fetch(PRODUCTION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const challengeData = (await challengeRes.json()) as Record<string, any>;
  console.log(`   • Response Status : HTTP ${challengeRes.status}`);

  if (challengeRes.status !== 402) {
    console.log("   • Unexpected status:", JSON.stringify(challengeData, null, 2));
    return;
  }

  const reqTerms = challengeData.accepts?.[0];
  console.log(`   • x402 Network    : ${reqTerms?.network}`);
  console.log(`   • USDC Contract   : ${reqTerms?.asset}`);
  console.log(`   • Pay To Wallet   : ${reqTerms?.payTo}`);
  console.log(`   • Amount Required : $${reqTerms?.extra?.priceUsd} USDC (${reqTerms?.maxAmountRequired} atomic units)`);
  console.log(`   • Bazaar Discovery: discoverable=${Boolean(challengeData.extensions?.bazaar?.discoverable)}\n`);

  const txHash = process.env.TX_HASH || "";
  if (!txHash) {
    console.log("💡 TO COMPLETE YOUR FIRST REAL ON-CHAIN SALE:");
    console.log("   Option A (Direct Base USDC Transfer — Zero Setup):");
    console.log(`     1. Send $0.10 USDC on Base Mainnet to your Ledger address:`);
    console.log(`        ${reqTerms?.payTo}`);
    console.log("        (Tip: You can even send $0.10 USDC from your wallet to itself, or from any Base wallet!)");
    console.log("     2. Copy the Base transaction hash (0x...) and run:");
    console.log(`        TX_HASH=0xYourBaseTxHash /opt/homebrew/bin/node --experimental-strip-types scripts/live-onchain-buyer.ts\n`);
    console.log("   Option B (Coinbase CDP Facilitator for x402 Bazaar Auto-Indexing):");
    console.log("     1. Create a free CDP API Key at https://portal.cdp.coinbase.com");
    console.log("     2. Add X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 in Vercel");
    console.log("     3. Call the endpoint using @x402/fetch or @coinbase/payments-mcp.");
    return;
  }

  // 2. Retry with X-PAYMENT header containing the on-chain txHash (or signed x402 proof)
  console.log(`2️⃣  Retrying request with X-PAYMENT: ${txHash} ...`);
  const paidRes = await fetch(PRODUCTION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": txHash,
    },
    body: JSON.stringify(payload),
  });

  const paidData = await paidRes.json();
  console.log(`   • Response Status : HTTP ${paidRes.status}\n`);
  console.log(JSON.stringify(paidData, null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
