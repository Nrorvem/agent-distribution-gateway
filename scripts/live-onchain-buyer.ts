/**
 * Live Production On-Chain Buyer Script (Supports Path B EIP-3009 & Path A txHash)
 *
 * Executes a real call against your live production gateway:
 *   https://agent-distribution-gateway.vercel.app/api/v1/enrich/person
 *
 * Step 1: Sends the enrichment request WITHOUT payment -> receives the live HTTP 402
 *         x402 challenge from Vercel.
 * Step 2:
 *   - Path B (Standard Agent Flow — EIP-3009 Gasless Off-Chain Signature):
 *     If `BUYER_PRIVATE_KEY` is set (in env or `.env.local`), signs a single-use
 *     EIP-3009 `TransferWithAuthorization` voucher for $0.10 USDC on Base Mainnet
 *     (requires $0.00 ETH gas!) and submits it in `X-PAYMENT`. Your gateway verifies
 *     and settles the payment on-chain via `https://facilitator.payai.network` directly
 *     into your Ledger wallet (`0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC`).
 *   - Path A (Legacy Direct txHash):
 *     If `TX_HASH=0x...` is provided, sends the raw txHash in `X-PAYMENT`.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildSignedX402PaymentHeader,
  privateKeyToAddress,
} from "../src/lib/eip3009-signer.ts";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const out: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        out[key] = val;
      }
    }
  }
  return out;
}

const PRODUCTION_ENDPOINT =
  process.env.GATEWAY_ENDPOINT ||
  "https://agent-distribution-gateway.vercel.app/api/v1/enrich/person";

async function main() {
  const localEnv = loadEnvLocal();
  const payload = {
    first_name: process.argv[2] || "Fidji",
    last_name: process.argv[3] || "Simo",
    domain: process.argv[4] || "instacart.com",
  };

  console.log("================================================================================");
  console.log(`🌐 CALLING LIVE PRODUCTION GATEWAY: ${PRODUCTION_ENDPOINT}`);
  console.log(`👤 Target Profile: ${payload.first_name} ${payload.last_name} @ ${payload.domain}`);
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
  const atomicAmount = String(reqTerms?.amount || reqTerms?.maxAmountRequired || "100000");
  const usdDisplay = (Number(atomicAmount) / 1_000_000).toFixed(2);
  console.log(`   • x402 Version    : v${challengeData.x402Version}`);
  console.log(`   • x402 Network    : ${reqTerms?.network}`);
  console.log(`   • USDC Contract   : ${reqTerms?.asset}`);
  console.log(`   • Pay To Wallet   : ${reqTerms?.payTo}`);
  console.log(`   • Amount Required : $${usdDisplay} USDC (${atomicAmount} atomic units)`);
  console.log(`   • Bazaar Discovery: discoverable=${Boolean(challengeData.extensions?.bazaar?.discoverable)}\n`);

  const buyerPrivKey = process.env.BUYER_PRIVATE_KEY || localEnv.BUYER_PRIVATE_KEY || "";
  const txHash = process.env.TX_HASH || "";

  if (buyerPrivKey) {
    const buyerAddress = privateKeyToAddress(buyerPrivKey);
    console.log("2️⃣  Path B (Standard x402 v2 Agent Flow — EIP-3009 Gasless Signature):");
    console.log(`   • Buyer Agent Wallet : ${buyerAddress}`);
    console.log(`   • Paying To (Ledger) : ${reqTerms.payTo}`);

    // Pre-flight Base Mainnet USDC balance check
    try {
      const balCallData =
        "0x70a08231" + buyerAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
      const rpcRes = await fetch("https://mainnet.base.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: reqTerms.asset, data: balCallData }, "latest"],
        }),
      });
      const rpcJson = (await rpcRes.json()) as { result?: string };
      const buyerUsdcAtomic = BigInt(rpcJson.result || "0x0");
      const buyerUsdcDisplay = (Number(buyerUsdcAtomic) / 1_000_000).toFixed(2);
      console.log(`   • Buyer USDC Balance : $${buyerUsdcDisplay} USDC (${buyerUsdcAtomic.toString()} atomic units)`);

      if (buyerUsdcAtomic < BigInt(atomicAmount)) {
        console.log(
          `\n⚠️  Insufficient Base Mainnet USDC in test buyer wallet (${buyerAddress}).`
        );
        console.log(
          `   Required: $${usdDisplay} USDC (${atomicAmount} atomic units) | Available: $${buyerUsdcDisplay} USDC`
        );
        console.log(
          `   👉 Send at least $${usdDisplay} USDC on Base Mainnet to ${buyerAddress} (it will settle right back into your Ledger ${reqTerms.payTo} via Coinbase CDP Facilitator) and re-run this script.\n`
        );
      }
    } catch {
      // Ignore RPC pre-flight check errors and proceed
    }

    console.log(`   • Signing EIP-3009 TransferWithAuthorization ($${usdDisplay} USDC, 0 ETH gas)...`);

    const signed = buildSignedX402PaymentHeader({
      privateKeyHex: buyerPrivKey,
      network: reqTerms.network || "eip155:8453",
      usdcAddress: reqTerms.asset,
      payTo: reqTerms.payTo,
      valueAtomic: atomicAmount,
      resourceUrl: challengeData.resource?.url || PRODUCTION_ENDPOINT,
      description: challengeData.resource?.description,
      tokenName: reqTerms.extra?.name || "USD Coin",
      tokenVersion: reqTerms.extra?.version || "2",
      extensions: challengeData.extensions,
    });

    console.log(`   • Nonce              : ${signed.paymentPayload.payload.authorization.nonce}`);
    console.log(`   • Submitting PAYMENT-SIGNATURE header to ${PRODUCTION_ENDPOINT} ...\n`);

    const paidRes = await fetch(PRODUCTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": signed.headerBase64,
        "X-PAYMENT": signed.headerBase64,
      },
      body: JSON.stringify(payload),
    });

    const paidData = (await paidRes.json()) as Record<string, any>;
    console.log(`   • Response Status : HTTP ${paidRes.status}\n`);
    console.log(JSON.stringify(paidData, null, 2));

    if (paidRes.status === 200) {
      console.log("\n3️⃣  Verifying Coinbase CDP x402 Bazaar Discovery Indexing...");
      const bazaarRes = await fetch(
        `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?payTo=${reqTerms.payTo}`
      );
      const bazaarData = await bazaarRes.json();
      console.log(`   • Bazaar Search Status : HTTP ${bazaarRes.status}`);
      console.log(JSON.stringify(bazaarData, null, 2));
    }
    return;
  }

  if (txHash) {
    console.log(`2️⃣  Path A: Retrying request with direct on-chain TX_HASH: ${txHash} ...`);
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
    return;
  }

  console.log("💡 No BUYER_PRIVATE_KEY or TX_HASH provided.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
