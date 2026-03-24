import { createMiddleware } from "hono/factory";
import type { JWTPayload } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "../env.js";

/** Claims present in a Cloudflare Access JWT. */
export interface AccessJWTPayload extends JWTPayload {
  email?: string;
  country?: string;
  type?: string;
  identity_nonce?: string;
}

/**
 * Detect whether a request arrived via a Service Binding (Worker-to-Worker)
 * rather than through the public internet via Cloudflare's edge.
 *
 * Cloudflare's edge automatically attaches `cf` properties (country, colo,
 * tlsVersion, etc.) to every public request. These cannot be stripped by
 * external callers. Service Binding calls skip the edge entirely, so the
 * `cf` object is absent or empty.
 */
function isServiceBindingRequest(req: Request): boolean {
  // Hono wraps the raw Request — access the underlying cf property.
  // On edge requests, cf.colo is always set (e.g. "DFW", "AMS").
  // On Service Binding requests, cf is undefined or lacks edge metadata.
  const cf = (req as unknown as { cf?: Record<string, unknown> }).cf;
  return !cf?.colo;
}

/**
 * Hono middleware that validates the Cloudflare Access JWT on incoming requests.
 *
 * Authentication modes (checked in order):
 * 1. Access not configured (no env vars) → dev mode, allow through.
 * 2. Service Binding call (no cf.colo) → trusted internal call, allow through.
 * 3. JWT present → validate signature, issuer, audience.
 * 4. No JWT → reject with 401.
 *
 * Mode 2 is safe because Service Bindings are scoped to the same Cloudflare
 * account. External callers always go through the edge (which populates cf),
 * so they cannot fake the absence of cf properties.
 */
export const requireAccessAuth = createMiddleware<AppEnv>(async (c, next) => {
  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;

  // Dev mode — Access not configured, allow through.
  if (!teamDomain || !aud) {
    c.set("accessIdentity", { email: "dev@localhost" } as AccessJWTPayload);
    await next();
    return;
  }

  // Service Binding calls are internal to the Cloudflare account.
  // They bypass the edge (no cf metadata) and cannot be spoofed by
  // external callers, who always go through the edge.
  if (isServiceBindingRequest(c.req.raw)) {
    c.set("accessIdentity", {
      email: "service@internal",
    } as AccessJWTPayload);
    await next();
    return;
  }

  // Public request — require a valid Cloudflare Access JWT.
  const token = c.req.header("Cf-Access-Jwt-Assertion");

  if (!token) {
    return c.json({ error: "Unauthorized — no Access token. Ensure Cloudflare Access is protecting this route." }, 401);
  }

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));

    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience: aud,
    });

    c.set("accessIdentity", payload as AccessJWTPayload);
  } catch {
    return c.json({ error: "Unauthorized — invalid Access token" }, 401);
  }

  await next();
});
