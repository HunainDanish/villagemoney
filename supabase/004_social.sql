-- Porchlight migration 004: friends, rivals, moving in together, gifts,
-- raid reports. Run once in Supabase -> SQL Editor (after 001-003).
-- Safe to re-run.

-- Moving in together: a resident who moved in points at the host's house.
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
