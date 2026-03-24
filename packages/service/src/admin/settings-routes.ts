import type { Settings } from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { logAudit } from "./audit-helpers.js";

export const settingsRoutes = new Hono<AppEnv>();

/** GET /api/v1/settings — get current settings (returns defaults if none saved). */
settingsRoutes.get("/settings", async (c) => {
  const settings = await c.var.settingsStore.get();
  return c.json(settings);
});

/** PUT /api/v1/settings — replace settings. */
settingsRoutes.put("/settings", async (c) => {
  const body = await c.req.json<Settings>();
  await c.var.settingsStore.put(body);
  logAudit(c, {
    action: "updated",
    entityType: "settings",
    entityKey: "global",
    entityName: "Settings",
    details: "Settings updated",
  });
  return c.json(body);
});
