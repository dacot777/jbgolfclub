CREATE TABLE IF NOT EXISTS admin_sessions (
  session_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS analytics_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_rate_expiry ON analytics_rate_limits(window_started);
CREATE TABLE IF NOT EXISTS analytics_visitors (
  id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1))
);
CREATE INDEX IF NOT EXISTS analytics_visitor_last_seen ON analytics_visitors(last_seen_at);
CREATE TABLE IF NOT EXISTS analytics_visits (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  browser TEXT NOT NULL,
  device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_visit_started ON analytics_visits(started_at);
CREATE INDEX IF NOT EXISTS analytics_visit_visitor ON analytics_visits(visitor_id);
CREATE TABLE IF NOT EXISTS analytics_views (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES analytics_visits(id) ON DELETE CASCADE,
  menu TEXT NOT NULL CHECK(menu IN ('overview','campaigns','news','blog','connection')),
  entered_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  active_ms INTEGER NOT NULL DEFAULT 0,
  last_seq INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);
CREATE INDEX IF NOT EXISTS analytics_view_visit ON analytics_views(visit_id);
