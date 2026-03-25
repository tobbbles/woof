import type { AuditEntry } from "@woof/types";
import { describe, expect, it, vi } from "vitest";
import { AuditStore } from "./audit.js";

// ---------------------------------------------------------------------------
// D1 mock helpers
// ---------------------------------------------------------------------------

interface MockRow {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  entity_type: string;
  entity_key: string;
  entity_name: string;
  details: string;
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "entry-1",
    timestamp: "2025-03-15T10:00:00.000Z",
    user: "alice@example.com",
    action: "created",
    entityType: "flag",
    entityKey: "dark-mode",
    entityName: "dark-mode",
    details: "Created flag dark-mode",
    ...overrides,
  };
}

function entryToRow(entry: AuditEntry): MockRow {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    user: entry.user,
    action: entry.action,
    entity_type: entry.entityType,
    entity_key: entry.entityKey,
    entity_name: entry.entityName,
    details: entry.details,
  };
}

function createMockD1(opts?: {
  allFn?: () => Promise<{ results: MockRow[] }>;
  runFn?: () => Promise<unknown>;
}) {
  const run = vi.fn().mockImplementation(opts?.runFn ?? (async () => ({})));
  const all = vi.fn().mockImplementation(opts?.allFn ?? (async () => ({ results: [] })));
  const bind = vi.fn().mockReturnValue({ run, all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, run, all } as unknown as D1Database & {
    prepare: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditStore", () => {
  describe("append", () => {
    it("inserts an entry with correct bind parameters", async () => {
      const db = createMockD1();
      const store = new AuditStore(db);
      const entry = makeEntry();

      await store.append(entry);

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO audit_entries"),
      );
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('"user"'),
      );
      const bind = db.prepare.mock.results[0].value.bind;
      expect(bind).toHaveBeenCalledWith(
        entry.id,
        entry.timestamp,
        entry.user,
        entry.action,
        entry.entityType,
        entry.entityKey,
        entry.entityName,
        entry.details,
      );
    });

    it("retries on transient D1 errors", async () => {
      let calls = 0;
      const db = createMockD1({
        runFn: async () => {
          calls++;
          if (calls < 3) throw new Error("Network connection lost");
          return {};
        },
      });
      const store = new AuditStore(db);

      await store.append(makeEntry());

      expect(calls).toBe(3);
    });

    it("throws non-retryable errors immediately", async () => {
      const db = createMockD1({
        runFn: async () => {
          throw new Error("UNIQUE constraint failed");
        },
      });
      const store = new AuditStore(db);

      await expect(store.append(makeEntry())).rejects.toThrow("UNIQUE constraint failed");
      // Should not have retried — only 1 call
      expect(db.run).toHaveBeenCalledTimes(1);
    });

    it("gives up after max retries", async () => {
      const db = createMockD1({
        runFn: async () => {
          throw new Error("Network connection lost");
        },
      });
      const store = new AuditStore(db);

      await expect(store.append(makeEntry())).rejects.toThrow("Network connection lost");
      // initial + 3 retries = 4 calls
      expect(db.run).toHaveBeenCalledTimes(4);
    });
  });

  describe("list", () => {
    it("returns entries with default limit", async () => {
      const entry = makeEntry();
      const db = createMockD1({ allFn: async () => ({ results: [entryToRow(entry)] }) });
      const store = new AuditStore(db);

      const result = await store.list();

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual(entry);
      expect(result.cursor).toBeUndefined();
    });

    it("maps snake_case columns to camelCase fields", async () => {
      const entry = makeEntry({
        entityType: "segment",
        entityKey: "beta-testers",
        entityName: "Beta Testers",
      });
      const db = createMockD1({ allFn: async () => ({ results: [entryToRow(entry)] }) });
      const store = new AuditStore(db);

      const result = await store.list();

      expect(result.entries[0].entityType).toBe("segment");
      expect(result.entries[0].entityKey).toBe("beta-testers");
      expect(result.entries[0].entityName).toBe("Beta Testers");
    });

    it("uses cursor for timestamp-based pagination", async () => {
      const db = createMockD1();
      const store = new AuditStore(db);
      const cursor = "2025-03-15T10:00:00.000Z";

      await store.list({ cursor });

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE timestamp < ?"),
      );
      const bind = db.prepare.mock.results[0].value.bind;
      expect(bind).toHaveBeenCalledWith(cursor, 51); // limit + 1
    });

    it("returns cursor when there are more results", async () => {
      const rows = Array.from({ length: 4 }, (_, i) =>
        entryToRow(makeEntry({
          id: `entry-${i}`,
          timestamp: `2025-03-15T1${3 - i}:00:00.000Z`,
        })),
      );
      const db = createMockD1({ allFn: async () => ({ results: rows }) });
      const store = new AuditStore(db);

      const result = await store.list({ limit: 3 });

      expect(result.entries).toHaveLength(3);
      expect(result.cursor).toBe("2025-03-15T11:00:00.000Z");
    });

    it("returns no cursor when results fit within limit", async () => {
      const rows = [entryToRow(makeEntry())];
      const db = createMockD1({ allFn: async () => ({ results: rows }) });
      const store = new AuditStore(db);

      const result = await store.list({ limit: 10 });

      expect(result.entries).toHaveLength(1);
      expect(result.cursor).toBeUndefined();
    });

    it("returns empty list when no entries exist", async () => {
      const db = createMockD1();
      const store = new AuditStore(db);

      const result = await store.list();

      expect(result.entries).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });

    it("quotes user column in SELECT queries", async () => {
      const db = createMockD1();
      const store = new AuditStore(db);

      await store.list();

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('"user"'),
      );
    });
  });
});
