create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_user_id uuid not null,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  phase text not null default 'lobby' check (phase in ('lobby', 'clue', 'intercept', 'decode', 'result', 'finished')),
  round_number integer not null default 0,
  max_rounds integer not null default 8,
  winner text null check (winner in ('A', 'B')),
  score_team_a_intercepts integer not null default 0,
  score_team_b_intercepts integer not null default 0,
  score_team_a_miscomms integer not null default 0,
  score_team_b_miscomms integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  auth_user_id uuid not null,
  player_name text not null,
  team text null check (team in ('A', 'B')),
  role text null check (role in ('encoder', 'decoder')),
  is_host boolean not null default false,
  connected boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  unique (room_id, auth_user_id),
  unique (room_id, team, role)
);

create table if not exists public.team_words (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  words text[] not null check (array_length(words, 1) = 4),
  created_at timestamptz not null default timezone('utc', now()),
  unique (room_id, team)
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

create or replace function public.generate_code_text()
returns text
language sql
security definer
set search_path = public
as $$
  select string_agg(number::text, '-' order by sort_key)
  from (
    select number, row_number() over () as sort_key
    from (
      select unnest(array[1, 2, 3, 4]) as number
      order by random()
      limit 3
    ) shuffled
  ) ordered_numbers;
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

  select count(*)
  into v_existing_player_count
  from public.room_players as rp
  where rp.room_id = v_room.id;

  if v_existing_player_count >= 4
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

create or replace function public.update_self_seat(p_room_id uuid, p_team text, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_self_id uuid;
begin
  perform public.assert_authenticated();

  if p_team not in ('A', 'B') or p_role not in ('encoder', 'decoder') then
    raise exception '无效席位。';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.status <> 'lobby' then
    raise exception '游戏开始后不能换座位。';
  end if;

  select id
  into v_self_id
  from public.room_players
  where room_id = p_room_id
    and auth_user_id = auth.uid();

  if v_self_id is null then
    raise exception '你不在该房间中。';
  end if;

  if exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and team = p_team
      and role = p_role
      and id <> v_self_id
  ) then
    raise exception '该席位已被占用。';
  end if;

  update public.room_players
  set team = p_team,
      role = p_role
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
  v_player_count integer;
  v_a_encoder uuid;
  v_b_encoder uuid;
  v_round integer := 1;
begin
  perform public.assert_authenticated();

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if v_room.host_user_id <> auth.uid() then
    raise exception '只有房主可以开始游戏。';
  end if;

  select count(*)
  into v_player_count
  from public.room_players
  where room_id = p_room_id
    and team is not null
    and role is not null;

  if v_player_count <> 4 then
    raise exception '需要 4 名玩家且席位完整。';
  end if;

  if exists (
    select 1
    from (
      select team, role, count(*) as seat_count
      from public.room_players
      where room_id = p_room_id
      group by team, role
    ) seats
    where seat_count <> 1
  ) then
    raise exception '队伍或角色分配不完整。';
  end if;

  insert into public.team_words (room_id, team, words)
  values
    (p_room_id, 'A', public.draw_words(4)),
    (p_room_id, 'B', public.draw_words(4))
  on conflict (room_id, team)
  do update set words = excluded.words;

  select id into v_a_encoder
  from public.room_players
  where room_id = p_room_id and team = 'A' and role = 'encoder';

  select id into v_b_encoder
  from public.room_players
  where room_id = p_room_id and team = 'B' and role = 'encoder';

  delete from public.round_codes where room_id = p_room_id;
  delete from public.round_submissions where room_id = p_room_id;

  insert into public.round_codes (room_id, team, round_number, encoder_player_id, code)
  values
    (p_room_id, 'A', v_round, v_a_encoder, public.generate_code_text()),
    (p_room_id, 'B', v_round, v_b_encoder, public.generate_code_text());

  insert into public.round_submissions (room_id, team, round_number)
  values
    (p_room_id, 'A', v_round),
    (p_room_id, 'B', v_round);

  update public.rooms
  set status = 'active',
      phase = 'clue',
      round_number = v_round,
      winner = null,
      score_team_a_intercepts = 0,
      score_team_b_intercepts = 0,
      score_team_a_miscomms = 0,
      score_team_b_miscomms = 0
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

  if v_room.phase <> 'clue' then
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

create or replace function public.submit_own_guess(p_room_id uuid, p_team text, p_guess text)
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
  set phase = 'clue',
      status = 'active',
      round_number = v_next_round
  where id = p_room_id;
end;
$$;

grant usage on schema public to authenticated;
grant select on public.rooms, public.room_players, public.team_words, public.round_codes, public.round_submissions to authenticated;
grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.update_self_seat(uuid, text, text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.submit_clues(uuid, text, text[]) to authenticated;
grant execute on function public.submit_intercept_guess(uuid, text, text) to authenticated;
grant execute on function public.submit_own_guess(uuid, text, text) to authenticated;
grant execute on function public.advance_round(uuid) to authenticated;

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
