CREATE TABLE IF NOT EXISTS reviewed_ads (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE IF NOT EXISTS reviewed_snapshots (
  id TEXT PRIMARY KEY,
  ad_id TEXT NOT NULL REFERENCES reviewed_ads(id),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX IF NOT EXISTS reviewed_snapshots_ad ON reviewed_snapshots(ad_id);
