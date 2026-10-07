CREATE TABLE IF NOT EXISTS workspace_backups (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 completed_at INTEGER,
 manifest_hash TEXT,
 object_count INTEGER,
 byte_count INTEGER,
 error TEXT,
 restore_status TEXT,
 restore_hash TEXT
);
