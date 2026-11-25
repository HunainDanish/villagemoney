-- Porchlight migration 006: visitor log and the stored Instagram token.
-- Run once in Supabase -> SQL Editor (after 001-005). Safe to re-run.

-- One row per visitor per house per day: knocking twice in a day counts once.
create table if not exists visits (
  house_id   bigint not null references residents(id) on delete cascade,
  visitor_id bigint not null references residents(id) on delete cascade,
  day        date   not null default current_date,
  primary key (house_id, visitor_id, day),
  check (house_id <> visitor_id)
);
create index if not exists visits_house_idx on visits(house_id, day desc);
alter table visits enable row level security;

-- Instagram long-lived tokens expire after 60 days; the weekly cron
-- (/api/admin/refresh) swaps in a fresh one here.
create table if not exists app_tokens (
  name       text primary key,
  value      text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table app_tokens enable row level security;
