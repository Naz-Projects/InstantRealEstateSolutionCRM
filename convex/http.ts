import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// "Monitor the Web" (Zillow NCC deal-finder) — the Firecrawl Monitor webhook.
// Firecrawl POSTs to https://<deployment>.convex.site/firecrawl-monitor with an
// `X-Firecrawl-Signature: sha256=<hex>` header (HMAC-SHA256 of the raw body keyed
// with FIRECRAWL_WEBHOOK_SECRET). We verify the signature, then just trigger a
// scan (the payload shape isn't trusted — runMonitorScan re-scrapes). The daily
// cron is the safety net. Strictly additive. Spec §9 + §14. Runs in the default
// Convex runtime (not "use node"), so we use Web Crypto (crypto.subtle).

const enc = new TextEncoder();

/** Constant-time hex-string compare (equal length assumed; caller checks). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify `header` is an HMAC-SHA256 of `rawBody` keyed with `secret`. Accepts
 * both a bare hex digest and a `sha256=`-prefixed value. Constant-time compare.
 */
async function verifySignature(
  secret: string,
  rawBody: string,
  header: string,
): Promise<boolean> {
  const provided = (header.startsWith("sha256=") ? header.slice(7) : header).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqualHex(expected, provided);
}

const http = httpRouter();

http.route({
  path: "/firecrawl-monitor",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Read the RAW body first (needed for HMAC; a single read is all we get).
    const rawBody = await request.text();
    const secret = (process.env.FIRECRAWL_WEBHOOK_SECRET ?? "").trim();
    const header = request.headers.get("X-Firecrawl-Signature") ?? "";
    if (!secret || !header || !(await verifySignature(secret, rawBody, header))) {
      return new Response("unauthorized", { status: 401 });
    }
    // Valid signature → trigger a scan and return 200 promptly (payload not trusted).
    // A scan error is already recorded as a failed monitorRuns row by runMonitorScan's
    // own try/catch; catch it here too so it can never 500 this webhook response — a
    // 500 would make Firecrawl retry-storm us, and the daily cron is the safety net.
    try {
      await ctx.runAction(internal.monitorActions.runMonitorScan, { trigger: "webhook" });
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `firecrawl-monitor webhook: runMonitorScan threw: ${e instanceof Error ? e.message : String(e)}`,
        context: "http.firecrawl-monitor",
      });
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
