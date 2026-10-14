PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('manager','employee')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('cases','consultations','tasks')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  next_due TEXT,
  start_date TEXT,
  last_scan TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_owner ON records(owner_id, type);
CREATE INDEX IF NOT EXISTS records_schedule ON records(active, type, next_due, start_date);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  dedup_key TEXT NOT NULL UNIQUE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS deliveries_retry ON deliveries(status, available_at);
CREATE INDEX IF NOT EXISTS deliveries_owner ON deliveries(owner_id, created_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription TEXT NOT NULL CHECK(json_valid(subscription)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_owner ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS push_receipts (
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY(delivery_id,subscription_id)
);
