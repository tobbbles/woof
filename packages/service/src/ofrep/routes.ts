import { evaluate } from "@woof/evaluation";
import type {
  BulkEvaluationFailure,
  BulkEvaluationResponse,
  EvalContextEntry,
  EvalContextMeta,
  EvaluationRequest,
  FlagNotFoundResponse,
  GeneralErrorResponse,
} from "@woof/types";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { ofrepAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";

const EVAL_PREFIX = "evalctx:";
const EVAL_TTL = 86400; // 24 hours

/** Write an evaluation context to KV with TTL. Fire-and-forget via waitUntil. */
function logEvalContext(c: { env: AppEnv["Bindings"]; executionCtx: ExecutionContext }, entry: EvalContextEntry): void {
  const key = `${EVAL_PREFIX}${entry.flagKey}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
  const meta: EvalContextMeta = {
    flagKey: entry.flagKey,
    result: entry.result,
    variant: entry.variant,
    matchedRule: entry.matchedRule,
    timestamp: entry.timestamp,
  };
  c.executionCtx.waitUntil(
    c.env.FLAGS.put(key, JSON.stringify(entry), {
      metadata: meta,
      expirationTtl: EVAL_TTL,
    }),
  );
}

export const ofrepRoutes = new Hono<AppEnv>();

// ── Global error handler — returns spec-compliant generalErrorResponse ──

ofrepRoutes.onError((err, c) => {
  console.error("OFREP error:", err);
  const response: GeneralErrorResponse = {
    errorDetails: err instanceof Error ? err.message : "Internal server error",
  };
  return c.json(response, 500);
});

// ── Authentication — optional BearerAuth / ApiKeyAuth per spec ──

ofrepRoutes.use("*", ofrepAuth);

// ── Rate limiting — 429 + Retry-After per spec ──

ofrepRoutes.use("*", rateLimit);

// ── Single flag evaluation ──────────────────────────────────────────────

/** POST /ofrep/v1/evaluate/flags/:key */
ofrepRoutes.post("/evaluate/flags/:key", async (c) => {
  const key = c.req.param("key");

  let body: EvaluationRequest;
  try {
    body = await c.req.json<EvaluationRequest>();
  } catch {
    return c.json({ key, errorCode: "PARSE_ERROR", errorDetails: "Invalid JSON body" }, 400);
  }

  if (!body.context?.targetingKey) {
    return c.json(
      {
        key,
        errorCode: "TARGETING_KEY_MISSING",
        errorDetails: "context.targetingKey is required",
      },
      400,
    );
  }

  const flag = await c.var.flagStore.get(key);
  if (!flag) {
    const notFound: FlagNotFoundResponse = {
      key,
      errorCode: "FLAG_NOT_FOUND",
      errorDetails: `Flag "${key}" not found`,
    };
    return c.json(notFound, 404);
  }

  const [rules, segments, allFlags] = await Promise.all([
    c.var.ruleStore.listByFlag(key),
    c.var.segmentStore.list(),
    c.var.flagStore.list(),
  ]);
  const result = evaluate(flag, body.context, rules, { segments, allFlags });

  // Log evaluation context to KV with 24h TTL (fire-and-forget)
  const reason = "reason" in result ? result.reason : result.errorCode;
  logEvalContext(c, {
    flagKey: key,
    context: body.context as Record<string, unknown>,
    result: reason,
    variant: "variant" in result ? result.variant : undefined,
    matchedRule: result.metadata?.ruleName as string | undefined,
    timestamp: new Date().toISOString(),
  });

  if ("errorCode" in result) {
    return c.json(result, 400);
  }
  return c.json(result, 200);
});

// ── Bulk flag evaluation ────────────────────────────────────────────────

/** POST /ofrep/v1/evaluate/flags */
ofrepRoutes.post("/evaluate/flags", async (c) => {
  let body: EvaluationRequest;
  try {
    body = await c.req.json<EvaluationRequest>();
  } catch {
    const failure: BulkEvaluationFailure = {
      errorCode: "PARSE_ERROR",
      errorDetails: "Invalid JSON body",
    };
    return c.json(failure, 400);
  }

  if (!body.context?.targetingKey) {
    const failure: BulkEvaluationFailure = {
      errorCode: "TARGETING_KEY_MISSING",
      errorDetails: "context.targetingKey is required",
    };
    return c.json(failure, 400);
  }

  const [flags, allRules, segments] = await Promise.all([
    c.var.flagStore.list(),
    c.var.ruleStore.list(),
    c.var.segmentStore.list(),
  ]);

  const entries = flags.map((flag) => {
    const flagRules = allRules.filter((r) => r.flagKey === flag.key).sort((a, b) => a.priority - b.priority);
    return evaluate(flag, body.context, flagRules, { segments, allFlags: flags });
  });

  // Log each evaluation context (fire-and-forget)
  const now = new Date().toISOString();
  for (const entry of entries) {
    const reason = "reason" in entry ? entry.reason : entry.errorCode;
    logEvalContext(c, {
      flagKey: entry.key,
      context: body.context as Record<string, unknown>,
      result: reason,
      variant: "variant" in entry ? entry.variant : undefined,
      matchedRule: entry.metadata?.ruleName as string | undefined,
      timestamp: now,
    });
  }

  const response: BulkEvaluationResponse = { flags: entries };

  // Compute ETag from the response payload.
  const payload = JSON.stringify(response);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const etag = `"${Array.from(new Uint8Array(hash.slice(0, 16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}"`;

  const ifNoneMatch = c.req.header("If-None-Match");
  const etagMatch = ifNoneMatch === "*" || ifNoneMatch?.split(",").some((t) => t.trim() === etag);
  if (etagMatch) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag },
    });
  }

  return c.json(response, 200, { ETag: etag });
});
