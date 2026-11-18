CREATE TABLE IF NOT EXISTS meta_ad_registry (
  account_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  reviewed_id TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  post_url TEXT,
  status TEXT NOT NULL,
  status_observed_at TEXT,
  start_at TEXT,
  created_at TEXT,
  first_delivery_date TEXT,
  last_active_at TEXT,
  paused_since TEXT,
  PRIMARY KEY (account_id, ad_id)
);

CREATE TABLE IF NOT EXISTS meta_ad_history (
  account_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  since TEXT NOT NULL,
  until TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (account_id, ad_id, kind, since, until)
);

CREATE TABLE IF NOT EXISTS meta_ad_thumbnails (
  public_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  creative_id TEXT,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta_ad_history_revisions (
  account_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  since TEXT NOT NULL,
  until TEXT NOT NULL,
  replaced_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(account_id,ad_id,kind,since,until,replaced_at)
);

CREATE TABLE IF NOT EXISTS meta_ad_pause_events (
  account_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL,
  previous_active_at TEXT,
  last_delivery_date TEXT,
  PRIMARY KEY(account_id,ad_id,at,source)
);

-- Preserve observed Instagram days predating the dedicated per-ad history.
INSERT OR IGNORE INTO meta_ad_history(account_id, ad_id, kind, since, until, payload)
SELECT r.account_id, json_extract(d.value,'$.adId'), 'day', r.since, r.since,
  json_object('adName',json_extract(d.value,'$.adName'),
    'spend',json_extract(d.value,'$.spend'),'impressions',json_extract(d.value,'$.impressions'),
    'linkClicks',json_extract(d.value,'$.linkClicks'),'reach',json_extract(d.value,'$.reach'))
FROM meta_ads_reports r, json_each(r.payload) d
WHERE r.kind='day' AND json_type(d.value,'$.adId')='text';

INSERT OR IGNORE INTO meta_ad_registry(account_id,ad_id,public_key,title,status)
SELECT account_id,ad_id,'meta-'||lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||
  '-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6))),
  COALESCE(json_extract(payload,'$.adName'), 'Instagram 광고'),'unknown'
FROM meta_ad_history WHERE kind='day' GROUP BY account_id,ad_id HAVING MAX(since) IS NOT NULL;

UPDATE meta_ad_registry AS a SET first_delivery_date=(
  SELECT MIN(since) FROM meta_ad_history h WHERE h.account_id=a.account_id AND h.ad_id=a.ad_id
    AND h.kind='day' AND (h.payload->>'$.impressions'>0 OR h.payload->>'$.spend'>0
      OR h.payload->>'$.linkClicks'>0 OR h.payload->>'$.reach'>0)
);
