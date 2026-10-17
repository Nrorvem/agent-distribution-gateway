# Step 3: Public Deployment & Agent Directory Registration Guide

Your gateway exposes four live machine-native endpoints once deployed to Vercel:

| Endpoint | Path | Purpose |
| :--- | :--- | :--- |
| **MCP Server (Streamable HTTP)** | `https://<YOUR_DOMAIN>/api/mcp` | Primary endpoint for Claude Code, Cursor, Smithery, Glama, and `x402-mcp` agents |
| **REST `x402` Endpoint** | `https://<YOUR_DOMAIN>/api/v1/enrich/person` | Direct `HTTP 402` endpoint for `x402` Bazaar and HTTP buyer agents |
| **A2A Agent Card** | `https://<YOUR_DOMAIN>/.well-known/agent.json` | Open-web discovery card advertising schemas, pricing, and verifiable `txHashes` |
| **LLM Manifest** | `https://<YOUR_DOMAIN>/llms.txt` | Markdown documentation for web-crawling agents |

---

## 1. Environment Variables Required in Vercel

When deploying to Vercel (via CLI or Dashboard), set these 5 environment variables:

```env
APOLLO_API_KEY=<your_scoped_apollo_api_key>
APOLLO_MOCK_MODE=false
X402_WALLET_ADDRESS=0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC
X402_NETWORK=base
X402_ENRICH_PRICE_USD=0.10
X402_FACILITATOR_URL=https://x402.org/facilitator
```

*(Note: In production on Vercel, either omit `X402_DEV_BYPASS_TOKEN` or set it to a long random secret that only you know so external agents must pay real USDC on Base.)*

---

## 2. Where to Register Your Live Endpoint (Layer 4 Distribution)

Once your `https://<YOUR_DOMAIN>.vercel.app` URL is live:

### A. Coinbase `x402` Bazaar (Automatic + Manual Discovery)
- **How `x402` Bazaar indexes your endpoint:**
  Coinbase’s `x402` Facilitator automatically indexes resources (`resource: "https://<YOUR_DOMAIN>/api/v1/enrich/person"` and `/api/mcp`) when real `x402` payments settle through the Facilitator (`withBazaar` / discovery catalog) or when submitted to the `x402` ecosystem directory.
- **Cold-Start Seeding Tip:**
  Run 5–10 real `\$0.10` USDC calls against `https://<YOUR_DOMAIN>/api/v1/enrich/person` using a buyer wallet (`@coinbase/payments-mcp` or `x402-fetch`). Because the `\$0.10` USDC transfers directly to your own Ledger wallet (`0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC`), your net cost is `\$0.00` while your endpoint registers real on-chain volume and `txHashes`.

### B. Smithery (`https://smithery.ai/new`)
- Connect your GitHub repository or submit your remote Streamable HTTP URL:
  `https://<YOUR_DOMAIN>/api/mcp`
- Smithery automatically reads `smithery.yaml` and calls `POST /api/mcp` (`tools/list`) to index `get_enrichment_quote` and `enrich_person`.

### C. Glama MCP Directory (`https://glama.ai/mcp/servers`)
- Submit your repository / URL; Glama reads `glama.json` at the repo root and indexes your tool definitions and semantic tags.

### D. PulseMCP (`https://www.pulsemcp.com/submit`) & `mcpservers.org`
- Submit:
  - **Name:** `Apollo.io B2B Person Enrichment & Work Email Finder (x402)`
  - **Server URL:** `https://<YOUR_DOMAIN>/api/mcp`
  - **Agent Card:** `https://<YOUR_DOMAIN>/.well-known/agent.json`
  - **Description:** Zero-signup B2B Person Enrichment, Executive Work Email Finder, and LinkedIn-to-Email Resolver powered by Apollo.io (`$0.10` USDC per call via `x402` on Base).
