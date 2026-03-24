import type { ActionFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";
import { useNavigate, useOutletContext } from "@remix-run/react";
import type { EvalContextEntry } from "@woof/types";
import {
  ArrowLeft,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Plus,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { ConditionGroupEditor } from "~/components/condition-group-editor";
import { getApiClient } from "~/lib/api.server";
import type { Condition, ConditionGroup } from "~/types/rule";
import { countConditions, emptyConditionGroup } from "~/types/rule";
import type { RulesContext } from "./_app.rules";

export const meta: MetaFunction = () => [{ title: "Create Rule — Woof" }];

export async function action({ request, context }: ActionFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const form = await request.formData();

  const flagKey = form.get("flagKey") as string;
  const name = form.get("name") as string;
  const variantKey = form.get("variantKey") as string;
  const conditionGroup = JSON.parse(form.get("conditionGroup") as string) as ConditionGroup;
  const segmentIds = JSON.parse((form.get("segmentIds") as string) || "[]") as string[];

  await api.createRule({
    flagKey,
    name,
    variantKey,
    conditionGroup,
    segmentIds,
  });
  return redirect("/rules");
}

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CreateRulePage() {
  const { flags, segments, evalContexts } = useOutletContext<RulesContext>();
  const navigate = useNavigate();

  // Rule builder state
  const [flagKey, setFlagKey] = useState(flags[0]?.key || "");
  const [name, setName] = useState("");
  const [variantKey, setVariantKey] = useState("");
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [conditionGroup, setConditionGroup] = useState<ConditionGroup>(emptyConditionGroup());

  // Evaluation history panel state
  const [historySearch, setHistorySearch] = useState("");
  const [historyFlagFilter, setHistoryFlagFilter] = useState<string>(flagKey);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedFlag = flags.find((f) => f.key === flagKey);
  const variantKeys = selectedFlag ? Object.keys(selectedFlag.variants) : [];

  const handleFlagChange = (key: string) => {
    setFlagKey(key);
    setHistoryFlagFilter(key);
    const flag = flags.find((f) => f.key === key);
    if (flag) {
      const variants = Object.keys(flag.variants);
      setVariantKey(variants[0] || "");
    }
  };

  const condCount = countConditions(conditionGroup);

  // Filter evaluation contexts
  const filteredHistory = evalContexts.filter((ev: EvalContextEntry) => {
    const matchFlag = historyFlagFilter === "all" || ev.flagKey === historyFlagFilter;
    const matchSearch =
      historySearch === "" ||
      ev.flagKey.toLowerCase().includes(historySearch.toLowerCase()) ||
      (ev.matchedRule || "").toLowerCase().includes(historySearch.toLowerCase()) ||
      Object.keys(ev.context).some((k) => k.toLowerCase().includes(historySearch.toLowerCase()));
    return matchFlag && matchSearch;
  });

  // Collect all unique context keys across visible history
  const allContextKeys = Array.from(new Set(filteredHistory.flatMap((ev) => Object.keys(ev.context)))).sort();

  const copyValue = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const applyFullContext = (context: Record<string, unknown>) => {
    const keys = Object.keys(context);
    const conditions: Condition[] = keys.map((key) => ({
      attribute: key,
      operator: "equals",
      value: String(context[key] ?? ""),
    }));
    setConditionGroup({ ...conditionGroup, conditions });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/rules")}
          className="p-2 rounded-lg hover:bg-muted transition text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1>Create New Rule</h1>
          <p className="text-muted-foreground mt-1">
            Build conditions using past evaluation context for quick attribute discovery
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6 items-start">
        {/* Left: Rule Builder */}
        <div className="space-y-5">
          <form method="post">
            <input type="hidden" name="flagKey" value={flagKey} />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="variantKey" value={variantKey} />
            <input type="hidden" name="conditionGroup" value={JSON.stringify(conditionGroup)} />
            <input type="hidden" name="segmentIds" value={JSON.stringify(segmentIds)} />

            <div className="bg-card border border-border rounded-xl p-6 space-y-5">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Target Flag</label>
                  {flags.length > 0 ? (
                    <select
                      value={flagKey}
                      onChange={(e) => handleFlagChange(e.target.value)}
                      className="w-full px-3 py-2.5 bg-input-background border border-border rounded-lg"
                    >
                      {flags.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.name || f.key} ({f.key})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="px-3 py-2.5 bg-input-background border border-border rounded-lg text-muted-foreground text-sm">
                      No flags available
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Rule Name</label>
                  <input
                    placeholder="e.g. Premium Users"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2.5 bg-input-background border border-border rounded-lg"
                  />
                </div>
              </div>

              {/* Serve Variant */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Serve Variant</label>
                <select
                  value={variantKey}
                  onChange={(e) => setVariantKey(e.target.value)}
                  className="w-full px-3 py-2.5 bg-input-background border border-border rounded-lg max-w-xs"
                >
                  {variantKeys.length === 0 && <option value="">Select a flag first</option>}
                  {variantKeys.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Segments */}
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Include Segments</label>
                <div className="flex gap-2 flex-wrap">
                  {segments.map((seg) => (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() =>
                        setSegmentIds((prev) =>
                          prev.includes(seg.id) ? prev.filter((s) => s !== seg.id) : [...prev, seg.id],
                        )
                      }
                      className={`text-xs px-3 py-1.5 rounded-full border transition flex items-center gap-1 ${
                        segmentIds.includes(seg.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary"
                      }`}
                    >
                      <Users className="w-3 h-3" /> {seg.name}
                    </button>
                  ))}
                  {segments.length === 0 && (
                    <span className="text-xs text-muted-foreground">No segments created yet</span>
                  )}
                </div>
              </div>

              {/* Condition Group Builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground">Conditions ({condCount})</label>
                  <span className="text-xs text-muted-foreground/60 italic">
                    type or use the dropdown to pick from evaluation context keys
                  </span>
                </div>
                <ConditionGroupEditor
                  group={conditionGroup}
                  onChange={setConditionGroup}
                  contextKeys={allContextKeys}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 mt-5">
              <button
                type="submit"
                disabled={!name || !flagKey || !variantKey}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" /> Create Rule
              </button>
              <button
                type="button"
                onClick={() => navigate("/rules")}
                className="px-5 py-2.5 border border-border rounded-lg text-muted-foreground hover:text-foreground transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* Right: Evaluation History Panel */}
        <div className="space-y-4">
          {/* Header + filters */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h3>Previous Evaluations</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Browse past OFREP requests. Use &ldquo;Use entire context&rdquo; to populate conditions, or pick keys from
              the condition attribute dropdowns.
            </p>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search history..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-input-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <select
                value={historyFlagFilter}
                onChange={(e) => setHistoryFlagFilter(e.target.value)}
                className="px-2 py-2 bg-input-background border border-border rounded-lg text-sm"
              >
                <option value="all">All flags</option>
                {flags.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name || f.key}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* History list */}
          <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
            {filteredHistory.length === 0 ? (
              <div className="bg-card border border-border rounded-xl py-10 flex flex-col items-center text-muted-foreground">
                <Clock className="w-8 h-8 mb-2" />
                <p className="text-sm">No evaluations found</p>
                <p className="text-xs mt-1">Evaluations from the OFREP endpoint will appear here</p>
              </div>
            ) : (
              filteredHistory.map((ev) => {
                const isExpanded = expandedCheck === ev.timestamp;
                const contextEntries = Object.entries(ev.context);
                return (
                  <div key={ev.timestamp} className="bg-card border border-border rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedCheck(isExpanded ? null : ev.timestamp)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {ev.result === "TARGETING_MATCH" || ev.result === "SPLIT" || ev.result === "STATIC" ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{ev.flagKey}</code>
                            {ev.matchedRule && (
                              <span className="text-xs text-muted-foreground truncate">/ {ev.matchedRule}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{formatTime(ev.timestamp)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{contextEntries.length} keys</span>
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/10">
                        {/* Quick action */}
                        <button
                          type="button"
                          onClick={() => applyFullContext(ev.context)}
                          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-90 transition"
                        >
                          <Braces className="w-3 h-3" /> Use entire context
                        </button>

                        {/* JSON context viewer */}
                        <div className="bg-background rounded-lg border border-border overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                            <span className="text-xs text-muted-foreground">Context JSON</span>
                            <span className="text-xs text-muted-foreground">{contextEntries.length} properties</span>
                          </div>
                          <div className="p-3 font-mono text-xs overflow-x-auto max-h-64 overflow-y-auto">
                            <div className="text-muted-foreground">{"{"}</div>
                            {contextEntries.map(([key, value], i) => {
                              const isLast = i === contextEntries.length - 1;
                              const strValue = String(value);
                              return (
                                <div
                                  key={key}
                                  className="flex items-center gap-0 pl-4 py-0.5 rounded-sm group hover:bg-muted/50"
                                >
                                  <span className="text-blue-600 shrink-0">&quot;{key}&quot;</span>
                                  <span className="text-muted-foreground shrink-0">:&nbsp;</span>
                                  <span className="text-green-700">&quot;{strValue}&quot;</span>
                                  {!isLast && <span className="text-muted-foreground">,</span>}
                                  <button
                                    type="button"
                                    className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition"
                                    onClick={() => copyValue(key, strValue)}
                                    title="Copy value"
                                  >
                                    {copiedKey === key ? (
                                      <Check className="w-3 h-3 text-green-600" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                            <div className="text-muted-foreground">{"}"}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
