export interface Environment {
  id: string;
  name: string;
  key: string;
  color: string;
  protected: boolean;
}

export interface FlagDefaults {
  defaultEnv: string;
  defaultRollout: number;
  requireApproval: boolean;
  approvalEnvs: string[];
  staleFlagDays: number;
  autoDisableStale: boolean;
}

export interface EvaluationSettings {
  strategy: "first-match" | "all-match";
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  loggingEnabled: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface Settings {
  environments: Environment[];
  flagDefaults: FlagDefaults;
  evaluation: EvaluationSettings;
}
