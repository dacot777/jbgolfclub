CREATE TABLE calendar_schedules_next (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  account TEXT CHECK(account IN ('jbgolfacademy','jbgolfclub_official','jbgolfclub_bundang')),
  scheduled_brand TEXT CHECK(scheduled_brand IN ('club','academy','haus')),
  scheduled_branch TEXT CHECK(scheduled_branch IN ('cheongdam','seohyeon')),
  brand TEXT GENERATED ALWAYS AS (COALESCE(scheduled_brand, CASE
    WHEN account='jbgolfacademy' THEN 'academy'
    WHEN account IN ('jbgolfclub_official','jbgolfclub_bundang') THEN 'club'
  END)) STORED,
  branch TEXT GENERATED ALWAYS AS (COALESCE(scheduled_branch, CASE
    WHEN account='jbgolfclub_bundang' THEN 'seohyeon'
  END)) STORED,
  kind TEXT CHECK(kind IN ('post','reel')),
  day TEXT,
  local_time TEXT,
  title TEXT,
  note TEXT,
  creation_fingerprint TEXT,
  permalink TEXT CHECK(permalink IS NULL OR (day IS NOT NULL AND account IS NOT NULL)),
  CHECK (
    (account IS NOT NULL AND scheduled_brand IS NULL AND scheduled_branch IS NULL)
    OR (account IS NULL AND (
      (scheduled_brand IS 'club' AND scheduled_branch IS NOT NULL)
      OR (scheduled_brand IN ('academy','haus') AND scheduled_branch IS NULL)
      OR (day IS NULL AND scheduled_brand IS NULL AND scheduled_branch IS NULL)
    ))
  ),
  CHECK (
    (day IS NOT NULL AND brand IS NOT NULL AND kind IS NOT NULL AND title IS NOT NULL
      AND note IS NOT NULL AND creation_fingerprint IS NOT NULL)
    OR (day IS NULL AND account IS NULL AND scheduled_brand IS NULL AND scheduled_branch IS NULL
      AND kind IS NULL AND local_time IS NULL AND title IS NULL AND note IS NULL AND creation_fingerprint IS NULL)
  )
);
INSERT INTO calendar_schedules_next(id,version,account,kind,day,local_time,title,note,creation_fingerprint,permalink)
SELECT id,version,account,kind,day,local_time,title,note,creation_fingerprint,permalink FROM calendar_schedules;
DROP TABLE calendar_schedules;
ALTER TABLE calendar_schedules_next RENAME TO calendar_schedules;
CREATE INDEX calendar_schedules_day ON calendar_schedules(day,local_time,id) WHERE day IS NOT NULL;
CREATE UNIQUE INDEX calendar_schedule_link ON calendar_schedules(account,replace(permalink,'/reel/','/p/')) WHERE permalink IS NOT NULL;
