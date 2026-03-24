import type { ListAuditResponse } from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";

export const auditRoutes = new Hono<AppEnv>();

/** GET /api/v1/audit — list audit entries (newest first), with optional cursor pagination. */
auditRoutes.get("/audit", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const cursor = c.req.query("cursor") || undefined;

  const result = await c.var.auditStore.list({ limit, cursor });

  const response: ListAuditResponse = {
    entries: result.entries,
    cursor: result.cursor,
  };
  return c.json(response);
});
