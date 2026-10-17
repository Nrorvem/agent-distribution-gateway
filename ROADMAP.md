# Agent Distribution Gateway — 3-Front Roadmap

This repository implements an **Agentic Broker / Distribution Gateway** designed to bridge non-agent-native products and services into zero-signup, pay-per-execution endpoints for autonomous AI agents.

## The 3-Front Strategy

We are pushing all three fronts sequentially inside a unified gateway architecture (`src/verticals/`):

| Front | Vertical | Supply Source | Target Agent Buyer | Protocol & Payment Stack | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Option A** | **Unbundled SaaS Utility Broker** | **Apollo.io** (`/api/v1/people/match` Person Enrichment) | Sales, coding, and autonomous research agents | **MCP** (`/api/mcp`) + **REST `x402`** (`$0.10` USDC on Base) | **Active (Phase 1)** |
| **Option B** | **Digital Infrastructure Concierge** | Ephemeral sandboxes, domains, or SMS/telecom APIs | Autonomous dev/ops agents spinning up projects | **MCP / A2A** (`/.well-known/agent.json`) + **`x402` / Stripe MPP** | **Planned (Phase 2)** |
| **Option C** | **Physical Niche Aggregator** | High-margin custom swag / print-on-demand / gifting | Personal assistants & corporate procurement agents | **Google UCP** (`/.well-known/ucp`) + **OpenAI ACP / Stripe SPT** | **Planned (Phase 3)** |

---

## Phase 1 (Today): Option A — Apollo.io Person Enrichment Broker

### Why Apollo Person Enrichment Works as Wedge #1
1. **High Human Friction:** Standard users must sign up for Apollo and commit to an annual/monthly subscription just to enrich a handful of leads.
2. **Unit Economics Arbitrage:**
   - **Your Wholesale Cost:** ~1 Apollo email credit per matched person (`reveal_phone_number: false` enforced to prevent 8-credit mobile charges).
   - **Agent Retail Price:** `$0.10 USDC` per enriched match via `x402` on Base.
   - **Zero-Match Protection:** If Apollo finds no match for the requested person, the connector flags `matched: false` so you can avoid charging or issue a retry credit.

### The 4-Layer Architecture Implemented Here
1. **Layer 1 — Supply Connector (`src/verticals/option-a-apollo/connector.ts`):**
   Connects to `POST https://api.apollo.io/api/v1/people/match` using your master `APOLLO_API_KEY`, enforces credit guardrails (`reveal_phone_number: false`), and normalizes the response.
2. **Layer 2 — Machine Schema (`src/verticals/option-a-apollo/schema.ts`):**
   Strict JSON schemas for input identifiers (`first_name`, `last_name`, `domain`, `organization_name`, `linkedin_url`, `email`) and deterministic output (`verified_email`, `title`, `seniority`, `organization`, `employment_history`, `match_confidence`).
3. **Layer 3 — Zero-Auth Payment Gate (`src/lib/x402-gate.ts`, `src/app/api/mcp/route.ts`, `src/app/api/v1/enrich/person/route.ts`):**
   Implements both MCP (`paidTool`) and REST HTTP `402 Payment Required` challenges on Base (USDC). Payment acts as the authentication credential.
4. **Layer 4 — Discovery Registration (`src/app/.well-known/agent.json/route.ts`, `src/app/llms.txt/route.ts`):**
   Publishes the A2A Agent Card (`/.well-known/agent.json`) and `/llms.txt` so agent directories (x402 Bazaar, Smithery, Official MCP Registry, Glama) and web-crawling agents can index the service automatically.
