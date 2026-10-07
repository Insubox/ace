-- Search/index cache. The Durable Object journal is the publication authority.
CREATE TABLE IF NOT EXISTS native_stores (
    name TEXT PRIMARY KEY,
    version_count INTEGER NOT NULL,
    tip TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
