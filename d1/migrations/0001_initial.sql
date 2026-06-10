create table if not exists rooms (
  id text primary key,
  room_code text not null unique,
  state_json text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_rooms_room_code on rooms(room_code);
create index if not exists idx_rooms_updated_at on rooms(updated_at);
