CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('news','blog')),
  url TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(kind,url)
);
CREATE INDEX IF NOT EXISTS media_items_kind_date ON media_items(kind,published_at,first_seen_at);
CREATE TABLE IF NOT EXISTS media_refresh (
  kind TEXT PRIMARY KEY CHECK (kind IN ('news','blog')),
  next_keyword INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  cycle_active INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  lock_until INTEGER NOT NULL DEFAULT 0
);
