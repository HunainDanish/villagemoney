-- Porchlight migration 003: optional password sign-in.
-- Run once in Supabase -> SQL Editor (after schema.sql and 002_game.sql).
-- Safe to re-run.

-- Only a salted scrypt hash is stored, never the password itself.
alter table residents add column if not exists password_hash text;

-- Wrong-password protection: after 5 misses the account is locked for
-- 15 minutes (a house key from a DM still works during a lock).
alter table residents add column if not exists failed_logins smallint not null default 0;
alter table residents add column if not exists locked_until timestamptz;
