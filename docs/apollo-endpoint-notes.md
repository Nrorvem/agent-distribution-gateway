# Apollo Upstream Endpoints & Probe Findings

This document records the empirical probe results and official schema notes for Apollo.io API endpoints tested on the live key in Phase 0.

## Authentication & Headers
- Header: `x-api-key: <APOLLO_API_KEY>`
- Content-Type: `application/json`
- Rate Limit Headers observed:
  - `x-rate-limit-minute`: e.g. `200` (search) or `1000` (enrichment)
  - `x-minute-usage`: current minute count
  - `x-rate-limit-hourly`: `6000`
  - `x-hourly-usage`: current hourly count
  - `x-rate-limit-24-hour`: `50000`
  - `x-24-hour-usage`: 24h count

---

## 1. People Search (`mixed_people/api_search`)
- **Status:** **200 OK** (Fully authorized & functional)
- **Path:** `POST https://api.apollo.io/api/v1/mixed_people/api_search`
- **Credit Cost:** **0 credits** (Search is free, returns obfuscated last names and flags like `has_email: true`)
- **Request Parameters:**
  - `q_organization_domains_list`: `string[]` (e.g. `["apollo.io"]`)
  - `person_titles`: `string[]` (e.g. `["ceo"]`)
  - `person_seniorities`: `string[]` (e.g. `["c_suite", "vp"]`)
  - `person_locations`: `string[]`
  - `organization_ids`: `string[]`
  - `organization_num_employees_ranges`: `string[]` (e.g. `["1,10"]`)
  - `q_keywords`: `string`
  - `page`: `number` (default 1)
  - `per_page`: `number` (default 10, capped at 25)
- **Response Structure:**
  ```json
  {
    "total_entries": 1,
    "people": [
      {
        "id": "64a7ff0cc4dfae00013df1a5",
        "first_name": "Matt",
        "last_name_obfuscated": "Cu***l",
        "title": "CEO",
        "last_refreshed_at": "2026-10-22T14:32:27.000+00:00",
        "has_email": true,
        "has_city": true,
        "has_state": true,
        "has_country": true,
        "has_direct_phone": "Yes",
        "organization": {
          "name": "Apollo.io",
          "has_industry": true,
          "has_phone": true,
          "has_city": true,
          "has_state": true,
          "has_country": true,
          "has_zip_code": true,
          "has_revenue": true,
          "has_employee_count": true
        }
      }
    ]
  }
  ```
- **Funnel Integration:** The returned `id` (`"64a7ff0cc4dfae00013df1a5"`) immediately feeds `POST /api/v1/enrich/person` (`enrich_person`) or `POST /api/v1/enrich/people/bulk`.

---

## 2. Organization Search (`mixed_companies/search`)
- **Status:** 403 `API_INACCESSIBLE` on current API key scope.
- **Path:** `POST https://api.apollo.io/api/v1/mixed_companies/search` (or fallback search)
- **Error:** `"This API key is not authorized to access api/v1/mixed_companies/search. Request an API key from your administrator that includes this endpoint in its configured scope."`
- **Handling Strategy:**
  - Standard Apollo schema implemented in `search-connector.ts`.
  - When live API returns 403 / scope denied or when in `APOLLO_MOCK_MODE=true`, gracefully falls back to deterministic mock search results or single enrichment if a domain is provided, with clear `TODO(verify-live)` marker.

---

## 3. Organization Enrich (`organizations/enrich`)
- **Status:** **200 OK** (Fully authorized & functional)
- **Path:** `GET https://api.apollo.io/api/v1/organizations/enrich?domain={domain}`
- **Credit Cost:** 1 credit (or 0 for cached/basic profile depending on tier)
- **Request Parameters:**
  - Query parameter: `domain` (e.g. `apollo.io`)
- **Response Structure (key fields verified):**
  - `id`: `"5e66b6381e05b4008c8331b8"`
  - `name`: `"Apollo.io"`
  - `website_url`: `"http://www.apollo.io"`
  - `primary_domain`: `"apollo.io"`
  - `industry`: `"information technology & services"`
  - `industries`: `["information technology & services", "sales intelligence"]`
  - `estimated_num_employees`: `800`
  - `founded_year`: `2015`
  - `annual_revenue`: `100000000`
  - `annual_revenue_printed`: `"$100M"`
  - `total_funding`: `151300000`
  - `total_funding_printed`: `"$151.3M"`
  - `latest_funding_stage`: `"Series D"`
  - `latest_funding_round_date`: `"2023-08-29T00:00:00.000+00:00"`
  - `phone`: `"(415) ..."`
  - `street_address`, `city`, `state`, `postal_code`, `country`
  - `short_description`: `"Apollo.io is the leading B2B sales intelligence..."`
  - `technology_names`: `string[]` (e.g. 216 technologies)
  - `departmental_head_count`: `{ engineering: 150, sales: 250, ... }`
- **Funnel Integration:** Organization `id` directly feeds `search_people { organization_ids: [id] }`.

---

## 4. Bulk Organization Enrich (`organizations/bulk_enrich`)
- **Status:** 403 `API_INACCESSIBLE` on current API key scope.
- **Path:** `POST https://api.apollo.io/api/v1/organizations/bulk_enrich`
- **Payload:** `{ "domains": ["apollo.io", "stripe.com"] }`
- **Handling Strategy:**
  - Implement connector following standard Apollo documentation.
  - As a resilient fallback when bulk endpoint is 403, connector can run concurrent single `organizations/enrich` calls (bounded at max 10) or return deterministic mock data in mock mode.

---

## 5. Bulk Person Match (`people/bulk_match`)
- **Status:** 403 `API_INACCESSIBLE` on current API key scope.
- **Path:** `POST https://api.apollo.io/api/v1/people/bulk_match`
- **Payload:** `{ "details": [{ "first_name": "...", "last_name": "...", "domain": "..." }], "reveal_personal_emails": false, "reveal_phone_number": false }`
- **Credit Guardrail:** Always `reveal_phone_number: false`.
- **Handling Strategy:**
  - Implement connector following standard Apollo documentation.
  - Can fall back to parallel `people/match` calls for up to 10 records or mock mode when scope is restricted.

---

## 6. Organization Job Postings (`organizations/{id}/job_postings`)
- **Status:** 403 `API_INACCESSIBLE` on current API key scope.
- **Handling Strategy:** Marked as stretch goal; mock mode fallback provided.

---

## Summary of §1 Product Surface & Upstream Status
| # | Product | REST route | Upstream | Upstream Status | Strategy |
|---|---|---|---|---|---|
| 1 | People Search | `/api/v1/search/people` | `POST /api/v1/mixed_people/api_search` | **Verified 200 OK** (0 credits) | Direct live upstream |
| 2 | Org Search | `/api/v1/search/organizations` | `POST /api/v1/mixed_companies/search` | Scope 403 | Live connector with mock fallback |
| 3 | Person Enrich | `/api/v1/enrich/person` | `POST /api/v1/people/match` | **Verified 200 OK** (Live in production) | Existing live upstream |
| 4 | Org Enrich | `/api/v1/enrich/organization` | `GET /api/v1/organizations/enrich` | **Verified 200 OK** | Direct live upstream |
| 5 | Bulk Person Enrich | `/api/v1/enrich/people/bulk` | `POST /api/v1/people/bulk_match` | Scope 403 | Bulk upstream + parallel match fallback |
| 6 | Bulk Org Enrich | `/api/v1/enrich/organizations/bulk` | `POST /api/v1/organizations/bulk_enrich` | Scope 403 | Bulk upstream + parallel enrich fallback |
