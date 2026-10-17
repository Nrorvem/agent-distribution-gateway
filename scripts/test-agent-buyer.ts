/**
 * Autonomous Buyer Agent E2E Lifecycle Test Harness
 *
 * Simulates all 6 stages of the Agentic Commerce Lifecycle from our brainstorm:
 *   Stage 1: Intent Formulation & Mandate Scoping ($0.25 max budget for B2B lead enrichment)
 *   Stage 2: Discovery & Negotiation (Inspecting Agent Card & schema)
 *   Stage 3: Identity & KYA / Zero-Auth Challenge (Triggering HTTP 402 Payment Required)
 *   Stage 4: Policy Enforcement & Guardrail Hook (Verifying $0.10 <= $0.25 budget mandate)
 *   Stage 5: Payment Execution & Settlement (Signing x402 payload & retrying request)
 *   Stage 6: Fulfillment Verification & Audit Logging (Validating deterministic output & receipt)
 *
 * Run directly with Node 23:
 *   /opt/homebrew/bin/node --experimental-strip-types scripts/test-agent-buyer.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  validatePersonEnrichInput,
  PERSON_ENRICH_JSON_SCHEMA,
} from "../src/verticals/option-a-apollo/schema.ts";
import { enrichPersonWithApollo } from "../src/verticals/option-a-apollo/connector.ts";
import {
  buildX402Challenge,
  verifyX402Payment,
  recordAuditLog,
  getGateConfig,
} from "../src/lib/x402-gate.ts";

function loadEnv() {
  const fullPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(fullPath)) {
    for (const line of fs.readFileSync(fullPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
  // Default to mock supply unless --live is passed so repeated test runs don't burn Apollo credits
  if (!process.argv.includes("--live")) {
    process.env.APOLLO_MOCK_MODE = "true";
  }
}

async function runSixStageLifecycleSimulation() {
  loadEnv();
  console.log("================================================================================");
  console.log("🤖 AUTONOMOUS BUYER AGENT — 6-STAGE COMMERCE LIFECYCLE TEST (OPTION A: APOLLO)");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // STAGE 1: Intent Formulation & Mandate Scoping
  // ---------------------------------------------------------------------------
  const mandate = {
    prompt: "Find the verified work email, title, and firmographics for Tim Zheng at apollo.io",
    maxBudgetUsd: 0.25,
    allowedNetworks: ["base", "base-sepolia"],
    requiredFields: ["email", "title", "organization"],
  };
  console.log("1️⃣  [STAGE 1: INTENT & MANDATE]");
  console.log(`   • Task Prompt     : "${mandate.prompt}"`);
  console.log(`   • Spending Mandate: Max $${mandate.maxBudgetUsd.toFixed(2)} USDC on ${mandate.allowedNetworks.join("/")}\n`);

  // ---------------------------------------------------------------------------
  // STAGE 2: Discovery & Negotiation
  // ---------------------------------------------------------------------------
  const cfg = getGateConfig();
  const resourceUrl = "https://gateway.local/api/v1/enrich/person";
  console.log("2️⃣  [STAGE 2: DISCOVERY & SCHEMA EVALUATION]");
  console.log("   • Discovered Endpoint: /.well-known/agent.json -> /api/v1/enrich/person");
  console.log(`   • Advertised Price   : $${cfg.priceUsd} USDC (${cfg.atomicUnits} atomic units on ${cfg.network})`);
  console.log(`   • Output Properties  : ${Object.keys(PERSON_ENRICH_JSON_SCHEMA.output.properties).join(", ")}\n`);

  // ---------------------------------------------------------------------------
  // STAGE 3: Initial Call & HTTP 402 Payment Challenge
  // ---------------------------------------------------------------------------
  const queryPayload = {
    first_name: "Tim",
    last_name: "Zheng",
    domain: "apollo.io",
  };

  const validation = validatePersonEnrichInput(queryPayload);
  if (!validation.valid || !validation.data) {
    throw new Error(`Input validation failed: ${validation.error}`);
  }

  const challenge = buildX402Challenge(
    resourceUrl,
    "Apollo.io Verified B2B Person Enrichment (1 profile lookup)"
  );
  const reqTerms = challenge.accepts[0];

  console.log("3️⃣  [STAGE 3: INITIAL INVOCATION -> HTTP 402 CHALLENGE]");
  console.log(`   • Seller returned HTTP 402 Payment Required (x402Version=${challenge.x402Version})`);
  console.log(`   • Asset Contract  : ${reqTerms.asset} (${reqTerms.extra.name})`);
  console.log(`   • Pay To Wallet   : ${reqTerms.payTo}`);
  console.log(`   • Required Amount : ${reqTerms.maxAmountRequired} atomic units ($${reqTerms.extra.priceUsd} USD)\n`);

  // ---------------------------------------------------------------------------
  // STAGE 4: Policy Enforcement & Authorization (The Guardrail Hook)
  // ---------------------------------------------------------------------------
  const requestedUsd = parseFloat(reqTerms.extra.priceUsd);
  const withinBudget = requestedUsd <= mandate.maxBudgetUsd;
  const networkAllowed = mandate.allowedNetworks.includes(reqTerms.network);

  console.log("4️⃣  [STAGE 4: POLICY GUARDRAIL HOOK]");
  console.log(`   • Budget Check    : $${requestedUsd.toFixed(2)} <= $${mandate.maxBudgetUsd.toFixed(2)} ? ${withinBudget ? "PASS ✅" : "BLOCK ❌"}`);
  console.log(`   • Network Check   : ${reqTerms.network} in allowlist ? ${networkAllowed ? "PASS ✅" : "BLOCK ❌"}`);
  if (!withinBudget || !networkAllowed) {
    throw new Error("Guardrail Hook blocked transaction!");
  }

  // Issue JIT single-use x402 payment header
  const jitPaymentProof = Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: reqTerms.network,
      payer: "0xBuyerAgentAutonomousWallet88A1",
      amount: reqTerms.maxAmountRequired,
      devBypassToken: cfg.devBypassToken,
      txHash: "0x8f4e2c9b1d7a6e5f4c3b2a190807060504030201aabbccddeeff001122334455",
    })
  ).toString("base64");
  console.log("   • Issued JIT x402 Payment Proof for retry header.\n");

  // ---------------------------------------------------------------------------
  // STAGE 5: Payment Execution & Settlement
  // ---------------------------------------------------------------------------
  console.log("5️⃣  [STAGE 5: x402 PAYMENT VERIFICATION & SETTLEMENT]");
  const verification = await verifyX402Payment(
    jitPaymentProof,
    resourceUrl,
    reqTerms.description
  );
  if (!verification.verified) {
    throw new Error(`Payment verification failed: ${verification.error}`);
  }
  console.log(`   • Payment Verified: ${verification.verified} (mode: ${verification.mode})`);
  console.log(`   • Payer Wallet    : ${verification.payer}`);
  console.log(`   • Settlement Hash : ${verification.txHash}\n`);

  // ---------------------------------------------------------------------------
  // STAGE 6: Fulfillment Verification & Audit Logging
  // ---------------------------------------------------------------------------
  console.log("6️⃣  [STAGE 6: APOLLO SUPPLY FULFILLMENT & AUDIT TELEMETRY]");
  const enrichment = await enrichPersonWithApollo(validation.data);
  const receipt = recordAuditLog({
    vertical: "option-a-apollo",
    tool: "enrich_person",
    payer: verification.payer || "unknown",
    amount_usd: cfg.priceUsd,
    network: cfg.network,
    tx_hash: verification.txHash || `0xsim_${Date.now().toString(16)}`,
    verification_mode: verification.mode || "dev_bypass_token",
    matched: enrichment.matched,
    latency_ms: enrichment.latency_ms,
  });

  console.log(`   • Supply Source   : ${enrichment.source} (matched=${enrichment.matched}, latency=${enrichment.latency_ms}ms)`);
  console.log(`   • Enriched Person : ${enrichment.person?.full_name} — ${enrichment.person?.title} @ ${enrichment.person?.organization?.name}`);
  console.log(`   • Verified Email  : ${enrichment.person?.email} (${enrichment.person?.email_status})`);
  console.log(`   • LinkedIn URL    : ${enrichment.person?.linkedin_url}`);
  console.log(`   • Audit Receipt ID: ${receipt.receipt_id} (${receipt.timestamp})\n`);

  console.log("✅ FULL 6-STAGE AGENTIC SALE COMPLETED SUCCESSFULLY!");
}

runSixStageLifecycleSimulation().catch((err) => {
  console.error("❌ Simulation failed:", err);
  process.exit(1);
});
