import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminRoutes } from "./admin/routes.js";
import { requireAccessAuth } from "./auth/access.js";
import type { AppEnv } from "./env.js";
import { ofrepRoutes } from "./ofrep/routes.js";
import { AuditStore } from "./store/audit.js";
import { FlagStore } from "./store/flags.js";
import { RuleStore } from "./store/rules.js";
import { SegmentStore } from "./store/segments.js";
import { SettingsStore } from "./store/settings.js";

const app = new Hono<AppEnv>();

// CORS — restrict to origins listed in the CORS_ORIGINS env var.
// Must expose ETag/Retry-After and allow auth + caching request headers
// so that browser-based OFREP providers work correctly.
app.use("*", async (c, next) => {
  const allowed = c.env.CORS_ORIGINS ? c.env.CORS_ORIGINS.split(",").map((o) => o.trim()) : [];

  const middleware = cors({
    origin: (requestOrigin) => {
      if (allowed.includes(requestOrigin)) return requestOrigin;
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "If-None-Match"],
    exposeHeaders: ["ETag", "Retry-After"],
    maxAge: 86400,
  });

  return middleware(c, next);
});

// Inject stores into context for all routes.
app.use("*", async (c, next) => {
  const kv = c.env.FLAGS;
  c.set("flagStore", new FlagStore(kv));
  c.set("ruleStore", new RuleStore(kv));
  c.set("segmentStore", new SegmentStore(kv));
  c.set("auditStore", new AuditStore(c.env.DB));
  c.set("settingsStore", new SettingsStore(kv));
  await next();
});

// Mount OFREP evaluation routes — no auth required.
app.route("/ofrep/v1", ofrepRoutes);

// Mount admin API routes — protected by Cloudflare Access.
app.use("/api/v1/*", requireAccessAuth);
app.route("/api/v1", adminRoutes);

// Health check.
app.get("/healthz", (c) => c.json({ ok: true }));

export default app;
