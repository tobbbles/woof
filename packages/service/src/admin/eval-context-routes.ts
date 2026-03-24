import type { EvalContextEntry, EvalContextMeta, ListEvalContextsResponse } from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";

const EVAL_PREFIX = "evalctx:";

export const evalContextRoutes = new Hono<AppEnv>();

/**
 * GET /api/v1/eval-contexts — list recent evaluation contexts.
 *
 * Reads directly from KV using the "evalctx:" prefix. Entries auto-expire
 * via TTL so this only returns the last 24h of evaluations.
 *
 * Query params:
 *   ?flagKey=X   — filter to a specific flag (uses prefix scan)
 *   ?limit=50    — max entries to return (default 50)
 *   ?cursor=...  — KV list cursor for pagination
 *   ?full=true   — include full context values (default: metadata only for list)
 */
evalContextRoutes.get("/eval-contexts", async (c) => {
  const flagKey = c.req.query("flagKey");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const cursor = c.req.query("cursor") || undefined;
  const full = c.req.query("full") === "true";

  // Use flagKey as sub-prefix for efficient filtering
  const prefix = flagKey ? `${EVAL_PREFIX}${flagKey}:` : EVAL_PREFIX;

  const listed = await c.env.FLAGS.list<EvalContextMeta>({ prefix, limit, cursor });

  let entries: EvalContextEntry[];

  if (full) {
    // Fetch full values for each key
    const results = await Promise.all(listed.keys.map((k) => c.env.FLAGS.get<EvalContextEntry>(k.name, "json")));
    entries = results.filter((e): e is EvalContextEntry => e !== null);
  } else {
    // Return metadata-only entries (no context body — cheaper for list views)
    entries = listed.keys
      .filter((k) => k.metadata)
      .map((k) => ({
        ...k.metadata!,
        context: {},
      }));
  }

  // Sort newest first (keys contain timestamp)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const response: ListEvalContextsResponse = {
    entries,
    cursor: listed.list_complete ? undefined : listed.cursor,
    complete: listed.list_complete,
  };
  return c.json(response);
});

/**
 * GET /api/v1/eval-contexts/:key — get a single evaluation context by KV key.
 *
 * Used when expanding an entry in the list to load the full context.
 */
evalContextRoutes.get("/eval-contexts/:key{.+}", async (c) => {
  const kvKey = c.req.param("key");
  const entry = await c.env.FLAGS.get<EvalContextEntry>(kvKey, "json");
  if (!entry) {
    return c.json({ error: "Evaluation context not found" }, 404);
  }
  return c.json(entry);
});
