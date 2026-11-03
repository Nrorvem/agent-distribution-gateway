/**
 * Bulk Person Enrichment Schemas, Types, and Validators
 */

import {
  validatePersonEnrichInput,
  type PersonEnrichInput,
} from "./schema.ts";
import type { NormalizedPerson } from "./person-normalizer.ts";

export interface BulkPersonInput {
  details: PersonEnrichInput[];
  reveal_personal_emails?: boolean;
  original_indices_map?: number[][];
  submitted_count?: number;
}

export interface BulkPersonResultItem {
  index: number;
  original_indices: number[];
  input_echo: Record<string, unknown>;
  matched: boolean;
  person: NormalizedPerson | null;
}

export interface BulkPersonOutput {
  matched: boolean;
  payment_settled?: boolean;
  source: "apollo_live" | "apollo_mock";
  timestamp: string;
  latency_ms: number;
  submitted_count: number;
  matched_count: number;
  billable_count: number;
  results: BulkPersonResultItem[];
}

export const BULK_PERSON_MAX_ITEMS = 10;

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

export function validateBulkPersonInput(
  rawInput: Record<string, unknown>
): { valid: boolean; data?: BulkPersonInput; error?: string } {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { valid: false, error: "Request body must be a JSON object containing a 'details' array." };
  }

  const raw = unwrapLlmWrappers(rawInput);
  const rawList = raw.details ?? raw.people ?? raw.records ?? raw.persons;

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return {
      valid: false,
      error: "Missing or empty 'details' array. Provide 1 to 10 person identifier objects.",
    };
  }

  if (rawList.length > BULK_PERSON_MAX_ITEMS) {
    return {
      valid: false,
      error: `Batch size of ${rawList.length} exceeds the maximum limit of ${BULK_PERSON_MAX_ITEMS} profiles per call.`,
    };
  }

  const validatedDetails: PersonEnrichInput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`Record [${i}]: Must be an object with person identifiers`);
      continue;
    }
    const val = validatePersonEnrichInput(item as Record<string, unknown>);
    if (!val.valid || !val.data) {
      errors.push(`Record [${i}]: ${val.error || "Invalid person identifiers"}`);
    } else {
      validatedDetails.push(val.data);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: `Validation errors in submitted batch: ${errors.join("; ")}`,
    };
  }

  // Deduplicate identical records by a composite identifier signature while tracking original indices (S3)
  const sigToDedupedIndex = new Map<string, number>();
  const dedupedDetails: PersonEnrichInput[] = [];
  const originalIndicesMap: number[][] = [];

  for (let i = 0; i < validatedDetails.length; i++) {
    const d = validatedDetails[i];
    const sig = [
      d.id || "",
      d.email || "",
      d.linkedin_url || "",
      `${d.first_name || ""}:${d.last_name || ""}:${d.domain || d.organization_name || ""}`,
    ].join("|").toLowerCase();

    if (sigToDedupedIndex.has(sig)) {
      const existingIdx = sigToDedupedIndex.get(sig)!;
      originalIndicesMap[existingIdx].push(i);
    } else {
      const newIdx = dedupedDetails.length;
      sigToDedupedIndex.set(sig, newIdx);
      dedupedDetails.push(d);
      originalIndicesMap.push([i]);
    }
  }

  return {
    valid: true,
    data: {
      details: dedupedDetails,
      reveal_personal_emails: Boolean(raw.reveal_personal_emails),
      original_indices_map: originalIndicesMap,
      submitted_count: rawList.length,
    },
  };
}
