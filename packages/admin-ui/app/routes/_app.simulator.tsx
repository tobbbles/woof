import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import type { ConditionGroup, Flag, Rule, Segment } from "@woof/types";
import { CheckCircle2, Clock, GitBranch, Link2, Percent, Play, ShieldOff, XCircle } from "lucide-react";
import { useState } from "react";
import { getApiClient } from "~/lib/api.server";
import { countConditions } from "~/types/rule";

export const meta: MetaFunction = () => [{ title: "Simulator — Woof" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const [{ flags }, { rules }, { segments }] = await Promise.all([
    api.listFlags(),
    api.listRules(),
    api.listSegments(),
  ]);
  return json({ flags, rules, segments });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalStep {
  type: "kill_switch" | "prerequisites" | "schedule" | "flag_status" | "rule" | "rollout";
  label: string;
  passed: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stickyHash(flagKey: string, stickyValue: string): number {
  const input = `${flagKey}:${stickyValue}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) | 0;
  }
  return Math.abs(hash) % 100;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function evalCond(attr: string, operator: string, value: string, ctx: Record<string, string>): boolean {
  const actual = ctx[attr];
  if (actual === undefined) return false;
  switch (operator) {
    case "equals":
      return actual === value;
    case "not_equals":
      return actual !== value;
    case "in":
      return value
        .split(",")
        .map((s) => s.trim())
        .includes(actual);
    case "contains":
      return actual.includes(value);
    case "ends_with":
      return actual.endsWith(value);
    case "greater_than":
      return parseFloat(actual) > parseFloat(value);
    case "less_than":
      return parseFloat(actual) < parseFloat(value);
    case "semver_gte":
      return compareSemver(actual, value) >= 0;
    case "semver_lte":
      return compareSemver(actual, value) <= 0;
    default:
      return false;
  }
}

function evaluateConditionGroup(group: ConditionGroup, ctx: Record<string, string>): boolean {
  const condResults = group.conditions.map((c) => {
    const result = evalCond(c.attribute, c.operator, c.value, ctx);
    return c.negate ? !result : result;
  });
  const groupResults = group.groups.map((g) => evaluateConditionGroup(g, ctx));
  const all = [...condResults, ...groupResults];
  if (all.length === 0) return true;
  return group.logic === "AND" ? all.every(Boolean) : all.some(Boolean);
}

function describeGroupFailures(group: ConditionGroup, ctx: Record<string, string>): string[] {
  const failures: string[] = [];
  for (const c of group.conditions) {
    const result = evalCond(c.attribute, c.operator, c.value, ctx);
    const final = c.negate ? !result : result;
    if (!final) {
      failures.push(`${c.negate ? "NOT " : ""}${c.attribute} ${c.operator} ${c.value}`);
    }
  }
  for (const sub of group.groups) {
    const subResult = evaluateConditionGroup(sub, ctx);
    if (!subResult) {
      const subFailures = describeGroupFailures(sub, ctx);
      failures.push(`[${sub.logic} group: ${subFailures.join(", ")}]`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

function StepIcon({ step }: { step: EvalStep }) {
  const cls = "w-4 h-4";
  switch (step.type) {
    case "kill_switch":
      return <ShieldOff className={cls} />;
    case "prerequisites":
      return <Link2 className={cls} />;
    case "schedule":
      return <Clock className={cls} />;
    case "flag_status":
      return step.passed ? <CheckCircle2 className={cls} /> : <XCircle className={cls} />;
    case "rule":
      return <GitBranch className={cls} />;
    case "rollout":
      return <Percent className={cls} />;
    default:
      return step.passed ? <CheckCircle2 className={cls} /> : <XCircle className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SimulatorPage() {
  const { flags, rules, segments } = useLoaderData<typeof loader>();

  const [selectedFlag, setSelectedFlag] = useState((flags as Flag[])[0]?.key || "");
  const [context, setContext] = useState<Record<string, string>>({
    "user.id": "usr_12345",
    "user.email": "jane@company.io",
    "user.plan": "beta",
    "user.country": "US",
    "user.role": "admin",
    "user.authenticated": "true",
  });
  const [newAttr, setNewAttr] = useState({ key: "", value: "" });
  const [evalResult, setEvalResult] = useState<{
    result: boolean;
    steps: EvalStep[];
    matchedRule: string | null;
  } | null>(null);

  const allFlags = flags as Flag[];
  const allRules = rules as Rule[];
  const allSegments = segments as Segment[];

  const flag = allFlags.find((f) => f.key === selectedFlag);
  const flagRules = allRules.filter((r) => r.flagKey === selectedFlag).sort((a, b) => a.priority - b.priority);

  const addAttribute = () => {
    if (!newAttr.key) return;
    setContext({ ...context, [newAttr.key]: newAttr.value });
    setNewAttr({ key: "", value: "" });
  };

  const removeAttribute = (key: string) => {
    const c = { ...context };
    delete c[key];
    setContext(c);
  };

  // ── Evaluation ────────────────────────────────────────────────────────
  const runEvaluation = () => {
    if (!flag) return;
    const steps: EvalStep[] = [];
    let matchedRule: string | null = null;
    let halted = false;

    // 1. Kill Switch
    if (flag.killSwitch) {
      steps.push({
        type: "kill_switch",
        label: "Kill Switch",
        passed: false,
        detail: "Kill switch is ACTIVE — returning default OFF immediately.",
      });
      halted = true;
    } else {
      steps.push({
        type: "kill_switch",
        label: "Kill Switch",
        passed: true,
        detail: "Kill switch is not active.",
      });
    }

    // 2. Prerequisites
    if (!halted) {
      const prereqs = flag.prerequisites ?? [];
      if (prereqs.length > 0) {
        const unmet = prereqs.filter((pKey) => {
          const pFlag = allFlags.find((f) => f.key === pKey);
          return !pFlag || !pFlag.enabled;
        });
        if (unmet.length > 0) {
          steps.push({
            type: "prerequisites",
            label: "Prerequisites",
            passed: false,
            detail: `Unmet prerequisite flags: ${unmet.join(", ")}`,
          });
          halted = true;
        } else {
          steps.push({
            type: "prerequisites",
            label: "Prerequisites",
            passed: true,
            detail: `All ${prereqs.length} prerequisite flag(s) are enabled.`,
          });
        }
      } else {
        steps.push({
          type: "prerequisites",
          label: "Prerequisites",
          passed: true,
          detail: "No prerequisites configured.",
        });
      }
    }

    // 3. Schedule
    if (!halted) {
      const now = new Date();
      if (flag.scheduleStart && new Date(flag.scheduleStart) > now) {
        steps.push({
          type: "schedule",
          label: "Schedule",
          passed: false,
          detail: `Scheduled to start ${flag.scheduleStart}. Not active yet.`,
        });
        halted = true;
      } else if (flag.scheduleEnd && new Date(flag.scheduleEnd) < now) {
        steps.push({
          type: "schedule",
          label: "Schedule",
          passed: false,
          detail: `Schedule expired on ${flag.scheduleEnd}.`,
        });
        halted = true;
      } else {
        const parts: string[] = [];
        if (flag.scheduleStart) parts.push(`start: ${flag.scheduleStart}`);
        if (flag.scheduleEnd) parts.push(`end: ${flag.scheduleEnd}`);
        steps.push({
          type: "schedule",
          label: "Schedule",
          passed: true,
          detail: parts.length > 0 ? `Within schedule window (${parts.join(", ")}).` : "No schedule constraints.",
        });
      }
    }

    // 4. Flag Status
    if (!halted) {
      if (!flag.enabled) {
        steps.push({
          type: "flag_status",
          label: "Flag Status",
          passed: false,
          detail: "Flag is globally disabled.",
        });
        halted = true;
      } else {
        steps.push({
          type: "flag_status",
          label: "Flag Status",
          passed: true,
          detail: "Flag is enabled.",
        });
      }
    }

    // 5. Rules + Segments
    if (!halted) {
      for (const rule of flagRules) {
        const condCount = countConditions(rule.conditionGroup);

        // Evaluate rule's own condition group
        const rulePassed = evaluateConditionGroup(rule.conditionGroup, context);

        // Evaluate segment conditions
        let segmentsPassed = true;
        const segmentFailures: string[] = [];
        if (rule.segmentIds && rule.segmentIds.length > 0) {
          for (const segId of rule.segmentIds) {
            const seg = allSegments.find((s) => s.id === segId || s.key === segId);
            if (!seg) {
              segmentsPassed = false;
              segmentFailures.push(`Segment "${segId}" not found`);
              continue;
            }
            if (!evaluateConditionGroup(seg.conditionGroup, context)) {
              segmentsPassed = false;
              const sf = describeGroupFailures(seg.conditionGroup, context);
              segmentFailures.push(`Segment "${seg.name}": ${sf.join("; ")}`);
            }
          }
        }

        const passed = rulePassed && segmentsPassed;

        if (passed) {
          const segInfo = rule.segmentIds?.length ? ` + ${rule.segmentIds.length} segment(s)` : "";
          steps.push({
            type: "rule",
            label: `Rule #${rule.priority}: ${rule.name}`,
            passed: true,
            detail: `${condCount} condition(s) with ${rule.conditionGroup.logic} logic${segInfo} — all matched. Serving variant "${rule.variantKey}".`,
          });
          matchedRule = rule.name;
          break;
        } else {
          const ruleFailures = !rulePassed ? describeGroupFailures(rule.conditionGroup, context) : [];
          const allFailures = [...ruleFailures, ...segmentFailures];
          steps.push({
            type: "rule",
            label: `Rule #${rule.priority}: ${rule.name}`,
            passed: false,
            detail:
              allFailures.length > 0
                ? `${rule.conditionGroup.logic} group failed: ${allFailures.join("; ")}`
                : "No conditions matched.",
          });
        }
      }

      // If no rules exist, add a note
      if (flagRules.length === 0) {
        steps.push({
          type: "rule",
          label: "Rule Evaluation",
          passed: true,
          detail: "No targeting rules configured — skipping to rollout.",
        });
      }
    }

    // 6. Default Rollout
    if (!halted) {
      const rollout = flag.rolloutPercentage ?? 100;
      if (matchedRule) {
        steps.push({
          type: "rollout",
          label: "Default Rollout",
          passed: true,
          detail: `Skipped — rule "${matchedRule}" already matched.`,
        });
      } else {
        const stickinessAttr = flag.stickinessAttribute ?? "user_id";
        // Map stickiness attribute to context key
        const stickyCtxKey =
          stickinessAttr === "user_id"
            ? "user.id"
            : stickinessAttr === "session_id"
              ? "session.id"
              : stickinessAttr === "device_id"
                ? "device.id"
                : stickinessAttr;
        const stickyValue = context[stickyCtxKey] ?? "anonymous";
        const bucket = stickyHash(flag.key, stickyValue);
        const passed = bucket < rollout;
        steps.push({
          type: "rollout",
          label: "Default Rollout",
          passed,
          detail: `Bucket ${bucket} (hash of "${flag.key}:${stickyValue}") ${passed ? "<" : ">="} ${rollout}% threshold — ${passed ? "included" : "excluded"}.`,
        });
        if (!passed) {
          setEvalResult({ result: false, steps, matchedRule: null });
          return;
        }
      }
    }

    // Final result
    const finalResult = !halted && (matchedRule !== null || steps[steps.length - 1]?.passed === true);
    setEvalResult({ result: finalResult, steps, matchedRule });
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1>What If? Simulator</h1>
        <p className="text-muted-foreground mt-1">
          Enter a mock user profile to trace exactly which rule fires and why
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left Column ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Flag Selector */}
          <div className="bg-card border border-border rounded-xl p-5">
            <label className="text-xs text-muted-foreground block mb-2">Target Flag</label>
            <select
              value={selectedFlag}
              onChange={(e) => {
                setSelectedFlag(e.target.value);
                setEvalResult(null);
              }}
              className="w-full px-3 py-2.5 bg-input-background border border-border rounded-lg"
            >
              {allFlags.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.key}
                  {f.description ? ` — ${f.description}` : ""}
                </option>
              ))}
            </select>
            {flag && (
              <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <span
                  className={`px-2 py-0.5 rounded-full ${flag.enabled ? "bg-green-100 text-green-800" : "bg-muted"}`}
                >
                  {flag.enabled ? "enabled" : "disabled"}
                </span>
                {flag.killSwitch && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800">kill switch</span>
                )}
                <span>{flag.rolloutPercentage ?? 100}% rollout</span>
                <span>
                  {flagRules.length} rule{flagRules.length !== 1 ? "s" : ""}
                </span>
                {flag.prerequisites && flag.prerequisites.length > 0 && (
                  <span>
                    {flag.prerequisites.length} prerequisite{flag.prerequisites.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* User Context Editor */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3>User Context</h3>
              <span className="text-xs text-muted-foreground">{Object.keys(context).length} attributes</span>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Object.entries(context).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1.5 rounded flex-1 truncate">{key}</code>
                  <input
                    value={value}
                    onChange={(e) => setContext({ ...context, [key]: e.target.value })}
                    className="flex-1 px-3 py-1.5 bg-input-background border border-border rounded-lg text-sm"
                  />
                  <button
                    onClick={() => removeAttribute(key)}
                    className="text-muted-foreground hover:text-destructive text-xs p-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
              <input
                placeholder="key"
                value={newAttr.key}
                onChange={(e) => setNewAttr({ ...newAttr, key: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addAttribute()}
                className="flex-1 px-3 py-1.5 bg-input-background border border-border rounded-lg text-sm"
              />
              <input
                placeholder="value"
                value={newAttr.value}
                onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addAttribute()}
                className="flex-1 px-3 py-1.5 bg-input-background border border-border rounded-lg text-sm"
              />
              <button
                onClick={addAttribute}
                className="text-xs bg-muted px-3 py-1.5 rounded-lg hover:bg-accent transition"
              >
                Add
              </button>
            </div>
          </div>

          <button
            onClick={runEvaluation}
            disabled={!flag}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50"
          >
            <Play className="w-4 h-4" /> Run Evaluation
          </button>
        </div>

        {/* ── Right Column: Evaluation Trace ──────────────────── */}
        <div>
          {!evalResult ? (
            <div className="bg-card border border-border rounded-xl h-full flex flex-col items-center justify-center text-muted-foreground py-16">
              <Play className="w-10 h-10 mb-3" />
              <p>Run an evaluation to see the trace</p>
              {flagRules.length === 0 && (
                <p className="text-xs mt-2">Tip: create rules on the Rule Engine page first</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Result Banner */}
              <div
                className={`rounded-xl p-5 flex items-center gap-3 ${
                  evalResult.result ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
                }`}
              >
                {evalResult.result ? (
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-500" />
                )}
                <div>
                  <div className={evalResult.result ? "text-green-800" : "text-red-800"}>
                    {evalResult.result ? "Flag is ON for this user" : "Flag is OFF for this user"}
                  </div>
                  <div className={`text-sm ${evalResult.result ? "text-green-600" : "text-red-600"}`}>
                    {evalResult.matchedRule
                      ? `Matched rule: "${evalResult.matchedRule}"`
                      : "No rule matched — default variant applies"}
                  </div>
                </div>
              </div>

              {/* Trace Steps */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="mb-4">Evaluation Trace</h3>
                <div className="space-y-0">
                  {evalResult.steps.map((step, i) => {
                    const isLast = i === evalResult.steps.length - 1;
                    return (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                              step.passed ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"
                            }`}
                          >
                            <StepIcon step={step} />
                          </div>
                          {!isLast && <div className="w-px flex-1 bg-border min-h-4" />}
                        </div>
                        <div className="pb-4">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-foreground">{step.label}</span>
                            {step.passed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
