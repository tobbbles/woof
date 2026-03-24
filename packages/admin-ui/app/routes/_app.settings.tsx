import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { Settings } from "@woof/types";
import { GripVertical, Plus, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import { getApiClient } from "~/lib/api.server";

export const meta: MetaFunction = () => [{ title: "Settings — Woof" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const settings = await api.getSettings();
  return json({ settings });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const form = await request.formData();
  const settings = JSON.parse(form.get("settings") as string) as Settings;
  await api.updateSettings(settings);
  return json({ ok: true });
}

const colorOptions = [
  { label: "Green", value: "#16a34a" },
  { label: "Yellow", value: "#ca8a04" },
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#9333ea" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Teal", value: "#0d9488" },
];

export default function SettingsPage() {
  const { settings: initial } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [environments, setEnvironments] = useState((initial as Settings).environments);
  const [defaults, setDefaults] = useState((initial as Settings).flagDefaults);
  const [evaluation, setEvaluation] = useState((initial as Settings).evaluation);
  const [saved, setSaved] = useState(false);

  const addEnvironment = () => {
    setEnvironments((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: "",
        key: "",
        color: "#9333ea",
        protected: false,
      },
    ]);
  };

  const updateEnv = (id: string, field: string, value: string | boolean) => {
    setEnvironments((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const removeEnv = (id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
  };

  const handleSave = () => {
    const settings: Settings = {
      environments,
      flagDefaults: defaults,
      evaluation,
    };
    fetcher.submit({ settings: JSON.stringify(settings) }, { method: "post" });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleApprovalEnv = (key: string) => {
    setDefaults((prev) => ({
      ...prev,
      approvalEnvs: prev.approvalEnvs.includes(key)
        ? prev.approvalEnvs.filter((k) => k !== key)
        : [...prev.approvalEnvs, key],
    }));
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1>Settings</h1>
          <p className="text-muted-foreground mt-1">Configure Woof environments and flag behavior</p>
        </div>
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition ${
            saved ? "bg-green-600 text-white" : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          <Save className="w-4 h-4" />
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </div>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3>Environments</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Define deployment environments for flag targeting</p>
          </div>
          <button
            onClick={addEnvironment}
            className="flex items-center gap-1.5 text-sm text-primary hover:opacity-80 transition"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        <div className="space-y-3">
          {environments.map((env) => (
            <div key={env.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-4 py-3">
              <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: env.color }} />
              <input
                value={env.name}
                onChange={(e) => updateEnv(env.id, "name", e.target.value)}
                placeholder="Name"
                className="flex-1 bg-input-background border border-border rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                value={env.key}
                onChange={(e) => updateEnv(env.id, "key", e.target.value)}
                placeholder="key_slug"
                className="flex-1 bg-input-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
              />
              <select
                value={env.color}
                onChange={(e) => updateEnv(env.id, "color", e.target.value)}
                className="bg-input-background border border-border rounded-lg px-2 py-1.5 text-sm"
              >
                {colorOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={env.protected}
                  onChange={(e) => updateEnv(env.id, "protected", e.target.checked)}
                  className="accent-primary"
                />
                Protected
              </label>
              <button
                onClick={() => removeEnv(env.id)}
                className="text-muted-foreground hover:text-destructive transition p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div>
          <h3>Flag Defaults</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Default behavior when creating new feature flags</p>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Default Environment</label>
            <select
              value={defaults.defaultEnv}
              onChange={(e) => setDefaults({ ...defaults, defaultEnv: e.target.value })}
              className="w-full bg-input-background border border-border rounded-lg px-3 py-2"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.key}>
                  {env.name || env.key}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Default Rollout %</label>
            <input
              type="number"
              min={0}
              max={100}
              value={defaults.defaultRollout}
              onChange={(e) =>
                setDefaults({
                  ...defaults,
                  defaultRollout: Number(e.target.value),
                })
              }
              className="w-full bg-input-background border border-border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Stale Flag Threshold (days)</label>
            <input
              type="number"
              min={1}
              value={defaults.staleFlagDays}
              onChange={(e) =>
                setDefaults({
                  ...defaults,
                  staleFlagDays: Number(e.target.value),
                })
              }
              className="w-full bg-input-background border border-border rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={defaults.autoDisableStale}
                onChange={(e) =>
                  setDefaults({
                    ...defaults,
                    autoDisableStale: e.target.checked,
                  })
                }
                className="accent-primary w-4 h-4"
              />
              <span className="text-sm">Auto-disable stale flags</span>
            </label>
          </div>
        </div>
        <div>
          <label className="flex items-center gap-2.5 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={defaults.requireApproval}
              onChange={(e) =>
                setDefaults({
                  ...defaults,
                  requireApproval: e.target.checked,
                })
              }
              className="accent-primary w-4 h-4"
            />
            <span className="text-sm">Require approval before enabling flags</span>
          </label>
          {defaults.requireApproval && (
            <div className="ml-7">
              <p className="text-xs text-muted-foreground mb-2">Require approval for these environments:</p>
              <div className="flex gap-2 flex-wrap">
                {environments.map((env) => (
                  <button
                    key={env.id}
                    onClick={() => toggleApprovalEnv(env.key)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      defaults.approvalEnvs.includes(env.key)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary"
                    }`}
                  >
                    {env.name || env.key}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div>
          <h3>Evaluation Engine</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Configure how rules are evaluated at runtime</p>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Matching Strategy</label>
            <select
              value={evaluation.strategy}
              onChange={(e) =>
                setEvaluation({
                  ...evaluation,
                  strategy: e.target.value as "first-match" | "all-match",
                })
              }
              className="w-full bg-input-background border border-border rounded-lg px-3 py-2"
            >
              <option value="first-match">First Match (short-circuit)</option>
              <option value="all-match">All Match (evaluate all rules)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Log Level</label>
            <select
              value={evaluation.logLevel}
              onChange={(e) =>
                setEvaluation({
                  ...evaluation,
                  logLevel: e.target.value as "debug" | "info" | "warn" | "error",
                })
              }
              className="w-full bg-input-background border border-border rounded-lg px-3 py-2"
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={evaluation.cacheEnabled}
              onChange={(e) => setEvaluation({ ...evaluation, cacheEnabled: e.target.checked })}
              className="accent-primary w-4 h-4"
            />
            <span className="text-sm">Enable evaluation caching</span>
          </label>
          {evaluation.cacheEnabled && (
            <div className="ml-7">
              <label className="text-xs text-muted-foreground block mb-1">Cache TTL (seconds)</label>
              <input
                type="number"
                min={1}
                value={evaluation.cacheTtlSeconds}
                onChange={(e) =>
                  setEvaluation({
                    ...evaluation,
                    cacheTtlSeconds: Number(e.target.value),
                  })
                }
                className="w-40 bg-input-background border border-border rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          )}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={evaluation.loggingEnabled}
              onChange={(e) =>
                setEvaluation({
                  ...evaluation,
                  loggingEnabled: e.target.checked,
                })
              }
              className="accent-primary w-4 h-4"
            />
            <span className="text-sm">Enable evaluation logging</span>
          </label>
        </div>
      </section>

      <section className="bg-card border border-destructive/30 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-destructive">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Irreversible actions — proceed with caution</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="flex items-center gap-2 text-sm border border-destructive/40 text-destructive px-4 py-2 rounded-lg hover:bg-destructive/10 transition">
            <RotateCcw className="w-3.5 h-3.5" /> Reset All Flags
          </button>
          <button className="flex items-center gap-2 text-sm border border-destructive/40 text-destructive px-4 py-2 rounded-lg hover:bg-destructive/10 transition">
            <X className="w-3.5 h-3.5" /> Purge Audit Log
          </button>
        </div>
      </section>
    </div>
  );
}
