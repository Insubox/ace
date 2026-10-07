CREATE TABLE IF NOT EXISTS native_verifications (
  store TEXT NOT NULL,
  version TEXT NOT NULL,
  verifier TEXT NOT NULL,
  workflow TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('requested','running','completed','failed')),
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  receipt_key TEXT,
  receipt_hash TEXT,
  error TEXT,
  PRIMARY KEY(store, version, verifier)
);
