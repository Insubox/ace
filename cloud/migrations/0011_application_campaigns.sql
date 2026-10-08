CREATE TABLE IF NOT EXISTS application_campaigns (
 id TEXT PRIMARY KEY,
 project TEXT NOT NULL,
 actor TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 request_key TEXT NOT NULL,
 baseline_run TEXT NOT NULL,
 status TEXT NOT NULL,
 state_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS application_campaigns_project ON application_campaigns(project,created_at);
