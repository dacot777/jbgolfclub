CREATE TABLE IF NOT EXISTS calendar_read_grant (
  id INTEGER PRIMARY KEY CHECK(id=1),
  token_digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
