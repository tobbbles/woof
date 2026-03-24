import type { Segment } from "@woof/types";

const KEY_PREFIX = "segment:";
const INDEX_KEY = "index:segments";

/**
 * KV-backed segment store.
 *
 * Uses an index key for RYOW-consistent listing instead of `kv.list()`.
 * Falls back to `kv.list()` and rebuilds the index if it doesn't exist.
 */
export class SegmentStore {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<Segment | null> {
    return this.kv.get<Segment>(`${KEY_PREFIX}${key}`, "json");
  }

  async list(): Promise<Segment[]> {
    let keys = await this.kv.get<string[]>(INDEX_KEY, "json");

    if (!keys) {
      keys = await this.rebuildIndex();
    }

    if (keys.length === 0) return [];

    const segments = await Promise.all(keys.map((key) => this.kv.get<Segment>(`${KEY_PREFIX}${key}`, "json")));
    return segments.filter((s): s is Segment => s !== null);
  }

  async put(segment: Segment): Promise<void> {
    await this.kv.put(`${KEY_PREFIX}${segment.key}`, JSON.stringify(segment));

    const keys = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    if (!keys.includes(segment.key)) {
      keys.push(segment.key);
      await this.kv.put(INDEX_KEY, JSON.stringify(keys));
    }
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(`${KEY_PREFIX}${key}`);

    const keys = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    const updated = keys.filter((k) => k !== key);
    await this.kv.put(INDEX_KEY, JSON.stringify(updated));
  }

  private async rebuildIndex(): Promise<string[]> {
    const result = await this.kv.list({ prefix: KEY_PREFIX });
    const keys = result.keys.map((k) => k.name.slice(KEY_PREFIX.length));
    await this.kv.put(INDEX_KEY, JSON.stringify(keys));
    return keys;
  }
}
