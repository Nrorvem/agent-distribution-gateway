import { NextRequest } from "next/server";
import { handlePaidGet, handlePaidPost } from "@/lib/paid-route";
import {
  validatePeopleSearchInput,
  type PeopleSearchInput,
  type PeopleSearchOutput,
} from "@/verticals/option-a-apollo/search-schema";
import { searchPeopleWithApollo } from "@/verticals/option-a-apollo/search-connector";
import { getProductById } from "@/verticals/option-a-apollo/catalog";
import { unitPriceUsd } from "@/verticals/option-a-apollo/pricing";

const product = getProductById("search_people")!;
const DESCRIPTION =
  "Apollo.io B2B People Search & Decision Maker Finder ($0.01 USDC / page, Free on Miss)";

export async function GET(req: NextRequest) {
  return handlePaidGet(
    req,
    product.path,
    DESCRIPTION,
    {
      priceUsd: unitPriceUsd("search_people"),
      bazaar: product.bazaar(),
    },
    product.inputSchema
  );
}

export async function POST(req: NextRequest) {
  return handlePaidPost<PeopleSearchInput, PeopleSearchOutput>({
    req,
    resourcePath: product.path,
    description: DESCRIPTION,
    vertical: "option-a-apollo",
    tool: "search_people",
    validate: validatePeopleSearchInput,
    expectedSchema: product.inputSchema,
    spec: () => ({
      priceUsd: unitPriceUsd("search_people"),
      bazaar: product.bazaar(),
    }),
    execute: searchPeopleWithApollo,
    isBillable: (output) => output.matched && output.people.some((p) => p.has_email),
    receiptExtras: (output) => ({
      results_count: output.people.length,
      emailable_count: output.people.filter((p) => p.has_email).length,
      page: output.pagination.page,
      total_entries: output.pagination.total_entries,
    }),
  });
}
