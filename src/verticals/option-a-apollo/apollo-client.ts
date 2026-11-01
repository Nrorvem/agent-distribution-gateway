/**
 * Shared Apollo.io HTTP Client
 *
 * Provides a resilient fetch wrapper for Apollo.io API requests with:
 * - 8-second timeout via AbortController
 * - Automatic JSON parsing
 * - API key sanitization (never logged or leaked in error messages)
 * - Error message truncation to 300 chars
 * - Mock mode detection
 */

const APOLLO_BASE_URL = "https://api.apollo.io";

export function isApolloMockMode(): boolean {
  if (process.env.APOLLO_MOCK_MODE === "true") return true;
  const key = process.env.APOLLO_API_KEY;
  return !key || key === "mock_key" || key === "test_api_key";
}

export interface ApolloRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  apiKey?: string;
  timeoutMs?: number;
}

export async function apolloRequest<T>(
  method: "GET" | "POST",
  apiPath: string,
  options: ApolloRequestOptions = {}
): Promise<T> {
  const apiKey = options.apiKey || process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing APOLLO_API_KEY in environment");
  }

  const cleanPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = new URL(`${APOLLO_BASE_URL}${cleanPath}`);

  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": apiKey,
      },
      body: method === "POST" && options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const rawText = await res.text().catch(() => "Unknown Apollo error");
      const safeText = rawText.replace(new RegExp(apiKey, "g"), "[REDACTED_API_KEY]").slice(0, 300);
      throw new Error(`Apollo API error (HTTP ${res.status}): ${safeText}`);
    }

    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      throw new Error(`Apollo API request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}
