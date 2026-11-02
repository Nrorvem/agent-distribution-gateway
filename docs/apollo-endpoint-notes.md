# Apollo Upstream Endpoints & Empirical Probe Findings

This document records the empirical probe results and official schema notes for Apollo.io API endpoints tested against the live API key.

## Authentication & Headers
- Header: `x-api-key: <APOLLO_API_KEY>`
- Content-Type: `application/json`
- Rate Limit Headers observed:
  - `x-rate-limit-minute`: `200` (search / usage stats) or `1000` (enrichment)
  - `x-minute-usage`: current minute count
  - `x-rate-limit-hourly`: `6000` (or `400` on usage stats)
  - `x-hourly-usage`: current hourly count
  - `x-rate-limit-24-hour`: `50000` (or `2000` on usage stats)
  - `x-24-hour-usage`: 24h count

---

## 1. People Search (`mixed_people/api_search`)
- **Status:** **200 OK** (Verified live)
- **Path:** `POST https://api.apollo.io/api/v1/mixed_people/api_search`
- **Credit Cost:** **0 credits** (Returns partial identities with obfuscated last names and `has_email: true` flags)
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
- **Observed Response Structure:**
  ```json
  {
    "total_entries": 1,
    "people": [
      {
        "id": "658823a94919ba0001e34fa9",
        "first_name": "Prashant",
        "last_name_obfuscated": "Ya***v",
        "title": "Senior Frontend Engineer",
        "last_refreshed_at": "2026-10-13T15:14:56.000+00:00",
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
- **Funnel Integration:** The returned `id` feeds `POST /api/v1/enrich/person` (`enrich_person`) or `POST /api/v1/enrich/people/bulk` via the `unlock` hint.

---

## 2. Organization Search (`mixed_companies/search`)
- **Status:** **200 OK** (Verified live on updated API key scope)
- **Path:** `POST https://api.apollo.io/api/v1/mixed_companies/search`
- **Credit Cost:** 0 credits
- **Observed Response Structure:**
  - Returns `organizations` and `accounts` arrays with full firmographic summaries: `id`, `name`, `primary_domain`, `website_url`, `industry`, `estimated_num_employees`, `founded_year`, `city`, `country`.
- **Funnel Integration:** Organization `id` directly feeds `search_people { organization_ids: [id] }` or `enrich_organization { domain }`.

---

## 3. Organization Enrich (`organizations/enrich`)
- **Status:** **200 OK** (Verified live)
- **Path:** `GET https://api.apollo.io/api/v1/organizations/enrich?domain={domain}`
- **Credit Cost:** 1 credit per enriched profile
- **Observed Response Structure:**
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
  - `technology_names`: `string[]` (216+ technologies)
  - `departmental_head_count`: `{ engineering: 150, sales: 250, ... }`

---

## 4. Bulk Organization Enrich (`organizations/bulk_enrich`)
- **Status:** **200 OK** (Verified live on updated API key scope)
- **Path:** `POST https://api.apollo.io/api/v1/organizations/bulk_enrich`
- **Payload:** `{ "domains": ["apollo.io", "nonexistentdomainxyz123.com"] }`
- **Observed Response Structure:**
  - `organizations` array is **index-aligned** with the input `domains` array.
  - Matches contain full organization records; non-matches contain `null` entries.
  - Returns `total_requested_records`, `unique_enriched_records`, and `missing_records`.

---

## 5. Bulk Person Match (`people/bulk_match`)
- **Status:** **200 OK** (Verified live on updated API key scope)
- **Path:** `POST https://api.apollo.io/api/v1/people/bulk_match`
- **Payload:** `{ "details": [...], "reveal_personal_emails": false, "reveal_phone_number": false }`
- **Credit Guardrail:** Always `reveal_phone_number: false`.
- **Observed Response Structure:**
  - `matches` array is **index-aligned** with the input `details` array.
  - Matches contain full person profiles including deliverable work `email`, `title`, and `organization`.
  - Non-matches contain `null` entries.
  - Returns `credits_consumed`, `unique_enriched_records`, and `missing_records`.

---

## 6. API Usage Stats (`usage_stats/api_usage_stats`)
- **Status:** **200 OK** (Verified live)
- **Path:** `POST https://api.apollo.io/api/v1/usage_stats/api_usage_stats`
- **Credit Cost:** 0 credits
- **Observed Response Structure:**
  - Returns endpoint rate limits and consumption statistics broken down by `day`, `hour`, and `minute` with `{ limit, consumed, left_over }`.
  - Powers the gateway health check endpoint (`GET /api/v1/health`).

---

## Summary of Upstream Endpoints
| # | Product | REST route | Upstream | Upstream Status | Strategy |
|---|---|---|---|---|---|
| 1 | People Search | `/api/v1/search/people` | `POST /api/v1/mixed_people/api_search` | **Verified 200 OK** (0 credits) | Direct live upstream |
| 2 | Org Search | `/api/v1/search/organizations` | `POST /api/v1/mixed_companies/search` | **Verified 200 OK** (0 credits) | Direct live upstream |
| 3 | Person Enrich | `/api/v1/enrich/person` | `POST /api/v1/people/match` | **Verified 200 OK** | Direct live upstream |
| 4 | Org Enrich | `/api/v1/enrich/organization` | `GET /api/v1/organizations/enrich` | **Verified 200 OK** | Direct live upstream |
| 5 | Bulk Person Enrich | `/api/v1/enrich/people/bulk` | `POST /api/v1/people/bulk_match` | **Verified 200 OK** | Direct live upstream + parallel fallback |
| 6 | Bulk Org Enrich | `/api/v1/enrich/organizations/bulk` | `POST /api/v1/organizations/bulk_enrich` | **Verified 200 OK** | Direct live upstream + parallel fallback |
| 7 | Health Check | `/api/v1/health` | `POST /api/v1/usage_stats/api_usage_stats` | **Verified 200 OK** | Cached health monitoring |
