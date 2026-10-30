/**
 * Verification & Management Script for x402scan Ownership Proofs
 *
 * Verifies an EIP-191 personal_sign signature of the exact origin string:
 * "https://agent-distribution-gateway.vercel.app"
 * against the merchant receiving wallet (0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC).
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-ownership-proof.ts 0x<signature>
 *   node --experimental-strip-types scripts/verify-ownership-proof.ts --refresh
 */

import fs from "node:fs";
import path from "node:path";
import { recoverPersonalSignAddress } from "../src/lib/eip3009-signer.ts";

const EXPECTED_MERCHANT = "0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
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
    out[key] = val;
  }
  return out;
}

function saveProofToEnvLocal(proof: string) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  if (content.includes("X402_OWNERSHIP_PROOF=")) {
    content = content.replace(/X402_OWNERSHIP_PROOF=.*/g, `X402_OWNERSHIP_PROOF=${proof}`);
  } else {
    content += `\nX402_OWNERSHIP_PROOF=${proof}\n`;
  }
  fs.writeFileSync(envPath, content, "utf-8");
  console.log(`✅ Saved X402_OWNERSHIP_PROOF to .env.local`);
}

async function triggerX402ScanReindex(targetOrigin: string) {
  console.log(`\n🔄 Triggering live re-discovery & verification on x402scan for: ${targetOrigin}`);
  try {
    const res = await fetch(
      "https://www.x402scan.com/api/trpc/public.resources.registerFromOrigin?batch=1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "0": {
            json: {
              origin: targetOrigin,
            },
          },
        }),
      }
    );
    const data = await res.json();
    console.log(`• x402scan Response:`, JSON.stringify(data, null, 2));
    console.log(`\nInspect live status on x402scan!`);
  } catch (err: any) {
    console.error(`❌ Failed to trigger x402scan reindex:`, err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const env = loadEnvLocal();

  const originArg = args.find((a) => a.startsWith("http://") || a.startsWith("https://"));
  const targetOrigin =
    originArg ||
    process.env.PUBLIC_GATEWAY_ORIGIN ||
    env.PUBLIC_GATEWAY_ORIGIN ||
    "https://enrichmatch.dev";

  if (args.includes("--refresh") || args.includes("--sync")) {
    await triggerX402ScanReindex(targetOrigin);
    return;
  }

  const sigArg = args.find((a) => a.startsWith("0x") && a.length >= 130);
  const signature = sigArg || env.X402_OWNERSHIP_PROOF;

  if (!signature) {
    console.log(`=================================================================`);
    console.log(`x402scan Ownership Proof Verifier`);
    console.log(`=================================================================`);
    console.log(`\nTarget Origin to sign : ${targetOrigin}`);
    console.log(`Expected Signer Wallet: ${EXPECTED_MERCHANT} (Ledger Nano S Plus)\n`);
    console.log(`How to generate the proof:`);
    console.log(`1. Run scripts/serve-signer.ts:`);
    console.log(`   /opt/homebrew/bin/node --experimental-strip-types scripts/serve-signer.ts ${targetOrigin}`);
    console.log(`2. Connect Ledger in browser and approve:`);
    console.log(`   ${targetOrigin}\n`);
    return;
  }

  console.log(`=================================================================`);
  console.log(`Verifying Ownership Proof`);
  console.log(`=================================================================`);
  console.log(`• Signed Message : ${targetOrigin}`);
  console.log(`• Signature      : ${signature}`);

  try {
    const recovered = recoverPersonalSignAddress(targetOrigin, signature);
    console.log(`• Recovered Signer: ${recovered}`);
    console.log(`• Expected Signer : ${EXPECTED_MERCHANT}`);

    const isMatch = recovered.toLowerCase() === EXPECTED_MERCHANT.toLowerCase();
    if (isMatch) {
      console.log(`\n🎉 VERIFICATION SUCCESS: Signature was produced by the Ledger receiving wallet!`);
      saveProofToEnvLocal(signature);
      console.log(`\nNext steps:`);
      console.log(`1. Push to Vercel production:`);
      console.log(`   /opt/homebrew/bin/node --experimental-strip-types scripts/push-vercel-env.ts`);
      console.log(`2. Re-trigger x402scan verification:`);
      console.log(`   /opt/homebrew/bin/node --experimental-strip-types scripts/verify-ownership-proof.ts --refresh\n`);
    } else {
      console.log(`\n❌ VERIFICATION FAILED: Recovered address (${recovered}) does not match merchant (${EXPECTED_MERCHANT})!`);
      if (recovered.toLowerCase() === (env.BUYER_PRIVATE_KEY ? "0x632cd837db857afc202bc0ed8a9ccbfdde5155ff" : "")) {
        console.log(`Note: This signature was generated by the buyer/test wallet, NOT the Ledger merchant receiving wallet.`);
      }
    }
  } catch (err: any) {
    console.error(`❌ Error verifying signature:`, err.message);
  }
}

main().catch(console.error);
