create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_user_id uuid not null,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  phase text not null default 'lobby',
  round_number integer not null default 0,
  max_rounds integer not null default 8,
  seat_count integer not null default 4 check (seat_count in (4, 6, 8, 10, 12, 14)),
  role_rotation_enabled boolean not null default true,
  winner text null check (winner in ('A', 'B')),
  score_team_a_intercepts integer not null default 0,
  score_team_b_intercepts integer not null default 0,
  score_team_a_miscomms integer not null default 0,
  score_team_b_miscomms integer not null default 0,
  team_a_words_confirmed boolean not null default false,
  team_b_words_confirmed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.rooms
add column if not exists team_a_words_confirmed boolean not null default false;

alter table public.rooms
add column if not exists team_b_words_confirmed boolean not null default false;

alter table public.rooms
add column if not exists seat_count integer not null default 4;

alter table public.rooms
add column if not exists role_rotation_enabled boolean not null default true;

alter table public.rooms drop constraint if exists rooms_seat_count_check;
alter table public.rooms
add constraint rooms_seat_count_check
check (seat_count in (4, 6, 8, 10, 12, 14));

alter table public.rooms drop constraint if exists rooms_phase_check;
update public.rooms
set phase = 'encrypt'
where phase = 'clue';
alter table public.rooms
add constraint rooms_phase_check
check (phase in ('lobby', 'word_assignment', 'encrypt', 'decode', 'intercept', 'result', 'finished'));

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  auth_user_id uuid not null,
  player_name text not null,
  team text null check (team in ('A', 'B')),
  role text null check (role in ('encoder', 'decoder', 'member')),
  team_seat integer null check (team_seat is null or team_seat > 0),
  is_host boolean not null default false,
  connected boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  unique (room_id, auth_user_id),
  unique (room_id, team, team_seat)
);

alter table public.room_players
add column if not exists team_seat integer null;

alter table public.room_players drop constraint if exists room_players_role_check;
alter table public.room_players
add constraint room_players_role_check
check (role is null or role in ('encoder', 'decoder', 'member'));

alter table public.room_players drop constraint if exists room_players_team_seat_check;
alter table public.room_players
add constraint room_players_team_seat_check
check (team_seat is null or team_seat > 0);

alter table public.room_players drop constraint if exists room_players_room_id_team_role_key;
alter table public.room_players drop constraint if exists room_players_room_id_team_team_seat_key;
alter table public.room_players
add constraint room_players_room_id_team_team_seat_key
unique (room_id, team, team_seat);

update public.room_players
set team_seat = case
      when team_seat is not null then team_seat
      when role = 'encoder' then 1
      when role = 'decoder' then 2
      else null
    end
where team is not null;

create table if not exists public.team_words (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  words text[] not null check (array_length(words, 1) = 4),
  confirmed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (room_id, team)
);

alter table public.team_words
add column if not exists confirmed boolean not null default false;

update public.team_words
set confirmed = true
where not confirmed;

update public.rooms
set team_a_words_confirmed = exists (
      select 1
      from public.team_words
      where public.team_words.room_id = public.rooms.id
        and public.team_words.team = 'A'
        and public.team_words.confirmed
    ),
    team_b_words_confirmed = exists (
      select 1
      from public.team_words
      where public.team_words.room_id = public.rooms.id
        and public.team_words.team = 'B'
        and public.team_words.confirmed
    );

create table if not exists public.round_codes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  round_number integer not null check (round_number > 0),
  encoder_player_id uuid not null references public.room_players(id) on delete cascade,
  code text not null check (code ~ '^[1-4]-[1-4]-[1-4]$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (room_id, team, round_number)
);

create table if not exists public.round_submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  round_number integer not null check (round_number > 0),
  clues text[] null check (clues is null or array_length(clues, 1) = 3),
  intercept_guess text null check (intercept_guess is null or intercept_guess ~ '^[1-4]-[1-4]-[1-4]$'),
  own_guess text null check (own_guess is null or own_guess ~ '^[1-4]-[1-4]-[1-4]$'),
  revealed_code text null check (revealed_code is null or revealed_code ~ '^[1-4]-[1-4]-[1-4]$'),
  intercept_correct boolean null,
  own_correct boolean null,
  resolved_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (room_id, team, round_number)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_rooms_updated_at on public.rooms;
create trigger trg_rooms_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

drop trigger if exists trg_round_submissions_updated_at on public.round_submissions;
create trigger trg_round_submissions_updated_at
before update on public.round_submissions
for each row
execute function public.set_updated_at();

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
  );
$$;

create or replace function public.current_player_team(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select team
  from public.room_players
  where room_id = p_room_id
    and auth_user_id = auth.uid()
  limit 1;
$$;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.team_words enable row level security;
alter table public.round_codes enable row level security;
alter table public.round_submissions enable row level security;

drop policy if exists "rooms_select_member" on public.rooms;
create policy "rooms_select_member"
on public.rooms
for select
to authenticated
using (public.is_room_member(id));

drop policy if exists "players_select_member" on public.room_players;
create policy "players_select_member"
on public.room_players
for select
to authenticated
using (public.is_room_member(room_id));

drop policy if exists "team_words_select_same_team" on public.team_words;
create policy "team_words_select_same_team"
on public.team_words
for select
to authenticated
using (
  public.is_room_member(room_id)
  and team = public.current_player_team(room_id)
  and (
    confirmed
    or exists (
      select 1
      from public.rooms
      join public.room_players
        on public.room_players.room_id = public.team_words.room_id
      where public.rooms.id = public.team_words.room_id
        and public.rooms.phase = 'word_assignment'
        and public.room_players.auth_user_id = auth.uid()
        and public.room_players.team = public.team_words.team
        and public.room_players.role = 'encoder'
    )
  )
);

drop policy if exists "round_codes_select_encoder_only" on public.round_codes;
create policy "round_codes_select_encoder_only"
on public.round_codes
for select
to authenticated
using (
  public.is_room_member(room_id)
  and exists (
    select 1
    from public.room_players
    where id = encoder_player_id
      and auth_user_id = auth.uid()
  )
);

drop policy if exists "round_submissions_select_member" on public.round_submissions;
create policy "round_submissions_select_member"
on public.round_submissions
for select
to authenticated
using (public.is_room_member(room_id));

create or replace function public.generate_room_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1 from public.rooms where room_code = v_code
    );
  end loop;

  return v_code;
end;
$$;

create or replace function public.draw_words(p_count integer)
returns text[]
language sql
security definer
set search_path = public
as $$
  with word_pool(word) as (
    values
      ('星轨'), ('镜海'), ('风铃'), ('夜航'), ('引擎'), ('玻璃'), ('钟楼'), ('轨道'),
      ('雪山'), ('珊瑚'), ('剧场'), ('旋涡'), ('琥珀'), ('纸鹤'), ('深林'), ('灯塔'),
      ('琴弦'), ('沙丘'), ('火种'), ('雾港'), ('雷达'), ('庭院'), ('齿轮'), ('潮汐'),
      ('画框'), ('信号'), ('余烬'), ('浮桥'), ('剪影'), ('棱镜'), ('回声'), ('焰火'),
      ('龙卷'), ('白塔'), ('萤火'), ('琴键'), ('铁锚'), ('雪豹'), ('飞鱼'), ('指针'),
      ('蜂巢'), ('棋盘'), ('墨迹'), ('航线'), ('雨林'), ('极光'), ('山脊'), ('陨石')
  )
  select array_agg(word)
  from (
    select word
    from word_pool
    order by random()
    limit p_count
  ) picked;
$$;

create or replace function public.room_team_capacity(p_seat_count integer)
returns integer
language sql
immutable
as $$
  select p_seat_count / 2;
$$;

create or replace function public.role_for_team_seat(p_team_seat integer)
returns text
language sql
immutable
as $$
  select case
    when p_team_seat = 1 then 'encoder'
    when p_team_seat = 2 then 'decoder'
    else 'member'
  end;
$$;

create or replace function public.compress_room_team_seats(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      id,
      row_number() over (
        partition by team
        order by team_seat asc, joined_at asc, id asc
      ) as next_team_seat
    from public.room_players
    where room_id = p_room_id
      and team in ('A', 'B')
      and team_seat is not null
  )
  update public.room_players as players
  set team_seat = ranked.next_team_seat
  from ranked
  where players.id = ranked.id;
end;
$$;

create or replace function public.assign_room_roles(p_room_id uuid, p_round_number integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rotation_enabled boolean;
  v_team text;
  v_team_count integer;
  v_encoder_seat integer;
  v_decoder_seat integer;
begin
  select role_rotation_enabled
  into v_rotation_enabled
  from public.rooms
  where id = p_room_id;

  update public.room_players
  set role = null
  where room_id = p_room_id
    and (team is null or team_seat is null);

  foreach v_team in array array['A', 'B']
  loop
    select count(*)
    into v_team_count
    from public.room_players
    where room_id = p_room_id
      and team = v_team
      and team_seat is not null;

    if v_team_count = 0 then
      continue;
    end if;

    v_encoder_seat := case
      when v_rotation_enabled then mod(greatest(p_round_number, 1) - 1, v_team_count) + 1
      else 1
    end;

    v_decoder_seat := case
      when v_team_count >= 2 then (v_encoder_seat % v_team_count) + 1
      else null
    end;

    update public.room_players
    set role = case
      when team_seat = v_encoder_seat then 'encoder'
      when team_seat = v_decoder_seat then 'decoder'
      else 'member'
    end
    where room_id = p_room_id
      and team = v_team
      and team_seat is not null;
  end loop;
end;
$$;

create or replace function public.generate_code_text()
returns text
language sql
security definer
set search_path = public
as $$
  with shuffled_numbers as (
    select number, random() as sort_key
    from unnest(array[1, 2, 3, 4]) as digits(number)
    order by sort_key
    limit 3
  )
  select string_agg(number::text, '-' order by sort_key)
  from shuffled_numbers;
$$;

create or replace function public.normalize_team_words(p_words text[], p_require_complete boolean default false)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_words text[];
begin
  if array_length(p_words, 1) <> 4 then
    raise exception '必须提供 4 个词语。';
  end if;

  select array_agg(trim(coalesce(value, '')) order by ordinality)
  into v_words
  from unnest(p_words) with ordinality as items(value, ordinality);

  if p_require_complete and exists (
    select 1
    from unnest(v_words) as value
    where value = ''
  ) then
    raise exception '确认前需要填写 4 个词语。';
  end if;

  if exists (
    select 1
    from (
      select value
      from unnest(v_words) as value
      where value <> ''
      group by value
      having count(*) > 1
    ) duplicates
  ) then
    raise exception '同队词语不能重复。';
  end if;

  return v_words;
end;
$$;

create or replace function public.assert_authenticated()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '需要先登录。';
  end if;
end;
$$;

drop function if exists public.create_room(text, text);
drop function if exists public.create_room(text);

create function public.create_room(p_player_name text, p_room_code text default null)
returns table(created_room_id uuid, created_room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_requested_code text;
begin
  perform public.assert_authenticated();

  if coalesce(length(trim(p_player_name)), 0) = 0 then
    raise exception '昵称不能为空。';
  end if;

  v_requested_code := nullif(upper(trim(p_room_code)), '');

  if v_requested_code is not null then
    if v_requested_code !~ '^[A-Z0-9]{6}$' then
      raise exception '房间码必须是 6 位大写字母或数字。';
    end if;

    if exists (
      select 1
      from public.rooms r
      where r.room_code = v_requested_code
    ) then
      raise exception '该房间码已被占用。';
    end if;

    v_room_code := v_requested_code;
  else
    v_room_code := public.generate_room_code();
  end if;

  insert into public.rooms (room_code, host_user_id)
  values (v_room_code, auth.uid())
  returning id into v_room_id;

  insert into public.room_players (room_id, auth_user_id, player_name, is_host)
  values (v_room_id, auth.uid(), trim(p_player_name), true);

  return query
  select v_room_id, v_room_code;
end;
$$;

drop function if exists public.join_room(text, text);

create function public.join_room(p_room_code text, p_player_name text)
returns table(joined_room_id uuid, joined_room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_existing_player_count integer;
  v_is_existing_member boolean;
  v_lookup_code text;
begin
  perform public.assert_authenticated();

  v_lookup_code := upper(trim(p_room_code));

  select *
  into v_room
  from public.rooms as r
  where r.room_code = v_lookup_code
  limit 1;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  if coalesce(length(trim(p_player_name)), 0) = 0 then
    raise exception '昵称不能为空。';
  end if;

  select exists (
    select 1
    from public.room_players as rp
    where rp.room_id = v_room.id
      and rp.auth_user_id = auth.uid()
  )
  into v_is_existing_member;

  if v_room.status <> 'lobby' and not v_is_existing_member then
    raise exception '游戏开始后不能加入新玩家。';
  end if;

  select count(*)
  into v_existing_player_count
  from public.room_players as rp
  where rp.room_id = v_room.id;

  if v_existing_player_count >= v_room.seat_count
     and not exists (
       select 1
       from public.room_players as rp
       where rp.room_id = v_room.id
         and rp.auth_user_id = auth.uid()
     ) then
    raise exception '房间已满。';
  end if;

  insert into public.room_players (room_id, auth_user_id, player_name, connected)
  values (v_room.id, auth.uid(), trim(p_player_name), true)
  on conflict (room_id, auth_user_id)
  do update set
    player_name = excluded.player_name,
    connected = true;

  return query
  select v_room.id, v_room.room_code;
end;
$$;

create or replace function public.cleanup_expired_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  perform public.assert_authenticated();

  with deleted_rooms as (
    delete from public.rooms
    where updated_at < timezone('utc', now()) - interval '24 hours'
    returning id
  )
  select count(*)
  into v_deleted_count
  from deleted_rooms;

  return v_deleted_count;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_self public.room_players%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  select *
  into v_self
  from public.room_players
  where room_id = p_room_id
    and auth_user_id = auth.uid();

  if v_self.id is null then
    raise exception '你不在该房间中。';
  end if;

  if v_self.is_host then
    raise exception '房主需要解散房间。';
  end if;

  if v_room.status not in ('lobby', 'finished') then
    raise exception '游戏进行中不能离开房间。';
  end if;

  delete from public.room_players
  where id = v_self.id;
end;
$$;

create or replace function public.kick_player(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_target public.room_players%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以踢出玩家。';
  end if;

  if v_room.status <> 'lobby' or v_room.phase <> 'lobby' then
    raise exception '只有选座大厅阶段可以踢出玩家。';
  end if;

  select *
  into v_target
  from public.room_players
  where id = p_player_id
    and room_id = p_room_id;

  if v_target.id is null then
    raise exception '目标玩家不存在。';
  end if;

  if v_target.is_host then
    raise exception '不能踢出房主。';
  end if;

  if v_target.auth_user_id = auth.uid() then
    raise exception '不能踢出自己。';
  end if;

  delete from public.room_players
  where id = v_target.id;
end;
$$;

create or replace function public.disband_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以解散房间。';
  end if;

  if v_room.status not in ('lobby', 'finished') then
    raise exception '游戏进行中不能解散房间。';
  end if;

  delete from public.rooms
  where id = p_room_id;
end;
$$;

create or replace function public.update_room_lobby_settings(
  p_room_id uuid,
  p_seat_count integer,
  p_role_rotation_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_player_count integer;
  v_max_team_players integer;
begin
  perform public.assert_authenticated();

  if p_seat_count not in (4, 6, 8, 10, 12, 14) then
    raise exception '席位数必须为 4、6、8、10、12 或 14。';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以修改房间设置。';
  end if;

  if v_room.status <> 'lobby' or v_room.phase <> 'lobby' then
    raise exception '只有大厅阶段可以修改房间设置。';
  end if;

  select count(*)
  into v_player_count
  from public.room_players
  where room_id = p_room_id;

  if v_player_count > p_seat_count then
    raise exception '当前房间人数已超过目标席位数。';
  end if;

  select coalesce(max(team_count), 0)
  into v_max_team_players
  from (
    select count(*) as team_count
    from public.room_players
    where room_id = p_room_id
      and team in ('A', 'B')
    group by team
  ) teams;

  if v_max_team_players > public.room_team_capacity(p_seat_count) then
    raise exception '缩小席位失败：某队已超过新的队伍容量。';
  end if;

  if exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and team in ('A', 'B')
      and team_seat is not null
      and team_seat > public.room_team_capacity(p_seat_count)
  ) then
    raise exception '缩小席位失败：存在超出新队伍容量的已选座位。';
  end if;

  update public.rooms
  set seat_count = p_seat_count,
      role_rotation_enabled = p_role_rotation_enabled
  where id = p_room_id;
end;
$$;

drop function if exists public.update_self_seat(uuid, text, text);

create or replace function public.update_self_seat(p_room_id uuid, p_team text, p_team_seat integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_self_id uuid;
  v_team_capacity integer;
begin
  perform public.assert_authenticated();

  if (p_team is null) <> (p_team_seat is null) then
    raise exception '席位信息不完整。';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  if v_room.status <> 'lobby' then
    raise exception '游戏开始后不能换座位。';
  end if;

  v_team_capacity := public.room_team_capacity(v_room.seat_count);

  if p_team is not null then
    if p_team not in ('A', 'B') then
      raise exception '无效队伍。';
    end if;

    if p_team_seat is null or p_team_seat < 1 or p_team_seat > v_team_capacity then
      raise exception '无效座位。';
    end if;
  end if;

  select id
  into v_self_id
  from public.room_players
  where room_id = p_room_id
    and auth_user_id = auth.uid();

  if v_self_id is null then
    raise exception '你不在该房间中。';
  end if;

  if p_team is not null then
    if exists (
      select 1
      from public.room_players
      where room_id = p_room_id
        and team = p_team
        and team_seat = p_team_seat
        and id <> v_self_id
    ) then
      raise exception '该席位已被占用。';
    end if;
  end if;

  update public.room_players
  set team = p_team,
      team_seat = p_team_seat,
      role = case
        when p_team is null or p_team_seat is null then null
        else public.role_for_team_seat(p_team_seat)
      end
  where id = v_self_id;
end;
$$;

create or replace function public.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_round integer := 1;
  v_team_capacity integer;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以开始游戏。';
  end if;

  v_team_capacity := public.room_team_capacity(v_room.seat_count);

  if exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and team is null
  ) then
    raise exception '开始游戏前，所有已加入玩家都需要先入座。';
  end if;

  if v_room.seat_count = 4 then
    if (
      select count(*)
      from public.room_players
      where room_id = p_room_id
        and team in ('A', 'B')
        and team_seat is not null
    ) <> 4 then
      raise exception '4 人房需要正好 4 名已入座玩家。';
    end if;
  end if;

  if exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and team in ('A', 'B')
      and team_seat is not null
      and team_seat > v_team_capacity
  ) then
    raise exception '存在超出席位上限的已选座位。';
  end if;

  if exists (
    select 1
    from unnest(array['A', 'B']) as teams(team_code)
    where not exists (
      select 1
      from public.room_players
      where room_id = p_room_id
        and team = teams.team_code
        and team_seat = 1
    )
    or not exists (
      select 1
      from public.room_players
      where room_id = p_room_id
        and team = teams.team_code
        and team_seat = 2
    )
  ) then
    raise exception '开始游戏前，两队的加密/拦截者和解码者位置都必须有人。';
  end if;

  perform public.compress_room_team_seats(p_room_id);
  perform public.assign_room_roles(p_room_id, v_round);

  delete from public.round_submissions where room_id = p_room_id;
  delete from public.round_codes where room_id = p_room_id;
  delete from public.team_words where room_id = p_room_id;

  insert into public.team_words (room_id, team, words, confirmed)
  values
    (p_room_id, 'A', array['', '', '', ''], false),
    (p_room_id, 'B', array['', '', '', ''], false);

  update public.rooms
  set status = 'active',
      phase = 'word_assignment',
      round_number = v_round,
      winner = null,
      score_team_a_intercepts = 0,
      score_team_b_intercepts = 0,
      score_team_a_miscomms = 0,
      score_team_b_miscomms = 0,
      team_a_words_confirmed = false,
      team_b_words_confirmed = false
  where id = p_room_id;
end;
$$;

create or replace function public.generate_team_words(p_room_id uuid, p_team text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_words text[];
begin
  perform public.assert_authenticated();

  if p_team not in ('A', 'B') then
    raise exception '队伍无效。';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if v_room.phase <> 'word_assignment' then
    raise exception '当前不是词语分配阶段。';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = p_team
      and role = 'encoder'
  ) then
    raise exception '只有本队加密/拦截者可以生成词语。';
  end if;

  if exists (
    select 1
    from public.team_words
    where room_id = p_room_id
      and team = p_team
      and confirmed
  ) then
    raise exception '本队词语已确认，不能再修改。';
  end if;

  v_words := public.draw_words(4);

  update public.team_words
  set words = v_words
  where room_id = p_room_id
    and team = p_team;

  return v_words;
end;
$$;

create or replace function public.save_team_words(p_room_id uuid, p_team text, p_words text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_words text[];
begin
  perform public.assert_authenticated();

  if p_team not in ('A', 'B') then
    raise exception '队伍无效。';
  end if;

  v_words := public.normalize_team_words(p_words, false);

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if v_room.phase <> 'word_assignment' then
    raise exception '当前不是词语分配阶段。';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = p_team
      and role = 'encoder'
  ) then
    raise exception '只有本队加密/拦截者可以编辑词语。';
  end if;

  if exists (
    select 1
    from public.team_words
    where room_id = p_room_id
      and team = p_team
      and confirmed
  ) then
    raise exception '本队词语已确认，不能再修改。';
  end if;

  update public.team_words
  set words = v_words
  where room_id = p_room_id
    and team = p_team;
end;
$$;

create or replace function public.confirm_team_words(p_room_id uuid, p_team text, p_words text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_words text[];
  v_round integer;
  v_a_encoder uuid;
  v_b_encoder uuid;
begin
  perform public.assert_authenticated();

  if p_team not in ('A', 'B') then
    raise exception '队伍无效。';
  end if;

  v_words := public.normalize_team_words(p_words, true);

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if v_room.phase <> 'word_assignment' then
    raise exception '当前不是词语分配阶段。';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = p_team
      and role = 'encoder'
  ) then
    raise exception '只有本队加密/拦截者可以确认词语。';
  end if;

  if exists (
    select 1
    from public.team_words
    where room_id = p_room_id
      and team = p_team
      and confirmed
  ) then
    raise exception '本队词语已确认，不能再修改。';
  end if;

  update public.team_words
  set words = v_words,
      confirmed = true
  where room_id = p_room_id
    and team = p_team;

  update public.rooms
  set team_a_words_confirmed = case when p_team = 'A' then true else team_a_words_confirmed end,
      team_b_words_confirmed = case when p_team = 'B' then true else team_b_words_confirmed end
  where id = p_room_id;

  if exists (
    select 1
    from public.team_words
    where room_id = p_room_id
      and not confirmed
  ) then
    return;
  end if;

  v_round := greatest(v_room.round_number, 1);

  select id into v_a_encoder
  from public.room_players
  where room_id = p_room_id and team = 'A' and role = 'encoder';

  select id into v_b_encoder
  from public.room_players
  where room_id = p_room_id and team = 'B' and role = 'encoder';

  delete from public.round_submissions where room_id = p_room_id;
  delete from public.round_codes where room_id = p_room_id;

  insert into public.round_codes (room_id, team, round_number, encoder_player_id, code)
  values
    (p_room_id, 'A', v_round, v_a_encoder, public.generate_code_text()),
    (p_room_id, 'B', v_round, v_b_encoder, public.generate_code_text());

  insert into public.round_submissions (room_id, team, round_number)
  values
    (p_room_id, 'A', v_round),
    (p_room_id, 'B', v_round);

  update public.rooms
  set phase = 'encrypt',
      round_number = v_round
  where id = p_room_id;
end;
$$;

create or replace function public.submit_clues(p_room_id uuid, p_team text, p_clues text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.phase <> 'encrypt' then
    raise exception '当前不是出题阶段。';
  end if;

  if array_length(p_clues, 1) <> 3 then
    raise exception '必须提交 3 条线索。';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = p_team
      and role = 'encoder'
  ) then
    raise exception '只有本队出题者可提交线索。';
  end if;

  update public.round_submissions
  set clues = array(
    select trim(value)
    from unnest(p_clues) as value
  )
  where room_id = p_room_id
    and round_number = v_room.round_number
    and team = p_team;

  if exists (
    select 1
    from public.round_submissions
    where room_id = p_room_id
      and round_number = v_room.round_number
      and (clues is null or array_length(clues, 1) <> 3)
  ) then
    return;
  end if;

  update public.rooms
  set phase = 'decode'
  where id = p_room_id;
end;
$$;

create or replace function public._legacy_submit_intercept_guess(p_room_id uuid, p_target_team text, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_guess text := regexp_replace(p_guess, '[^1-4]', '-', 'g');
  v_attacker_team text;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.phase <> 'intercept' then
    raise exception '当前不是破译阶段。';
  end if;

  if p_target_team not in ('A', 'B') then
    raise exception '目标队伍无效。';
  end if;

  v_attacker_team := case when p_target_team = 'A' then 'B' else 'A' end;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = v_attacker_team
      and role = 'decoder'
  ) then
    raise exception '只有对方队伍的解码者可提交破译。';
  end if;

  update public.round_submissions
  set intercept_guess = p_guess
  where room_id = p_room_id
    and round_number = v_room.round_number
    and team = p_target_team;

  if exists (
    select 1
    from public.round_submissions
    where room_id = p_room_id
      and round_number = v_room.round_number
      and intercept_guess is null
  ) then
    return;
  end if;

  update public.rooms
  set phase = 'decode'
  where id = p_room_id;
end;
$$;

create or replace function public._legacy_submit_own_guess(p_room_id uuid, p_team text, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_a_code text;
  v_b_code text;
  v_a_intercept_correct boolean;
  v_b_intercept_correct boolean;
  v_a_own_correct boolean;
  v_b_own_correct boolean;
  v_next_a_intercepts integer;
  v_next_b_intercepts integer;
  v_next_a_miscomms integer;
  v_next_b_miscomms integer;
  v_winner text;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.phase <> 'decode' then
    raise exception '当前不是本队解码阶段。';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = p_team
      and role = 'decoder'
  ) then
    raise exception '只有本队解码者可提交本队答案。';
  end if;

  update public.round_submissions
  set own_guess = p_guess
  where room_id = p_room_id
    and round_number = v_room.round_number
    and team = p_team;

  if exists (
    select 1
    from public.round_submissions
    where room_id = p_room_id
      and round_number = v_room.round_number
      and own_guess is null
  ) then
    return;
  end if;

  select code into v_a_code
  from public.round_codes
  where room_id = p_room_id and round_number = v_room.round_number and team = 'A';

  select code into v_b_code
  from public.round_codes
  where room_id = p_room_id and round_number = v_room.round_number and team = 'B';

  select intercept_guess = v_a_code, own_guess = v_a_code
  into v_a_intercept_correct, v_a_own_correct
  from public.round_submissions
  where room_id = p_room_id and round_number = v_room.round_number and team = 'A';

  select intercept_guess = v_b_code, own_guess = v_b_code
  into v_b_intercept_correct, v_b_own_correct
  from public.round_submissions
  where room_id = p_room_id and round_number = v_room.round_number and team = 'B';

  update public.round_submissions
  set revealed_code = case when team = 'A' then v_a_code else v_b_code end,
      intercept_correct = case when team = 'A' then v_a_intercept_correct else v_b_intercept_correct end,
      own_correct = case when team = 'A' then v_a_own_correct else v_b_own_correct end,
      resolved_at = timezone('utc', now())
  where room_id = p_room_id
    and round_number = v_room.round_number;

  v_next_a_intercepts := v_room.score_team_a_intercepts + case when v_b_intercept_correct then 1 else 0 end;
  v_next_b_intercepts := v_room.score_team_b_intercepts + case when v_a_intercept_correct then 1 else 0 end;
  v_next_a_miscomms := v_room.score_team_a_miscomms + case when not v_a_own_correct then 1 else 0 end;
  v_next_b_miscomms := v_room.score_team_b_miscomms + case when not v_b_own_correct then 1 else 0 end;

  if v_next_a_intercepts >= 2 or v_next_b_miscomms >= 2 then
    v_winner := 'A';
  elsif v_next_b_intercepts >= 2 or v_next_a_miscomms >= 2 then
    v_winner := 'B';
  end if;

  update public.rooms
  set score_team_a_intercepts = v_next_a_intercepts,
      score_team_b_intercepts = v_next_b_intercepts,
      score_team_a_miscomms = v_next_a_miscomms,
      score_team_b_miscomms = v_next_b_miscomms,
      phase = case when v_winner is null then 'result' else 'finished' end,
      status = case when v_winner is null then 'active' else 'finished' end,
      winner = v_winner
  where id = p_room_id;
end;
$$;

create or replace function public._legacy_advance_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_next_round integer;
  v_a_encoder uuid;
  v_b_encoder uuid;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以推进回合。';
  end if;

  if v_room.phase <> 'result' then
    raise exception '当前不是结算阶段。';
  end if;

  if v_room.round_number >= v_room.max_rounds then
    update public.rooms
    set phase = 'finished',
        status = 'finished',
        winner = case
          when score_team_a_intercepts > score_team_b_intercepts then 'A'
          when score_team_b_intercepts > score_team_a_intercepts then 'B'
          else winner
        end
    where id = p_room_id;
    return;
  end if;

  v_next_round := v_room.round_number + 1;

  select id into v_a_encoder
  from public.room_players
  where room_id = p_room_id and team = 'A' and role = 'encoder';

  select id into v_b_encoder
  from public.room_players
  where room_id = p_room_id and team = 'B' and role = 'encoder';

  insert into public.round_codes (room_id, team, round_number, encoder_player_id, code)
  values
    (p_room_id, 'A', v_next_round, v_a_encoder, public.generate_code_text()),
    (p_room_id, 'B', v_next_round, v_b_encoder, public.generate_code_text());

  insert into public.round_submissions (room_id, team, round_number)
  values
    (p_room_id, 'A', v_next_round),
    (p_room_id, 'B', v_next_round);

  update public.rooms
  set phase = 'encrypt',
      status = 'active',
      round_number = v_next_round
  where id = p_room_id;
end;
$$;

create or replace function public.submit_own_guess(p_room_id uuid, p_team text, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.phase <> 'decode' then
    raise exception '当前不是解密阶段。';
  end if;

  if p_team not in ('A', 'B') then
    raise exception '队伍无效。';
  end if;

  if p_guess !~ '^[1-4]-[1-4]-[1-4]$' then
    raise exception '解密密码格式应为 1-2-3。';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = p_team
      and role = 'decoder'
  ) then
    raise exception '只有本队解码者可以提交解密答案。';
  end if;

  update public.round_submissions
  set own_guess = p_guess
  where room_id = p_room_id
    and round_number = v_room.round_number
    and team = p_team;

  if exists (
    select 1
    from public.round_submissions
    where room_id = p_room_id
      and round_number = v_room.round_number
      and own_guess is null
  ) then
    return;
  end if;

  update public.rooms
  set phase = 'intercept'
  where id = p_room_id;
end;
$$;

create or replace function public.submit_intercept_guess(p_room_id uuid, p_target_team text, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_attacker_team text;
  v_a_code text;
  v_b_code text;
  v_a_intercept_correct boolean;
  v_b_intercept_correct boolean;
  v_a_own_correct boolean;
  v_b_own_correct boolean;
  v_next_a_intercepts integer;
  v_next_b_intercepts integer;
  v_next_a_miscomms integer;
  v_next_b_miscomms integer;
  v_a_win_condition boolean;
  v_b_win_condition boolean;
  v_a_score integer;
  v_b_score integer;
  v_game_finished boolean := false;
  v_winner text;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.phase <> 'intercept' then
    raise exception '当前不是拦截阶段。';
  end if;

  if p_target_team not in ('A', 'B') then
    raise exception '目标队伍无效。';
  end if;

  if p_guess !~ '^[1-4]-[1-4]-[1-4]$' then
    raise exception '拦截密码格式应为 1-2-3。';
  end if;

  v_attacker_team := case when p_target_team = 'A' then 'B' else 'A' end;

  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and auth_user_id = auth.uid()
      and team = v_attacker_team
      and role = 'encoder'
  ) then
    raise exception '只有本队加密/拦截者可以提交拦截。';
  end if;

  update public.round_submissions
  set intercept_guess = p_guess
  where room_id = p_room_id
    and round_number = v_room.round_number
    and team = p_target_team;

  if exists (
    select 1
    from public.round_submissions
    where room_id = p_room_id
      and round_number = v_room.round_number
      and intercept_guess is null
  ) then
    return;
  end if;

  select code into v_a_code
  from public.round_codes
  where room_id = p_room_id and round_number = v_room.round_number and team = 'A';

  select code into v_b_code
  from public.round_codes
  where room_id = p_room_id and round_number = v_room.round_number and team = 'B';

  select intercept_guess = v_a_code, own_guess = v_a_code
  into v_a_intercept_correct, v_a_own_correct
  from public.round_submissions
  where room_id = p_room_id and round_number = v_room.round_number and team = 'A';

  select intercept_guess = v_b_code, own_guess = v_b_code
  into v_b_intercept_correct, v_b_own_correct
  from public.round_submissions
  where room_id = p_room_id and round_number = v_room.round_number and team = 'B';

  update public.round_submissions
  set revealed_code = case when team = 'A' then v_a_code else v_b_code end,
      intercept_correct = case when team = 'A' then v_a_intercept_correct else v_b_intercept_correct end,
      own_correct = case when team = 'A' then v_a_own_correct else v_b_own_correct end,
      resolved_at = timezone('utc', now())
  where room_id = p_room_id
    and round_number = v_room.round_number;

  v_next_a_intercepts := v_room.score_team_a_intercepts + case when v_b_intercept_correct then 1 else 0 end;
  v_next_b_intercepts := v_room.score_team_b_intercepts + case when v_a_intercept_correct then 1 else 0 end;
  v_next_a_miscomms := v_room.score_team_a_miscomms + case when not v_a_own_correct then 1 else 0 end;
  v_next_b_miscomms := v_room.score_team_b_miscomms + case when not v_b_own_correct then 1 else 0 end;

  v_a_win_condition := v_next_a_intercepts >= 2 or v_next_b_miscomms >= 2;
  v_b_win_condition := v_next_b_intercepts >= 2 or v_next_a_miscomms >= 2;
  v_game_finished := v_a_win_condition or v_b_win_condition;

  if v_a_win_condition and v_b_win_condition then
    v_a_score := v_next_a_intercepts - v_next_a_miscomms;
    v_b_score := v_next_b_intercepts - v_next_b_miscomms;

    if v_a_score > v_b_score then
      v_winner := 'A';
    elsif v_b_score > v_a_score then
      v_winner := 'B';
    else
      v_winner := null;
    end if;
  elsif v_a_win_condition then
    v_winner := 'A';
  elsif v_b_win_condition then
    v_winner := 'B';
  end if;

  update public.rooms
  set score_team_a_intercepts = v_next_a_intercepts,
      score_team_b_intercepts = v_next_b_intercepts,
      score_team_a_miscomms = v_next_a_miscomms,
      score_team_b_miscomms = v_next_b_miscomms,
      phase = case when v_game_finished then 'finished' else 'result' end,
      status = case when v_game_finished then 'finished' else 'active' end,
      winner = v_winner
  where id = p_room_id;
end;
$$;

create or replace function public.skip_first_intercept(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_a_code text;
  v_b_code text;
  v_a_own_correct boolean;
  v_b_own_correct boolean;
  v_next_a_miscomms integer;
  v_next_b_miscomms integer;
  v_a_win_condition boolean;
  v_b_win_condition boolean;
  v_a_score integer;
  v_b_score integer;
  v_game_finished boolean := false;
  v_winner text;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以跳过第一轮拦截。';
  end if;

  if v_room.phase <> 'intercept' then
    raise exception '当前不是拦截阶段。';
  end if;

  if v_room.round_number <> 1 then
    raise exception '只能跳过第一轮的拦截阶段。';
  end if;

  select code into v_a_code
  from public.round_codes
  where room_id = p_room_id and round_number = v_room.round_number and team = 'A';

  select code into v_b_code
  from public.round_codes
  where room_id = p_room_id and round_number = v_room.round_number and team = 'B';

  select own_guess = v_a_code
  into v_a_own_correct
  from public.round_submissions
  where room_id = p_room_id and round_number = v_room.round_number and team = 'A';

  select own_guess = v_b_code
  into v_b_own_correct
  from public.round_submissions
  where room_id = p_room_id and round_number = v_room.round_number and team = 'B';

  update public.round_submissions
  set revealed_code = case when team = 'A' then v_a_code else v_b_code end,
      intercept_correct = false,
      own_correct = case when team = 'A' then v_a_own_correct else v_b_own_correct end,
      resolved_at = timezone('utc', now())
  where room_id = p_room_id
    and round_number = v_room.round_number;

  v_next_a_miscomms := v_room.score_team_a_miscomms + case when not v_a_own_correct then 1 else 0 end;
  v_next_b_miscomms := v_room.score_team_b_miscomms + case when not v_b_own_correct then 1 else 0 end;

  v_a_win_condition := v_room.score_team_a_intercepts >= 2 or v_next_b_miscomms >= 2;
  v_b_win_condition := v_room.score_team_b_intercepts >= 2 or v_next_a_miscomms >= 2;
  v_game_finished := v_a_win_condition or v_b_win_condition;

  if v_a_win_condition and v_b_win_condition then
    v_a_score := v_room.score_team_a_intercepts - v_next_a_miscomms;
    v_b_score := v_room.score_team_b_intercepts - v_next_b_miscomms;

    if v_a_score > v_b_score then
      v_winner := 'A';
    elsif v_b_score > v_a_score then
      v_winner := 'B';
    else
      v_winner := null;
    end if;
  elsif v_a_win_condition then
    v_winner := 'A';
  elsif v_b_win_condition then
    v_winner := 'B';
  end if;

  update public.rooms
  set score_team_a_miscomms = v_next_a_miscomms,
      score_team_b_miscomms = v_next_b_miscomms,
      phase = case when v_game_finished then 'finished' else 'result' end,
      status = case when v_game_finished then 'finished' else 'active' end,
      winner = v_winner
  where id = p_room_id;
end;
$$;

create or replace function public.advance_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_next_round integer;
  v_a_encoder uuid;
  v_b_encoder uuid;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以推进回合。';
  end if;

  if v_room.phase <> 'result' then
    raise exception '当前不是结算阶段。';
  end if;

  v_next_round := v_room.round_number + 1;

  perform public.assign_room_roles(p_room_id, v_next_round);

  select id into v_a_encoder
  from public.room_players
  where room_id = p_room_id and team = 'A' and role = 'encoder';

  select id into v_b_encoder
  from public.room_players
  where room_id = p_room_id and team = 'B' and role = 'encoder';

  insert into public.round_codes (room_id, team, round_number, encoder_player_id, code)
  values
    (p_room_id, 'A', v_next_round, v_a_encoder, public.generate_code_text()),
    (p_room_id, 'B', v_next_round, v_b_encoder, public.generate_code_text());

  insert into public.round_submissions (room_id, team, round_number)
  values
    (p_room_id, 'A', v_next_round),
    (p_room_id, 'B', v_next_round);

  update public.rooms
  set phase = 'encrypt',
      status = 'active',
      round_number = v_next_round
  where id = p_room_id;
end;
$$;

create or replace function public.restart_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.id is null then
    raise exception '房间不存在。';
  end if;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以重新开始。';
  end if;

  if v_room.status <> 'finished' or v_room.phase <> 'finished' then
    raise exception '只有游戏结束后可以重新开始。';
  end if;

  delete from public.round_submissions where room_id = p_room_id;
  delete from public.round_codes where room_id = p_room_id;
  delete from public.team_words where room_id = p_room_id;

  update public.room_players
  set team = null,
      role = null,
      team_seat = null,
      connected = true
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby',
      phase = 'lobby',
      round_number = 0,
      winner = null,
      score_team_a_intercepts = 0,
      score_team_b_intercepts = 0,
      score_team_a_miscomms = 0,
      score_team_b_miscomms = 0,
      team_a_words_confirmed = false,
      team_b_words_confirmed = false
  where id = p_room_id;
end;
$$;

create or replace function public.terminate_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.id is null then
    raise exception 'Room not found.';
  end if;

  if v_room.host_user_id <> auth.uid() then
    raise exception 'Only the host can terminate the game.';
  end if;

  if v_room.status <> 'active' or v_room.phase = 'lobby' then
    raise exception 'Only an active game can be terminated.';
  end if;

  delete from public.round_submissions where room_id = p_room_id;
  delete from public.round_codes where room_id = p_room_id;
  delete from public.team_words where room_id = p_room_id;

  update public.room_players
  set team = null,
      role = null,
      team_seat = null,
      connected = true
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby',
      phase = 'lobby',
      round_number = 0,
      winner = null,
      score_team_a_intercepts = 0,
      score_team_b_intercepts = 0,
      score_team_a_miscomms = 0,
      score_team_b_miscomms = 0,
      team_a_words_confirmed = false,
      team_b_words_confirmed = false
  where id = p_room_id;
end;
$$;

grant usage on schema public to authenticated;
grant select on public.rooms, public.room_players, public.team_words, public.round_codes, public.round_submissions to authenticated;
grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.cleanup_expired_rooms() to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.kick_player(uuid, uuid) to authenticated;
grant execute on function public.disband_room(uuid) to authenticated;
grant execute on function public.update_room_lobby_settings(uuid, integer, boolean) to authenticated;
grant execute on function public.update_self_seat(uuid, text, integer) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.generate_team_words(uuid, text) to authenticated;
grant execute on function public.save_team_words(uuid, text, text[]) to authenticated;
grant execute on function public.confirm_team_words(uuid, text, text[]) to authenticated;
grant execute on function public.submit_clues(uuid, text, text[]) to authenticated;
grant execute on function public.submit_intercept_guess(uuid, text, text) to authenticated;
grant execute on function public.skip_first_intercept(uuid) to authenticated;
grant execute on function public.submit_own_guess(uuid, text, text) to authenticated;
grant execute on function public.advance_round(uuid) to authenticated;
grant execute on function public.restart_room(uuid) to authenticated;
grant execute on function public.terminate_game(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.room_players;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.team_words;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.round_codes;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.round_submissions;
exception
  when duplicate_object then null;
end;
$$;
