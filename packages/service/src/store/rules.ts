import type { Rule } from "@woof/types";

const KEY_PREFIX = "rule:";
const INDEX_KEY = "index:rules";

/**
 * KV-backed rule store.
 *
 * Uses an index key for RYOW-consistent listing instead of `kv.list()`.
 * Falls back to `kv.list()` and rebuilds the index if it doesn't exist.
 */
export class RuleStore {
  constructor(private kv: KVNamespace) {}

  async get(id: string): Promise<Rule | null> {
    return this.kv.get<Rule>(`${KEY_PREFIX}${id}`, "json");
  }

  async list(): Promise<Rule[]> {
    let ids = await this.kv.get<string[]>(INDEX_KEY, "json");

    if (!ids) {
      ids = await this.rebuildIndex();
    }

    if (ids.length === 0) return [];

    const rules = await Promise.all(ids.map((id) => this.kv.get<Rule>(`${KEY_PREFIX}${id}`, "json")));
    return rules.filter((r): r is Rule => r !== null);
  }

  async listByFlag(flagKey: string): Promise<Rule[]> {
    const all = await this.list();
    return all.filter((r) => r.flagKey === flagKey).sort((a, b) => a.priority - b.priority);
  }

  async put(rule: Rule): Promise<void> {
    await this.kv.put(`${KEY_PREFIX}${rule.id}`, JSON.stringify(rule));

    const ids = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    if (!ids.includes(rule.id)) {
      ids.push(rule.id);
      await this.kv.put(INDEX_KEY, JSON.stringify(ids));
    }
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(`${KEY_PREFIX}${id}`);

    const ids = (await this.kv.get<string[]>(INDEX_KEY, "json")) ?? [];
    const updated = ids.filter((i) => i !== id);
    await this.kv.put(INDEX_KEY, JSON.stringify(updated));
  }

  private async rebuildIndex(): Promise<string[]> {
    const result = await this.kv.list({ prefix: KEY_PREFIX });
    const ids = result.keys.map((k) => k.name.slice(KEY_PREFIX.length));
    await this.kv.put(INDEX_KEY, JSON.stringify(ids));
    return ids;
  }
}
