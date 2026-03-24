import type { CreateRuleRequest, ListRulesResponse, Rule, UpdateRuleRequest } from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { logAudit } from "./audit-helpers.js";

export const ruleRoutes = new Hono<AppEnv>();

/** GET /api/v1/rules — list rules, optionally filtered by ?flagKey= */
ruleRoutes.get("/rules", async (c) => {
  const flagKey = c.req.query("flagKey");
  const rules = flagKey ? await c.var.ruleStore.listByFlag(flagKey) : await c.var.ruleStore.list();
  const response: ListRulesResponse = { rules };
  return c.json(response);
});

/** GET /api/v1/rules/:id — get a single rule. */
ruleRoutes.get("/rules/:id", async (c) => {
  const rule = await c.var.ruleStore.get(c.req.param("id"));
  if (!rule) return c.json({ error: "Rule not found" }, 404);
  return c.json(rule);
});

/** POST /api/v1/rules — create a new rule. */
ruleRoutes.post("/rules", async (c) => {
  const body = await c.req.json<CreateRuleRequest>();
  if (!body.flagKey || !body.name || !body.conditionGroup || !body.variantKey) {
    return c.json({ error: "flagKey, name, conditionGroup, and variantKey are required" }, 400);
  }

  // Validate the referenced flag exists
  const flag = await c.var.flagStore.get(body.flagKey);
  if (!flag) return c.json({ error: `Flag "${body.flagKey}" not found` }, 404);

  // Auto-assign priority if not provided
  let priority = body.priority;
  if (priority === undefined) {
    const existing = await c.var.ruleStore.listByFlag(body.flagKey);
    priority = existing.length + 1;
  }

  // Validate referenced segments exist
  if (body.segmentIds?.length) {
    for (const segId of body.segmentIds) {
      const seg = await c.var.segmentStore.get(segId);
      if (!seg) {
        return c.json({ error: `Segment "${segId}" not found` }, 400);
      }
    }
  }

  const now = new Date().toISOString();
  const rule: Rule = {
    id: crypto.randomUUID(),
    flagKey: body.flagKey,
    name: body.name,
    conditionGroup: body.conditionGroup,
    variantKey: body.variantKey,
    priority,
    segmentIds: body.segmentIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  await c.var.ruleStore.put(rule);
  logAudit(c, {
    action: "created",
    entityType: "rule",
    entityKey: rule.id,
    entityName: rule.name,
    details: `Rule created for flag "${rule.flagKey}"`,
  });
  return c.json(rule, 201);
});

/** PUT /api/v1/rules/:id — update an existing rule. */
ruleRoutes.put("/rules/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.var.ruleStore.get(id);
  if (!existing) return c.json({ error: "Rule not found" }, 404);

  const body = await c.req.json<UpdateRuleRequest>();

  // Validate referenced segments exist
  if (body.segmentIds?.length) {
    for (const segId of body.segmentIds) {
      const seg = await c.var.segmentStore.get(segId);
      if (!seg) {
        return c.json({ error: `Segment "${segId}" not found` }, 400);
      }
    }
  }

  const updated: Rule = {
    ...existing,
    ...(body.name !== undefined && { name: body.name }),
    ...(body.conditionGroup !== undefined && { conditionGroup: body.conditionGroup }),
    ...(body.variantKey !== undefined && { variantKey: body.variantKey }),
    ...(body.priority !== undefined && { priority: body.priority }),
    ...(body.segmentIds !== undefined && { segmentIds: body.segmentIds }),
    updatedAt: new Date().toISOString(),
  };

  await c.var.ruleStore.put(updated);
  logAudit(c, {
    action: "updated",
    entityType: "rule",
    entityKey: updated.id,
    entityName: updated.name,
    details: `Rule updated for flag "${updated.flagKey}"`,
  });
  return c.json(updated);
});

/** DELETE /api/v1/rules/:id — delete a rule. */
ruleRoutes.delete("/rules/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.var.ruleStore.get(id);
  if (!existing) return c.json({ error: "Rule not found" }, 404);

  await c.var.ruleStore.delete(id);
  logAudit(c, {
    action: "deleted",
    entityType: "rule",
    entityKey: existing.id,
    entityName: existing.name,
    details: `Rule deleted from flag "${existing.flagKey}"`,
  });
  return c.json({ deleted: true });
});
