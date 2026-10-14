ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','disabled'));
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
ALTER TABLE users ADD COLUMN notification_preview INTEGER NOT NULL DEFAULT 1 CHECK(notification_preview IN (0,1));
ALTER TABLE users ADD COLUMN last_mutation_id TEXT;
ALTER TABLE records ADD COLUMN last_mutation_id TEXT;
ALTER TABLE sessions ADD COLUMN public_id TEXT;
ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN device_name TEXT NOT NULL DEFAULT 'Older session';
CREATE UNIQUE INDEX IF NOT EXISTS session_public_id ON sessions(public_id);
CREATE INDEX IF NOT EXISTS users_status ON users(status,role);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_record ON activity(record_id,created_at);
CREATE INDEX IF NOT EXISTS activity_actor ON activity(actor_id,created_at);
CREATE TABLE IF NOT EXISTS handoffs (
  consultation_id TEXT PRIMARY KEY REFERENCES records(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES records(id),
  created_at TEXT NOT NULL
);
