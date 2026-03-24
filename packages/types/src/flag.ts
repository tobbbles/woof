/**
 * Supported flag value types.
 *
 * "integer" and "number" both map to JavaScript `number` at runtime,
 * but the distinction is preserved so the OFREP response can include
 * the correct type hint in metadata for strictly-typed clients.
 */
export type FlagType = "boolean" | "string" | "integer" | "number" | "object";

/** A concrete flag value — the type depends on FlagType. */
export type FlagValue = boolean | string | number | Record<string, unknown>;

/** A feature flag definition as stored in the backend. */
export interface Flag {
  /** Unique identifier for this flag. */
  key: string;

  /** The value type this flag resolves to. */
  type: FlagType;

  /** Whether this flag is enabled. When disabled, evaluations return the disabled variant. */
  enabled: boolean;

  /** The variant key to serve when the flag is enabled and no targeting rules match. */
  defaultVariant: string;

  /** Map of variant keys to their concrete values. */
  variants: Record<string, FlagValue>;

  /** Optional description for display in the admin UI. */
  description?: string;

  /** Human-readable display name. */
  name?: string;

  /** Emergency off-switch — when true, the flag is forced off regardless of enabled state. */
  killSwitch?: boolean;

  /** Deployment environment this flag targets. */
  environment?: string;

  /** Percentage of users who should receive this flag (0–100). */
  rolloutPercentage?: number;

  /** Context attribute used for sticky bucketing in percentage rollouts. */
  stickinessAttribute?: "user_id" | "session_id" | "device_id";

  /** Flag keys that must be enabled before this flag can activate. */
  prerequisites?: string[];

  /** ISO 8601 datetime — flag is inactive before this time. */
  scheduleStart?: string | null;

  /** ISO 8601 datetime — flag is inactive after this time. */
  scheduleEnd?: string | null;

  /** ISO 8601 datetime when the flag was created. */
  createdAt?: string;

  /** ISO 8601 datetime when the flag was last modified. */
  updatedAt?: string;
}
