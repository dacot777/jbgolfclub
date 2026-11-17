CREATE TABLE staff_activation_grants (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX staff_grant_expiry ON staff_activation_grants(expires_at);

CREATE TABLE staff_sessions (
  session_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX staff_session_expiry ON staff_sessions(expires_at);
