CREATE TABLE experiments (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, plan_hash TEXT NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL,
  report_key TEXT, error TEXT
);
CREATE INDEX experiments_project ON experiments(project, created_at);
CREATE TABLE evaluations (
  experiment TEXT NOT NULL REFERENCES experiments(id), task_index INTEGER NOT NULL,
  candidate TEXT NOT NULL, artifact_hash TEXT NOT NULL, observation_key TEXT NOT NULL,
  observation_hash TEXT NOT NULL, PRIMARY KEY(experiment, task_index)
);
CREATE TABLE evidence_index (
  experiment TEXT NOT NULL REFERENCES experiments(id), candidate TEXT NOT NULL,
  evidence_id TEXT NOT NULL, content_hash TEXT NOT NULL, document_key TEXT NOT NULL,
  PRIMARY KEY(experiment, candidate)
);
