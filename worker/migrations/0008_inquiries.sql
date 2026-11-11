CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  first_date TEXT,
  product TEXT NOT NULL CHECK(product IN ('camp','lesson','other')),
  channel TEXT NOT NULL CHECK(channel IN ('kakao','instagram_dm','phone','other')),
  source TEXT NOT NULL DEFAULT 'unknown' CHECK(source IN ('unknown','instagram_ad','instagram_post','search','referral','other')),
  ad_id TEXT CHECK(ad_id IS NULL OR source='instagram_ad'),
  stage TEXT NOT NULL DEFAULT 'received' CHECK(stage IN ('received','consulting','completed','closed')),
  assignee TEXT NOT NULL DEFAULT 'unassigned' CHECK(assignee IN ('unassigned','kim_yeoul','kim_uihyeon')),
  private_fields TEXT,
  creation_fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS inquiries_created ON inquiries(created_at);
