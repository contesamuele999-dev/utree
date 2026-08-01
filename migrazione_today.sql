-- ============================================================
-- Arbora — migrazione sezione TODAY
-- Esegui questo nello SQL Editor di Supabase (una volta sola).
-- Ordine obbligatorio: ricorrenza -> task -> giorno (FK).
-- Idempotente: si puo' rieseguire senza danni.
-- ============================================================

-- ------------------------------------------------------------
-- 0) ARCHIVIAZIONE VISIONI
-- Serve alle "Proposte" di Today: le righe scadute di una visione
-- archiviata non vengono piu' proposte. Archiviare non nasconde e
-- non cancella nulla: toglie solo rumore.
-- ------------------------------------------------------------
alter table public.visioni
  add column if not exists archiviata boolean not null default false;

-- ------------------------------------------------------------
-- 1) RICORRENZA — le regole delle task ricorrenti.
-- Le regole NON sono task: generano istanze reali nella tabella
-- `task`, una per giorno di occorrenza. Cosi' modificare una regola
-- non riscrive lo storico all'indietro.
--   tipo = 'giornaliera'  -> ogni giorno
--   tipo = 'settimanale'  -> giorni = [0..6], 0 = domenica
--   tipo = 'mensile'      -> giorni = [1..31]; se il mese e' piu' corto
--                            l'occorrenza cade sull'ultimo giorno del mese
--   tipo = 'intervallo'   -> ogni N giorni a partire da `dal`
-- ------------------------------------------------------------
create table if not exists public.ricorrenza (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null default '',
  tipo        text not null default 'giornaliera',
  giorni      int[],                      -- settimanale: 0=dom..6=sab · mensile: 1..31
  ogni        int  not null default 1,    -- solo per tipo 'intervallo'
  dal         date not null default current_date,
  al          date,                       -- null = senza fine
  attiva      boolean not null default true,
  vista_id    uuid references public.viste(id) on delete set null,  -- origine opzionale
  blocco_id   text,
  ordine      int  not null default 0,
  ultima_gen  date,                       -- ultimo giorno per cui sono state generate le istanze
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ricorrenza_tipo_chk
    check (tipo in ('giornaliera', 'settimanale', 'mensile', 'intervallo')),
  constraint ricorrenza_ogni_chk check (ogni >= 1)
);

create index if not exists ricorrenza_user_idx on public.ricorrenza(user_id, attiva);

alter table public.ricorrenza enable row level security;
drop policy if exists "ricorrenza own" on public.ricorrenza;
create policy "ricorrenza own" on public.ricorrenza for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2) TASK — le task di una giornata.
-- Quattro origini: manuale, teletrasporto da una riga di vista,
-- proposta accettata, istanza di una ricorrenza.
-- Le task COMPLETATE restano attaccate al loro giorno: lo storico
-- deve dire la verita'. Solo quelle aperte fanno rollover.
-- ------------------------------------------------------------
create table if not exists public.task (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  giorno        date not null,
  text          text not null default '',
  done          boolean not null default false,
  done_at       timestamptz,               -- quando e' stata spuntata (istogramma orario)
  ordine        int  not null default 0,
  -- origine da una riga di vista (teletrasporto / proposta)
  vista_id      uuid references public.viste(id) on delete set null,
  blocco_id     text,
  -- catena di rinvii
  origin_giorno date,                      -- primo giorno in cui e' comparsa
  rollover      int  not null default 0,   -- quante volte e' stata rimandata
  -- origine da regola ricorrente
  ricorrenza_id uuid references public.ricorrenza(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- tre stati invece di due: da fare -> a meta' (parziale) -> fatta.
-- Una task parziale non e' chiusa: fa rollover come una aperta, ma nella
-- barra di Today vale mezzo passo.
alter table public.task
  add column if not exists parziale boolean not null default false;

-- Nidificazione: come nelle righe delle viste, l'albero e' dato dall'ordine
-- piu' un livello di rientro. 0 = task di primo livello.
alter table public.task
  add column if not exists indent int not null default 0;

create index if not exists task_user_giorno_idx on public.task(user_id, giorno);
create index if not exists task_user_done_idx   on public.task(user_id, done, giorno);
create index if not exists task_vista_idx       on public.task(vista_id);

-- Una sola istanza per regola per giorno: rende la generazione idempotente
-- anche se due dispositivi aprono Today lo stesso giorno.
create unique index if not exists task_ric_giorno_uidx
  on public.task(ricorrenza_id, giorno)
  where ricorrenza_id is not null;

alter table public.task enable row level security;
drop policy if exists "task own" on public.task;
create policy "task own" on public.task for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3) GIORNO — il rito serale, una riga per data.
-- vittoria + mood + nota. `chiuso_at` null = giornata non chiusa.
-- ------------------------------------------------------------
create table if not exists public.giorno (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  giorno      date not null,
  vittoria    text,
  mood        int,                          -- 1..5, null = non compilato
  nota        text,
  chiuso_at   timestamptz,
  ordine      int  not null default 0,      -- non usato, presente per uniformita' con store.list
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint giorno_mood_chk check (mood is null or (mood >= 1 and mood <= 5)),
  constraint giorno_unico unique (user_id, giorno)
);

create index if not exists giorno_user_idx on public.giorno(user_id, giorno);

alter table public.giorno enable row level security;
drop policy if exists "giorno own" on public.giorno;
create policy "giorno own" on public.giorno for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4) updated_at automatico (se il trigger generico esiste gia'
--    nello schema, questa parte e' ridondante ma innocua).
-- ------------------------------------------------------------
create or replace function public.tocca_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists task_touch on public.task;
create trigger task_touch before update on public.task
  for each row execute function public.tocca_updated_at();

drop trigger if exists ricorrenza_touch on public.ricorrenza;
create trigger ricorrenza_touch before update on public.ricorrenza
  for each row execute function public.tocca_updated_at();

drop trigger if exists giorno_touch on public.giorno;
create trigger giorno_touch before update on public.giorno
  for each row execute function public.tocca_updated_at();
