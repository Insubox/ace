CREATE TABLE IF NOT EXISTS native_users (
    username TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('admin', 'writer', 'reader')),
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS native_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES native_users(username),
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS native_sessions_expiry ON native_sessions(expires_at);
