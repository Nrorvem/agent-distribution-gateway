import { NextRequest } from "next/server";
import { handlePaidGet, handlePaidPost } from "@/lib/paid-route";
import {
  validateOrgSearchInput,
  type OrgSearchInput,
  type OrgSearchOutput,
} from "@/verticals/option-a-apollo/search-schema";
import { searchOrganizationsWithApollo } from "@/verticals/option-a-apollo/search-connector";
import { getProductById } from "@/verticals/option-a-apollo/catalog";
import { unitPriceUsd } from "@/verticals/option-a-apollo/pricing";

const product = getProductById("search_organizations")!;
const DESCRIPTION =
  "Apollo.io B2B Company & Organization Search ($0.02 USDC / page, Free on Miss)";

export async function GET(req: NextRequest) {
  return handlePaidGet(
    req,
    product.path,
    DESCRIPTION,
    {
      priceUsd: unitPriceUsd("search_organizations"),
      bazaar: product.bazaar(),
    },
    product.inputSchema
  );
}

export async function POST(req: NextRequest) {
  return handlePaidPost<OrgSearchInput, OrgSearchOutput>({
    req,
    resourcePath: product.path,
    description: DESCRIPTION,
    vertical: "option-a-apollo",
    tool: "search_organizations",
    validate: validateOrgSearchInput,
    expectedSchema: product.inputSchema,
    spec: () => ({
      priceUsd: unitPriceUsd("search_organizations"),
      bazaar: product.bazaar(),
    }),
    execute: searchOrganizationsWithApollo,
    isBillable: (output) => output.matched && output.organizations.length > 0,
    receiptExtras: (output) => ({
      results_count: output.organizations.length,
      page: output.pagination.page,
      total_entries: output.pagination.total_entries,
    }),
  });
}
