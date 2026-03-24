import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";

/**
 * Optional OFREP authentication middleware.
 *
 * When the `OFREP_API_KEY` env var is set, requests must authenticate via
 * one of the two schemes defined by the OFREP spec:
 *   - BearerAuth:  `Authorization: Bearer <key>`
 *   - ApiKeyAuth:  `X-API-Key: <key>`
 *
 * When `OFREP_API_KEY` is unset, all requests pass through (no auth required).
 */
export const ofrepAuth = createMiddleware<AppEnv>(async (c, next) => {
  const apiKey = c.env.OFREP_API_KEY;
  if (!apiKey) {
    await next();
    return;
  }

  const bearer = c.req.header("Authorization");
  const xApiKey = c.req.header("X-API-Key");

  const token = (bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined) ?? xApiKey;

  if (!token) {
    return c.json(undefined, 401);
  }

  if (token !== apiKey) {
    return c.json(undefined, 403);
  }

  await next();
});
