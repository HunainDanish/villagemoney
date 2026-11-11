-- Porchlight migration 005: the two villas in the middle of town.
-- Run once in Supabase -> SQL Editor (after 001-004). Safe to re-run.
-- Until it runs, the villas simply stay at level 1.

create table if not exists villas (
  id     int primary key check (id in (0, 1)),
  bricks int not null default 0
);
insert into villas (id) values (0), (1) on conflict do nothing;

-- Add bricks atomically (many people can build at once).
create or replace function villa_add(p_villa int, p_n int)
returns int language sql as $$
  update villas set bricks = bricks + greatest(0, least(p_n, 60)) where id = p_villa returning bricks;
$$;

alter table villas enable row level security; -- only the server (service key) reads/writes
