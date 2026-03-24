import type { Flag } from "@woof/types";

const KEY_PREFIX = "flag:";
const INDEX_KEY = "index:flags";

/**
 * KV-backed flag store.
 *
 * Uses an index key (`index:flags`) containing an array of flag keys
 * instead of `kv.list()`. This gives read-your-own-write consistency
 * because `kv.get()` has RYOW guarantees while `kv.list()` does not.
 *
 * On first call, if the index doesn't exist, it falls back to `kv.list()`
 * and rebuilds the index automatically (migration from pre-index data).
 */
export class FlagStore {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<Flag | null> {
    return this.kv.get<Flag>(`${KEY_PREFIX}${key}`, "json");
  }

  async list(): Promise<Flag[]> {
    let keys = await this.kv.get<string[]>(INDEX_KEY, "json");

    // Migration: if no index exists, rebuild from kv.list()
    if (!keys) {
      keys = await this.rebuildIndex();
    }

    if (keys.length === 0) return [];

    const flags = await Promise.all(keys.map((key) => this.kv.get<Flag>(`${KEY_PREFIX}${key}`, "json")));
    return flags.filter((f): f is Flag => f !== null);
  }

  async put(flag: Flag): Promise<void> {
    await this.kv.put(`${KEY_PREFIX}${flag.key}`, JSON.stringify(flag));

    const keys = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    if (!keys.includes(flag.key)) {
      keys.push(flag.key);
      await this.kv.put(INDEX_KEY, JSON.stringify(keys));
    }
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(`${KEY_PREFIX}${key}`);

    const keys = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    const updated = keys.filter((k) => k !== key);
    await this.kv.put(INDEX_KEY, JSON.stringify(updated));
  }

  /** Scan existing KV keys and rebuild the index. */
  private async rebuildIndex(): Promise<string[]> {
    const result = await this.kv.list({ prefix: KEY_PREFIX });
    const keys = result.keys.map((k) => k.name.slice(KEY_PREFIX.length));
    await this.kv.put(INDEX_KEY, JSON.stringify(keys));
    return keys;
  }
}
