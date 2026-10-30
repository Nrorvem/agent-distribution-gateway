import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        // Canonicalize www.enrichmatch.dev -> enrichmatch.dev
        source: "/:path*",
        has: [{ type: "host", value: "www.enrichmatch.dev" }],
        destination: "https://enrichmatch.dev/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
