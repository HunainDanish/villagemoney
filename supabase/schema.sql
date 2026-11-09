-- Porchlight database schema (Supabase / PostgreSQL).
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.

create extension if not exists citext;

-- One row per resident. The id IS the house number and decides where the
-- house stands (see shared/layout.js), so the town needs no layout table.
create table if not exists residents (
  id          bigint generated always as identity primary key,
  username    citext not null unique,
  ig_user_id  text unique,                      -- filled by the Instagram webhook
  hidden      boolean not null default false,   -- "Hide my username"
  source      text not null default 'admin',    -- admin | dm | comment
  look        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Single-use sign-in links ("house keys"). Only a SHA-256 hash is stored.
create table if not exists house_keys (
  token_hash  text primary key,
  resident_id bigint not null references residents(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists house_keys_resident_idx on house_keys(resident_id);

-- Sign-in sessions (cookie). Only a SHA-256 hash of the token is stored.
create table if not exists sessions (
  token_hash   text primary key,
  resident_id  bigint not null references residents(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists sessions_resident_idx on sessions(resident_id);

-- Lock everything down: with RLS on and no policies, the public "anon" key
-- can read nothing. Only the server (service-role key) touches these tables.
alter table residents  enable row level security;
alter table house_keys enable row level security;
alter table sessions   enable row level security;

-- Get or create a resident without burning house numbers on duplicates
-- (a plain INSERT ... ON CONFLICT would skip ids and leave empty plots).
create or replace function get_or_create_resident(p_username text, p_source text, p_ig_user_id text default null)
returns residents
language plpgsql
security definer
set search_path = public
as $$
declare r residents;
begin
  select * into r from residents where username = p_username;
  if found then
    if p_ig_user_id is not null and r.ig_user_id is null then
      update residents set ig_user_id = p_ig_user_id where id = r.id returning * into r;
    end if;
    return r;
  end if;
  begin
    insert into residents (username, source, ig_user_id)
    values (p_username, p_source, p_ig_user_id)
    returning * into r;
  exception when unique_violation then
    select * into r from residents where username = p_username;
  end;
  return r;
end;
$$;

revoke all on function get_or_create_resident(text, text, text) from public, anon, authenticated;

-- Housekeeping: run occasionally (or schedule with pg_cron) to drop expired rows.
create or replace function cleanup_expired()
returns void language sql security definer set search_path = public as $$
  delete from house_keys where expires_at < now() or used_at < now() - interval '1 day';
  delete from sessions   where expires_at < now();
$$;
revoke all on function cleanup_expired() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Game progress (same as 002_game.sql; included so fresh installs need one file)
alter table residents add column if not exists last_active date;
create table if not exists progress (
  resident_id bigint primary key references residents(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table progress enable row level security;

-- ---------------------------------------------------------------------------
-- Optional password sign-in (same as 003_passwords.sql)
alter table residents add column if not exists password_hash text;
alter table residents add column if not exists failed_logins smallint not null default 0;
alter table residents add column if not exists locked_until timestamptz;

-- ---------------------------------------------------------------------------
-- Social (same as 004_social.sql)
alter table residents add column if not exists home_id bigint references residents(id) on delete set null;
create index if not exists residents_home_idx on residents(home_id) where home_id is not null;

-- Relationships between two residents.
--   friend / housemate: one row per pair, stored with a < b, plus who asked.
--   rival: one-sided, a = the person who marked b as a rival.
-- hearts = neighbour reputation between friends (grows with gifts).
create table if not exists relations (
  a            bigint not null references residents(id) on delete cascade,
  b            bigint not null references residents(id) on delete cascade,
  kind         text   not null check (kind in ('friend', 'rival', 'housemate')),
  status       text   not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by bigint references residents(id) on delete cascade,
  hearts       int    not null default 0,
  heart_day    date,
  created_at   timestamptz not null default now(),
  primary key (a, b, kind),
  check (a <> b)
);
create index if not exists relations_b_idx on relations(b);

-- Inbox: friend / move-in requests, gifts (with items), raid reports.
create table if not exists inbox (
  id         bigint generated always as identity primary key,
  to_id      bigint not null references residents(id) on delete cascade,
  from_id    bigint references residents(id) on delete set null,
  kind       text   not null,
  payload    jsonb  not null default '{}'::jsonb,
  claimed    boolean not null default false, -- gifts: delivered into progress
  seen_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists inbox_to_idx on inbox(to_id, created_at desc);

alter table relations enable row level security;
alter table inbox enable row level security;
