/**
 * Pricing Table & Atomic Unit Calculations for Option A (Apollo.io Gateway)
 *
 * Defines canonical USD prices for each tool in the Search -> Enrich funnel,
 * supporting environment variable overrides and exact string-based BigInt arithmetic.
 */

import { usdToAtomicUnits } from "../../lib/x402-gate.ts";

export type ApolloProductId =
  | "search_people"
  | "search_organizations"
  | "enrich_person"
  | "enrich_organization"
  | "bulk_enrich_people"
  | "bulk_enrich_organizations"
  | "get_organization_job_postings"
  | "prospect";

const DEFAULTS: Record<ApolloProductId, { envVar: string; unitUsd: string }> = {
  search_people:                 { envVar: "X402_PRICE_SEARCH_PEOPLE_USD",        unitUsd: "0.01" },
  search_organizations:          { envVar: "X402_PRICE_SEARCH_ORGS_USD",          unitUsd: "0.02" },
  enrich_person:                 { envVar: "X402_ENRICH_PRICE_USD",               unitUsd: "0.03" },
  enrich_organization:           { envVar: "X402_PRICE_ENRICH_ORG_USD",           unitUsd: "0.02" },
  bulk_enrich_people:            { envVar: "X402_PRICE_BULK_PERSON_UNIT_USD",     unitUsd: "0.025" },
  bulk_enrich_organizations:     { envVar: "X402_PRICE_BULK_ORG_UNIT_USD",        unitUsd: "0.015" },
  get_organization_job_postings: { envVar: "X402_PRICE_JOB_POSTINGS_USD",         unitUsd: "0.01" },
  prospect:                      { envVar: "X402_PRICE_PROSPECT_UNIT_USD",        unitUsd: "0.03" },
};

export function unitPriceUsd(id: ApolloProductId): string {
  const d = DEFAULTS[id];
  const envVal = process.env[d.envVar]?.trim();
  return envVal || d.unitUsd;
}

/** Multiplies a unit price by a count without floats; returns a decimal USD string with up to 6 dp. */
export function totalPriceUsd(id: ApolloProductId, count: number): string {
  const unit = unitPriceUsd(id);
  const unitAtomic = BigInt(usdToAtomicUnits(unit));
  const totalAtomic = unitAtomic * BigInt(count);
  const whole = totalAtomic / 1_000_000n;
  const rem = totalAtomic % 1_000_000n;
  if (rem === 0n) return `${whole}.00`;
  const frac = rem.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${frac}`;
}
