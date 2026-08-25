# 🌳 uTree

App di note ad albero per imprenditori. **Vite** (universi) → **Visioni** (mondi/progetti) → **Viste** (i singoli fogli/note).

PWA installabile su PC, tablet e smartphone. React + Vite + Supabase, deploy su GitHub Pages.

---

## Cosa fa

- **Editor a blocchi markdown** — titoli, grassetto, corsivo, code, divisori. Ogni blocco si trascina (drag & drop), si copia con un tap, si elimina con doppio tap. Undo/redo (Ctrl+Z / Ctrl+Y).
- **Hyperlink tra viste** — scrivi `[[Titolo]]`; cliccando salti alla vista collegata (creata se non esiste).
- **Vista Mappa** commutabile: **2.5D**, **mappa mentale** (radiale), **albero**. Filtro per livello gerarchico.
- **Vista Pipeline** stile Google Keep.
- **Scheda Livelli** — trascina le viste per cambiare ramo/livello (con conferma).
- **Ricerca rapida (Ctrl+K)** — una sola casella per saltare a qualunque vista (per titolo o per contenuto) o task di oggi, da qualsiasi schermata. Da telefono c’è il pulsante 🔍 in alto. `Alt+1…5` cambia scheda.
- **Modalità Focus + Pomodoro** — timer 25+5 editabile fino a 50+10, con suggerimenti di pausa. Si accende dal menu ☰ → *🍅 Timer Pomodoro* (o entrando in Focus da dentro una vista); mentre gira, il tempo restante compare anche nel titolo della scheda del browser.
- **Login multi-utente** — ogni utente vede solo i propri dati (Supabase + Row Level Security).
- **Google Calendar** — ogni utente collega il proprio account Google dal **Profilo**; le righe con scadenza si sincronizzano come eventi (create/aggiornate/eliminate insieme alla scadenza).
- **Progetti in team** — condividi una visione con un team, scegliendo se gli altri possono solo vederla o anche modificarla. Il permesso si imposta per tutto il team e, quando serve, **per singola persona**. Menu ☰ → *Team e condivisioni*.
- **Modalità DEMO** — senza Supabase l'app gira in locale (dati nel browser), utile per provarla subito.

---

## Avvio rapido (locale)

```bash
npm install
npm run dev
```

Apri l'indirizzo mostrato. Senza configurare Supabase parte in **modalità DEMO** locale.

Se il `.env` è già configurato ma vuoi comunque provare l'app **senza toccare il cloud**
(niente login, dati solo nel browser):

```bash
npm run demo
```

Legge `.env.demo`, che azzera le variabili Supabase: il `.env` normale resta intatto.

---

## Setup Supabase (login + sync cloud)

1. Crea un progetto su [supabase.com](https://supabase.com).
2. **SQL Editor** → incolla ed esegui il contenuto di [`supabase_schema.sql`](./supabase_schema.sql),
   poi le migrazioni che ti servono (una volta sola ciascuna, sono idempotenti):
   `migrazione_today.sql`, `migrazione_stage.sql`, `migrazione_cestino.sql`,
   `migrazione_immagini.sql`, `migrazione_pin.sql`, `migrazione_today_indent.sql`
   e — per i progetti condivisi in team — [`migrazione_team.sql`](./migrazione_team.sql).
3. **Project Settings → API**: copia *Project URL* e *anon public key*.
4. Crea un file `.env` (vedi `.env.example`):

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   ```
5. (Opzionale) **Authentication → Providers**: tieni attivo Email. Per test rapidi puoi disattivare la conferma email.
6. `npm run dev` → ora il login è reale.

---

## Setup Google Calendar (opzionale)

Permette a ogni utente di collegare il **proprio** account Google e sincronizzare le righe con scadenza. Tutto lato browser: nessun backend, compatibile con GitHub Pages.

1. [Google Cloud Console](https://console.cloud.google.com/) → crea/usa un progetto.
2. **API e servizi → Libreria** → abilita **Google Calendar API**.
3. **Credenziali → Crea credenziali → ID client OAuth** → tipo *Applicazione web*.
4. In **Origini JavaScript autorizzate** aggiungi gli URL dell'app (es. `http://localhost:5173` e `https://<tuo-utente>.github.io`).
5. Copia l'*ID client* nel `.env` (e come secret di GitHub Actions per la pubblicazione):

   ```
   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   ```
6. Nell'app: **Profilo → Google Calendar → Collega**. Poi ogni scadenza (📅) diventa un evento nel calendario dell'utente.

> Finché la Google Calendar API è in modalità *Testing*, aggiungi gli utenti come *Test users* nella schermata di consenso OAuth (oppure pubblica l'app).

---

## Pubblicazione su GitHub Pages

1. Crea un repo su GitHub chiamato **`utree`** e carica questa cartella.
2. **Settings → Secrets and variables → Actions** → aggiungi:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GOOGLE_CLIENT_ID` *(solo se usi Google Calendar)*
3. **Settings → Pages** → *Source: GitHub Actions*.
4. `git push` sul branch `main`: il workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builda e pubblica.
5. L'app sarà su `https://<tuo-utente>.github.io/utree/`.

> Se chiami il repo diversamente da `utree`, cambia `VITE_BASE` nel workflow (es. `/mio-repo/`).
> Per un dominio custom o un repo `<utente>.github.io`, imposta `VITE_BASE=/`.

---

## Struttura

```
src/
  lib/        supabase.js · store.js (cloud+demo) · auth.jsx · markdown.jsx
              localcache.js (anti-perdita) · offline.js (snapshot + coda) · today.js
  views/      Editor · Today · Pipeline · Tree · Links · Progress · Stats · Pomodoro …
  pages/      Auth · Legal (privacy + termini)
  App.jsx     orchestratore (visioni, viste, hyperlink, focus, ricerca rapida)
supabase_schema.sql   schema DB + Row Level Security
migrazione_team.sql   team, membri e condivisione dei progetti (RLS estesa)
```

Il primo caricamento porta solo il flusso principale (Today · Pipe · editor); le schermate
secondarie (Tree, Links, Progress, Statistiche, Team, Profilo, guida, backup, import da Keep)
arrivano al primo uso come pezzi separati e restano in cache. L'editor viene pre-scaricato
appena l'app è ferma, così aprire una nota resta istantaneo.

---

## Note

- Le pagine **Privacy** e **Termini** sono una base in italiano: falle rivedere a un legale prima di aprire l'app al pubblico.
- L'editor markdown è volutamente leggero (zero dipendenze pesanti) per massima fluidità.

---

uTree © 2026 — Sviluppata da **Samuele Contessa**.
