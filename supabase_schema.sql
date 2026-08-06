-- ============================================================
-- UTREE - Schema database Supabase
-- Esegui questo nello SQL Editor di Supabase (Dashboard -> SQL).
-- Modello: vite (universi) > visioni (mondi) > viste (fogli/note)
-- Ogni utente vede SOLO i propri dati (Row Level Security).
-- ============================================================

-- Estensione per UUID
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------
-- VITE  (il livello piu' alto: insiemi di visioni)
-- ----------------------------------------------------------
create table if not exists public.vite (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  titolo      text not null default 'Nuova vita',
  colore      text default '#1f7a4d',
  ordine      int  default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ----------------------------------------------------------
-- VISIONI  (mondi/progetti dentro una vita)
-- ----------------------------------------------------------
create table if not exists public.visioni (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  vita_id     uuid not null references public.vite(id) on delete cascade,
  titolo      text not null default 'Nuova visione',
  colore      text default '#2e9e63',
  ordine      int  default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ----------------------------------------------------------
-- VISTE  (le note / fogli singoli, i "pianeti")
-- contenuto: array JSON di blocchi (ogni blocco = riga/sezione markdown)
-- livello: profondita' nella gerarchia hyperlink (calcolato lato app)
-- ----------------------------------------------------------
create table if not exists public.viste (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  visione_id  uuid not null references public.visioni(id) on delete cascade,
  titolo      text not null default 'Nuova vista',
  blocchi     jsonb default '[]'::jsonb,
  is_template boolean default false,
  livello     int default 0,
  ordine      int  default 0,
  parent_id   uuid references public.viste(id) on delete set null,
  stage       text default 'idee',   -- fase kanban (bacheca Progress)
  cestino     jsonb default '[]'::jsonb,   -- righe eliminate, recuperabili 7 giorni
  pos_x       float default 0,   -- posizione nella mappa 2.5D
  pos_y       float default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ----------------------------------------------------------
-- LINK  (hyperlink tra viste; definiscono la gerarchia)
-- tipo: 'maggiore' = ramo principale (albero), 'minore' = collegamento secondario
-- ----------------------------------------------------------
create table if not exists public.links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  da_vista    uuid not null references public.viste(id) on delete cascade,
  a_vista     uuid not null references public.viste(id) on delete cascade,
  tipo        text default 'maggiore',
  created_at  timestamptz default now(),
  unique (da_vista, a_vista)
);

-- Indici utili
create index if not exists idx_visioni_vita on public.visioni(vita_id);
create index if not exists idx_viste_visione on public.viste(visione_id);
create index if not exists idx_links_da on public.links(da_vista);
create index if not exists idx_links_a  on public.links(a_vista);

-- ----------------------------------------------------------
-- TRIGGER updated_at
-- ----------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_vite_touch on public.vite;
create trigger trg_vite_touch before update on public.vite
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_visioni_touch on public.visioni;
create trigger trg_visioni_touch before update on public.visioni
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_viste_touch on public.viste;
create trigger trg_viste_touch before update on public.viste
  for each row execute function public.touch_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY  - ogni utente accede solo ai propri dati
-- ============================================================
alter table public.vite    enable row level security;
alter table public.visioni enable row level security;
alter table public.viste   enable row level security;
alter table public.links   enable row level security;

-- Policy generiche: l'utente puo' fare tutto solo sulle righe con user_id = auth.uid()
do $$
declare t text;
begin
  foreach t in array array['vite','visioni','viste','links'] loop
    execute format('drop policy if exists "own_select" on public.%I;', t);
    execute format('drop policy if exists "own_insert" on public.%I;', t);
    execute format('drop policy if exists "own_update" on public.%I;', t);
    execute format('drop policy if exists "own_delete" on public.%I;', t);

    execute format('create policy "own_select" on public.%I for select using (auth.uid() = user_id);', t);
    execute format('create policy "own_insert" on public.%I for insert with check (auth.uid() = user_id);', t);
    execute format('create policy "own_update" on public.%I for update using (auth.uid() = user_id);', t);
    execute format('create policy "own_delete" on public.%I for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- ============================================================
-- (Opzionale) Realtime: abilita la sincronizzazione live
-- Dashboard -> Database -> Replication -> abilita le tabelle,
-- oppure esegui:
-- alter publication supabase_realtime add table public.vite, public.visioni, public.viste, public.links;
-- ============================================================
