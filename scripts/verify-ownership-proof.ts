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

const PUBLIC_ORIGIN =
  process.env.PUBLIC_GATEWAY_ORIGIN || "https://agent-distribution-gateway.vercel.app";
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

async function triggerX402ScanReindex() {
  console.log(`\n🔄 Triggering live re-discovery & verification on x402scan...`);
  try {
    const res = await fetch(
      "https://www.x402scan.com/api/trpc/public.resources.registerFromOrigin?batch=1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "0": {
            json: {
              origin: PUBLIC_ORIGIN,
            },
          },
        }),
      }
    );
    const data = await res.json();
    console.log(`• x402scan Response:`, JSON.stringify(data, null, 2));
    console.log(`\nInspect live status at: https://www.x402scan.com/server/05a538fc-1188-4410-99a4-460feb103765`);
  } catch (err: any) {
    console.error(`❌ Failed to trigger x402scan reindex:`, err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const env = loadEnvLocal();

  if (args.includes("--refresh") || args.includes("--sync")) {
    await triggerX402ScanReindex();
    return;
  }

  const sigArg = args.find((a) => a.startsWith("0x") && a.length >= 130);
  const signature = sigArg || env.X402_OWNERSHIP_PROOF;

  if (!signature) {
    console.log(`=================================================================`);
    console.log(`x402scan Ownership Proof Verifier`);
    console.log(`=================================================================`);
    console.log(`\nTarget Origin to sign : ${PUBLIC_ORIGIN}`);
    console.log(`Expected Signer Wallet: ${EXPECTED_MERCHANT} (Ledger Nano S Plus)\n`);
    console.log(`How to generate the proof:`);
    console.log(`1. Open your browser wallet (MetaMask / Rabby connected to Ledger)`);
    console.log(`   or open the helper: scripts/sign-ledger.html`);
    console.log(`2. Sign the exact message:`);
    console.log(`   ${PUBLIC_ORIGIN}`);
    console.log(`3. Run this script with the resulting signature:`);
    console.log(`   /opt/homebrew/bin/node --experimental-strip-types scripts/verify-ownership-proof.ts <0x_signature>\n`);
    return;
  }

  console.log(`=================================================================`);
  console.log(`Verifying Ownership Proof`);
  console.log(`=================================================================`);
  console.log(`• Signed Message : ${PUBLIC_ORIGIN}`);
  console.log(`• Signature      : ${signature}`);

  try {
    const recovered = recoverPersonalSignAddress(PUBLIC_ORIGIN, signature);
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
