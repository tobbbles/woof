import type {
  ConditionGroup,
  EvaluationContext,
  EvaluationFailure,
  EvaluationSuccess,
  Flag,
  Rule,
  Segment,
} from "@woof/types";

export type EvaluationResult = EvaluationSuccess | EvaluationFailure;

export interface EvaluateOptions {
  /** All segments, needed for rule-segment evaluation. */
  segments?: Segment[];
  /** All flags, needed for prerequisite checks. */
  allFlags?: Flag[];
  /** Override current time for deterministic testing. */
  now?: Date;
}

/**
 * Evaluate a flag against a context, optionally with targeting rules.
 *
 * Evaluation order:
 * 1. Kill switch — if active, return DISABLED immediately.
 * 2. Prerequisites — all prerequisite flags must be enabled.
 * 3. Schedule — current time must be within [scheduleStart, scheduleEnd].
 * 4. Enabled check — if flag is off, return DISABLED.
 * 5. Rule targeting — iterate rules by priority (ascending). First match wins.
 *    Rule conditions AND referenced segment conditions must all pass.
 * 6. Default rollout — apply percentage-based rollout with sticky hashing.
 *
 * Includes `flagType` in metadata so strictly-typed clients can distinguish
 * integer from float (which JavaScript/JSON cannot).
 */
export function evaluate(
  flag: Flag,
  context: EvaluationContext,
  rules?: Rule[],
  options?: EvaluateOptions,
): EvaluationResult {
  const now = options?.now ?? new Date();
  const disabledResult = (reason: string): EvaluationResult => {
    const firstVariantKey = Object.keys(flag.variants)[0];
    if (!firstVariantKey) {
      return { key: flag.key, reason: "DISABLED", metadata: { flagType: flag.type, disabledReason: reason } };
    }
    return {
      key: flag.key,
      value: flag.variants[firstVariantKey],
      reason: "DISABLED",
      variant: firstVariantKey,
      metadata: { flagType: flag.type, disabledReason: reason },
    };
  };

  // 1. Kill switch
  if (flag.killSwitch) {
    return disabledResult("kill_switch");
  }

  // 2. Prerequisites
  if (flag.prerequisites?.length && options?.allFlags) {
    for (const prereqKey of flag.prerequisites) {
      const prereqFlag = options.allFlags.find((f) => f.key === prereqKey);
      if (!prereqFlag || !prereqFlag.enabled) {
        return disabledResult(`prerequisite_unmet:${prereqKey}`);
      }
    }
  }

  // 3. Schedule
  if (flag.scheduleStart && new Date(flag.scheduleStart) > now) {
    return disabledResult("schedule_not_started");
  }
  if (flag.scheduleEnd && new Date(flag.scheduleEnd) < now) {
    return disabledResult("schedule_expired");
  }

  // 4. Enabled check
  if (!flag.enabled) {
    return disabledResult("disabled");
  }

  // 5. Rule-based targeting (with segment evaluation)
  if (rules && rules.length > 0) {
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);
    for (const rule of sorted) {
      const ruleMatches = evaluateConditionGroup(rule.conditionGroup, context);
      if (!ruleMatches) continue;

      // Check segment conditions
      let segmentsMatch = true;
      if (rule.segmentIds?.length && options?.segments) {
        for (const segId of rule.segmentIds) {
          const segment = options.segments.find((s) => s.id === segId || s.key === segId);
          if (segment && !evaluateConditionGroup(segment.conditionGroup, context)) {
            segmentsMatch = false;
            break;
          }
        }
      }
      if (!segmentsMatch) continue;

      const value = flag.variants[rule.variantKey];
      if (value !== undefined) {
        return {
          key: flag.key,
          value,
          reason: "TARGETING_MATCH",
          variant: rule.variantKey,
          metadata: { flagType: flag.type, ruleName: rule.name },
        };
      }
      // Variant key referenced by rule doesn't exist — code default
      return {
        key: flag.key,
        reason: "UNKNOWN",
        metadata: {
          flagType: flag.type,
          errorHint: `Rule "${rule.name}" references missing variant "${rule.variantKey}"`,
        },
      };
    }
  }

  // 6. Default rollout
  const rolloutPct = flag.rolloutPercentage ?? 0;
  if (rolloutPct > 0 && rolloutPct < 100) {
    const stickyAttr = flag.stickinessAttribute ?? "user_id";
    const stickyValue = String(context[stickyAttr] ?? context.targetingKey ?? "");
    const bucket = stickyHash(flag.key, stickyValue);
    if (bucket >= rolloutPct) {
      // Outside rollout — return disabled/off variant
      const firstVariantKey = Object.keys(flag.variants)[0];
      if (!firstVariantKey) {
        return { key: flag.key, reason: "STATIC", metadata: { flagType: flag.type, rolloutBucket: bucket } };
      }
      return {
        key: flag.key,
        value: flag.variants[firstVariantKey],
        reason: "STATIC",
        variant: firstVariantKey,
        metadata: { flagType: flag.type, rolloutBucket: bucket },
      };
    }
    // Inside rollout — fall through to default variant
  } else if (rolloutPct === 0) {
    // 0% rollout with no matching rules = flag is effectively off for targeting
    // but if enabled, still serve the default variant (backward compat)
  }

  // Default fallthrough — serve the default variant
  const value = flag.variants[flag.defaultVariant];
  if (value === undefined) {
    return {
      key: flag.key,
      reason: "UNKNOWN",
      metadata: {
        flagType: flag.type,
        errorHint: `Default variant "${flag.defaultVariant}" not found in flag variants`,
      },
    };
  }

  return {
    key: flag.key,
    value,
    reason: rolloutPct > 0 ? "SPLIT" : "STATIC",
    variant: flag.defaultVariant,
    metadata: { flagType: flag.type },
  };
}

/**
 * Deterministic sticky hash for percentage-based rollouts.
 * Returns a value 0–99 based on flagKey + stickyValue.
 */
export function stickyHash(flagKey: string, stickyValue: string): number {
  const input = `${flagKey}:${stickyValue}`;
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) | 0;
  }
  return Math.abs(hash) % 100;
}

/** Evaluate a condition group against a context. */
export function evaluateConditionGroup(group: ConditionGroup, context: EvaluationContext): boolean {
  const condResults = group.conditions.map((c) => {
    const result = evaluateCondition(c.attribute, c.operator, c.value, context);
    return c.negate ? !result : result;
  });
  const groupResults = group.groups.map((g) => evaluateConditionGroup(g, context));
  const all = [...condResults, ...groupResults];
  if (all.length === 0) return true;
  return group.logic === "AND" ? all.every(Boolean) : all.some(Boolean);
}

/** Evaluate a single condition against the context. */
function evaluateCondition(attribute: string, operator: string, value: string, context: EvaluationContext): boolean {
  const actual = String(context[attribute] ?? "");
  if (context[attribute] === undefined) return false;

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

/**
 * Minimal semver comparison. Returns -1, 0, or 1.
 * Handles major.minor.patch; ignores prerelease tags.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
