import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Try to find a Cloudflare API token.
 *
 * Prefers CLOUDFLARE_API_TOKEN (user-created, can have DNS permissions)
 * over the wrangler OAuth token (which only has zone:read, not DNS write).
 */
export function findApiToken(): { token: string; source: "env" | "oauth" } | undefined {
  // 1. Explicit API token — user-created with full control over scopes
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return { token: process.env.CLOUDFLARE_API_TOKEN, source: "env" };
  }

  // 2. Wrangler's OAuth token — limited scopes (no DNS write)
  const candidates = [
    resolve(homedir(), ".config", ".wrangler", "config", "default.toml"),
    resolve(homedir(), ".wrangler", "config", "default.toml"),
  ];

  for (const tokenPath of candidates) {
    if (existsSync(tokenPath)) {
      const content = readFileSync(tokenPath, "utf-8");
      const match = content.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (match) return { token: match[1], source: "oauth" };
    }
  }

  return undefined;
}

interface CloudflareApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  errors?: Array<{ code: number; message: string }>;
}

async function cfApi<T>(
  path: string,
  token: string,
  options?: { method?: string; body?: unknown },
): Promise<CloudflareApiResult<T>> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json()) as {
    success: boolean;
    result: T;
    errors?: Array<{ code: number; message: string }>;
  };

  return {
    ok: json.success,
    result: json.result,
    errors: json.errors,
  };
}

interface Zone {
  id: string;
  name: string;
}

/** Look up a zone ID by name. */
export async function getZoneId(zoneName: string, token: string): Promise<string | undefined> {
  const result = await cfApi<Zone[]>(`/zones?name=${encodeURIComponent(zoneName)}`, token);
  return result.result?.[0]?.id;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

/** Check if a DNS record already exists for the given name. */
export async function findDnsRecord(zoneId: string, name: string, token: string): Promise<DnsRecord | undefined> {
  const result = await cfApi<DnsRecord[]>(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`, token);
  return result.result?.[0];
}

/**
 * Create a proxied DNS record for a Workers route.
 * Uses a AAAA record pointing to 100:: (the standard placeholder for Workers routes).
 */
export async function createDnsRecord(
  zoneId: string,
  name: string,
  token: string,
): Promise<CloudflareApiResult<DnsRecord>> {
  return cfApi<DnsRecord>(`/zones/${zoneId}/dns_records`, token, {
    method: "POST",
    body: {
      type: "AAAA",
      name,
      content: "100::",
      proxied: true,
      comment: "Woof feature flag service",
    },
  });
}
