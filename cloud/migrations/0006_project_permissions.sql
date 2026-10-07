CREATE TABLE IF NOT EXISTS native_projects (
 name TEXT PRIMARY KEY,
 creator TEXT NOT NULL,
 creation_nonce TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 legacy INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS native_project_members (
 project TEXT NOT NULL REFERENCES native_projects(name),
 username TEXT NOT NULL REFERENCES native_users(username),
 role TEXT NOT NULL CHECK(role IN ('owner','writer','reader')),
 added_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project,username)
);
CREATE TABLE IF NOT EXISTS project_resource_owners (
 kind TEXT NOT NULL CHECK(kind IN ('experiment','generation','judgement')),
 id TEXT NOT NULL,
 project TEXT NOT NULL REFERENCES native_projects(name),
 PRIMARY KEY(kind,id)
);
CREATE TABLE IF NOT EXISTS project_artifacts (
 project TEXT NOT NULL REFERENCES native_projects(name),
 hash TEXT NOT NULL,
 PRIMARY KEY(project,hash)
);
CREATE TABLE IF NOT EXISTS project_audit (
 id TEXT PRIMARY KEY,
 project TEXT NOT NULL REFERENCES native_projects(name),
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 resource TEXT NOT NULL,
 recorded_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO native_projects (name,creator,creation_nonce,created_at,legacy)
 SELECT name,'operator:operator',lower(hex(randomblob(16))),updated_at,1 FROM native_stores;
INSERT OR IGNORE INTO native_projects (name,creator,creation_nonce,created_at,legacy)
 SELECT project,'operator:operator',lower(hex(randomblob(16))),min(created_at),1 FROM experiments GROUP BY project;
INSERT OR IGNORE INTO native_project_members (project,username,role,added_by,created_at)
 SELECT p.name,u.username,CASE WHEN u.role = 'admin' THEN 'owner' ELSE u.role END,'migration:legacy-workspace',p.created_at
 FROM native_projects p CROSS JOIN native_users u WHERE p.legacy = 1;
INSERT OR IGNORE INTO project_resource_owners (kind,id,project)
 SELECT 'experiment',id,project FROM experiments;
INSERT OR IGNORE INTO project_artifacts (project,hash)
 SELECT x.project,e.artifact_hash FROM evaluations e JOIN experiments x ON x.id = e.experiment;
