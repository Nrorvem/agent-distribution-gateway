import { NextRequest, NextResponse } from "next/server";
import { getGateConfig } from "@/lib/x402-gate";

/**
 * Layer 4: Open-Web Protocol Discovery — /llms.txt
 * Provides a clean, structured Markdown manifest for LLM agents browsing the root domain.
 */
export async function GET(req: NextRequest) {
  const cfg = getGateConfig();
  const origin =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const content = `# Apollo.io B2B Person Enrichment & Verified Work Email Finder (x402 + MCP)

> Zero-signup, pay-per-call B2B Person Enrichment for autonomous AI agents. No account creation, monthly subscription, or API key required. Payment via \`x402\` (${cfg.priceUsd} USDC on ${cfg.networkCaip2}) acts as authentication.

## Machine Discovery & Protocol Endpoints

- **A2A Agent Card**: ${origin}/.well-known/agent.json
- **MCP Server (Streamable HTTP)**: ${origin}/api/mcp
- **Direct REST x402 Endpoint**: ${origin}/api/v1/enrich/person

## How an Autonomous Agent Executes a Purchase

1. **Inspect Schema & Pricing (Free)**:
   \`GET ${origin}/api/v1/enrich/person\` or call MCP tool \`get_enrichment_quote\`.
2. **Submit Enrichment Request**:
   \`POST ${origin}/api/v1/enrich/person\` with JSON body:
   \`\`\`json
   {
     "first_name": "Tim",
     "last_name": "Zheng",
     "domain": "apollo.io"
   }
   \`\`\`
3. **Handle HTTP 402 Challenge**:
   If no \`X-PAYMENT\` header is present, the server responds with \`HTTP 402 Payment Required\` and an \`x402Version: 1\` challenge specifying \`${cfg.atomicUnits}\` atomic USDC units ($${cfg.priceUsd}) payable to \`${cfg.payTo}\` on \`${cfg.network}\`.
4. **Retry with Signed x402 Proof**:
   Attach the signed USDC payment proof in the \`X-PAYMENT\` header (or via \`x402-mcp\` / \`@coinbase/payments-mcp\`). The server settles the payment and returns the deterministic JSON profile + cryptographic receipt immediately.
`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
