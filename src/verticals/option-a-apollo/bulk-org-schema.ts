/**
 * Bulk Organization Enrichment Schemas, Types, and Validators
 */

import { cleanDomainCandidate, looksLikeDomain, FREE_EMAIL_PROVIDERS } from "./schema.ts";
import type { BulkOrgEnrichOutput } from "./org-connector.ts";

export interface BulkOrgInput {
  domains: string[];
  skipped: string[];
}

function unwrapLlmWrappers(raw: Record<string, unknown>): Record<string, unknown> {
  let current = { ...raw };
  for (const wrapperKey of ["input", "params", "arguments", "data", "body"]) {
    const candidate = current[wrapperKey];
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      Object.keys(current).length <= 2
    ) {
      current = { ...current, ...(candidate as Record<string, unknown>) };
      break;
    }
  }
  return current;
}

export function validateBulkOrgInput(
  rawInput: Record<string, unknown>
): { valid: boolean; data?: BulkOrgInput; error?: string } {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { valid: false, error: "Request body must be a JSON object containing a 'domains' array." };
  }

  const raw = unwrapLlmWrappers(rawInput);
  const rawList = raw.domains ?? raw.websites ?? raw.companies;

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return {
      valid: false,
      error: "Missing or empty 'domains' array. Provide 1 to 10 company domains.",
    };
  }

  if (rawList.length > 10) {
    return {
      valid: false,
      error: `Batch size of ${rawList.length} exceeds the maximum limit of 10 domains per call.`,
    };
  }

  const cleanedDomains: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    let candidate = "";
    if (typeof item === "string") {
      candidate = item.trim();
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      candidate = String(obj.domain || obj.website || obj.primary_domain || "").trim();
    }

    const cleaned = cleanDomainCandidate(candidate);
    if (!cleaned || (!looksLikeDomain(cleaned) && !cleaned.includes("."))) {
      continue;
    }

    if (FREE_EMAIL_PROVIDERS.has(cleaned)) {
      skipped.push(cleaned);
      continue;
    }

    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      cleanedDomains.push(cleaned);
    }
  }

  if (cleanedDomains.length === 0) {
    return {
      valid: false,
      error: skipped.length > 0
        ? `All submitted domains were skipped because they are consumer email providers (${skipped.join(", ")}). Provide business company domains.`
        : "No valid company domains found in request. Provide at least one valid company domain.",
    };
  }

  return {
    valid: true,
    data: {
      domains: cleanedDomains,
      skipped,
    },
  };
}
