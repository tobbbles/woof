import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";

/**
 * Simple per-isolate rate limiter for OFREP evaluation endpoints.
 *
 * Uses an in-memory sliding window per client IP. This is best-effort
 * (not globally consistent across isolates), but produces spec-compliant
 * 429 responses with Retry-After headers.
 *
 * For production rate limiting, configure Cloudflare's built-in rate
 * limiting rules in the dashboard — they operate at the edge before
 * the request reaches the Worker.
 */
const windowMs = 60_000; // 1 minute window
const maxRequests = 600; // requests per window per IP

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

// Periodically clean stale entries to prevent memory leaks.
// Workers isolates are short-lived, so this is mostly precautionary.
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
}

let lastCleanup = 0;

export const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const now = Date.now();

  // Cleanup every 30 seconds
  if (now - lastCleanup > 30_000) {
    cleanup();
    lastCleanup = now;
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  let entry = windows.get(ip);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(ip, entry);
  }

  entry.count++;

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return c.json({ errorDetails: "Rate limit exceeded" }, 429, { "Retry-After": String(retryAfter) });
  }

  await next();
});
