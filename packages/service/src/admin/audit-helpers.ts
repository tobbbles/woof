import type { AuditAction, AuditEntityType, AuditEntry } from "@woof/types";
import type { Context } from "hono";
import type { AppEnv } from "../env.js";

/**
 * Fire-and-forget audit log write.
 * Uses waitUntil() so the write completes even after the response is sent.
 */
export function logAudit(
  c: Context<AppEnv>,
  entry: {
    action: AuditAction;
    entityType: AuditEntityType;
    entityKey: string;
    entityName: string;
    details: string;
  },
): void {
  const auditEntry: AuditEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    user: c.var.accessIdentity?.email ?? "unknown",
    ...entry,
  };
  c.executionCtx.waitUntil(c.var.auditStore.append(auditEntry));
}
