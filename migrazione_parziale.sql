-- ============================================================
-- uTree — task "a metà" (Today)
-- Esegui questo nello SQL Editor di Supabase (una volta sola).
-- Idempotente: si puo' rieseguire senza danni.
--
-- Tre stati invece di due: da fare -> a meta' -> fatta.
-- Una task `parziale` NON e' chiusa: fa rollover al giorno dopo
-- come una task aperta, ma nella barra di Today vale mezzo passo.
-- ============================================================

alter table public.task
  add column if not exists parziale boolean not null default false;
