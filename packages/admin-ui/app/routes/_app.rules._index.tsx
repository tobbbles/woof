import type { ActionFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useFetcher, useNavigate, useOutletContext } from "@remix-run/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Flag,
  Plus,
  ShieldOff,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { ConditionGroupDisplay } from "~/components/condition-group-display";
import { getApiClient } from "~/lib/api.server";
import { countConditions } from "~/types/rule";
import type { RulesContext } from "./_app.rules";

export const meta: MetaFunction = () => [{ title: "Rule Engine — Woof" }];

export async function action({ request, context }: ActionFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  switch (intent) {
    case "delete": {
      const id = form.get("id") as string;
      await api.deleteRule(id);
      break;
    }
    case "reorder": {
      const updates = JSON.parse(form.get("updates") as string) as {
        id: string;
        priority: number;
      }[];
      await Promise.all(updates.map((u) => api.updateRule(u.id, { priority: u.priority })));
      break;
    }
    default:
      return json({ error: "Unknown intent" }, 400);
  }

  const [{ flags }, { rules }, { segments }] = await Promise.all([
    api.listFlags(),
    api.listRules(),
    api.listSegments(),
  ]);
  return json({ flags, rules, segments });
}

const envColors: Record<string, string> = {
  production: "bg-green-100 text-green-800",
  staging: "bg-yellow-100 text-yellow-800",
  development: "bg-blue-100 text-blue-800",
};

export default function RulesIndexPage() {
  const outletData = useOutletContext<RulesContext>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();

  // Prefer fresh action data over loader data (RYOW via index keys)
  const flags = (fetcher.data as RulesContext | undefined)?.flags ?? outletData.flags;
  const rules = (fetcher.data as RulesContext | undefined)?.rules ?? outletData.rules;
  const segments = (fetcher.data as RulesContext | undefined)?.segments ?? outletData.segments;

  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [flagFilter, setFlagFilter] = useState("all");

  const filteredRules = flagFilter === "all" ? rules : rules.filter((r) => r.flagKey === flagFilter);

  const sortedRules = [...filteredRules].sort((a, b) => a.priority - b.priority);

  const deleteRule = (id: string) => {
    fetcher.submit({ intent: "delete", id }, { method: "post" });
  };

  const movePriority = (id: string, direction: "up" | "down") => {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;

    const flagRules = [...rules].filter((r) => r.flagKey === rule.flagKey).sort((a, b) => a.priority - b.priority);
    const idx = flagRules.findIndex((r) => r.id === id);

    if (direction === "up" && idx > 0) {
      const temp = flagRules[idx].priority;
      flagRules[idx] = { ...flagRules[idx], priority: flagRules[idx - 1].priority };
      flagRules[idx - 1] = { ...flagRules[idx - 1], priority: temp };
    } else if (direction === "down" && idx < flagRules.length - 1) {
      const temp = flagRules[idx].priority;
      flagRules[idx] = { ...flagRules[idx], priority: flagRules[idx + 1].priority };
      flagRules[idx + 1] = { ...flagRules[idx + 1], priority: temp };
    } else {
      return;
    }

    const updates = flagRules.map((r) => ({ id: r.id, priority: r.priority }));
    fetcher.submit({ intent: "reorder", updates: JSON.stringify(updates) }, { method: "post" });
  };

  const getFlagForRule = (flagKey: string) => flags.find((f) => f.key === flagKey);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>Rule Engine</h1>
          <p className="text-muted-foreground mt-1">
            Top-down priority evaluation with AND/OR logic — first matching rule wins
          </p>
        </div>
        <button
          onClick={() => navigate("/rules/new")}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" /> New Rule
        </button>
      </div>

      {flags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground shrink-0">Filter:</span>
          <button
            onClick={() => setFlagFilter("all")}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              flagFilter === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary"
            }`}
          >
            All
          </button>
          {flags.map((flag) => (
            <button
              key={flag.key}
              onClick={() => setFlagFilter(flag.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
                flagFilter === flag.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary"
              }`}
            >
              {flag.enabled ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
              {flag.key}
            </button>
          ))}
        </div>
      )}

      {sortedRules.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-16 flex flex-col items-center text-muted-foreground">
          <Flag className="w-10 h-10 mb-3" />
          <p>No rules found{flagFilter !== "all" ? " for this flag" : ""}.</p>
          <button onClick={() => navigate("/rules/new")} className="mt-3 text-sm text-primary hover:opacity-80">
            Create one
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedRules.map((rule, idx) => {
            const flag = getFlagForRule(rule.flagKey);
            const condCount = countConditions(rule.conditionGroup);
            const hasNesting = rule.conditionGroup.groups.length > 0;
            const isExpanded = expandedRule === rule.id;
            const ruleSegments = segments.filter(
              (s) => rule.segmentIds?.includes(s.id) || rule.segmentIds?.includes(s.key),
            );

            return (
              <div key={rule.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition"
                  onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => movePriority(rule.id, "up")}
                        disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => movePriority(rule.id, "down")}
                        disabled={idx === sortedRules.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="w-6 h-6 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                      {rule.priority}
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-foreground">{rule.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            rule.conditionGroup.logic === "AND"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {rule.conditionGroup.logic}
                        </span>
                        {hasNesting && (
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                            nested
                          </span>
                        )}
                        {rule.variantKey && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                            → {rule.variantKey}
                          </span>
                        )}
                        {segments
                          .filter((s) => rule.segmentIds?.includes(s.id) || rule.segmentIds?.includes(s.key))
                          .map((s) => (
                            <span
                              key={s.id}
                              className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full flex items-center gap-1"
                            >
                              <Users className="w-2.5 h-2.5" />
                              {s.name}
                            </span>
                          ))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <code className="bg-muted px-1.5 py-0.5 rounded">{rule.flagKey}</code>
                        {flag &&
                          (flag.killSwitch ? (
                            <span className="text-red-600">⊘ killed</span>
                          ) : (
                            <span className={flag.enabled ? "text-green-600" : "text-muted-foreground"}>
                              {flag.enabled ? "● on" : "○ off"}
                            </span>
                          ))}
                        {flag?.environment && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${envColors[flag.environment] ?? "bg-muted text-muted-foreground"}`}
                          >
                            {flag.environment}
                          </span>
                        )}
                        <span>
                          {condCount} condition{condCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="text-muted-foreground hover:text-destructive transition p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-5 py-4 bg-muted/20 space-y-4">
                    {flag?.killSwitch && (
                      <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-center gap-2">
                        <ShieldOff className="w-4 h-4" /> Kill switch is active on{" "}
                        <code className="bg-red-100 px-1 rounded">{flag.key}</code> — all evaluations return FAIL.
                      </div>
                    )}
                    {flag && !flag.enabled && (
                      <div className="px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 flex items-center gap-2">
                        <ToggleLeft className="w-4 h-4" /> Flag{" "}
                        <code className="bg-yellow-100 px-1 rounded">{flag.key}</code> is disabled — rule will not take
                        effect.
                      </div>
                    )}
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">Condition Tree</div>
                      <ConditionGroupDisplay group={rule.conditionGroup} />
                    </div>
                    {ruleSegments.length > 0 && (
                      <div>
                        <div className="text-sm text-muted-foreground mb-2">Included Segments</div>
                        <div className="flex gap-2 flex-wrap">
                          {ruleSegments.map((s) => (
                            <div
                              key={s.id}
                              className="text-xs bg-purple-50 border border-purple-200 rounded-lg px-3 py-2"
                            >
                              <span className="text-purple-800">{s.name}</span>
                              <span className="text-purple-600 ml-2">
                                ({countConditions(s.conditionGroup)} conditions, {s.conditionGroup.logic})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
