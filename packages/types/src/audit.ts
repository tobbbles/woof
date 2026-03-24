export type AuditAction = "created" | "updated" | "deleted" | "toggled" | "evaluated";
export type AuditEntityType = "flag" | "rule" | "segment" | "settings";

/** A single audit log entry recording a mutation. */
export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityKey: string;
  entityName: string;
  details: string;
}

/** Response for list audit endpoint. */
export interface ListAuditResponse {
  entries: AuditEntry[];
  cursor?: string;
}
