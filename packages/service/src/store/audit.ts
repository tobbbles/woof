import type { AuditEntry } from "@woof/types";

const RETRYABLE_MESSAGES = ["Network connection lost", "storage caused object to be reset", "reset because its code was updated"];
const MAX_RETRIES = 3;

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_MESSAGES.some((r) => msg.includes(r));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isRetryable(err)) throw err;
      // Exponential backoff with jitter: ~50ms, ~100ms, ~200ms
      const delay = (1 << attempt) * 25 + Math.random() * 25;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * D1-backed audit store.
 */
export class AuditStore {
  constructor(private db: D1Database) {}

  async append(entry: AuditEntry): Promise<void> {
    await withRetry(() =>
      this.db
        .prepare(
          `INSERT INTO audit_entries (id, timestamp, "user", action, entity_type, entity_key, entity_name, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(entry.id, entry.timestamp, entry.user, entry.action, entry.entityType, entry.entityKey, entry.entityName, entry.details)
        .run(),
    );
  }

  async list(opts?: { limit?: number; cursor?: string }): Promise<{ entries: AuditEntry[]; cursor?: string }> {
    const limit = opts?.limit ?? 50;

    let stmt: D1PreparedStatement;
    const columns = `id, timestamp, "user", action, entity_type, entity_key, entity_name, details`;
    if (opts?.cursor) {
      stmt = this.db
        .prepare(`SELECT ${columns} FROM audit_entries WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?`)
        .bind(opts.cursor, limit + 1);
    } else {
      stmt = this.db.prepare(`SELECT ${columns} FROM audit_entries ORDER BY timestamp DESC LIMIT ?`).bind(limit + 1);
    }

    const result = await stmt.all<{
      id: string;
      timestamp: string;
      user: string;
      action: string;
      entity_type: string;
      entity_key: string;
      entity_name: string;
      details: string;
    }>();

    const rows = result.results;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const entries: AuditEntry[] = page.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      user: row.user,
      action: row.action as AuditEntry["action"],
      entityType: row.entity_type as AuditEntry["entityType"],
      entityKey: row.entity_key,
      entityName: row.entity_name,
      details: row.details,
    }));

    return {
      entries,
      cursor: hasMore ? page[page.length - 1].timestamp : undefined,
    };
  }
}
