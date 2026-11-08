-- Porchlight migration 002: game progress (woodcutting, foraging, fishing,
-- crafting, yard decor, quests, streaks, porch lights).
-- Run this once in Supabase -> SQL Editor AFTER schema.sql. Safe to re-run.

-- Last day the resident visited: their porch light shines that night.
alter table residents add column if not exists last_active date;

-- One row per resident. `state` is the game state managed by shared/game.js
-- (inventory, coins, xp, cooldowns, quests, streak, decor, paint).
-- `updated_at` is used for compare-and-swap so two tabs can't double-apply.
create table if not exists progress (
  resident_id bigint primary key references residents(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table progress enable row level security;
