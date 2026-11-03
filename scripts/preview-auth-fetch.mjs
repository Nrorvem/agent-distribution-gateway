// Preload for testing protected Vercel preview deployments.
// Usage: export VERCEL_OIDC_TOKEN=<fresh token from `vercel env pull <tmpfile> --environment=development`>; node --import ./scripts/preview-auth-fetch.mjs --experimental-strip-types scripts/<script>.ts ...
// Adds x-vercel-trusted-oidc-idp-token (from VERCEL_OIDC_TOKEN) to every fetch to *.vercel.app. Never logs the token.
// NOTE: do NOT use `vercel env run` here; it loads the stale VERCEL_OIDC_TOKEN from .env.local (302 to login).
const token = (process.env.VERCEL_OIDC_TOKEN || "").trim();
if (!token) {
  console.error("[preview-auth-fetch] VERCEL_OIDC_TOKEN missing; run via `npx vercel env run -- ...`");
} else {
  const orig = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^https:\/\/[^/]+\.vercel\.app\//.test(url)) {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      headers.set("x-vercel-trusted-oidc-idp-token", token);
      init = { ...init, headers };
    }
    return orig(input, init);
  };
}
