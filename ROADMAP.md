# Agent Distribution Gateway — 3-Front Roadmap

This repository implements an **Agentic Broker / Distribution Gateway** designed to bridge non-agent-native products and services into zero-signup, pay-per-execution endpoints for autonomous AI agents.

## The 3-Front Strategy

We are pushing all three fronts sequentially inside a unified gateway architecture (`src/verticals/`):

| Front | Vertical | Supply Source | Target Agent Buyer | Protocol & Payment Stack | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Option A** | **Full-Funnel B2B Data Gateway** | **Apollo.io** (Search + Single & Bulk Enrichment) | Sales, coding, and autonomous research agents | **MCP** (`/api/mcp`) + **REST `x402`** (`$0.01–$0.03` USDC on Base) | **Shipped (Phase 1 & Phase 1b)** |
| **Option B** | **Digital Infrastructure Concierge** | Ephemeral sandboxes, domains, or SMS/telecom APIs | Autonomous dev/ops agents spinning up projects | **MCP / A2A** (`/.well-known/agent.json`) + **`x402` / Stripe MPP** | **Planned (Phase 2)** |
| **Option C** | **Physical Niche Aggregator** | High-margin custom swag / print-on-demand / gifting | Personal assistants & corporate procurement agents | **Google UCP** (`/.well-known/ucp`) + **OpenAI ACP / Stripe SPT** | **Planned (Phase 3)** |

---

## Phase 1 & 1b (Shipped): Option A — Apollo.io Full-Funnel Suite

### Product Surface & Catalog Pricing
1. **People Search (`/api/v1/search/people`, tool: `search_people`)**: `$0.01 / page` (0 credits upstream).
2. **Organization Search (`/api/v1/search/organizations`, tool: `search_organizations`)**: `$0.02 / page`.
3. **Person Enrichment (`/api/v1/enrich/person`, tool: `enrich_person`)**: `$0.03 / call` (Free-on-Miss: $0.00 charged if no deliverable email is returned).
4. **Organization Enrichment (`/api/v1/enrich/organization`, tool: `enrich_organization`)**: `$0.02 / call`.
5. **Bulk People Enrichment (`/api/v1/enrich/people/bulk`, tool: `bulk_enrich_people`)**: `$0.025 / record` (≤10).
6. **Bulk Organization Enrichment (`/api/v1/enrich/organizations/bulk`, tool: `bulk_enrich_organizations`)**: `$0.015 / domain` (≤10).

### The 4-Layer Architecture Implemented Here
1. **Layer 1 — Supply Connectors (`src/verticals/option-a-apollo/*connector.ts`):**
   Connects to Apollo.io endpoints using `APOLLO_API_KEY`, strictly enforces credit guardrails (`reveal_phone_number: false`), and normalizes responses into clean contracts.
2. **Layer 2 — Machine Schemas (`src/verticals/option-a-apollo/*schema.ts`):**
   Strict JSON schemas, pre-payment input validators, and chaining guidance (`next_step`).
3. **Layer 3 — Zero-Auth Payment Gate (`src/lib/x402-gate.ts`, `src/lib/paid-route.ts`, `src/lib/paid-mcp.ts`):**
   HTTP `402 Payment Required` challenges on Base USDC (EIP-3009 Path B via CDP Facilitator and PayAI fallback).
4. **Layer 4 — Multi-Surface Discovery (`catalog.ts`, `agent.json`, `x402`, `openapi.json`, `llms.txt`, `/api/mcp`):**
   Single source of truth catalog powering 6 discovery surfaces for Smithery, Glama, x402scan, Coinbase Bazaar, and web-crawling LLM agents.
