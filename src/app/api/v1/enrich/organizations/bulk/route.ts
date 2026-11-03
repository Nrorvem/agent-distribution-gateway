import { NextRequest } from "next/server";
import { handlePaidGet, handlePaidPost } from "@/lib/paid-route";
import {
  validateBulkOrgInput,
  type BulkOrgInput,
} from "@/verticals/option-a-apollo/bulk-org-schema";
import {
  bulkEnrichOrganizationsWithApollo,
  type BulkOrgEnrichOutput,
} from "@/verticals/option-a-apollo/org-connector";
import { getProductById } from "@/verticals/option-a-apollo/catalog";
import { totalPriceUsd } from "@/verticals/option-a-apollo/pricing";

const product = getProductById("bulk_enrich_organizations")!;
const DESCRIPTION =
  "Apollo.io B2B Bulk Organization Firmographics ($0.015 USDC / domain, Free on Miss if zero matches)";

export async function GET(req: NextRequest) {
  return handlePaidGet(
    req,
    product.path,
    DESCRIPTION,
    {
      priceUsd: totalPriceUsd("bulk_enrich_organizations", 1),
      bazaar: product.bazaar(),
      challengeMessage:
        "Payment Required. Free-on-Miss: Priced per domain submitted ($0.015 USDC each); settled on-chain only if at least one organization is found; $0.00 charged if zero organizations resolved.",
    },
    product.inputSchema
  );
}

export async function POST(req: NextRequest) {
  return handlePaidPost<BulkOrgInput, BulkOrgEnrichOutput>({
    req,
    resourcePath: product.path,
    description: DESCRIPTION,
    vertical: "option-a-apollo",
    tool: "bulk_enrich_organizations",
    validate: validateBulkOrgInput,
    expectedSchema: product.inputSchema,
    spec: (input) => {
      const count = input ? input.domains.length : 10;
      return {
        priceUsd: totalPriceUsd("bulk_enrich_organizations", count),
        bazaar: product.bazaar(),
        challengeMessage:
          "Payment Required. Free-on-Miss: Priced per domain submitted ($0.015 USDC each); settled on-chain only if at least one organization is found; $0.00 charged if zero organizations resolved.",
      };
    },
    execute: (data) => bulkEnrichOrganizationsWithApollo(data.domains, data.skipped),
    isBillable: (output) => output.matched_count >= 1,
    receiptExtras: (output) => ({
      submitted_count: output.submitted_count,
      matched_count: output.matched_count,
      pricing_note:
        "Priced at $0.015 USDC per submitted domain; settled on-chain only if at least one organization was found.",
    }),
  });
}
