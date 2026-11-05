CREATE TABLE IF NOT EXISTS instagram_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  oauth_user_id TEXT,
  app_scoped_id TEXT,
  username TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  token_expires_at INTEGER NOT NULL,
  last_refreshed_at INTEGER NOT NULL,
  refresh_lock_until INTEGER NOT NULL DEFAULT 0,
  refresh_error TEXT
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deletion_confirmations (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
