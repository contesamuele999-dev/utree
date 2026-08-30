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

> ⚠️ **Le email di Supabase non arrivano?** Il servizio di posta *integrato* di Supabase
> è pensato solo per lo sviluppo: poche email all'ora e, sui progetti nuovi, consegna
> **solo agli indirizzi del team del progetto**. Tutte le altre vengono scartate in
> silenzio: nessun errore, nessuna email. Vedi la sezione **Email** qui sotto.

---

## Email (Maileroo)

uTree manda email in **due occasioni diverse**, e non passano dallo stesso posto.
Servono entrambe le configurazioni: farne una sola lascia l'altra metà muta.

| Quando | Chi la manda | Come si configura |
|---|---|---|
| Conferma registrazione, reset password | Supabase Auth | **SMTP** Maileroo nel pannello Supabase |
| Invito a un team | la Edge Function `invita-team` | **API** Maileroo, chiave nei secrets |

Prima di tutto, una volta sola: su [maileroo.com](https://maileroo.com) aggiungi il tuo
dominio in **Domains** e completa la verifica DNS (SPF, DKIM, e il record di ritorno che
ti indica). Finché il dominio non risulta verificato, Maileroo rifiuta i messaggi che
partono da quell'indirizzo — ed è la causa più comune di "non arriva niente".

### 1. Email di sistema (registrazione, reset password)

Sono di Supabase, non di uTree: si attivano dandogli un SMTP vero al posto di quello di prova.

1. Maileroo → **Domains** → il tuo dominio → **SMTP Accounts** → crea un account
   (l'alias, es. `noreply`, e la password che ti mostra: la password si vede una volta sola).
2. Supabase → **Project Settings → Authentication → SMTP Settings** → *Enable Custom SMTP*:

   | Campo | Valore |
   |---|---|
   | Host | `smtp.maileroo.com` |
   | Port | `587` (STARTTLS) — in alternativa `465` SSL o `2525` |
   | Username | le credenziali dell'account SMTP appena creato |
   | Password | la password generata da Maileroo |
   | Sender email | `noreply@tuodominio.it` (sul dominio verificato) |
   | Sender name | `uTree` |

   > Se `587` viene bloccato dalla rete, prova `2525`. Copia lo username **esattamente**
   > come lo mostra Maileroo: a seconda dell'account è l'alias (`noreply`) o l'indirizzo
   > completo, e sbagliarlo dà un errore di autenticazione, non un errore di invio.
3. **Save**, poi prova a registrare un account nuovo: l'email di conferma deve arrivare.

### 2. Email di invito al team

Invitare qualcuno scrive una riga in `team_membro` **e** gli manda l'email con il link per
entrare. L'email non può partire dal browser (servirebbe la chiave dell'API, che in un
bundle pubblico è una chiave regalata): parte dalla Edge Function
[`supabase/functions/invita-team`](./supabase/functions/invita-team/index.ts), che usa
l'**API v2 di Maileroo**.

Finché la funzione non è pubblicata, **gli inviti funzionano lo stesso** — sono salvati e
validi — ma l'email non parte: la pagina Team lo dice chiaramente e offre
*Copia link* / *Scrivi* per mandarlo a mano.

1. Maileroo → **Email API** → crea una **Sending Key** per il dominio verificato e copiala
   (anche questa si vede una volta sola).
2. Installa la CLI di Supabase se non ce l'hai
   ([guida](https://supabase.com/docs/guides/local-development/cli/getting-started)), poi
   dalla cartella del progetto:

   ```bash
   supabase login
   supabase link --project-ref <il-tuo-project-ref>
   supabase functions deploy invita-team
   ```

   Il *project ref* è la sigla nell'URL del progetto Supabase
   (`https://<project-ref>.supabase.co`).
3. Imposta i tre segreti:

   ```bash
   supabase secrets set MAILEROO_API_KEY=la-tua-sending-key
   supabase secrets set UTREE_MITTENTE="uTree <invito@tuodominio.it>"
   supabase secrets set UTREE_APP_URL=https://<tuo-utente>.github.io/utree/
   ```

   - `UTREE_MITTENTE` deve stare sul dominio **verificato**, altrimenti Maileroo rifiuta.
   - `UTREE_APP_URL` è la base dei link di invito: se sbagliata, l'invitato atterra su una
     pagina che non esiste. Deve finire con `/`.
   - Dopo un `secrets set` la funzione riparte da sola: non serve rifare il deploy.
4. Nell'app: **☰ → Team e condivisioni** → invita un indirizzo. Il messaggio di esito dice
   se l'email è partita **davvero**: la funzione controlla il campo `success` della risposta,
   perché Maileroo risponde `200 OK` anche quando scarta il messaggio.

Se qualcosa non torna, il motivo è nei log:

```bash
supabase functions logs invita-team
```

L'invitato riceve un link tipo `…/utree/?invito=anna@esempio.it`: la pagina di accesso
precompila l'indirizzo. **Deve registrarsi con quella email**, perché è su quella che
l'invito si aggancia (`utree_collega_inviti` in `migrazione_team.sql`).

La funzione non usa la `service_role` key: riusa il JWT di chi invita, quindi a decidere
chi può invitare in quale team restano le RLS, come per il resto dell'app.

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
index.html  scheletro + rete di sicurezza dell'avvio (vedi sotto)
supabase/functions/invita-team/   email di invito al team (Edge Function)
supabase_schema.sql   schema DB + Row Level Security
migrazione_team.sql   team, membri e condivisione dei progetti (RLS estesa)
```

**Se l'app non si apre.** Tre reti, una dentro l'altra, perché una schermata bianca
non dice niente a nessuno: l'`ErrorBoundary` prende gli errori di render; il `try`
attorno a `createRoot` in `main.jsx` prende quelli del montaggio; il pannello inline
in `index.html` prende tutto il resto — bundle non scaricato, modulo che esplode
mentre viene valutato, avvio che non risponde entro 10 secondi. L'ultimo non importa
nulla e non dipende da niente, quindi è l'unico che regge anche quando non regge
nient'altro: offre *Ricarica* e *Svuota la cache dell'app*.

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
