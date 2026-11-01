import { NextRequest } from "next/server";
import { handlePaidGet, handlePaidPost } from "@/lib/paid-route";
import {
  validateBulkPersonInput,
  type BulkPersonInput,
  type BulkPersonOutput,
} from "@/verticals/option-a-apollo/bulk-person-schema";
import { bulkEnrichPeopleWithApollo } from "@/verticals/option-a-apollo/bulk-person-connector";
import { getProductById } from "@/verticals/option-a-apollo/catalog";
import { totalPriceUsd } from "@/verticals/option-a-apollo/pricing";

const product = getProductById("bulk_enrich_people")!;
const DESCRIPTION =
  "Apollo.io B2B Bulk Person Enrichment ($0.025 USDC / record, Free on Miss if zero emails found)";

export async function GET(req: NextRequest) {
  return handlePaidGet(
    req,
    product.path,
    DESCRIPTION,
    {
      priceUsd: totalPriceUsd("bulk_enrich_people", 1),
      bazaar: product.bazaar(),
      challengeMessage:
        "Payment Required. Free-on-Miss: Priced per record submitted ($0.025 USDC each); settled on-chain only if at least one record returns a deliverable email; $0.00 charged if zero deliverable emails found.",
    },
    product.inputSchema
  );
}

export async function POST(req: NextRequest) {
  return handlePaidPost<BulkPersonInput, BulkPersonOutput>({
    req,
    resourcePath: product.path,
    description: DESCRIPTION,
    vertical: "option-a-apollo",
    tool: "bulk_enrich_people",
    validate: validateBulkPersonInput,
    expectedSchema: product.inputSchema,
    spec: (input) => {
      const count = input ? input.details.length : 10;
      return {
        priceUsd: totalPriceUsd("bulk_enrich_people", count),
        bazaar: product.bazaar(),
        challengeMessage:
          "Payment Required. Free-on-Miss: Priced per record submitted ($0.025 USDC each); settled on-chain only if at least one record returns a deliverable email; $0.00 charged if zero deliverable emails found.",
      };
    },
    execute: bulkEnrichPeopleWithApollo,
    isBillable: (output) => output.billable_count >= 1,
    receiptExtras: (output) => ({
      submitted_count: output.submitted_count,
      matched_count: output.matched_count,
      billable_count: output.billable_count,
      pricing_note:
        "Priced at $0.025 USDC per submitted record; settled on-chain only if at least one deliverable email was found.",
    }),
  });
}
