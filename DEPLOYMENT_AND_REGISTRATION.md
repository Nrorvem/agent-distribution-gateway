# Public Deployment & Agent Directory Registration Guide

Your gateway exposes six live machine-native endpoints on EnrichMatch (`https://enrichmatch.dev`):

| Endpoint | Path | Purpose |
| :--- | :--- | :--- |
| **Paid REST `x402 v2` Endpoint** | `POST /api/v1/enrich/person` | Direct `HTTP 402` (`x402Version: 2`) endpoint for `x402scan`, Coinbase Bazaar, and autonomous HTTP buyer agents |
| **MCP Server (Streamable HTTP)** | `GET/POST /api/mcp` | Primary endpoint for Claude Code, Cursor, Smithery, Glama, and `x402-mcp` agents |
| **OpenAPI 3.1.0 Discovery Spec** | `GET /openapi.json` | Canonical `x402scan` / Poncho / AgentCash discovery document (`info.contact.email`, `info.x-guidance`, `x-payment-info`) |
| **x402 Resource Manifest** | `GET /.well-known/x402` | Machine-readable x402 v2 resource discovery index |
| **A2A Agent Card** | `GET /.well-known/agent.json` | Open-web A2A discovery card advertising schemas, pricing, and verifiable BaseScan `txHashes` |
| **LLM Manifest** | `GET /llms.txt` | Markdown documentation for web-crawling agents |

---

## 1. Environment Variables in Vercel Production

Push environment variables directly from `.env.local` to Vercel Production via CLI:

```bash
npx --yes vercel link
/opt/homebrew/bin/node --experimental-strip-types scripts/push-vercel-env.ts
```

Required production variables:
```env
APOLLO_API_KEY=<your_scoped_apollo_api_key>
APOLLO_MOCK_MODE=false
X402_WALLET_ADDRESS=0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC
X402_NETWORK=base
X402_ENRICH_PRICE_USD=0.03
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=<your_cdp_api_key_id>
CDP_API_KEY_SECRET=<your_cdp_api_key_secret>
```

---

## 2. Discovery & Distribution Channels (Layer 4)

### A. `x402scan` / Poncho (`https://www.x402scan.com/resources/register`)
- Submit origin: `https://enrichmatch.dev` (or fallback `https://agent-distribution-gateway.vercel.app`).
- `x402scan` automatically fetches `/openapi.json`, verifies `x402Version: 2` (`eip155:8453`, `PAYMENT-REQUIRED` header), loads `/favicon.ico`, and verifies origin ownership via `info.contact.email` (`info@nrorvem.com`).

### B. Official Coinbase `x402` Bazaar (`https://api.cdp.coinbase.com/platform/v2/x402`)
- When `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are active on Vercel, running a single real `$0.03 USDC` call via:
  ```bash
  /opt/homebrew/bin/node --experimental-strip-types scripts/live-onchain-buyer.ts
  ```
  settles through Coinbase's Official Facilitator with `extensions.bazaar` attached, automatically indexing the endpoint into Coinbase's x402 Bazaar catalog while settling the `$0.03 USDC` back into your Ledger wallet (`0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC`).

### C. Smithery (`https://smithery.ai`) & Glama (`https://glama.ai/mcp/servers`)
- Connected to GitHub (`https://github.com/Nrorvem/agent-distribution-gateway`) and live MCP URL (`https://enrichmatch.dev/api/mcp`).
- Reads `smithery.yaml`, `glama.json`, and `server.json` at the repo root and dynamically queries `POST /api/mcp` (`tools/list`).

### D. Community `x402bazaar.org`
- Terminal registration script (uses lowercase `ownerAddress` to bypass `Wintyx57/x402-backend`'s mixed-case EIP-191 bug):
  ```bash
  /opt/homebrew/bin/node --experimental-strip-types scripts/register-x402bazaar.ts
  ```
