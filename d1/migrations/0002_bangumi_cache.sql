create table if not exists bangumi_source_cache (
  cache_key text primary key,
  payload_json text not null,
  updated_at text not null,
  expires_at text not null
);

create index if not exists idx_bangumi_source_cache_expires_at on bangumi_source_cache(expires_at);

create table if not exists bangumi_character_cache (
  subject_id integer primary key,
  names_json text not null,
  updated_at text not null,
  expires_at text not null
);

create index if not exists idx_bangumi_character_cache_expires_at on bangumi_character_cache(expires_at);
