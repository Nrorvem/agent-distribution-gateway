"use client";

import React, { useState } from "react";

const PRODUCTS_TABLE = [
  {
    id: "search_organizations",
    name: "Organization Search",
    path: "/api/v1/search/organizations",
    stage: "Search",
    price: "$0.02 / page",
    billingRule: "Settled if ≥ 1 company found ($0.00 on miss)",
  },
  {
    id: "search_people",
    name: "People Search",
    path: "/api/v1/search/people",
    stage: "Search",
    price: "$0.01 / page",
    billingRule: "Settled if ≥ 1 person found (0 credits upstream)",
  },
  {
    id: "enrich_person",
    name: "Person Enrich",
    path: "/api/v1/enrich/person",
    stage: "Enrich",
    price: "$0.03 / call",
    billingRule: "Settled if deliverable email found ($0.00 on miss)",
  },
  {
    id: "enrich_organization",
    name: "Organization Enrich",
    path: "/api/v1/enrich/organization",
    stage: "Enrich",
    price: "$0.02 / call",
    billingRule: "Settled if company resolved ($0.00 on miss)",
  },
  {
    id: "bulk_enrich_people",
    name: "Bulk People Enrich",
    path: "/api/v1/enrich/people/bulk",
    stage: "Bulk",
    price: "$0.025 / record",
    billingRule: "Settled if ≥ 1 deliverable email found (≤ 10 profiles)",
  },
  {
    id: "bulk_enrich_organizations",
    name: "Bulk Org Enrich",
    path: "/api/v1/enrich/organizations/bulk",
    stage: "Bulk",
    price: "$0.015 / domain",
    billingRule: "Settled if ≥ 1 company found (≤ 10 domains)",
  },
];

export default function GatewayDashboard() {
  const [selectedEndpoint, setSelectedEndpoint] = useState("/api/v1/enrich/person");
  const [firstName, setFirstName] = useState("Tim");
  const [lastName, setLastName] = useState("Zheng");
  const [domain, setDomain] = useState("apollo.io");
  const [attachPayment, setAttachPayment] = useState(false);
  const [responseLog, setResponseLog] = useState<string>(
    "// Click 'Simulate Agent Request' to test the HTTP 402 Challenge or Paid Execution"
  );
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function runSimulation() {
    setLoading(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (attachPayment) {
        headers["X-PAYMENT"] = "dev_test_payment_proof_2026";
      }

      let reqBody: unknown = {};
      if (selectedEndpoint === "/api/v1/enrich/person") {
        reqBody = { first_name: firstName, last_name: lastName, domain };
      } else if (selectedEndpoint === "/api/v1/search/people") {
        reqBody = { organization_domains: [domain], person_titles: ["CEO", "Founder"] };
      } else if (selectedEndpoint === "/api/v1/search/organizations") {
        reqBody = { organization_name: "Apollo", per_page: 2 };
      } else if (selectedEndpoint === "/api/v1/enrich/organization") {
        reqBody = { domain };
      } else if (selectedEndpoint === "/api/v1/enrich/people/bulk") {
        reqBody = { details: [{ first_name: firstName, last_name: lastName, domain }] };
      } else if (selectedEndpoint === "/api/v1/enrich/organizations/bulk") {
        reqBody = { domains: [domain, "stripe.com"] };
      }

      const res = await fetch(selectedEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
      });

      setStatusCode(res.status);
      const data = await res.json();
      setResponseLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setResponseLog(`Error: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ marginBottom: 32, borderBottom: "1px solid #1e293b", paddingBottom: 24 }}>
        <div
          style={{
            display: "inline-block",
            padding: "4px 10px",
            backgroundColor: "#1e3a8a",
            color: "#93c5fd",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          ZERO-SIGNUP FULL-FUNNEL B2B DATA • x402 v2 & MCP LIVE
        </div>
        <h1 style={{ margin: "0 0 8px 0", fontSize: 28, color: "#f8fafc" }}>
          Apollo.io Full-Funnel B2B Intelligence Gateway
        </h1>
        <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.5 }}>
          Unbundling annual B2B data subscriptions into zero-signup, pay-per-call (Search → Enrich → Settle on Base USDC)
          endpoints for autonomous AI agents. Free-on-Miss: $0.00 charged if no deliverable result is returned.
        </p>
      </header>

      {/* Discovery Links */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {[
          { label: "Product Catalog", path: "/api/v1/catalog", desc: "Full-funnel menu & chaining workflow" },
          { label: "A2A Agent Card", path: "/.well-known/agent.json", desc: "Machine discovery & SLA telemetry" },
          { label: "x402 Manifest", path: "/.well-known/x402", desc: "Standard x402 resource discovery" },
          { label: "MCP Server", path: "/api/mcp", desc: "JSON-RPC 2.0 Streamable HTTP tools" },
          { label: "OpenAPI 3.1.0", path: "/openapi.json", desc: "Schema contracts & x-payment-info" },
        ].map((ep) => (
          <a
            key={ep.path}
            href={ep.path}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              padding: 16,
              backgroundColor: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontSize: 13, color: "#60a5fa", fontWeight: 600 }}>
              {ep.label} ↗
            </div>
            <code style={{ display: "block", marginTop: 6, fontSize: 12, color: "#f1f5f9" }}>
              {ep.path}
            </code>
            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
              {ep.desc}
            </div>
          </a>
        ))}
      </section>

      {/* Full-Funnel Products Table */}
      <section
        style={{
          marginBottom: 32,
          backgroundColor: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 24,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18, color: "#f8fafc" }}>
          Full-Funnel Products (Search → Enrich)
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155", textAlign: "left", color: "#94a3b8" }}>
                <th style={{ padding: "8px 12px" }}>Stage</th>
                <th style={{ padding: "8px 12px" }}>Product</th>
                <th style={{ padding: "8px 12px" }}>Endpoint</th>
                <th style={{ padding: "8px 12px" }}>Price</th>
                <th style={{ padding: "8px 12px" }}>Billing Guarantee</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS_TABLE.map((p) => (
                <tr
                  key={p.id}
                  style={{
                    borderBottom: "1px solid #1e293b",
                    backgroundColor: selectedEndpoint === p.path ? "#1e293b" : "transparent",
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedEndpoint(p.path)}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 11,
                        backgroundColor: p.stage === "Search" ? "#065f46" : p.stage === "Enrich" ? "#1e3a8a" : "#6b21a8",
                        color: "#f8fafc",
                      }}
                    >
                      {p.stage}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "#f8fafc" }}>
                    {p.name}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <code style={{ color: "#38bdf8" }}>{p.path}</code>
                  </td>
                  <td style={{ padding: "10px 12px", color: "#34d399", fontWeight: 600 }}>
                    {p.price}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12 }}>
                    {p.billingRule}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive Simulator */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.3fr",
          gap: 24,
          backgroundColor: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 24,
        }}
      >
        <div>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>
            Interactive Buyer Agent Simulator
          </h2>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>
            Simulate how an autonomous agent interacts with paid gateway endpoints with and without an <code>X-PAYMENT</code> header.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            <label style={{ fontSize: 13 }}>
              Target Endpoint
              <select
                value={selectedEndpoint}
                onChange={(e) => setSelectedEndpoint(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "#0f172a",
                  color: "#f8fafc",
                }}
              >
                {PRODUCTS_TABLE.map((p) => (
                  <option key={p.id} value={p.path}>
                    {p.name} ({p.path})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 13 }}>
              First Name
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "#0f172a",
                  color: "#f8fafc",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              Last Name
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "#0f172a",
                  color: "#f8fafc",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              Company Domain
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "#0f172a",
                  color: "#f8fafc",
                }}
              />
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                marginTop: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={attachPayment}
                onChange={(e) => setAttachPayment(e.target.checked)}
              />
              Attach signed <code>X-PAYMENT</code> proof (Free on Miss)
            </label>

            <button
              onClick={runSimulation}
              disabled={loading}
              style={{
                marginTop: 8,
                padding: "10px 16px",
                backgroundColor: attachPayment ? "#10b981" : "#3b82f6",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {loading
                ? "Executing..."
                : attachPayment
                ? "Execute Paid Agent Call (Expect HTTP 200)"
                : "Call Without Payment (Expect HTTP 402 Challenge)"}
            </button>
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
              Gateway Response
            </span>
            {statusCode && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  backgroundColor:
                    statusCode === 200
                      ? "#065f46"
                      : statusCode === 402
                      ? "#92400e"
                      : "#7f1d1d",
                  color: "#ffffff",
                }}
              >
                HTTP {statusCode}{" "}
                {statusCode === 402
                  ? "Payment Required (x402)"
                  : statusCode === 200
                  ? "OK (Paid & Fulfilled)"
                  : ""}
              </span>
            )}
          </div>
          <pre
            style={{
              margin: 0,
              padding: 16,
              backgroundColor: "#090d16",
              border: "1px solid #1e293b",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.45,
              overflowX: "auto",
              maxHeight: 480,
              color: "#e2e8f0",
            }}
          >
            {responseLog}
          </pre>
        </div>
      </section>
    </main>
  );
}
