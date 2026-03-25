CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  details TEXT NOT NULL
);

CREATE INDEX idx_audit_timestamp ON audit_entries(timestamp DESC);
CREATE INDEX idx_audit_entity ON audit_entries(entity_type, entity_key);
CREATE INDEX idx_audit_user ON audit_entries("user");

PRAGMA optimize;
