import type { Settings } from "@woof/types";

const SETTINGS_KEY = "settings:global";

const DEFAULT_SETTINGS: Settings = {
  environments: [
    { id: "1", name: "Production", key: "production", color: "#16a34a", protected: true },
    { id: "2", name: "Staging", key: "staging", color: "#ca8a04", protected: false },
    { id: "3", name: "Development", key: "development", color: "#2563eb", protected: false },
  ],
  flagDefaults: {
    defaultEnv: "development",
    defaultRollout: 0,
    requireApproval: true,
    approvalEnvs: ["production"],
    staleFlagDays: 30,
    autoDisableStale: false,
  },
  evaluation: {
    strategy: "first-match",
    cacheEnabled: true,
    cacheTtlSeconds: 60,
    loggingEnabled: true,
    logLevel: "info",
  },
};

/** KV-backed settings store. Returns defaults if nothing has been saved. */
export class SettingsStore {
  constructor(private kv: KVNamespace) {}

  async get(): Promise<Settings> {
    const settings = await this.kv.get<Settings>(SETTINGS_KEY, "json");
    return settings ?? DEFAULT_SETTINGS;
  }

  async put(settings: Settings): Promise<void> {
    await this.kv.put(SETTINGS_KEY, JSON.stringify(settings));
  }
}
