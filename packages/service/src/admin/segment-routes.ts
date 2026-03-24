import type { CreateSegmentRequest, ListSegmentsResponse, Segment, UpdateSegmentRequest } from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { logAudit } from "./audit-helpers.js";

export const segmentRoutes = new Hono<AppEnv>();

/** GET /api/v1/segments — list all segments. */
segmentRoutes.get("/segments", async (c) => {
  const segments = await c.var.segmentStore.list();
  const response: ListSegmentsResponse = { segments };
  return c.json(response);
});

/** GET /api/v1/segments/:key — get a single segment. */
segmentRoutes.get("/segments/:key", async (c) => {
  const segment = await c.var.segmentStore.get(c.req.param("key"));
  if (!segment) return c.json({ error: "Segment not found" }, 404);
  return c.json(segment);
});

/** POST /api/v1/segments — create a new segment. */
segmentRoutes.post("/segments", async (c) => {
  const body = await c.req.json<CreateSegmentRequest>();
  if (!body.name || !body.key || !body.conditionGroup) {
    return c.json({ error: "name, key, and conditionGroup are required" }, 400);
  }

  const existing = await c.var.segmentStore.get(body.key);
  if (existing) {
    return c.json({ error: `Segment "${body.key}" already exists` }, 409);
  }

  const now = new Date().toISOString();
  const segment: Segment = {
    id: `seg_${crypto.randomUUID()}`,
    name: body.name,
    key: body.key,
    description: body.description ?? "",
    conditionGroup: body.conditionGroup,
    createdAt: now,
    updatedAt: now,
  };

  await c.var.segmentStore.put(segment);
  logAudit(c, {
    action: "created",
    entityType: "segment",
    entityKey: segment.key,
    entityName: segment.name,
    details: `Segment created`,
  });
  return c.json(segment, 201);
});

/** PUT /api/v1/segments/:key — update an existing segment. */
segmentRoutes.put("/segments/:key", async (c) => {
  const key = c.req.param("key");
  const existing = await c.var.segmentStore.get(key);
  if (!existing) return c.json({ error: "Segment not found" }, 404);

  const body = await c.req.json<UpdateSegmentRequest>();
  const updated: Segment = {
    ...existing,
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.conditionGroup !== undefined && { conditionGroup: body.conditionGroup }),
    updatedAt: new Date().toISOString(),
  };

  await c.var.segmentStore.put(updated);
  logAudit(c, {
    action: "updated",
    entityType: "segment",
    entityKey: updated.key,
    entityName: updated.name,
    details: `Segment updated`,
  });
  return c.json(updated);
});

/** DELETE /api/v1/segments/:key — delete a segment. */
segmentRoutes.delete("/segments/:key", async (c) => {
  const key = c.req.param("key");
  const existing = await c.var.segmentStore.get(key);
  if (!existing) return c.json({ error: "Segment not found" }, 404);

  await c.var.segmentStore.delete(key);
  logAudit(c, {
    action: "deleted",
    entityType: "segment",
    entityKey: existing.key,
    entityName: existing.name,
    details: `Segment deleted`,
  });
  return c.json({ deleted: true });
});
