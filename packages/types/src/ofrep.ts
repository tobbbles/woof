import type { FlagValue } from "./flag.js";

/** Context sent with every OFREP evaluation request. */
export interface EvaluationContext {
  /** The key identifying the target (user, service, etc). */
  targetingKey: string;
  /** Arbitrary attributes for targeting. */
  [key: string]: unknown;
}

/** OFREP single flag evaluation request body. */
export interface EvaluationRequest {
  context: EvaluationContext;
}

/** OFREP evaluation reason codes. */
export type EvaluationReason = "STATIC" | "TARGETING_MATCH" | "SPLIT" | "DISABLED" | "UNKNOWN";

/** OFREP evaluation error codes (flag-level). */
export type EvaluationErrorCode = "PARSE_ERROR" | "TARGETING_KEY_MISSING" | "INVALID_CONTEXT" | "GENERAL";

/** OFREP flag-not-found error code (404 responses only). */
export type FlagNotFoundErrorCode = "FLAG_NOT_FOUND";

/** Metadata attached to an evaluation response. */
export type EvaluationMetadata = Record<string, boolean | string | number>;

/**
 * Successful OFREP evaluation response.
 *
 * When `value` is absent, the client should use its code-level default
 * (the OFREP "codeDefaultFlag" pattern).
 */
export interface EvaluationSuccess {
  key: string;
  value?: FlagValue;
  reason: EvaluationReason;
  variant?: string;
  metadata?: EvaluationMetadata;
}

/** Failed OFREP evaluation response (400). */
export interface EvaluationFailure {
  key: string;
  errorCode: EvaluationErrorCode;
  errorDetails?: string;
  metadata?: EvaluationMetadata;
}

/** OFREP flag-not-found response (404). */
export interface FlagNotFoundResponse {
  key: string;
  errorCode: FlagNotFoundErrorCode;
  errorDetails?: string;
  metadata?: EvaluationMetadata;
}

/** OFREP general error response (500). */
export interface GeneralErrorResponse {
  errorDetails?: string;
}

/** OFREP bulk evaluation failure response (400). */
export interface BulkEvaluationFailure {
  errorCode: EvaluationErrorCode;
  errorDetails?: string;
}

/** A single entry in the bulk evaluation response. */
export type BulkEvaluationEntry = EvaluationSuccess | EvaluationFailure;

/** OFREP bulk evaluation response body. */
export interface BulkEvaluationResponse {
  flags: BulkEvaluationEntry[];
  metadata?: EvaluationMetadata;
}
