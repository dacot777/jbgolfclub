ALTER TABLE calendar_schedules ADD COLUMN permalink TEXT CHECK (permalink IS NULL OR day IS NOT NULL);
CREATE UNIQUE INDEX calendar_schedule_link ON calendar_schedules(account, replace(permalink, '/reel/', '/p/')) WHERE permalink IS NOT NULL;
CREATE INDEX calendar_media_link ON calendar_instagram_media(account, replace(replace(replace(permalink, '/reel/', '/p/'), '/reels/', '/p/'), '/tv/', '/p/'));
