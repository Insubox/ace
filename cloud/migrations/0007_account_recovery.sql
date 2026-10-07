CREATE TABLE IF NOT EXISTS native_recovery_tickets (
  username TEXT PRIMARY KEY REFERENCES native_users(username),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  username TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
