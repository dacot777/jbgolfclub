CREATE TABLE IF NOT EXISTS meta_ads_sync (
  account_id TEXT PRIMARY KEY,
  active_run TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  published_run TEXT,
  synced_at TEXT,
  currency TEXT,
  time_zone TEXT
);

CREATE TABLE IF NOT EXISTS meta_ads_reports (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  since TEXT NOT NULL,
  run TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (account_id, kind, since)
);

CREATE INDEX IF NOT EXISTS meta_ads_published ON meta_ads_reports(account_id, run);
