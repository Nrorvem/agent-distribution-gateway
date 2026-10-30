/**
 * Pushes CDP_API_KEY_ID, CDP_API_KEY_SECRET, and X402_FACILITATOR_URL
 * from local `.env.local` directly into Vercel Production via `npx vercel` CLI
 * (using exact string piping without trailing newlines).
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local not found in current directory");
  }
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

function main() {
  const env = loadEnvLocal();
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    throw new Error("Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET in .env.local");
  }

  const varsToPush: Array<[string, string]> = [
    ["CDP_API_KEY_ID", env.CDP_API_KEY_ID],
    ["CDP_API_KEY_SECRET", env.CDP_API_KEY_SECRET],
    ["X402_FACILITATOR_URL", "https://api.cdp.coinbase.com/platform/v2/x402"],
    ["X402_ENRICH_PRICE_USD", env.X402_ENRICH_PRICE_USD || "0.03"],
  ];

  if (env.PUBLIC_GATEWAY_ORIGIN) {
    varsToPush.push(["PUBLIC_GATEWAY_ORIGIN", env.PUBLIC_GATEWAY_ORIGIN]);
  }
  if (env.X402_OWNERSHIP_PROOFS) {
    varsToPush.push(["X402_OWNERSHIP_PROOFS", env.X402_OWNERSHIP_PROOFS]);
  }
  if (env.X402_OWNERSHIP_PROOF) {
    varsToPush.push(["X402_OWNERSHIP_PROOF", env.X402_OWNERSHIP_PROOF]);
  }

  const execEnv = {
    ...process.env,
    PATH: `/opt/homebrew/bin:${process.env.PATH || "/usr/bin:/bin"}`,
  };

  for (const [key, value] of varsToPush) {
    console.log(`\n→ Setting ${key} in Vercel (production)...`);
    try {
      execSync(`/opt/homebrew/bin/npx --yes vercel env rm ${key} production -y`, {
        stdio: "ignore",
        env: execEnv,
      });
    } catch {
      // Ignore if variable did not exist yet
    }
    execSync(`/opt/homebrew/bin/npx --yes vercel env add ${key} production`, {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
      env: execEnv,
    });
  }

  console.log("\n✅ All CDP environment variables pushed to Vercel production!");
  console.log("🚀 Triggering production deployment with new environment variables...");
  execSync("/opt/homebrew/bin/npx --yes vercel --prod --yes", {
    stdio: "inherit",
    env: execEnv,
  });
}

main();
