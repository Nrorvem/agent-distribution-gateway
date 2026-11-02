import { NextResponse } from "next/server";
import { isApolloMockMode } from "@/verticals/option-a-apollo/apollo-client";

interface CachedHealth {
  timestamp: number;
  data: {
    apollo: "ok" | "degraded";
    minute_usage_pct: number;
  };
}

let healthCache: CachedHealth | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

export async function GET() {
  const now = Date.now();
  if (healthCache && now - healthCache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      ...healthCache.data,
      cached: true,
    });
  }

  if (isApolloMockMode()) {
    const data = { apollo: "ok" as const, minute_usage_pct: 0 };
    healthCache = { timestamp: now, data };
    return NextResponse.json({ ...data, cached: false });
  }

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { apollo: "degraded", minute_usage_pct: 0, error: "Missing upstream credentials" },
      { status: 503 }
    );
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://api.apollo.io/api/v1/usage_stats/api_usage_stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const data = { apollo: "degraded" as const, minute_usage_pct: 0 };
      healthCache = { timestamp: now, data };
      return NextResponse.json(data, { status: 503 });
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    let maxPct = 0;

    for (const val of Object.values(json)) {
      if (val && typeof val === "object" && val.minute && typeof val.minute.limit === "number") {
        const { limit, consumed } = val.minute;
        if (limit > 0 && typeof consumed === "number") {
          const pct = (consumed / limit) * 100;
          if (pct > maxPct) maxPct = pct;
        }
      }
    }

    const data = {
      apollo: "ok" as const,
      minute_usage_pct: Number(maxPct.toFixed(2)),
    };
    healthCache = { timestamp: now, data };
    return NextResponse.json({ ...data, cached: false });
  } catch {
    const data = { apollo: "degraded" as const, minute_usage_pct: 0 };
    return NextResponse.json(data, { status: 503 });
  }
}
