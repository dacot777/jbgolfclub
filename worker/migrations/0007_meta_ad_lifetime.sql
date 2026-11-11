CREATE TABLE IF NOT EXISTS meta_ad_lifetime_cache (
  account_id TEXT PRIMARY KEY,
  refreshed_at TEXT,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  currency TEXT,
  payload TEXT NOT NULL DEFAULT '[]'
);
