/** A single targeting condition. */
export interface Condition {
  attribute: string;
  operator: string;
  value: string;
  negate?: boolean;
}

/** A group of conditions joined by AND/OR logic, supporting nesting. */
export interface ConditionGroup {
  logic: "AND" | "OR";
  conditions: Condition[];
  groups: ConditionGroup[];
}

/** A targeting rule bound to a specific flag. */
export interface Rule {
  id: string;
  flagKey: string;
  name: string;
  conditionGroup: ConditionGroup;
  priority: number;
  /** The variant key to serve when this rule matches. */
  variantKey: string;
  /** Segment IDs whose conditions must also match for this rule to fire. */
  segmentIds?: string[];
  createdAt: string;
  updatedAt: string;
}

/** A reusable user cohort defined by conditions. */
export interface Segment {
  id: string;
  name: string;
  key: string;
  description: string;
  conditionGroup: ConditionGroup;
  createdAt: string;
  updatedAt: string;
}

/** Request body for creating a new rule. */
export interface CreateRuleRequest {
  flagKey: string;
  name: string;
  conditionGroup: ConditionGroup;
  variantKey: string;
  priority?: number;
  segmentIds?: string[];
}

/** Request body for updating an existing rule. All fields optional. */
export interface UpdateRuleRequest {
  name?: string;
  conditionGroup?: ConditionGroup;
  variantKey?: string;
  priority?: number;
  segmentIds?: string[];
}

/** Response for list rules endpoint. */
export interface ListRulesResponse {
  rules: Rule[];
}

/** Request body for creating a new segment. */
export interface CreateSegmentRequest {
  name: string;
  key: string;
  description: string;
  conditionGroup: ConditionGroup;
}

/** Request body for updating an existing segment. All fields optional. */
export interface UpdateSegmentRequest {
  name?: string;
  description?: string;
  conditionGroup?: ConditionGroup;
}

/** Response for list segments endpoint. */
export interface ListSegmentsResponse {
  segments: Segment[];
}
