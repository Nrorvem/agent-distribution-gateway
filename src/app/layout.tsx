import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Apollo.io B2B Person Enrichment & Verified Work Email Finder (x402)",
  description:
    "Zero-signup, pay-per-match B2B Person Enrichment, Executive Work Email Finder, and LinkedIn-to-Email Resolver powered by Apollo.io ($0.03 USDC on Base via x402 v2 — Free-on-Miss).",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Apollo.io B2B Person Enrichment & Verified Work Email Finder (x402)",
    siteName: "Apollo.io B2B Person Enrichment & Verified Work Email Finder",
    description:
      "Zero-signup, pay-per-match B2B Person Enrichment, Executive Work Email Finder, and LinkedIn-to-Email Resolver powered by Apollo.io ($0.03 USDC on Base via x402 v2 — Free-on-Miss).",
  },
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
