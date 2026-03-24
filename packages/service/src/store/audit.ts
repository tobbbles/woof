import type { AuditEntry } from "@woof/types";

const KEY_PREFIX = "audit:";
const INDEX_KEY = "index:audit";

/**
 * KV-backed audit store.
 *
 * Uses an index key (array of KV keys, newest first) for RYOW-consistent
 * listing instead of `kv.list()`.
 */
export class AuditStore {
  constructor(private kv: KVNamespace) {}

  async append(entry: AuditEntry): Promise<void> {
    const kvKey = `${KEY_PREFIX}${entry.id}`;
    await this.kv.put(kvKey, JSON.stringify(entry));

    // Prepend to index (newest first). Cap at 500 entries.
    const index = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    index.unshift(kvKey);
    if (index.length > 500) index.length = 500;
    await this.kv.put(INDEX_KEY, JSON.stringify(index));
  }

  async list(opts?: { limit?: number; cursor?: string }): Promise<{ entries: AuditEntry[]; cursor?: string }> {
    const limit = opts?.limit ?? 50;
    const index = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];

    // Simple offset-based pagination using cursor as start index
    const start = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
    const slice = index.slice(start, start + limit);

    const entries: AuditEntry[] = [];
    const results = await Promise.all(slice.map((kvKey) => this.kv.get<AuditEntry>(kvKey, "json")));
    for (const entry of results) {
      if (entry) entries.push(entry);
    }

    const nextStart = start + limit;
    return {
      entries,
      cursor: nextStart < index.length ? String(nextStart) : undefined,
    };
  }
}
