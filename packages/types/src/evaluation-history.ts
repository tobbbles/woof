/** Metadata stored on each evaluation context KV key (returned by kv.list). */
export interface EvalContextMeta {
  flagKey: string;
  result: string;
  variant?: string;
  matchedRule?: string;
  timestamp: string;
}

/** Full evaluation context entry stored as KV value. */
export interface EvalContextEntry extends EvalContextMeta {
  /** The full evaluation context sent with the OFREP request. */
  context: Record<string, unknown>;
}

/** Response for the evaluation log admin endpoint. */
export interface ListEvalContextsResponse {
  entries: EvalContextEntry[];
  cursor?: string;
  complete: boolean;
}
