CREATE TABLE IF NOT EXISTS application_runs (
 id TEXT PRIMARY KEY,
 project TEXT NOT NULL,
 actor TEXT NOT NULL,
 profile TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 request_key TEXT NOT NULL,
 status TEXT NOT NULL,
 source_version TEXT,
 result_version TEXT,
 report_key TEXT,
 report_hash TEXT,
 error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS application_runs_project ON application_runs(project,created_at);
