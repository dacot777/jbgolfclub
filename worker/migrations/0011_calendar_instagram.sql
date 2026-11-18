CREATE TABLE calendar_instagram_states (
  state_hash TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE calendar_instagram_accounts (
  account TEXT PRIMARY KEY CHECK(account IN ('jbgolfacademy','jbgolfclub_official','jbgolfclub_bundang')),
  user_id TEXT NOT NULL UNIQUE,
  oauth_user_id TEXT,
  app_scoped_id TEXT,
  encrypted_token TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  last_synced_at INTEGER,
  sync_error TEXT,
  after_cursor TEXT,
  scan_started_at INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE calendar_instagram_media (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES calendar_instagram_accounts(account) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('post','reel')),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  permalink TEXT NOT NULL,
  thumbnail_url TEXT,
  use_album_child INTEGER NOT NULL DEFAULT 0,
  thumbnail_checked_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX calendar_instagram_by_month ON calendar_instagram_media(date, time, account);
