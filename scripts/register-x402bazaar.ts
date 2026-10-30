/**
 * Action B + Action C Verification & Registration Script:
 * 1. Action B: Registers our live endpoint on x402bazaar.org (`https://x402-api.onrender.com/quick-register`)
 *    by signing `quick-register:<url>:<lowercase_owner_address>:<timestamp>` with EIP-191 personal_sign
 *    (bypassing x402bazaar's mixed-case ownerAddress frontend bug).
 * 2. Action C: Verifies our Coinbase Developer Platform (CDP) API Key ID & Secret against
 *    Coinbase's Official x402 Facilitator (`https://api.cdp.coinbase.com/platform/v2/x402/supported`).
 */

import fs from "node:fs";
import path from "node:path";
import { privateKeyToAddress, signPersonalMessage } from "../src/lib/eip3009-signer.ts";
import { buildCdpBearerJwt } from "../src/lib/x402-gate.ts";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnvLocal();

  const endpointUrl =
    process.argv[2] ||
    process.env.GATEWAY_ENDPOINT ||
    "https://enrichmatch.dev/api/v1/enrich/person";
  const serviceName = "Apollo.io B2B Person Enrichment & Verified Work Email Finder";
  const priceUsdc = 0.1;

  console.log("=================================================================");
  console.log("1. ACTION B: Registering API on x402bazaar.org (Quick-Register)");
  console.log("=================================================================");

  const privKey = process.env.BUYER_PRIVATE_KEY;
  if (!privKey) {
    throw new Error("Missing BUYER_PRIVATE_KEY in .env.local");
  }

  // Must use ALL-LOWERCASE ownerAddress because x402bazaar's QuickRegisterSchema
  // lowercases ownerAddress BEFORE verifying the EIP-191 signature!
  const signerChecksummed = privateKeyToAddress(privKey);
  const ownerAddressLower = signerChecksummed.toLowerCase();
  const timestamp = Date.now();
  const messageToSign = `quick-register:${endpointUrl}:${ownerAddressLower}:${timestamp}`;
  const signature = signPersonalMessage(messageToSign, privKey);

  console.log(`• Target URL     : ${endpointUrl}`);
  console.log(`• Signer Address : ${ownerAddressLower} (forced lowercase for x402bazaar schema)`);
  console.log(`• Signed Message : ${messageToSign}`);

  const regRes = await fetch("https://x402-api.onrender.com/quick-register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: endpointUrl,
      name: serviceName,
      price: priceUsdc,
      ownerAddress: ownerAddressLower,
      timestamp,
      signature,
    }),
  });

  const regBody = await regRes.text();
  console.log(`• x402bazaar HTTP Status : ${regRes.status}`);
  console.log(`• x402bazaar Response    : ${regBody}\n`);

  console.log("=================================================================");
  console.log("2. ACTION C: Verifying Coinbase CDP Official x402 Facilitator Key");
  console.log("=================================================================");

  const cdpKeyId = process.env.CDP_API_KEY_ID || "";
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET || "";
  if (!cdpKeyId || !cdpKeySecret) {
    throw new Error("Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET in .env.local");
  }

  const jwt = buildCdpBearerJwt({
    apiKeyId: cdpKeyId,
    apiKeySecret: cdpKeySecret,
    requestMethod: "GET",
    requestHost: "api.cdp.coinbase.com",
    requestPath: "/platform/v2/x402/supported",
  });

  const cdpRes = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/supported", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });

  const cdpText = await cdpRes.text();
  console.log(`• CDP /supported HTTP Status : ${cdpRes.status}`);
  console.log(`• CDP /supported Response    : ${cdpText.slice(0, 600)}\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
