import type { Flag, FlagType, FlagValue } from "./flag.js";

/** Request body for creating a new flag. */
export interface CreateFlagRequest {
  key: string;
  type: FlagType;
  enabled: boolean;
  defaultVariant: string;
  variants: Record<string, FlagValue>;
  description?: string;
  name?: string;
  killSwitch?: boolean;
  environment?: string;
  rolloutPercentage?: number;
  stickinessAttribute?: "user_id" | "session_id" | "device_id";
  prerequisites?: string[];
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
}

/** Request body for updating an existing flag. All fields optional — merges with existing. */
export interface UpdateFlagRequest {
  enabled?: boolean;
  defaultVariant?: string;
  variants?: Record<string, FlagValue>;
  description?: string;
  name?: string;
  killSwitch?: boolean;
  environment?: string;
  rolloutPercentage?: number;
  stickinessAttribute?: "user_id" | "session_id" | "device_id";
  prerequisites?: string[];
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
}

/** Response for list flags endpoint. */
export interface ListFlagsResponse {
  flags: Flag[];
}
