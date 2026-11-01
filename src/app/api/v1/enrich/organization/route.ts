import { NextRequest } from "next/server";
import { handlePaidGet, handlePaidPost } from "@/lib/paid-route";
import {
  validateOrgEnrichInput,
  type OrgEnrichInput,
  type OrgEnrichOutput,
} from "@/verticals/option-a-apollo/org-schema";
import { enrichOrganizationWithApollo } from "@/verticals/option-a-apollo/org-connector";
import { getProductById } from "@/verticals/option-a-apollo/catalog";
import { unitPriceUsd } from "@/verticals/option-a-apollo/pricing";

const product = getProductById("enrich_organization")!;
const DESCRIPTION =
  "Apollo.io B2B Company Firmographics & Tech Stack Enrichment ($0.02 USDC, Free on Miss)";

export async function GET(req: NextRequest) {
  return handlePaidGet(
    req,
    product.path,
    DESCRIPTION,
    {
      priceUsd: unitPriceUsd("enrich_organization"),
      bazaar: product.bazaar(),
    },
    product.inputSchema
  );
}

export async function POST(req: NextRequest) {
  return handlePaidPost<OrgEnrichInput, OrgEnrichOutput>({
    req,
    resourcePath: product.path,
    description: DESCRIPTION,
    vertical: "option-a-apollo",
    tool: "enrich_organization",
    validate: validateOrgEnrichInput,
    expectedSchema: product.inputSchema,
    spec: () => ({
      priceUsd: unitPriceUsd("enrich_organization"),
      bazaar: product.bazaar(),
    }),
    execute: enrichOrganizationWithApollo,
    isBillable: (output) => output.matched && output.organization !== null,
    receiptExtras: (output) => ({
      organization_name: output.organization?.name || null,
      primary_domain: output.organization?.primary_domain || null,
      apollo_id: output.organization?.apollo_id || null,
    }),
  });
}
