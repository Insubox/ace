CREATE TABLE IF NOT EXISTS project_notifications (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 project TEXT NOT NULL,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 resource TEXT NOT NULL,
 recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS project_notifications_project ON project_notifications(project,sequence);
CREATE TABLE IF NOT EXISTS notification_reads (
 project TEXT NOT NULL,
 actor TEXT NOT NULL,
 through_sequence INTEGER NOT NULL,
 PRIMARY KEY(project,actor)
);
