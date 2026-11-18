CREATE TABLE IF NOT EXISTS calendar_schedules (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  account TEXT CHECK(account IN ('jbgolfacademy','jbgolfclub_official','jbgolfclub_bundang')),
  kind TEXT CHECK(kind IN ('post','reel')),
  day TEXT,
  local_time TEXT,
  title TEXT,
  note TEXT,
  creation_fingerprint TEXT,
  CHECK (
    (day IS NOT NULL AND account IS NOT NULL AND kind IS NOT NULL AND title IS NOT NULL AND note IS NOT NULL AND creation_fingerprint IS NOT NULL)
    OR (day IS NULL AND account IS NULL AND kind IS NULL AND local_time IS NULL AND title IS NULL AND note IS NULL AND creation_fingerprint IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS calendar_schedules_day ON calendar_schedules(day,local_time,id) WHERE day IS NOT NULL;
