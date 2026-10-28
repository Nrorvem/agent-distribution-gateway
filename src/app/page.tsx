"use client";

import React, { useState } from "react";

export default function GatewayDashboard() {
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

      const res = await fetch("/api/v1/enrich/person", {
        method: "POST",
        headers,
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          domain,
        }),
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
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px" }}>
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
          ZERO-SIGNUP B2B INTELLIGENCE • x402 v2 & MCP LIVE
        </div>
        <h1 style={{ margin: "0 0 8px 0", fontSize: 28, color: "#f8fafc" }}>
          Apollo.io B2B Person Enrichment & Verified Work Email Finder
        </h1>
        <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.5 }}>
          Unbundling annual B2B data subscriptions into zero-signup, pay-per-match (`$0.03 USDC` on Base — Free-on-Miss)
          endpoints for autonomous AI agents.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {[
          {
            label: "A2A Agent Card",
            path: "/.well-known/agent.json",
            desc: "Machine discovery & SLA telemetry",
          },
          {
            label: "LLM Manifest",
            path: "/llms.txt",
            desc: "Markdown instructions for web agents",
          },
          {
            label: "MCP Server",
            path: "/api/mcp",
            desc: "JSON-RPC 2.0 Streamable HTTP + paidTool",
          },
          {
            label: "REST x402 Endpoint",
            path: "/api/v1/enrich/person",
            desc: "HTTP 402 challenge & USDC settlement",
          },
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
            <code
              style={{
                display: "block",
                marginTop: 6,
                fontSize: 13,
                color: "#f1f5f9",
              }}
            >
              {ep.path}
            </code>
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
              {ep.desc}
            </div>
          </a>
        ))}
      </section>

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
            Test how an autonomous agent interacts with <code>POST /api/v1/enrich/person</code> with and without an <code>X-PAYMENT</code> header.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
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
              Attach signed <code>X-PAYMENT</code> proof ($0.03 USDC — Free on Miss)
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
              maxHeight: 420,
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
