/**
 * Direct Apollo.io Supply Connector Test
 *
 * Tests your live `APOLLO_API_KEY` (or mock fallback if not set yet) against
 * `enrichPersonWithApollo` with strict credit guardrails (`reveal_phone_number: false`).
 *
 * Usage:
 *   APOLLO_API_KEY=your_key /opt/homebrew/bin/node --experimental-strip-types scripts/test-apollo-direct.ts
 */

import fs from "node:fs";
import path from "node:path";
import { enrichPersonWithApollo } from "../src/verticals/option-a-apollo/connector.ts";

function loadEnv() {
  for (const file of [".env.local", ".env.local.example", ".env"]) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}

async function main() {
  loadEnv();
  const firstName = process.argv[2] || "Tim";
  const lastName = process.argv[3] || "Zheng";
  const domain = process.argv[4] || "apollo.io";

  console.log(`🔍 Enriching: ${firstName} ${lastName} @ ${domain} ...`);
  const result = await enrichPersonWithApollo({
    first_name: firstName,
    last_name: lastName,
    domain,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
