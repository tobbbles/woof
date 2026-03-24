import type { AccessJWTPayload } from "./auth/access.js";
import type { AuditStore } from "./store/audit.js";
import type { FlagStore } from "./store/flags.js";
import type { RuleStore } from "./store/rules.js";
import type { SegmentStore } from "./store/segments.js";
import type { SettingsStore } from "./store/settings.js";

export type AppEnv = {
  Bindings: {
    FLAGS: KVNamespace;
    /** Cloudflare Access team domain, e.g. "https://myteam.cloudflareaccess.com" */
    ACCESS_TEAM_DOMAIN: string;
    /** Application Audience (AUD) tag from the Cloudflare Access dashboard. */
    ACCESS_AUD: string;
    /**
     * Optional API key for OFREP evaluation endpoints.
     * When set, requests must include `Authorization: Bearer <key>` or `X-API-Key: <key>`.
     * When unset, OFREP endpoints are publicly accessible.
     */
    OFREP_API_KEY?: string;
    /**
     * Comma-separated list of allowed CORS origins.
     * e.g. "https://app.example.com,https://staging.example.com"
     * When unset, no cross-origin requests are allowed.
     */
    CORS_ORIGINS?: string;
  };
  Variables: {
    flagStore: FlagStore;
    ruleStore: RuleStore;
    segmentStore: SegmentStore;
    auditStore: AuditStore;
    settingsStore: SettingsStore;
    /** Verified Cloudflare Access identity — set by requireAccessAuth middleware. */
    accessIdentity: AccessJWTPayload;
  };
};
