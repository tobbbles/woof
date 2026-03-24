import type {
  CreateFlagRequest,
  CreateRuleRequest,
  CreateSegmentRequest,
  EvalContextEntry,
  Flag,
  ListAuditResponse,
  ListEvalContextsResponse,
  ListFlagsResponse,
  ListRulesResponse,
  ListSegmentsResponse,
  Rule,
  Segment,
  Settings,
  UpdateFlagRequest,
  UpdateRuleRequest,
  UpdateSegmentRequest,
} from "@woof/types";

/**
 * A Fetcher is anything with a fetch method — either the global fetch,
 * a Cloudflare Service Binding, or a custom implementation.
 */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Server-side client for the @woof/service admin API.
 *
 * Uses a Cloudflare Service Binding (env.API) to call the API Worker
 * directly, bypassing the public URL and Cloudflare Access edge gate.
 * Forwards the user's Access JWT so the API Worker can still validate identity.
 */
export function createApiClient(fetcher: Fetcher, authHeaders?: Record<string, string>) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    // Service Bindings require a full URL, but the host is ignored —
    // the request is routed directly to the bound Worker.
    const res = await fetcher.fetch(`https://internal${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`API ${init?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
      throw new Response(body, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return res.json() as Promise<T>;
  }

  return {
    // ── Flags ──────────────────────────────────────────────

    listFlags: () => request<ListFlagsResponse>("/api/v1/flags"),

    getFlag: (key: string) => request<Flag>(`/api/v1/flags/${key}`),

    createFlag: (data: CreateFlagRequest) =>
      request<Flag>("/api/v1/flags", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    updateFlag: (key: string, data: UpdateFlagRequest) =>
      request<Flag>(`/api/v1/flags/${key}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    deleteFlag: (key: string) =>
      request<{ deleted: boolean }>(`/api/v1/flags/${key}`, {
        method: "DELETE",
      }),

    // ── Rules ──────────────────────────────────────────────

    listRules: (flagKey?: string) => {
      const qs = flagKey ? `?flagKey=${encodeURIComponent(flagKey)}` : "";
      return request<ListRulesResponse>(`/api/v1/rules${qs}`);
    },

    getRule: (id: string) => request<Rule>(`/api/v1/rules/${id}`),

    createRule: (data: CreateRuleRequest) =>
      request<Rule>("/api/v1/rules", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    updateRule: (id: string, data: UpdateRuleRequest) =>
      request<Rule>(`/api/v1/rules/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    deleteRule: (id: string) =>
      request<{ deleted: boolean }>(`/api/v1/rules/${id}`, {
        method: "DELETE",
      }),

    // ── Segments ───────────────────────────────────────────

    listSegments: () => request<ListSegmentsResponse>("/api/v1/segments"),

    getSegment: (key: string) => request<Segment>(`/api/v1/segments/${key}`),

    createSegment: (data: CreateSegmentRequest) =>
      request<Segment>("/api/v1/segments", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    updateSegment: (key: string, data: UpdateSegmentRequest) =>
      request<Segment>(`/api/v1/segments/${key}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    deleteSegment: (key: string) =>
      request<{ deleted: boolean }>(`/api/v1/segments/${key}`, {
        method: "DELETE",
      }),

    // ── Audit ──────────────────────────────────────────────

    listAudit: (params?: { limit?: number; cursor?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.cursor) qs.set("cursor", params.cursor);
      const q = qs.toString();
      return request<ListAuditResponse>(`/api/v1/audit${q ? `?${q}` : ""}`);
    },

    // ── Evaluation Contexts ─────────────────────────────────

    listEvalContexts: (params?: { flagKey?: string; limit?: number; cursor?: string; full?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.flagKey) qs.set("flagKey", params.flagKey);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.full) qs.set("full", "true");
      const q = qs.toString();
      return request<ListEvalContextsResponse>(`/api/v1/eval-contexts${q ? `?${q}` : ""}`);
    },

    getEvalContext: (kvKey: string) => request<EvalContextEntry>(`/api/v1/eval-contexts/${encodeURIComponent(kvKey)}`),

    // ── Settings ───────────────────────────────────────────

    getSettings: () => request<Settings>("/api/v1/settings"),

    updateSettings: (data: Settings) =>
      request<Settings>("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  };
}

/**
 * Get an API client from the Cloudflare environment.
 * Uses the API Service Binding for direct Worker-to-Worker calls.
 *
 * Pass the incoming request to forward the user's Cloudflare Access JWT
 * to the API Worker (Service Bindings bypass the Access edge gate,
 * but the API Worker still validates the JWT).
 */
export function getApiClient(env: Record<string, unknown>, request?: Request) {
  // Extract the Access JWT from the incoming request to forward it.
  // Only forward Access-specific credentials — not the full Cookie header
  // (which may contain unrelated cookies like cf_clearance that would
  // fail JWT validation).
  const authHeaders: Record<string, string> = {};
  if (request) {
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (jwt) {
      authHeaders["Cf-Access-Jwt-Assertion"] = jwt;
    }
  }

  const api = env.API as Fetcher | undefined;
  if (api) {
    return createApiClient(api, authHeaders);
  }

  // Fallback to SERVICE_URL for local development (wrangler dev)
  const serviceUrl = env.SERVICE_URL as string | undefined;
  if (serviceUrl) {
    const base = serviceUrl.replace(/\/$/, "");
    return createApiClient(
      {
        fetch: (input, init) => {
          const url = String(input).replace("https://internal", base);
          return globalThis.fetch(url, init);
        },
      },
      authHeaders,
    );
  }

  throw new Response("Neither API service binding nor SERVICE_URL is configured", { status: 500 });
}
