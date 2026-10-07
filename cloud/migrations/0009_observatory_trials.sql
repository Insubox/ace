CREATE TABLE IF NOT EXISTS observatory_trials (
 id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES native_projects(name),
 actor TEXT NOT NULL, request_hash TEXT NOT NULL, request_key TEXT NOT NULL,
 experiment TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 plan_hash TEXT, native_version TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS observatory_trials_project ON observatory_trials(project,created_at DESC);
