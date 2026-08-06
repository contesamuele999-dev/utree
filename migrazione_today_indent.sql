-- ============================================================
-- uTree — nidificazione delle task di Today
-- Esegui nello SQL Editor di Supabase. Idempotente.
-- (E' gia' incluso in migrazione_today.sql: questo file serve
--  a chi quella migrazione l'aveva gia' eseguita.)
-- ============================================================

alter table public.task
  add column if not exists indent int not null default 0;
