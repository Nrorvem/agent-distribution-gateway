import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Agent Distribution Gateway — Option A: Apollo.io Broker",
  description:
    "Zero-signup, pay-per-call B2B Person Enrichment for AI agents via MCP & x402 on Base.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace",
          backgroundColor: "#0a0e17",
          color: "#e2e8f0",
        }}
      >
        {children}
      </body>
    </html>
  );
}
