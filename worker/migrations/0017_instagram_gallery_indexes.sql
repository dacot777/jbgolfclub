CREATE INDEX calendar_media_account_latest ON calendar_instagram_media(account,date DESC,time DESC,id DESC);
CREATE INDEX calendar_link_account_latest ON calendar_schedules(account,day DESC,local_time DESC,id DESC) WHERE permalink IS NOT NULL;
