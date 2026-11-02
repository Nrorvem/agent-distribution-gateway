import { NextRequest, NextResponse } from "next/server";
import {
  validatePersonEnrichInput,
  PERSON_ENRICH_JSON_SCHEMA,
} from "@/verticals/option-a-apollo/schema";
import { enrichPersonWithApollo } from "@/verticals/option-a-apollo/connector";
import {
  buildX402Challenge,
  verifyX402Payment,
  settleVerifiedX402Payment,
  recordAuditLog,
  getGateConfig,
  resolveGatewayOrigin,
} from "@/lib/x402-gate";
import { handlePaidMcpCall } from "@/lib/paid-mcp";
import {
  APOLLO_PRODUCTS,
  getProductById,
  getProductByMcpTool,
  getMcpToolsList,
} from "@/verticals/option-a-apollo/catalog";
import {
  validatePeopleSearchInput,
  validateOrgSearchInput,
  type PeopleSearchInput,
  type PeopleSearchOutput,
  type OrgSearchInput,
  type OrgSearchOutput,
} from "@/verticals/option-a-apollo/search-schema";
import {
  searchPeopleWithApollo,
  searchOrganizationsWithApollo,
} from "@/verticals/option-a-apollo/search-connector";
import {
  validateOrgEnrichInput,
  type OrgEnrichInput,
  type OrgEnrichOutput,
} from "@/verticals/option-a-apollo/org-schema";
import {
  enrichOrganizationWithApollo,
  bulkEnrichOrganizationsWithApollo,
  type BulkOrgEnrichOutput,
} from "@/verticals/option-a-apollo/org-connector";
import {
  validateBulkPersonInput,
  type BulkPersonInput,
  type BulkPersonOutput,
} from "@/verticals/option-a-apollo/bulk-person-schema";
import { bulkEnrichPeopleWithApollo } from "@/verticals/option-a-apollo/bulk-person-connector";
import {
  validateBulkOrgInput,
  type BulkOrgInput,
} from "@/verticals/option-a-apollo/bulk-org-schema";
import { unitPriceUsd, totalPriceUsd } from "@/verticals/option-a-apollo/pricing";

export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);
  const mcpTools = getMcpToolsList();
  return NextResponse.json({
    protocol: "mcp-streamable-http",
    serverInfo: {
      name: "enrichmatch-apollo-broker",
      version: "0.4.0",
    },
    paymentProtocol: "x402",
    x402Version: 2,
    network: cfg.networkCaip2,
    priceUsd: cfg.priceUsd,
    freeOnMiss: true,
    tools: mcpTools,
  });
}

export async function POST(req: NextRequest) {
  let rpc: Record<string, any>;
  try {
    rpc = (await req.json()) as Record<string, any>;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 }
    );
  }

  const { id = null, method, params = {} } = rpc;

  // 1. MCP Handshake
  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "enrichmatch-apollo-broker",
          version: "0.4.0",
        },
        instructions:
          "Full-Funnel B2B Data Flow: search_organizations → search_people → enrich_person / bulk_enrich_people; enrich_organization for firmographics.",
      },
    });
  }

  if (method === "notifications/initialized") {
    return NextResponse.json({ jsonrpc: "2.0", id, result: {} });
  }

  // 2. List Tools
  if (method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: getMcpToolsList(),
      },
    });
  }

  // 3. Call Tool
  if (method === "tools/call") {
    const toolName = params?.name;
    const rawArgs = (params?.arguments || {}) as Record<string, unknown>;
    const cfg = getGateConfig();

    if (toolName === "get_enrichment_quote") {
      const requestedTool = typeof rawArgs.tool === "string" ? rawArgs.tool.trim() : undefined;
      if (requestedTool && requestedTool !== "enrich_person") {
        const product = getProductByMcpTool(requestedTool);
        if (product) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      tool: product.mcpTool,
                      path: product.path,
                      price_usd: product.pricing.unitUsd(),
                      per: product.pricing.per,
                      billing_rule: product.pricing.billingRule,
                      network: cfg.networkCaip2,
                      asset_contract: cfg.asset,
                      recipient_wallet: cfg.payTo,
                      zero_signup: true,
                      schema: product.inputSchema,
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          });
        }
      }

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tool: "enrich_person",
                  price_usd: cfg.priceUsd,
                  free_on_miss: true,
                  billing_policy: "Only settles payment when matched === true and a deliverable email is returned ($0.00 on miss)",
                  network: cfg.networkCaip2,
                  asset_contract: cfg.asset,
                  recipient_wallet: cfg.payTo,
                  sla_p95_ms: 850,
                  zero_signup: true,
                  schema: PERSON_ENRICH_JSON_SCHEMA,
                  catalog: APOLLO_PRODUCTS.map((p) => ({
                    id: p.id,
                    tool: p.mcpTool,
                    path: p.path,
                    stage: p.funnelStage,
                    price_usd: p.pricing.unitUsd(),
                    per: p.pricing.per,
                    billing_rule: p.pricing.billingRule,
                  })),
                },
                null,
                2
              ),
            },
          ],
        },
      });
    }

    // search_people
    if (toolName === "search_people") {
      const prod = getProductById("search_people")!;
      return handlePaidMcpCall<PeopleSearchInput, PeopleSearchOutput>({
        req,
        id,
        tool: "search_people",
        description: "MCP Tool Call: search_people (Apollo.io B2B People Search — $0.01 USDC, Free on Miss)",
        rawArgs,
        params,
        validate: validatePeopleSearchInput,
        expectedSchema: prod.inputSchema,
        spec: () => ({ priceUsd: unitPriceUsd("search_people"), bazaar: prod.bazaar() }),
        execute: searchPeopleWithApollo,
        isBillable: (out) => out.matched && out.people.some((p) => p.has_email),
        receiptExtras: (out) => ({
          results_count: out.people.length,
          emailable_count: out.people.filter((p) => p.has_email).length,
        }),
      });
    }

    // search_organizations
    if (toolName === "search_organizations") {
      const prod = getProductById("search_organizations")!;
      return handlePaidMcpCall<OrgSearchInput, OrgSearchOutput>({
        req,
        id,
        tool: "search_organizations",
        description: "MCP Tool Call: search_organizations (Apollo.io B2B Organization Search — $0.02 USDC, Free on Miss)",
        rawArgs,
        params,
        validate: validateOrgSearchInput,
        expectedSchema: prod.inputSchema,
        spec: () => ({ priceUsd: unitPriceUsd("search_organizations"), bazaar: prod.bazaar() }),
        execute: searchOrganizationsWithApollo,
        isBillable: (out) => out.matched && out.organizations.length > 0,
        receiptExtras: (out) => ({ results_count: out.organizations.length }),
      });
    }

    // enrich_organization
    if (toolName === "enrich_organization") {
      const prod = getProductById("enrich_organization")!;
      return handlePaidMcpCall<OrgEnrichInput, OrgEnrichOutput>({
        req,
        id,
        tool: "enrich_organization",
        description: "MCP Tool Call: enrich_organization (Apollo.io B2B Company Firmographics — $0.02 USDC, Free on Miss)",
        rawArgs,
        params,
        validate: validateOrgEnrichInput,
        expectedSchema: prod.inputSchema,
        spec: () => ({ priceUsd: unitPriceUsd("enrich_organization"), bazaar: prod.bazaar() }),
        execute: enrichOrganizationWithApollo,
        isBillable: (out) => out.matched && out.organization !== null,
        receiptExtras: (out) => ({ organization_name: out.organization?.name, primary_domain: out.organization?.primary_domain }),
      });
    }

    // bulk_enrich_people
    if (toolName === "bulk_enrich_people") {
      const prod = getProductById("bulk_enrich_people")!;
      return handlePaidMcpCall<BulkPersonInput, BulkPersonOutput>({
        req,
        id,
        tool: "bulk_enrich_people",
        description: "MCP Tool Call: bulk_enrich_people (Apollo.io B2B Bulk Person Enrichment — $0.025 USDC / record, Free on Miss)",
        rawArgs,
        params,
        validate: validateBulkPersonInput,
        expectedSchema: prod.inputSchema,
        spec: (input) => ({
          priceUsd: totalPriceUsd("bulk_enrich_people", input ? input.details.length : 10),
          bazaar: prod.bazaar(),
        }),
        execute: bulkEnrichPeopleWithApollo,
        isBillable: (out) => out.billable_count >= 1,
        receiptExtras: (out) => ({
          submitted_count: out.submitted_count,
          matched_count: out.matched_count,
          billable_count: out.billable_count,
        }),
      });
    }

    // bulk_enrich_organizations
    if (toolName === "bulk_enrich_organizations") {
      const prod = getProductById("bulk_enrich_organizations")!;
      return handlePaidMcpCall<BulkOrgInput, BulkOrgEnrichOutput>({
        req,
        id,
        tool: "bulk_enrich_organizations",
        description: "MCP Tool Call: bulk_enrich_organizations (Apollo.io B2B Bulk Organization Firmographics — $0.015 USDC / domain, Free on Miss)",
        rawArgs,
        params,
        validate: validateBulkOrgInput,
        expectedSchema: prod.inputSchema,
        spec: (input) => ({
          priceUsd: totalPriceUsd("bulk_enrich_organizations", input ? input.domains.length : 10),
          bazaar: prod.bazaar(),
        }),
        execute: (data) => bulkEnrichOrganizationsWithApollo(data.domains, data.skipped),
        isBillable: (out) => out.matched_count >= 1,
        receiptExtras: (out) => ({
          submitted_count: out.submitted_count,
          matched_count: out.matched_count,
        }),
      });
    }

    // Legacy enrich_person: untouched handler logic
    if (toolName === "enrich_person") {
      const origin = resolveGatewayOrigin(req);
      const resourceUrl = `${origin}/api/mcp`;
      const description =
        "MCP Tool Call: enrich_person (Apollo.io B2B Person Enrichment — $0.03 USDC on Match, Free on Miss)";
      const paymentProof =
        req.headers.get("payment-signature") ||
        req.headers.get("PAYMENT-SIGNATURE") ||
        req.headers.get("x-payment") ||
        req.headers.get("X-PAYMENT") ||
        (typeof rawArgs._x402_payment === "string" ? rawArgs._x402_payment : null) ||
        (typeof params?._meta?.payment === "string" ? params._meta.payment : null);

      if (!paymentProof) {
        const challenge = buildX402Challenge(resourceUrl, description);
        return NextResponse.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              _meta: { x402: challenge },
              content: [
                {
                  type: "text",
                  text: JSON.stringify(challenge, null, 2),
                },
              ],
            },
          },
          {
            status: 402,
            headers: { "X-Payment-Protocol": "x402" },
          }
        );
      }

      // Validate input BEFORE verifying/settling payment so a paying agent is never charged on malformed input
      const validation = validatePersonEnrichInput(rawArgs);
      if (!validation.valid || !validation.data) {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: validation.error,
                  expected_schema: PERSON_ENRICH_JSON_SCHEMA.input,
                }),
              },
            ],
          },
        });
      }

      const verification = await verifyX402Payment(
        paymentProof,
        resourceUrl,
        description,
        { verifyOnly: true }
      );

      if (!verification.verified) {
        const challenge = buildX402Challenge(resourceUrl, description);
        return NextResponse.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              _meta: { x402: challenge },
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ...challenge,
                      error: verification.error,
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          },
          { status: 402 }
        );
      }

      const enrichment = await enrichPersonWithApollo(validation.data);
      const hasDeliverableEmail = Boolean(
        enrichment.matched &&
          enrichment.person?.email &&
          enrichment.person.email.trim().length > 0 &&
          enrichment.person.email_status !== "unavailable"
      );

      if (!hasDeliverableEmail) {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...enrichment,
                    payment_settled: false,
                    receipt: {
                      receipt_id: `miss_${Date.now()}`,
                      tx_hash: null,
                      amount_usd: "0.00",
                      network: cfg.network,
                      free_on_miss: true,
                      note: "Free-on-Miss: No deliverable email found. Payment was verified but NOT settled on-chain ($0.00 charged).",
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
      }

      let settledTxHash = verification.txHash;
      let settledPayer = verification.payer;
      if (verification.settlementContext) {
        const settleResult = await settleVerifiedX402Payment(
          verification.settlementContext
        );
        if (!settleResult.verified || !settleResult.settled) {
          const challenge = buildX402Challenge(resourceUrl, description);
          return NextResponse.json(
            {
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                _meta: { x402: challenge },
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ...challenge,
                        error: settleResult.error || "On-chain payment settlement failed",
                      },
                      null,
                      2
                    ),
                  },
                ],
              },
            },
            { status: 402 }
          );
        }
        settledTxHash = settleResult.txHash;
        settledPayer = settleResult.payer || settledPayer;
      } else if (verification.mode === "dev_bypass_token" && !settledTxHash) {
        settledTxHash = `0xsim_${Date.now().toString(16)}`;
      }

      const receipt = recordAuditLog({
        vertical: "option-a-apollo",
        tool: "mcp:enrich_person",
        payer: settledPayer || "unknown",
        amount_usd: cfg.priceUsd,
        network: cfg.network,
        tx_hash: settledTxHash || `0xsim_${Date.now().toString(16)}`,
        verification_mode: verification.mode || "dev_bypass_token",
        matched: enrichment.matched,
        latency_ms: enrichment.latency_ms,
      });

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...enrichment,
                  payment_settled: true,
                  receipt: {
                    receipt_id: receipt.receipt_id,
                    tx_hash: settledTxHash,
                    amount_usd: cfg.priceUsd,
                    network: cfg.network,
                    free_on_miss: true,
                  },
                },
                null,
                2
              ),
            },
          ],
        },
      });
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    });
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}
