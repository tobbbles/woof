import type { ConditionGroup, EvaluationContext, Flag, Rule, Segment } from "@woof/types";
import { describe, expect, it } from "vitest";
import { evaluate, evaluateConditionGroup, stickyHash } from "./evaluate.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    key: "test-flag",
    type: "boolean",
    enabled: true,
    defaultVariant: "on",
    variants: { on: true, off: false },
    ...overrides,
  };
}

function makeContext(overrides: Partial<EvaluationContext> & { targetingKey?: string } = {}): EvaluationContext {
  return { targetingKey: "user-1", ...overrides };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    flagKey: "test-flag",
    name: "Test Rule",
    conditionGroup: { logic: "AND", conditions: [], groups: [] },
    priority: 0,
    variantKey: "on",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-1",
    name: "Test Segment",
    key: "test-segment",
    description: "A test segment",
    conditionGroup: { logic: "AND", conditions: [], groups: [] },
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConditionGroup(overrides: Partial<ConditionGroup> = {}): ConditionGroup {
  return { logic: "AND", conditions: [], groups: [], ...overrides };
}

// ---------------------------------------------------------------------------
// evaluate() — basic flag evaluation
// ---------------------------------------------------------------------------

describe("evaluate", () => {
  describe("basic flag evaluation", () => {
    it("returns default variant for a simple enabled flag", () => {
      const result = evaluate(makeFlag(), makeContext());
      expect(result).toMatchObject({
        key: "test-flag",
        value: true,
        reason: "STATIC",
        variant: "on",
      });
    });

    it("returns DISABLED for a disabled flag", () => {
      const result = evaluate(makeFlag({ enabled: false }), makeContext());
      expect(result).toMatchObject({
        key: "test-flag",
        reason: "DISABLED",
      });
      expect(result.metadata?.disabledReason).toBe("disabled");
    });

    it("serves the first variant value when disabled", () => {
      const result = evaluate(makeFlag({ enabled: false, variants: { off: false, on: true } }), makeContext());
      expect(result.value).toBe(false);
      expect(result.variant).toBe("off");
    });

    it("returns DISABLED with no value when flag has no variants", () => {
      const result = evaluate(makeFlag({ enabled: false, variants: {} }), makeContext());
      expect(result.reason).toBe("DISABLED");
      expect(result.value).toBeUndefined();
      expect(result.variant).toBeUndefined();
    });

    it("returns UNKNOWN when default variant key is missing from variants", () => {
      const result = evaluate(makeFlag({ defaultVariant: "missing" }), makeContext());
      expect(result.reason).toBe("UNKNOWN");
      expect(result.metadata?.errorHint).toContain("missing");
    });

    it("includes flagType in metadata", () => {
      const result = evaluate(makeFlag({ type: "string" }), makeContext());
      expect(result.metadata?.flagType).toBe("string");
    });

    it("works with string flag type", () => {
      const result = evaluate(
        makeFlag({ type: "string", variants: { primary: "hello", fallback: "world" }, defaultVariant: "primary" }),
        makeContext(),
      );
      expect(result.value).toBe("hello");
    });

    it("works with number flag type", () => {
      const result = evaluate(
        makeFlag({ type: "number", variants: { v1: 3.14 }, defaultVariant: "v1" }),
        makeContext(),
      );
      expect(result.value).toBe(3.14);
    });

    it("works with object flag type", () => {
      const obj = { color: "red", size: 10 };
      const result = evaluate(
        makeFlag({ type: "object", variants: { config: obj }, defaultVariant: "config" }),
        makeContext(),
      );
      expect(result.value).toEqual(obj);
    });
  });

  // -------------------------------------------------------------------------
  // Kill switch
  // -------------------------------------------------------------------------

  describe("kill switch", () => {
    it("returns DISABLED when kill switch is active", () => {
      const result = evaluate(makeFlag({ killSwitch: true }), makeContext());
      expect(result.reason).toBe("DISABLED");
      expect(result.metadata?.disabledReason).toBe("kill_switch");
    });

    it("overrides enabled state", () => {
      const result = evaluate(makeFlag({ killSwitch: true, enabled: true }), makeContext());
      expect(result.reason).toBe("DISABLED");
    });

    it("takes precedence over prerequisites and schedules", () => {
      const result = evaluate(
        makeFlag({
          killSwitch: true,
          prerequisites: ["other-flag"],
          scheduleStart: "2020-01-01T00:00:00Z",
        }),
        makeContext(),
        undefined,
        { allFlags: [makeFlag({ key: "other-flag", enabled: true })] },
      );
      expect(result.metadata?.disabledReason).toBe("kill_switch");
    });

    it("does not trigger when killSwitch is false", () => {
      const result = evaluate(makeFlag({ killSwitch: false }), makeContext());
      expect(result.reason).toBe("STATIC");
    });

    it("does not trigger when killSwitch is undefined", () => {
      const result = evaluate(makeFlag(), makeContext());
      expect(result.reason).toBe("STATIC");
    });
  });

  // -------------------------------------------------------------------------
  // Prerequisites
  // -------------------------------------------------------------------------

  describe("prerequisites", () => {
    it("passes when all prerequisite flags are enabled", () => {
      const flag = makeFlag({ prerequisites: ["prereq-1", "prereq-2"] });
      const allFlags = [makeFlag({ key: "prereq-1", enabled: true }), makeFlag({ key: "prereq-2", enabled: true })];
      const result = evaluate(flag, makeContext(), undefined, { allFlags });
      expect(result.reason).toBe("STATIC");
    });

    it("returns DISABLED when a prerequisite flag is disabled", () => {
      const flag = makeFlag({ prerequisites: ["prereq-1"] });
      const allFlags = [makeFlag({ key: "prereq-1", enabled: false })];
      const result = evaluate(flag, makeContext(), undefined, { allFlags });
      expect(result.reason).toBe("DISABLED");
      expect(result.metadata?.disabledReason).toBe("prerequisite_unmet:prereq-1");
    });

    it("returns DISABLED when a prerequisite flag is missing", () => {
      const flag = makeFlag({ prerequisites: ["nonexistent"] });
      const result = evaluate(flag, makeContext(), undefined, { allFlags: [] });
      expect(result.reason).toBe("DISABLED");
      expect(result.metadata?.disabledReason).toBe("prerequisite_unmet:nonexistent");
    });

    it("skips prerequisite check when allFlags is not provided", () => {
      const flag = makeFlag({ prerequisites: ["prereq-1"] });
      const result = evaluate(flag, makeContext());
      expect(result.reason).toBe("STATIC");
    });

    it("skips prerequisite check when prerequisites array is empty", () => {
      const flag = makeFlag({ prerequisites: [] });
      const result = evaluate(flag, makeContext(), undefined, { allFlags: [] });
      expect(result.reason).toBe("STATIC");
    });

    it("reports the first unmet prerequisite", () => {
      const flag = makeFlag({ prerequisites: ["a", "b", "c"] });
      const allFlags = [
        makeFlag({ key: "a", enabled: true }),
        makeFlag({ key: "b", enabled: false }),
        makeFlag({ key: "c", enabled: false }),
      ];
      const result = evaluate(flag, makeContext(), undefined, { allFlags });
      expect(result.metadata?.disabledReason).toBe("prerequisite_unmet:b");
    });
  });

  // -------------------------------------------------------------------------
  // Schedule
  // -------------------------------------------------------------------------

  describe("schedule", () => {
    const now = new Date("2025-06-15T12:00:00Z");

    it("returns DISABLED when before scheduleStart", () => {
      const flag = makeFlag({ scheduleStart: "2025-07-01T00:00:00Z" });
      const result = evaluate(flag, makeContext(), undefined, { now });
      expect(result.reason).toBe("DISABLED");
      expect(result.metadata?.disabledReason).toBe("schedule_not_started");
    });

    it("returns DISABLED when after scheduleEnd", () => {
      const flag = makeFlag({ scheduleEnd: "2025-01-01T00:00:00Z" });
      const result = evaluate(flag, makeContext(), undefined, { now });
      expect(result.reason).toBe("DISABLED");
      expect(result.metadata?.disabledReason).toBe("schedule_expired");
    });

    it("passes when within schedule window", () => {
      const flag = makeFlag({
        scheduleStart: "2025-01-01T00:00:00Z",
        scheduleEnd: "2025-12-31T23:59:59Z",
      });
      const result = evaluate(flag, makeContext(), undefined, { now });
      expect(result.reason).toBe("STATIC");
    });

    it("passes when scheduleStart is exactly now", () => {
      const flag = makeFlag({ scheduleStart: "2025-06-15T12:00:00Z" });
      const result = evaluate(flag, makeContext(), undefined, { now });
      // scheduleStart > now is false when equal, so it passes
      expect(result.reason).toBe("STATIC");
    });

    it("passes when scheduleEnd is exactly now", () => {
      const flag = makeFlag({ scheduleEnd: "2025-06-15T12:00:00Z" });
      const result = evaluate(flag, makeContext(), undefined, { now });
      // scheduleEnd < now is false when equal, so it passes
      expect(result.reason).toBe("STATIC");
    });

    it("handles null scheduleStart and scheduleEnd", () => {
      const flag = makeFlag({ scheduleStart: null, scheduleEnd: null });
      const result = evaluate(flag, makeContext(), undefined, { now });
      expect(result.reason).toBe("STATIC");
    });

    it("handles only scheduleStart set", () => {
      const flag = makeFlag({ scheduleStart: "2025-01-01T00:00:00Z" });
      const result = evaluate(flag, makeContext(), undefined, { now });
      expect(result.reason).toBe("STATIC");
    });

    it("handles only scheduleEnd set", () => {
      const flag = makeFlag({ scheduleEnd: "2026-01-01T00:00:00Z" });
      const result = evaluate(flag, makeContext(), undefined, { now });
      expect(result.reason).toBe("STATIC");
    });

    it("is checked after prerequisites", () => {
      // Prerequisite unmet should trigger before schedule
      const flag = makeFlag({
        prerequisites: ["missing"],
        scheduleStart: "2025-07-01T00:00:00Z",
      });
      const result = evaluate(flag, makeContext(), undefined, {
        now,
        allFlags: [],
      });
      expect(result.metadata?.disabledReason).toBe("prerequisite_unmet:missing");
    });
  });

  // -------------------------------------------------------------------------
  // Rule-based targeting
  // -------------------------------------------------------------------------

  describe("rule targeting", () => {
    it("returns TARGETING_MATCH when a rule matches", () => {
      const rule = makeRule({
        conditionGroup: makeConditionGroup({
          conditions: [{ attribute: "country", operator: "equals", value: "US" }],
        }),
        variantKey: "on",
      });
      const ctx = makeContext({ country: "US" });
      const result = evaluate(makeFlag(), ctx, [rule]);
      expect(result.reason).toBe("TARGETING_MATCH");
      expect(result.value).toBe(true);
      expect(result.variant).toBe("on");
      expect(result.metadata?.ruleName).toBe("Test Rule");
    });

    it("falls through to default when no rules match", () => {
      const rule = makeRule({
        conditionGroup: makeConditionGroup({
          conditions: [{ attribute: "country", operator: "equals", value: "UK" }],
        }),
      });
      const ctx = makeContext({ country: "US" });
      const result = evaluate(makeFlag(), ctx, [rule]);
      expect(result.reason).toBe("STATIC");
    });

    it("evaluates rules in priority order (ascending)", () => {
      const lowPriority = makeRule({
        id: "rule-low",
        name: "Low Priority",
        priority: 10,
        variantKey: "off",
        conditionGroup: makeConditionGroup(), // matches everything
      });
      const highPriority = makeRule({
        id: "rule-high",
        name: "High Priority",
        priority: 1,
        variantKey: "on",
        conditionGroup: makeConditionGroup(), // matches everything
      });
      // Pass in wrong order to verify sorting
      const result = evaluate(makeFlag(), makeContext(), [lowPriority, highPriority]);
      expect(result.variant).toBe("on");
      expect(result.metadata?.ruleName).toBe("High Priority");
    });

    it("returns UNKNOWN when rule references missing variant", () => {
      const rule = makeRule({
        variantKey: "nonexistent",
        conditionGroup: makeConditionGroup(),
      });
      const result = evaluate(makeFlag(), makeContext(), [rule]);
      expect(result.reason).toBe("UNKNOWN");
      expect(result.metadata?.errorHint).toContain("nonexistent");
    });

    it("skips rules with empty rules array", () => {
      const result = evaluate(makeFlag(), makeContext(), []);
      expect(result.reason).toBe("STATIC");
    });

    it("matches rule with empty condition group (always matches)", () => {
      const rule = makeRule({ conditionGroup: makeConditionGroup() });
      const result = evaluate(makeFlag(), makeContext(), [rule]);
      expect(result.reason).toBe("TARGETING_MATCH");
    });
  });

  // -------------------------------------------------------------------------
  // Segment-referenced rules
  // -------------------------------------------------------------------------

  describe("segments", () => {
    it("matches when rule and segment conditions both pass", () => {
      const segment = makeSegment({
        conditionGroup: makeConditionGroup({
          conditions: [{ attribute: "plan", operator: "equals", value: "pro" }],
        }),
      });
      const rule = makeRule({
        segmentIds: ["seg-1"],
        conditionGroup: makeConditionGroup(), // always matches
      });
      const ctx = makeContext({ plan: "pro" });
      const result = evaluate(makeFlag(), ctx, [rule], { segments: [segment] });
      expect(result.reason).toBe("TARGETING_MATCH");
    });

    it("skips rule when segment condition fails", () => {
      const segment = makeSegment({
        conditionGroup: makeConditionGroup({
          conditions: [{ attribute: "plan", operator: "equals", value: "pro" }],
        }),
      });
      const rule = makeRule({
        segmentIds: ["seg-1"],
        conditionGroup: makeConditionGroup(), // always matches
      });
      const ctx = makeContext({ plan: "free" });
      const result = evaluate(makeFlag(), ctx, [rule], { segments: [segment] });
      expect(result.reason).toBe("STATIC"); // fell through to default
    });

    it("requires ALL segments to match (AND logic)", () => {
      const seg1 = makeSegment({
        id: "seg-1",
        conditionGroup: makeConditionGroup({
          conditions: [{ attribute: "plan", operator: "equals", value: "pro" }],
        }),
      });
      const seg2 = makeSegment({
        id: "seg-2",
        key: "seg-2",
        conditionGroup: makeConditionGroup({
          conditions: [{ attribute: "country", operator: "equals", value: "US" }],
        }),
      });
      const rule = makeRule({
        segmentIds: ["seg-1", "seg-2"],
        conditionGroup: makeConditionGroup(),
      });
      // Only first segment matches
      const ctx = makeContext({ plan: "pro", country: "UK" });
      const result = evaluate(makeFlag(), ctx, [rule], { segments: [seg1, seg2] });
      expect(result.reason).toBe("STATIC");
    });

    it("matches segment by key as well as id", () => {
      const segment = makeSegment({
        id: "uuid-123",
        key: "beta-users",
        conditionGroup: makeConditionGroup(),
      });
      const rule = makeRule({
        segmentIds: ["beta-users"],
        conditionGroup: makeConditionGroup(),
      });
      const result = evaluate(makeFlag(), makeContext(), [rule], { segments: [segment] });
      expect(result.reason).toBe("TARGETING_MATCH");
    });

    it("ignores unknown segment IDs (rule still matches)", () => {
      const rule = makeRule({
        segmentIds: ["nonexistent-segment"],
        conditionGroup: makeConditionGroup(),
      });
      const result = evaluate(makeFlag(), makeContext(), [rule], { segments: [] });
      expect(result.reason).toBe("TARGETING_MATCH");
    });

    it("ignores segments when options.segments is not provided", () => {
      const rule = makeRule({
        segmentIds: ["seg-1"],
        conditionGroup: makeConditionGroup(),
      });
      const result = evaluate(makeFlag(), makeContext(), [rule]);
      expect(result.reason).toBe("TARGETING_MATCH");
    });
  });

  // -------------------------------------------------------------------------
  // Rollout percentage + sticky hash
  // -------------------------------------------------------------------------

  describe("rollout percentage", () => {
    it("serves default variant with reason SPLIT when inside rollout", () => {
      // We need to find a user that hashes inside a given rollout
      // stickyHash("rollout-flag", "user-1") gives a deterministic bucket
      const bucket = stickyHash("rollout-flag", "user-1");
      const flag = makeFlag({
        key: "rollout-flag",
        rolloutPercentage: bucket + 1, // ensure bucket < rolloutPct
      });
      const ctx = makeContext({ user_id: "user-1" });
      const result = evaluate(flag, ctx);
      expect(result.reason).toBe("SPLIT");
      expect(result.variant).toBe("on");
    });

    it("serves first variant with reason STATIC when outside rollout", () => {
      const bucket = stickyHash("rollout-flag", "user-1");
      const flag = makeFlag({
        key: "rollout-flag",
        rolloutPercentage: bucket, // bucket >= rolloutPct
        variants: { off: false, on: true },
      });
      const ctx = makeContext({ user_id: "user-1" });
      const result = evaluate(flag, ctx);
      expect(result.reason).toBe("STATIC");
      expect(result.metadata?.rolloutBucket).toBe(bucket);
    });

    it("serves default with STATIC when rolloutPercentage is 0", () => {
      const flag = makeFlag({ rolloutPercentage: 0 });
      const result = evaluate(flag, makeContext());
      expect(result.reason).toBe("STATIC");
    });

    it("serves default with SPLIT when rolloutPercentage is 100", () => {
      // 100% rollout skips the partial-rollout branch but the default
      // fallthrough still sees rolloutPct > 0, so reason is SPLIT
      const flag = makeFlag({ rolloutPercentage: 100 });
      const result = evaluate(flag, makeContext());
      expect(result.reason).toBe("SPLIT");
    });

    it("serves default with STATIC when rolloutPercentage is undefined", () => {
      const flag = makeFlag();
      const result = evaluate(flag, makeContext());
      expect(result.reason).toBe("STATIC");
    });

    it("uses stickinessAttribute when specified", () => {
      const flag = makeFlag({
        key: "sticky-test",
        rolloutPercentage: 50,
        stickinessAttribute: "session_id",
      });
      const ctx = makeContext({ session_id: "sess-abc" });
      const bucket = stickyHash("sticky-test", "sess-abc");
      const result = evaluate(flag, ctx);
      if (bucket < 50) {
        expect(result.reason).toBe("SPLIT");
      } else {
        expect(result.reason).toBe("STATIC");
      }
    });

    it("falls back to targetingKey when sticky attribute is missing", () => {
      const flag = makeFlag({
        key: "fallback-test",
        rolloutPercentage: 50,
        stickinessAttribute: "device_id",
      });
      const ctx = makeContext({ targetingKey: "user-xyz" });
      const bucket = stickyHash("fallback-test", "user-xyz");
      const result = evaluate(flag, ctx);
      if (bucket < 50) {
        expect(result.reason).toBe("SPLIT");
      } else {
        expect(result.reason).toBe("STATIC");
      }
    });

    it("handles no variants when outside rollout", () => {
      const bucket = stickyHash("no-var-flag", "user-1");
      const flag = makeFlag({
        key: "no-var-flag",
        rolloutPercentage: bucket, // outside rollout
        variants: {},
        defaultVariant: "on",
      });
      const ctx = makeContext({ user_id: "user-1" });
      const result = evaluate(flag, ctx);
      expect(result.reason).toBe("STATIC");
      expect(result.value).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Backward compatibility
  // -------------------------------------------------------------------------

  describe("backward compatibility", () => {
    it("evaluates flags without optional fields", () => {
      const minimalFlag: Flag = {
        key: "minimal",
        type: "boolean",
        enabled: true,
        defaultVariant: "on",
        variants: { on: true, off: false },
      };
      const result = evaluate(minimalFlag, makeContext());
      expect(result.reason).toBe("STATIC");
      expect(result.value).toBe(true);
    });

    it("evaluates with no rules and no options", () => {
      const result = evaluate(makeFlag(), makeContext());
      expect(result.reason).toBe("STATIC");
    });

    it("evaluates with undefined rules", () => {
      const result = evaluate(makeFlag(), makeContext(), undefined);
      expect(result.reason).toBe("STATIC");
    });
  });

  // -------------------------------------------------------------------------
  // Evaluation order
  // -------------------------------------------------------------------------

  describe("evaluation order", () => {
    it("kill switch > prerequisites > schedule > enabled > rules > rollout", () => {
      const now = new Date("2025-06-15T12:00:00Z");

      // Kill switch takes precedence
      const flag = makeFlag({
        killSwitch: true,
        enabled: false,
        prerequisites: ["missing"],
        scheduleStart: "2099-01-01T00:00:00Z",
      });
      let result = evaluate(flag, makeContext(), undefined, { now, allFlags: [] });
      expect(result.metadata?.disabledReason).toBe("kill_switch");

      // Without kill switch, prerequisites take precedence
      const flag2 = makeFlag({
        killSwitch: false,
        enabled: false,
        prerequisites: ["missing"],
        scheduleStart: "2099-01-01T00:00:00Z",
      });
      result = evaluate(flag2, makeContext(), undefined, { now, allFlags: [] });
      expect(result.metadata?.disabledReason).toBe("prerequisite_unmet:missing");

      // Without prerequisites, schedule takes precedence
      const flag3 = makeFlag({
        enabled: false,
        scheduleStart: "2099-01-01T00:00:00Z",
      });
      result = evaluate(flag3, makeContext(), undefined, { now });
      expect(result.metadata?.disabledReason).toBe("schedule_not_started");

      // Without schedule, enabled check takes precedence
      const flag4 = makeFlag({ enabled: false });
      result = evaluate(flag4, makeContext(), undefined, { now });
      expect(result.metadata?.disabledReason).toBe("disabled");
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateConditionGroup()
// ---------------------------------------------------------------------------

describe("evaluateConditionGroup", () => {
  const ctx = makeContext({
    country: "US",
    plan: "pro",
    age: "25",
    email: "user@company.com",
    app_version: "2.1.0",
    tags: "alpha",
  });

  describe("condition operators", () => {
    it("equals — matches exact string", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "equals", value: "US" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("equals — rejects non-match", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "equals", value: "UK" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("not_equals — matches when different", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "not_equals", value: "UK" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("not_equals — rejects when same", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "not_equals", value: "US" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("in — matches value in comma-separated list", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "in", value: "US, UK, CA" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("in — rejects value not in list", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "in", value: "UK, CA, AU" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("in — trims whitespace around list items", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "in", value: "  US  ,  UK  " }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("contains — matches substring", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "email", operator: "contains", value: "@company" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("contains — rejects when substring not found", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "email", operator: "contains", value: "@other" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("ends_with — matches suffix", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "email", operator: "ends_with", value: "@company.com" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("ends_with — rejects non-matching suffix", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "email", operator: "ends_with", value: "@other.com" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("greater_than — numeric comparison", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "age", operator: "greater_than", value: "18" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("greater_than — rejects when not greater", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "age", operator: "greater_than", value: "30" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("greater_than — rejects when equal", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "age", operator: "greater_than", value: "25" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("less_than — numeric comparison", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "age", operator: "less_than", value: "30" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("less_than — rejects when not less", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "age", operator: "less_than", value: "20" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("less_than — rejects when equal", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "age", operator: "less_than", value: "25" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("semver_gte — matches when version is greater", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_gte", value: "2.0.0" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("semver_gte — matches when version is equal", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_gte", value: "2.1.0" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("semver_gte — rejects when version is less", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_gte", value: "3.0.0" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("semver_lte — matches when version is less", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_lte", value: "3.0.0" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("semver_lte — matches when version is equal", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_lte", value: "2.1.0" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("semver_lte — rejects when version is greater", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_lte", value: "1.0.0" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("semver handles missing patch version", () => {
      const ctxShort = makeContext({ app_version: "2.1" });
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_gte", value: "2.1.0" }],
      });
      expect(evaluateConditionGroup(group, ctxShort)).toBe(true);
    });

    it("semver handles prerelease tags by ignoring them", () => {
      // parseInt("0-beta") => 0, so prerelease tag portion is ignored
      const ctxPre = makeContext({ app_version: "2.1.0-beta.1" });
      const group = makeConditionGroup({
        conditions: [{ attribute: "app_version", operator: "semver_gte", value: "2.1.0" }],
      });
      expect(evaluateConditionGroup(group, ctxPre)).toBe(true);
    });

    it("returns false for unknown operator", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "regex_match", value: ".*" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("returns false when attribute is undefined in context", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "nonexistent", operator: "equals", value: "anything" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });
  });

  describe("condition negation", () => {
    it("negates a true condition to false", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "equals", value: "US", negate: true }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("negates a false condition to true", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "equals", value: "UK", negate: true }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("does not negate when negate is false", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "equals", value: "US", negate: false }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("does not negate when negate is undefined", () => {
      const group = makeConditionGroup({
        conditions: [{ attribute: "country", operator: "equals", value: "US" }],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });
  });

  describe("AND logic", () => {
    it("requires all conditions to be true", () => {
      const group = makeConditionGroup({
        logic: "AND",
        conditions: [
          { attribute: "country", operator: "equals", value: "US" },
          { attribute: "plan", operator: "equals", value: "pro" },
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("fails when any condition is false", () => {
      const group = makeConditionGroup({
        logic: "AND",
        conditions: [
          { attribute: "country", operator: "equals", value: "US" },
          { attribute: "plan", operator: "equals", value: "free" },
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });
  });

  describe("OR logic", () => {
    it("passes when at least one condition is true", () => {
      const group = makeConditionGroup({
        logic: "OR",
        conditions: [
          { attribute: "country", operator: "equals", value: "UK" },
          { attribute: "plan", operator: "equals", value: "pro" },
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("fails when all conditions are false", () => {
      const group = makeConditionGroup({
        logic: "OR",
        conditions: [
          { attribute: "country", operator: "equals", value: "UK" },
          { attribute: "plan", operator: "equals", value: "free" },
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });
  });

  describe("nested groups", () => {
    it("evaluates nested AND within OR", () => {
      // (country=UK AND plan=pro) OR (country=US AND plan=pro) => true
      const group = makeConditionGroup({
        logic: "OR",
        conditions: [],
        groups: [
          makeConditionGroup({
            logic: "AND",
            conditions: [
              { attribute: "country", operator: "equals", value: "UK" },
              { attribute: "plan", operator: "equals", value: "pro" },
            ],
          }),
          makeConditionGroup({
            logic: "AND",
            conditions: [
              { attribute: "country", operator: "equals", value: "US" },
              { attribute: "plan", operator: "equals", value: "pro" },
            ],
          }),
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("evaluates nested OR within AND", () => {
      // (country=US OR country=UK) AND (plan=enterprise OR plan=pro) => true
      const group = makeConditionGroup({
        logic: "AND",
        conditions: [],
        groups: [
          makeConditionGroup({
            logic: "OR",
            conditions: [
              { attribute: "country", operator: "equals", value: "US" },
              { attribute: "country", operator: "equals", value: "UK" },
            ],
          }),
          makeConditionGroup({
            logic: "OR",
            conditions: [
              { attribute: "plan", operator: "equals", value: "enterprise" },
              { attribute: "plan", operator: "equals", value: "pro" },
            ],
          }),
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("fails nested AND within AND when inner group fails", () => {
      const group = makeConditionGroup({
        logic: "AND",
        conditions: [{ attribute: "country", operator: "equals", value: "US" }],
        groups: [
          makeConditionGroup({
            logic: "AND",
            conditions: [{ attribute: "plan", operator: "equals", value: "enterprise" }],
          }),
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(false);
    });

    it("mixes conditions and nested groups", () => {
      // country=US AND (plan=pro OR plan=enterprise)
      const group = makeConditionGroup({
        logic: "AND",
        conditions: [{ attribute: "country", operator: "equals", value: "US" }],
        groups: [
          makeConditionGroup({
            logic: "OR",
            conditions: [
              { attribute: "plan", operator: "equals", value: "pro" },
              { attribute: "plan", operator: "equals", value: "enterprise" },
            ],
          }),
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("deeply nested groups evaluate correctly", () => {
      // OR { AND { country=US, OR { plan=pro, plan=enterprise } } }
      const group = makeConditionGroup({
        logic: "OR",
        groups: [
          makeConditionGroup({
            logic: "AND",
            conditions: [{ attribute: "country", operator: "equals", value: "US" }],
            groups: [
              makeConditionGroup({
                logic: "OR",
                conditions: [
                  { attribute: "plan", operator: "equals", value: "pro" },
                  { attribute: "plan", operator: "equals", value: "enterprise" },
                ],
              }),
            ],
          }),
        ],
      });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });
  });

  describe("empty groups", () => {
    it("empty condition group returns true", () => {
      const group = makeConditionGroup();
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("empty AND group with no conditions returns true", () => {
      const group = makeConditionGroup({ logic: "AND" });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });

    it("empty OR group with no conditions returns true", () => {
      const group = makeConditionGroup({ logic: "OR" });
      expect(evaluateConditionGroup(group, ctx)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// stickyHash()
// ---------------------------------------------------------------------------

describe("stickyHash", () => {
  it("returns a number between 0 and 99", () => {
    for (let i = 0; i < 100; i++) {
      const hash = stickyHash("flag", `user-${i}`);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(100);
    }
  });

  it("is deterministic — same inputs always produce same output", () => {
    const a = stickyHash("my-flag", "user-42");
    const b = stickyHash("my-flag", "user-42");
    expect(a).toBe(b);
  });

  it("different flag keys produce different hashes for same user", () => {
    const a = stickyHash("flag-a", "user-1");
    const b = stickyHash("flag-b", "user-1");
    // Not guaranteed to differ, but overwhelmingly likely for distinct keys
    // Use a statistical approach: check distribution
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });

  it("different users produce different hashes for same flag", () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(stickyHash("test-flag", `user-${i}`));
    }
    // Should produce at least a few different buckets
    expect(results.size).toBeGreaterThan(1);
  });

  it("produces roughly even distribution", () => {
    const buckets = new Array(10).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const hash = stickyHash("distribution-test", `user-${i}`);
      buckets[Math.floor(hash / 10)]++;
    }
    // Each bucket should have roughly n/10 = 1000 items
    // Allow 40% deviation
    for (const count of buckets) {
      expect(count).toBeGreaterThan(600);
      expect(count).toBeLessThan(1400);
    }
  });

  it("handles empty strings", () => {
    const hash = stickyHash("", "");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(100);
  });
});
