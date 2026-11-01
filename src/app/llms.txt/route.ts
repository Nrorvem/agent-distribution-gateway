import { NextRequest, NextResponse } from "next/server";
import { getGateConfig, resolveGatewayOrigin } from "@/lib/x402-gate";
import { APOLLO_PRODUCTS } from "@/verticals/option-a-apollo/catalog";

/**
 * Layer 4: Open-Web Protocol Discovery — /llms.txt
 * Provides a clean, structured Markdown manifest for LLM agents browsing the root domain.
 */
export async function GET(req: NextRequest) {
  const origin = resolveGatewayOrigin(req);
  const cfg = getGateConfig(origin);

  const productList = APOLLO_PRODUCTS.map(
    (p) => `- **${p.title}** (\`${p.path}\`, MCP: \`${p.mcpTool}\`): $${p.pricing.unitUsd()} USDC / ${p.pricing.per} — ${p.pricing.billingRule}`
  ).join("\n");

  const content = `# Apollo.io Full-Funnel B2B Data Gateway (x402 v2 + MCP)

> Zero-signup, pay-per-call B2B Intelligence suite for autonomous AI agents. No monthly subscription or API key required. Payment via \`x402 v2\` on Base Mainnet (${cfg.networkCaip2}) acts as authentication.
> **Free-on-Miss Guarantee**: payments are verified first and ONLY settled on-chain when verified deliverable data is returned ($0.00 charged on misses).

## Machine Discovery & Protocol Endpoints

- **Product Catalog (Free)**: ${origin}/api/v1/catalog
- **OpenAPI 3.1.0 Spec**: ${origin}/openapi.json
- **x402 Discovery Manifest**: ${origin}/.well-known/x402
- **A2A Agent Card**: ${origin}/.well-known/agent.json
- **MCP Server (Streamable HTTP)**: ${origin}/api/mcp

## Product Menu & Pricing

${productList}

## Full Funnel Workflow (Search → Enrich)

Agents chain these tools autonomously without human intervention:

\`\`\`
1. Search Organizations (POST /api/v1/search/organizations) -> returns primary_domain & org id
      ↓
2. Search People (POST /api/v1/search/people) -> returns apollo_id for decision makers
      ↓
3. Enrich Person (POST /api/v1/enrich/person) or Bulk Enrich (POST /api/v1/enrich/people/bulk)
      ↓
4. Result: Verified Deliverable Work Email & Direct Mobile Status ($0.00 if email not found)
\`\`\`

### Example 1: Search Organizations
\`\`\`bash
curl -X POST "${origin}/api/v1/search/organizations" \\
  -H "Content-Type: application/json" \\
  -d '{"keywords": "sales intelligence", "employee_ranges": ["51,200"]}'
\`\`\`

### Example 2: Search People (0 Credits Upstream)
\`\`\`bash
curl -X POST "${origin}/api/v1/search/people" \\
  -H "Content-Type: application/json" \\
  -d '{"organization_domains": ["apollo.io"], "person_titles": ["CEO", "VP Sales"]}'
\`\`\`

### Example 3: Enrich Person (Free on Miss)
\`\`\`bash
curl -X POST "${origin}/api/v1/enrich/person" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name": "Tim", "last_name": "Zheng", "domain": "apollo.io"}'
\`\`\`

### Example 4: Bulk Person Enrichment (Up to 10 Profiles)
\`\`\`bash
curl -X POST "${origin}/api/v1/enrich/people/bulk" \\
  -H "Content-Type: application/json" \\
  -d '{"details": [{"first_name": "Tim", "last_name": "Zheng", "domain": "apollo.io"}]}'
\`\`\`

### Example 5: Enrich Organization Firmographics & Tech Stack
\`\`\`bash
curl -X POST "${origin}/api/v1/enrich/organization" \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "apollo.io"}'
\`\`\`

## Payment Flow (x402 v2)
1. Probing without payment returns \`HTTP 402 Payment Required\` with a \`PAYMENT-REQUIRED\` Base64 header.
2. Sign the payment payload using EIP-3009 \`TransferWithAuthorization\` for the quoted atomic units.
3. Resend the request with \`PAYMENT-SIGNATURE: <base64_payload>\` (or \`X-PAYMENT\`).
4. On success, the response includes \`X-Payment-Settled: true\` and \`X-PAYMENT-RESPONSE\` receipt headers.
`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
