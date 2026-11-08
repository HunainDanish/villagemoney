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
