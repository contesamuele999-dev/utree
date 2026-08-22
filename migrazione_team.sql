-- ============================================================
-- uTree — migrazione TEAM e PROGETTI CONDIVISI
-- Esegui questo nello SQL Editor di Supabase (una volta sola).
-- Idempotente: si puo' rieseguire senza danni.
--
-- Modello:
--   team          -> un gruppo di persone, creato da un utente (owner)
--   team_membro   -> le persone del team, invitate per email.
--                    `user_id` resta NULL finche' l'invitato non entra
--                    in uTree con quella email (vedi utree_collega_inviti).
--   condivisione  -> un PROGETTO (visione) condiviso con un team, con un
--                    permesso: 'vista' (sola visibilita') o 'modifica'.
--                    Una riga con `membro_id` valorizzato e' un'ECCEZIONE
--                    per quella singola persona e vince sul permesso del team.
--
-- Chi riceve un progetto condiviso vede la visione e tutte le sue viste
-- dentro la sua app, esattamente dove le vede il proprietario (Pipe, Tree,
-- Links, Progress). In sola visibilita' l'editor si apre in sola lettura.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) TABELLE
-- ------------------------------------------------------------
create table if not exists public.team (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  nome        text not null default 'Nuovo team',
  created_at  timestamptz not null default now()
);
create index if not exists team_owner_idx on public.team(owner_id);

create table if not exists public.team_membro (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.team(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,   -- null = invito non ancora accettato
  email       text not null,
  ruolo       text not null default 'membro',    -- 'admin' | 'membro'
  stato       text not null default 'invitato',  -- 'invitato' | 'attivo'
  created_at  timestamptz not null default now(),
  constraint team_membro_ruolo_chk check (ruolo in ('admin', 'membro')),
  constraint team_membro_stato_chk check (stato in ('invitato', 'attivo'))
);
create unique index if not exists team_membro_email_uniq on public.team_membro(team_id, lower(email));
create index if not exists team_membro_user_idx on public.team_membro(user_id);

create table if not exists public.condivisione (
  id          uuid primary key default gen_random_uuid(),
  visione_id  uuid not null references public.visioni(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,  -- proprietario del progetto
  team_id     uuid references public.team(id) on delete cascade,
  membro_id   uuid references public.team_membro(id) on delete cascade,   -- eccezione per una persona sola
  permesso    text not null default 'vista',      -- 'vista' | 'modifica'
  created_at  timestamptz not null default now(),
  constraint condivisione_permesso_chk check (permesso in ('vista', 'modifica')),
  constraint condivisione_target_chk check (team_id is not null or membro_id is not null)
);
-- un solo permesso "di squadra" per progetto+team, e una sola eccezione per persona
create unique index if not exists condivisione_team_uniq
  on public.condivisione(visione_id, team_id) where membro_id is null;
create unique index if not exists condivisione_membro_uniq
  on public.condivisione(visione_id, membro_id) where membro_id is not null;
create index if not exists condivisione_visione_idx on public.condivisione(visione_id);

-- ------------------------------------------------------------
-- 2) FUNZIONI DI SUPPORTO
-- Sono SECURITY DEFINER apposta: le policy di team_membro devono poter
-- leggere team_membro senza rientrare in se' stesse (ricorsione infinita).
-- ------------------------------------------------------------

-- i team di cui faccio parte (come proprietario o come membro attivo)
create or replace function public.utree_miei_team()
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.id from public.team t where t.owner_id = auth.uid()
  union
  select m.team_id from public.team_membro m
   where m.user_id = auth.uid() and m.stato = 'attivo';
$$;

-- i team che posso amministrare (proprietario, oppure membro con ruolo admin)
create or replace function public.utree_team_amministrati()
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.id from public.team t where t.owner_id = auth.uid()
  union
  select m.team_id from public.team_membro m
   where m.user_id = auth.uid() and m.stato = 'attivo' and m.ruolo = 'admin';
$$;

-- permesso effettivo dell'utente corrente su un PROGETTO (visione):
--   'modifica' | 'vista' | null (nessun accesso)
-- L'eccezione personale vince sul permesso del team; a parita' vince il piu' ampio.
create or replace function public.utree_permesso_visione(v uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when v is null then null
    when exists (select 1 from public.visioni x where x.id = v and x.user_id = auth.uid())
      then 'modifica'
    else (
      select c.permesso
        from public.condivisione c
        left join public.team_membro m on m.id = c.membro_id
       where c.visione_id = v
         and (
           (c.membro_id is not null and m.user_id = auth.uid())
           or (c.membro_id is null and c.team_id in (select public.utree_miei_team()))
         )
       order by (c.membro_id is not null) desc, (c.permesso = 'modifica') desc
       limit 1
    )
  end;
$$;

-- stesso permesso, partendo da una VISTA (passa dalla sua visione)
create or replace function public.utree_permesso_vista(v uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.utree_permesso_visione((select visione_id from public.viste where id = v));
$$;

-- Collega gli inviti in sospeso all'account che sta usando l'app adesso.
-- L'app la chiama a ogni avvio: chi viene invitato per email trova i progetti
-- condivisi appena entra, senza che nessuno debba conoscere il suo user_id.
create or replace function public.utree_collega_inviti()
returns integer language plpgsql security definer set search_path = public as $$
declare
  mia_email text;
  n integer;
begin
  select email into mia_email from auth.users where id = auth.uid();
  if mia_email is null then return 0; end if;
  update public.team_membro m
     set user_id = auth.uid(), stato = 'attivo'
   where m.user_id is null
     and lower(m.email) = lower(mia_email);
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.utree_miei_team() to authenticated;
grant execute on function public.utree_team_amministrati() to authenticated;
grant execute on function public.utree_permesso_visione(uuid) to authenticated;
grant execute on function public.utree_permesso_vista(uuid) to authenticated;
grant execute on function public.utree_collega_inviti() to authenticated;

-- ------------------------------------------------------------
-- 3) RLS DELLE NUOVE TABELLE
-- ------------------------------------------------------------
alter table public.team         enable row level security;
alter table public.team_membro  enable row level security;
alter table public.condivisione enable row level security;

drop policy if exists "team_select" on public.team;
drop policy if exists "team_insert" on public.team;
drop policy if exists "team_update" on public.team;
drop policy if exists "team_delete" on public.team;
create policy "team_select" on public.team for select
  using (owner_id = auth.uid() or id in (select public.utree_miei_team()));
create policy "team_insert" on public.team for insert
  with check (owner_id = auth.uid());
create policy "team_update" on public.team for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "team_delete" on public.team for delete
  using (owner_id = auth.uid());

drop policy if exists "membro_select" on public.team_membro;
drop policy if exists "membro_insert" on public.team_membro;
drop policy if exists "membro_update" on public.team_membro;
drop policy if exists "membro_delete" on public.team_membro;
-- ogni componente vede l'elenco del proprio team (serve a sapere con chi condivide)
create policy "membro_select" on public.team_membro for select
  using (user_id = auth.uid() or team_id in (select public.utree_miei_team()));
create policy "membro_insert" on public.team_membro for insert
  with check (team_id in (select public.utree_team_amministrati()));
create policy "membro_update" on public.team_membro for update
  using (team_id in (select public.utree_team_amministrati()))
  with check (team_id in (select public.utree_team_amministrati()));
create policy "membro_delete" on public.team_membro for delete
  using (team_id in (select public.utree_team_amministrati()));

drop policy if exists "cond_select" on public.condivisione;
drop policy if exists "cond_insert" on public.condivisione;
drop policy if exists "cond_update" on public.condivisione;
drop policy if exists "cond_delete" on public.condivisione;
-- vedo le condivisioni dei MIEI progetti, e quelle che riguardano me
create policy "cond_select" on public.condivisione for select
  using (
    owner_id = auth.uid()
    or team_id in (select public.utree_miei_team())
    or membro_id in (select id from public.team_membro where user_id = auth.uid())
  );
-- solo il proprietario del progetto decide chi ci entra e con quale permesso
create policy "cond_insert" on public.condivisione for insert
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.visioni v where v.id = visione_id and v.user_id = auth.uid())
  );
create policy "cond_update" on public.condivisione for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "cond_delete" on public.condivisione for delete
  using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- 4) RLS DEI DATI: aggiunge l'accesso condiviso a visioni / viste / links
-- Le vecchie policy "own_*" restano valide per i propri dati: qui le
-- sostituiamo con versioni che includono anche i progetti condivisi.
-- ------------------------------------------------------------

-- VISIONI ---------------------------------------------------
drop policy if exists "own_select" on public.visioni;
drop policy if exists "own_insert" on public.visioni;
drop policy if exists "own_update" on public.visioni;
drop policy if exists "own_delete" on public.visioni;
create policy "own_select" on public.visioni for select
  using (user_id = auth.uid() or public.utree_permesso_visione(id) is not null);
create policy "own_insert" on public.visioni for insert
  with check (user_id = auth.uid());
-- Rinominare, ricolorare, archiviare o eliminare un PROGETTO resta un diritto del
-- solo proprietario: chi ha il permesso 'modifica' lavora sul contenuto (le viste),
-- non sul contenitore. Cosi' nessuno puo' nemmeno riassegnarsi il progetto.
create policy "own_update" on public.visioni for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_delete" on public.visioni for delete
  using (user_id = auth.uid());

-- VISTE -----------------------------------------------------
drop policy if exists "own_select" on public.viste;
drop policy if exists "own_insert" on public.viste;
drop policy if exists "own_update" on public.viste;
drop policy if exists "own_delete" on public.viste;
create policy "own_select" on public.viste for select
  using (user_id = auth.uid() or public.utree_permesso_visione(visione_id) is not null);
create policy "own_insert" on public.viste for insert
  with check (user_id = auth.uid() and public.utree_permesso_visione(visione_id) = 'modifica');
create policy "own_update" on public.viste for update
  using (user_id = auth.uid() or public.utree_permesso_visione(visione_id) = 'modifica')
  with check (user_id = auth.uid() or public.utree_permesso_visione(visione_id) = 'modifica');
create policy "own_delete" on public.viste for delete
  using (user_id = auth.uid() or public.utree_permesso_visione(visione_id) = 'modifica');

-- LINKS -----------------------------------------------------
drop policy if exists "own_select" on public.links;
drop policy if exists "own_insert" on public.links;
drop policy if exists "own_update" on public.links;
drop policy if exists "own_delete" on public.links;
create policy "own_select" on public.links for select
  using (user_id = auth.uid() or public.utree_permesso_vista(da_vista) is not null);
create policy "own_insert" on public.links for insert
  with check (user_id = auth.uid() and public.utree_permesso_vista(da_vista) = 'modifica');
create policy "own_update" on public.links for update
  using (user_id = auth.uid() or public.utree_permesso_vista(da_vista) = 'modifica')
  with check (user_id = auth.uid() or public.utree_permesso_vista(da_vista) = 'modifica');
create policy "own_delete" on public.links for delete
  using (user_id = auth.uid() or public.utree_permesso_vista(da_vista) = 'modifica');

-- NB: `vite`, `task`, `ricorrenza` e `giorno` restano PRIVATE.
-- Si condivide il progetto (visione) con le sue viste, non la giornata
-- personale di nessuno.
