import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import type { Flag, FlagType, FlagValue, Rule, Settings } from "@woof/types";
import {
  Check,
  Clock,
  Edit2,
  GitBranch,
  Link2,
  Plus,
  Search,
  ShieldOff,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { getApiClient } from "~/lib/api.server";

export const meta: MetaFunction = () => [{ title: "Feature Flags — Woof" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const [{ flags }, { rules }, settings] = await Promise.all([api.listFlags(), api.listRules(), api.getSettings()]);
  return json({ flags, rules, settings });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  switch (intent) {
    case "toggle": {
      const key = form.get("key") as string;
      const enabled = form.get("enabled") === "true";
      await api.updateFlag(key, { enabled: !enabled });
      break;
    }

    case "kill_switch": {
      const key = form.get("key") as string;
      const killSwitch = form.get("killSwitch") === "true";
      await api.updateFlag(key, { killSwitch: !killSwitch });
      break;
    }

    case "create": {
      const key = form.get("key") as string;
      const type = (form.get("type") as FlagType) || "boolean";
      const description = (form.get("description") as string) || undefined;
      const name = (form.get("name") as string) || undefined;
      const environment = (form.get("environment") as string) || undefined;
      const stickinessAttribute =
        (form.get("stickinessAttribute") as "user_id" | "session_id" | "device_id") || undefined;
      const prerequisitesRaw = form.get("prerequisites") as string | null;
      const prerequisites = prerequisitesRaw ? (JSON.parse(prerequisitesRaw) as string[]) : undefined;
      const scheduleStart = (form.get("scheduleStart") as string) || null;
      const scheduleEnd = (form.get("scheduleEnd") as string) || null;

      const defaultVariant = type === "boolean" ? "off" : "default";
      const variants: Record<string, FlagValue> =
        type === "boolean"
          ? { on: true, off: false }
          : {
              default: type === "integer" || type === "number" ? 0 : type === "object" ? {} : "",
            };

      await api.createFlag({
        key,
        type,
        enabled: false,
        defaultVariant,
        variants,
        description,
        name,
        environment,
        stickinessAttribute,
        prerequisites: prerequisites && prerequisites.length > 0 ? prerequisites : undefined,
        scheduleStart: scheduleStart || null,
        scheduleEnd: scheduleEnd || null,
      });
      break;
    }

    case "update": {
      const key = form.get("key") as string;
      const description = form.get("description") as string | null;
      const defaultVariant = form.get("defaultVariant") as string | null;
      const enabled = form.get("enabled");
      const name = form.get("name") as string | null;
      const environment = form.get("environment") as string | null;
      const stickinessAttribute = form.get("stickinessAttribute") as string | null;
      const rolloutPercentageRaw = form.get("rolloutPercentage") as string | null;
      const rolloutPercentage =
        rolloutPercentageRaw !== null && rolloutPercentageRaw !== "" ? Number(rolloutPercentageRaw) : undefined;
      const prerequisitesRaw = form.get("prerequisites") as string | null;
      const prerequisites = prerequisitesRaw ? (JSON.parse(prerequisitesRaw) as string[]) : undefined;
      const scheduleStart = form.get("scheduleStart") as string | null;
      const scheduleEnd = form.get("scheduleEnd") as string | null;

      await api.updateFlag(key, {
        ...(description !== null && { description }),
        ...(defaultVariant !== null && { defaultVariant }),
        ...(enabled !== null && { enabled: enabled === "true" }),
        ...(name !== null && { name }),
        ...(environment !== null && { environment }),
        ...(stickinessAttribute !== null && {
          stickinessAttribute: stickinessAttribute as "user_id" | "session_id" | "device_id",
        }),
        ...(rolloutPercentage !== undefined && { rolloutPercentage }),
        ...(prerequisites !== undefined && { prerequisites }),
        ...(scheduleStart !== undefined && { scheduleStart: scheduleStart || null }),
        ...(scheduleEnd !== undefined && { scheduleEnd: scheduleEnd || null }),
      });
      break;
    }

    case "delete": {
      const key = form.get("key") as string;
      await api.deleteFlag(key);
      break;
    }

    default:
      return json({ error: "Unknown intent" }, 400);
  }

  const [{ flags }, { rules }, settings] = await Promise.all([api.listFlags(), api.listRules(), api.getSettings()]);
  return json({ flags, rules, settings });
}

const envColors: Record<string, string> = {
  production: "bg-green-100 text-green-800",
  staging: "bg-yellow-100 text-yellow-800",
  development: "bg-blue-100 text-blue-800",
};

function envBadge(env?: string) {
  if (!env) return null;
  const colors = envColors[env] || "bg-gray-100 text-gray-800";
  return <span className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${colors}`}>{env}</span>;
}

function formatSchedule(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  return `until ${fmt(end!)}`;
}

interface NewFlagState {
  key: string;
  name: string;
  type: FlagType;
  description: string;
  environment: string;
  stickinessAttribute: string;
  prerequisites: string[];
  scheduleStart: string;
  scheduleEnd: string;
}

const emptyNewFlag: NewFlagState = {
  key: "",
  name: "",
  type: "boolean",
  description: "",
  environment: "",
  stickinessAttribute: "",
  prerequisites: [],
  scheduleStart: "",
  scheduleEnd: "",
};

export default function FlagsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showCreate, setShowCreate] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newFlag, setNewFlag] = useState<NewFlagState>({ ...emptyNewFlag });

  // The action re-reads the list after every mutation (RYOW via index keys),
  // so fetcher.data contains confirmed server state as soon as the action
  // completes — no client-side guessing. The loader revalidation that follows
  // will eventually replace this, keeping both in sync.
  const fetcherData = fetcher.data as { flags?: Flag[]; rules?: Rule[]; settings?: Settings } | undefined;
  const flags = (fetcherData?.flags ?? loaderData.flags) as Flag[];
  const rules = (fetcherData?.rules ?? loaderData.rules) as Rule[];
  const settings = (fetcherData?.settings ?? loaderData.settings) as Settings;

  const search = searchParams.get("q") || "";
  const envFilter = searchParams.get("env") || "all";

  const filtered = flags.filter((f) => {
    const matchSearch =
      f.key.toLowerCase().includes(search.toLowerCase()) ||
      (f.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (f.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchEnv = envFilter === "all" || f.environment === envFilter;
    return matchSearch && matchEnv;
  });

  function setSearch(value: string) {
    setSearchParams((prev) => {
      if (value) prev.set("q", value);
      else prev.delete("q");
      return prev;
    });
  }

  function setEnvFilter(value: string) {
    setSearchParams((prev) => {
      if (value !== "all") prev.set("env", value);
      else prev.delete("env");
      return prev;
    });
  }

  function togglePrerequisite(flagKey: string) {
    setNewFlag((prev) => {
      const has = prev.prerequisites.includes(flagKey);
      return {
        ...prev,
        prerequisites: has ? prev.prerequisites.filter((k) => k !== flagKey) : [...prev.prerequisites, flagKey],
      };
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1>Feature Flags</h1>
          <p className="text-muted-foreground mt-1">Manage feature flags across your application</p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setEditingKey(null);
          }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" /> New Flag
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search flags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={envFilter}
          onChange={(e) => setEnvFilter(e.target.value)}
          className="px-3 py-2.5 bg-input-background border border-border rounded-lg"
        >
          <option value="all">All Environments</option>
          <option value="production">Production</option>
          <option value="staging">Staging</option>
          <option value="development">Development</option>
        </select>
      </div>

      {/* Create Panel */}
      {showCreate && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3>Create New Flag</h3>
            <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="Flag Key (e.g. my_flag)"
              value={newFlag.key}
              onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg font-mono"
            />
            <input
              placeholder="Flag Name"
              value={newFlag.name}
              onChange={(e) => setNewFlag({ ...newFlag, name: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg"
            />
            <select
              value={newFlag.type}
              onChange={(e) => setNewFlag({ ...newFlag, type: e.target.value as FlagType })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg"
            >
              <option value="boolean">Boolean</option>
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="object">Object</option>
            </select>
            <select
              value={newFlag.environment}
              onChange={(e) => setNewFlag({ ...newFlag, environment: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg"
            >
              <option value="">No Environment</option>
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
            <input
              placeholder="Description (optional)"
              value={newFlag.description}
              onChange={(e) => setNewFlag({ ...newFlag, description: e.target.value })}
              className="col-span-2 px-3 py-2 bg-input-background border border-border rounded-lg"
            />
            <select
              value={newFlag.stickinessAttribute}
              onChange={(e) => setNewFlag({ ...newFlag, stickinessAttribute: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg"
            >
              <option value="">Stickiness Attribute</option>
              <option value="user_id">user_id</option>
              <option value="session_id">session_id</option>
              <option value="device_id">device_id</option>
            </select>
            <div />
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Schedule Start</label>
                <input
                  type="datetime-local"
                  value={newFlag.scheduleStart}
                  onChange={(e) => setNewFlag({ ...newFlag, scheduleStart: e.target.value })}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Schedule End</label>
                <input
                  type="datetime-local"
                  value={newFlag.scheduleEnd}
                  onChange={(e) => setNewFlag({ ...newFlag, scheduleEnd: e.target.value })}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
            </div>
            {/* Prerequisites */}
            {flags.length > 0 && (
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-2">Prerequisites</label>
                <div className="flex flex-wrap gap-2">
                  {flags.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => togglePrerequisite(f.key)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${
                        newFlag.prerequisites.includes(f.key)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
                      }`}
                    >
                      {f.name || f.key}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              if (!newFlag.key) return;
              fetcher.submit(
                {
                  intent: "create",
                  key: newFlag.key,
                  type: newFlag.type,
                  description: newFlag.description,
                  name: newFlag.name,
                  environment: newFlag.environment,
                  stickinessAttribute: newFlag.stickinessAttribute,
                  prerequisites: JSON.stringify(newFlag.prerequisites),
                  scheduleStart: newFlag.scheduleStart,
                  scheduleEnd: newFlag.scheduleEnd,
                },
                { method: "post" },
              );
              setNewFlag({ ...emptyNewFlag });
              setShowCreate(false);
            }}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90"
          >
            <Check className="w-4 h-4" /> Create Flag
          </button>
        </div>
      )}

      {/* Flags Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Flag</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Env</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Rollout</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Rules</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Info</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Status</th>
              <th className="text-right px-5 py-3 text-muted-foreground text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((flag) => (
              <FlagRow
                key={flag.key}
                flag={flag}
                flags={flags}
                rules={rules}
                settings={settings}
                fetcher={fetcher}
                isEditing={editingKey === flag.key}
                onEdit={() => {
                  setEditingKey(flag.key);
                  setShowCreate(false);
                }}
                onCancelEdit={() => setEditingKey(null)}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {flags.length === 0
              ? "No flags yet. Create your first feature flag to get started."
              : "No flags match your search."}
          </div>
        )}
      </div>
    </div>
  );
}

function FlagRow({
  flag,
  flags,
  rules,
  settings,
  fetcher,
  isEditing,
  onEdit,
  onCancelEdit,
}: {
  flag: Flag;
  flags: Flag[];
  rules: Rule[];
  settings: Settings;
  fetcher: ReturnType<typeof useFetcher>;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const [editDescription, setEditDescription] = useState(flag.description ?? "");
  const [editDefaultVariant, setEditDefaultVariant] = useState(flag.defaultVariant);
  const [editName, setEditName] = useState(flag.name ?? "");
  const [editEnvironment, setEditEnvironment] = useState(flag.environment ?? "");
  const [editStickinessAttribute, setEditStickinessAttribute] = useState(flag.stickinessAttribute ?? "");
  const [editRolloutPercentage, setEditRolloutPercentage] = useState(
    flag.rolloutPercentage !== undefined ? String(flag.rolloutPercentage) : "",
  );
  const [editPrerequisites, setEditPrerequisites] = useState<string[]>(flag.prerequisites ?? []);
  const [editScheduleStart, setEditScheduleStart] = useState(flag.scheduleStart ?? "");
  const [editScheduleEnd, setEditScheduleEnd] = useState(flag.scheduleEnd ?? "");

  const variantKeys = Object.keys(flag.variants);
  const ruleCount = rules.filter((r) => r.flagKey === flag.key).length;
  const prereqCount = flag.prerequisites?.length ?? 0;
  const schedule = formatSchedule(flag.scheduleStart, flag.scheduleEnd);

  // Check if all prerequisites are met (enabled and not kill-switched)
  const prereqsMet =
    prereqCount > 0 &&
    flag.prerequisites!.every((pk) => {
      const dep = flags.find((f) => f.key === pk);
      return dep && dep.enabled && !dep.killSwitch;
    });

  function toggleEditPrerequisite(key: string) {
    setEditPrerequisites((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  if (isEditing) {
    return (
      <tr className="border-b border-border last:border-0 bg-primary/5">
        <td className="px-5 py-4" colSpan={7}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4>
                Editing <code className="text-sm bg-muted px-2 py-1 rounded">{flag.key}</code>
              </h4>
              <button onClick={onCancelEdit} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Description</label>
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Default Variant</label>
                <select
                  value={editDefaultVariant}
                  onChange={(e) => setEditDefaultVariant(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                >
                  {variantKeys.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Environment</label>
                <select
                  value={editEnvironment}
                  onChange={(e) => setEditEnvironment(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                >
                  <option value="">No Environment</option>
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Stickiness Attribute</label>
                <select
                  value={editStickinessAttribute}
                  onChange={(e) => setEditStickinessAttribute(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                >
                  <option value="">None</option>
                  <option value="user_id">user_id</option>
                  <option value="session_id">session_id</option>
                  <option value="device_id">device_id</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Rollout Percentage</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editRolloutPercentage}
                  onChange={(e) => setEditRolloutPercentage(e.target.value)}
                  placeholder="0–100"
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Schedule Start</label>
                <input
                  type="datetime-local"
                  value={editScheduleStart}
                  onChange={(e) => setEditScheduleStart(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Schedule End</label>
                <input
                  type="datetime-local"
                  value={editScheduleEnd}
                  onChange={(e) => setEditScheduleEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-lg"
                />
              </div>
              {/* Prerequisites */}
              {flags.length > 1 && (
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-2">Prerequisites</label>
                  <div className="flex flex-wrap gap-2">
                    {flags
                      .filter((f) => f.key !== flag.key)
                      .map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => toggleEditPrerequisite(f.key)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition ${
                            editPrerequisites.includes(f.key)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
                          }`}
                        >
                          {f.name || f.key}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  fetcher.submit(
                    {
                      intent: "update",
                      key: flag.key,
                      name: editName,
                      description: editDescription,
                      defaultVariant: editDefaultVariant,
                      environment: editEnvironment,
                      stickinessAttribute: editStickinessAttribute,
                      rolloutPercentage: editRolloutPercentage,
                      prerequisites: JSON.stringify(editPrerequisites),
                      scheduleStart: editScheduleStart,
                      scheduleEnd: editScheduleEnd,
                    },
                    { method: "post" },
                  );
                  onCancelEdit();
                }}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90"
              >
                <Check className="w-4 h-4" /> Save Changes
              </button>
              <button
                onClick={onCancelEdit}
                className="px-4 py-2 border border-border rounded-lg text-muted-foreground hover:text-foreground transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition">
      {/* Flag column */}
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{flag.name || flag.key}</span>
          {flag.killSwitch && <ShieldOff className="w-4 h-4 text-red-500 shrink-0" />}
        </div>
        <code className="text-xs text-muted-foreground">{flag.key}</code>
        {flag.description && <div className="text-xs text-muted-foreground mt-0.5">{flag.description}</div>}
      </td>

      {/* Env column */}
      <td className="px-5 py-4">{envBadge(flag.environment)}</td>

      {/* Rollout column */}
      <td className="px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${flag.rolloutPercentage ?? 0}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{flag.rolloutPercentage ?? 0}%</span>
          </div>
          {flag.stickinessAttribute && (
            <div className="text-xs text-muted-foreground">sticky: {flag.stickinessAttribute}</div>
          )}
        </div>
      </td>

      {/* Rules column */}
      <td className="px-5 py-4">
        <Link
          to={`/rules?flagKey=${encodeURIComponent(flag.key)}`}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <GitBranch className="w-3.5 h-3.5" />
          {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
        </Link>
      </td>

      {/* Info column */}
      <td className="px-5 py-4">
        <div className="space-y-1">
          {prereqCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                {prereqCount} {prereqCount === 1 ? "prereq" : "prereqs"}{" "}
                {prereqsMet ? (
                  <span className="text-green-600">&#10003;</span>
                ) : (
                  <span className="text-amber-600">unmet</span>
                )}
              </span>
            </div>
          )}
          {schedule && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{schedule}</span>
            </div>
          )}
        </div>
      </td>

      {/* Status column */}
      <td className="px-5 py-4">
        <button
          onClick={() =>
            fetcher.submit(
              {
                intent: "toggle",
                key: flag.key,
                enabled: String(flag.enabled),
              },
              { method: "post" },
            )
          }
          disabled={!!flag.killSwitch}
          className={`text-foreground ${flag.killSwitch ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          {flag.enabled ? (
            <ToggleRight className="w-7 h-7 text-green-600" />
          ) : (
            <ToggleLeft className="w-7 h-7 text-muted-foreground" />
          )}
        </button>
      </td>

      {/* Actions column */}
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() =>
              fetcher.submit(
                {
                  intent: "kill_switch",
                  key: flag.key,
                  killSwitch: String(!!flag.killSwitch),
                },
                { method: "post" },
              )
            }
            className={`transition p-1 ${
              flag.killSwitch ? "text-red-500 hover:text-red-700" : "text-muted-foreground hover:text-red-500"
            }`}
            title={flag.killSwitch ? "Deactivate kill switch" : "Activate kill switch"}
          >
            <ShieldOff className="w-4 h-4" />
          </button>
          <button onClick={onEdit} className="text-muted-foreground hover:text-foreground transition p-1">
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => fetcher.submit({ intent: "delete", key: flag.key }, { method: "post" })}
            className="text-muted-foreground hover:text-destructive transition p-1"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
