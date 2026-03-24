// Re-export shared types from @woof/types
export type {
  Condition,
  ConditionGroup,
  Rule,
  Segment,
} from "@woof/types";

import type { ConditionGroup, EvaluationContext } from "@woof/types";

/** Count total leaf conditions in a group recursively. */
export function countConditions(group: ConditionGroup): number {
  return group.conditions.length + group.groups.reduce((sum, g) => sum + countConditions(g), 0);
}

/** Create an empty condition group for form defaults. */
export function emptyConditionGroup(): ConditionGroup {
  return {
    logic: "AND",
    conditions: [{ attribute: "", operator: "equals", value: "" }],
    groups: [],
  };
}

/** Evaluate a single condition against a context value. */
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
    default:
      return false;
  }
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

/** Describe which conditions in a group failed, for debugging UI. */
export function describeGroupFailures(group: ConditionGroup, context: EvaluationContext): string[] {
  const failures: string[] = [];

  for (const c of group.conditions) {
    const result = evaluateCondition(c.attribute, c.operator, c.value, context);
    const passed = c.negate ? !result : result;
    if (!passed) {
      const actual = context[c.attribute];
      const prefix = c.negate ? "NOT " : "";
      failures.push(
        `${c.attribute} ${prefix}${c.operator} "${c.value}" (got: ${actual === undefined ? "undefined" : JSON.stringify(actual)})`,
      );
    }
  }

  for (const g of group.groups) {
    failures.push(...describeGroupFailures(g, context));
  }

  return failures;
}
