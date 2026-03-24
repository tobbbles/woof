import type { CreateFlagRequest, Flag, ListFlagsResponse, UpdateFlagRequest } from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { logAudit } from "./audit-helpers.js";
import { auditRoutes } from "./audit-routes.js";
import { evalContextRoutes } from "./eval-context-routes.js";
import { ruleRoutes } from "./rule-routes.js";
import { segmentRoutes } from "./segment-routes.js";
import { settingsRoutes } from "./settings-routes.js";

export const adminRoutes = new Hono<AppEnv>();

// ── Flag CRUD ──────────────────────────────────────────────────────

/** GET /api/v1/flags — list all flags. */
adminRoutes.get("/flags", async (c) => {
  const flags = await c.var.flagStore.list();
  const response: ListFlagsResponse = { flags };
  return c.json(response);
});

/** GET /api/v1/flags/:key — get a single flag. */
adminRoutes.get("/flags/:key", async (c) => {
  const flag = await c.var.flagStore.get(c.req.param("key"));
  if (!flag) {
    return c.json({ error: "Flag not found" }, 404);
  }
  return c.json(flag);
});

/** POST /api/v1/flags — create a new flag. */
adminRoutes.post("/flags", async (c) => {
  const body = await c.req.json<CreateFlagRequest>();

  if (!body.key || !body.type || !body.variants || !body.defaultVariant) {
    return c.json({ error: "key, type, defaultVariant, and variants are required" }, 400);
  }

  const existing = await c.var.flagStore.get(body.key);
  if (existing) {
    return c.json({ error: `Flag "${body.key}" already exists` }, 409);
  }

  // Validate prerequisites exist
  if (body.prerequisites?.length) {
    for (const prereqKey of body.prerequisites) {
      const prereq = await c.var.flagStore.get(prereqKey);
      if (!prereq) {
        return c.json({ error: `Prerequisite flag "${prereqKey}" not found` }, 400);
      }
    }
  }

  const now = new Date().toISOString();
  const flag: Flag = {
    key: body.key,
    type: body.type,
    enabled: body.enabled ?? false,
    defaultVariant: body.defaultVariant,
    variants: body.variants,
    description: body.description,
    name: body.name,
    killSwitch: body.killSwitch ?? false,
    environment: body.environment ?? "development",
    rolloutPercentage: body.rolloutPercentage ?? 0,
    stickinessAttribute: body.stickinessAttribute ?? "user_id",
    prerequisites: body.prerequisites ?? [],
    scheduleStart: body.scheduleStart ?? null,
    scheduleEnd: body.scheduleEnd ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await c.var.flagStore.put(flag);
  logAudit(c, {
    action: "created",
    entityType: "flag",
    entityKey: flag.key,
    entityName: flag.name || flag.key,
    details: `Flag created (type: ${flag.type})`,
  });
  return c.json(flag, 201);
});

/** PUT /api/v1/flags/:key — update an existing flag. */
adminRoutes.put("/flags/:key", async (c) => {
  const key = c.req.param("key");
  const existing = await c.var.flagStore.get(key);
  if (!existing) {
    return c.json({ error: "Flag not found" }, 404);
  }

  const body = await c.req.json<UpdateFlagRequest>();

  // Validate prerequisites exist
  if (body.prerequisites?.length) {
    for (const prereqKey of body.prerequisites) {
      const prereq = await c.var.flagStore.get(prereqKey);
      if (!prereq) {
        return c.json({ error: `Prerequisite flag "${prereqKey}" not found` }, 400);
      }
    }
  }

  const updated: Flag = {
    ...existing,
    ...(body.enabled !== undefined && { enabled: body.enabled }),
    ...(body.defaultVariant !== undefined && { defaultVariant: body.defaultVariant }),
    ...(body.variants !== undefined && { variants: body.variants }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.name !== undefined && { name: body.name }),
    ...(body.killSwitch !== undefined && { killSwitch: body.killSwitch }),
    ...(body.environment !== undefined && { environment: body.environment }),
    ...(body.rolloutPercentage !== undefined && { rolloutPercentage: body.rolloutPercentage }),
    ...(body.stickinessAttribute !== undefined && { stickinessAttribute: body.stickinessAttribute }),
    ...(body.prerequisites !== undefined && { prerequisites: body.prerequisites }),
    ...(body.scheduleStart !== undefined && { scheduleStart: body.scheduleStart }),
    ...(body.scheduleEnd !== undefined && { scheduleEnd: body.scheduleEnd }),
    updatedAt: new Date().toISOString(),
  };

  await c.var.flagStore.put(updated);

  // Distinguish toggle from general update for better audit trail
  const isToggleOnly =
    body.enabled !== undefined &&
    body.defaultVariant === undefined &&
    body.variants === undefined &&
    body.description === undefined &&
    body.name === undefined &&
    body.killSwitch === undefined &&
    body.environment === undefined &&
    body.rolloutPercentage === undefined &&
    body.stickinessAttribute === undefined &&
    body.prerequisites === undefined &&
    body.scheduleStart === undefined &&
    body.scheduleEnd === undefined;
  const isKillSwitchToggle =
    body.killSwitch !== undefined &&
    body.enabled === undefined &&
    body.defaultVariant === undefined &&
    body.variants === undefined &&
    body.description === undefined &&
    body.name === undefined;
  const isToggle = isToggleOnly || isKillSwitchToggle;

  logAudit(c, {
    action: isToggle ? "toggled" : "updated",
    entityType: "flag",
    entityKey: updated.key,
    entityName: updated.name || updated.key,
    details: isKillSwitchToggle
      ? `Kill switch ${updated.killSwitch ? "activated" : "deactivated"}`
      : isToggleOnly
        ? `Flag ${updated.enabled ? "enabled" : "disabled"}`
        : `Flag updated`,
  });
  return c.json(updated);
});

/** DELETE /api/v1/flags/:key — delete a flag. */
adminRoutes.delete("/flags/:key", async (c) => {
  const key = c.req.param("key");
  const existing = await c.var.flagStore.get(key);
  if (!existing) {
    return c.json({ error: "Flag not found" }, 404);
  }

  await c.var.flagStore.delete(key);
  logAudit(c, {
    action: "deleted",
    entityType: "flag",
    entityKey: key,
    entityName: existing.name || key,
    details: `Flag deleted`,
  });
  return c.json({ deleted: true });
});

// ── Mount sub-routers ──────────────────────────────────────────────

adminRoutes.route("/", ruleRoutes);
adminRoutes.route("/", segmentRoutes);
adminRoutes.route("/", auditRoutes);
adminRoutes.route("/", settingsRoutes);
adminRoutes.route("/", evalContextRoutes);
