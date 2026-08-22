// ============================================================
// TEAM e PROGETTI CONDIVISI
//
// Un PROGETTO in uTree è una visione. Condividerlo significa darne
// l'accesso a un team, con uno di due permessi:
//   'vista'    -> sola visibilità: si legge, non si tocca
//   'modifica' -> si lavora dentro come il proprietario
//
// Il permesso si sceglie per il team intero e, se serve, si sovrascrive
// PER SINGOLO MEMBRO (eccezione): "tutto il team può vedere, ma Anna
// può anche modificare" è una riga di team + una riga di eccezione.
//
// Lato database il vincolo vero lo mettono le policy RLS (migrazione_team.sql):
// quello che c'è qui serve alla UI per sapere cosa mostrare e cosa bloccare.
// ============================================================
import { supabase, hasSupabase } from './supabase.js'
import { store } from './store.js'

export const PERMESSI = [
  { id: 'vista', label: 'Sola visibilità', desc: 'Può aprire e leggere, non può modificare niente.' },
  { id: 'modifica', label: 'Modifica', desc: 'Può scrivere nelle viste del progetto, come il proprietario.' },
]
export const etichettaPermesso = (p) => PERMESSI.find(x => x.id === p)?.label || 'Nessun accesso'

// Le tabelle del team arrivano con una migrazione a parte: se non è ancora
// stata eseguita le letture falliscono. Non è un errore da urlare — l'app
// funziona lo stesso, semplicemente senza condivisioni.
export function tabelleMancanti(err) {
  const m = (err?.message || '') + ' ' + (err?.details || '')
  return err?.code === '42P01' || /relation .* does not exist|could not find the table/i.test(m)
}

// insert "nudo": lo `store` aggiunge sempre user_id, che queste tabelle non hanno
async function insert(table, row) {
  if (!hasSupabase) return store.insert(table, row)
  const { data, error } = await supabase.from(table).insert(row).select().single()
  if (error) throw error
  return data
}

// ---- lettura -------------------------------------------------------------
// Ritorna sempre un oggetto utilizzabile: `disponibile:false` vuol dire
// "migrazione non ancora eseguita", non "errore".
export async function caricaTeam() {
  const vuoto = { teams: [], membri: [], condivisioni: [], disponibile: false }
  try {
    const [teams, membri, condivisioni] = await Promise.all([
      store.list('team'), store.list('team_membro'), store.list('condivisione'),
    ])
    return { teams, membri, condivisioni, disponibile: true }
  } catch (e) {
    if (!tabelleMancanti(e)) console.warn('[team] lettura fallita:', e?.message || e)
    return vuoto
  }
}

// Chi viene invitato per email non ha ancora un user_id noto a chi invita:
// all'avvio l'app chiede al database di agganciare gli inviti in sospeso
// all'account collegato adesso. Torna quanti inviti sono stati accettati.
export async function collegaInviti() {
  if (!hasSupabase) return 0
  try {
    const { data, error } = await supabase.rpc('utree_collega_inviti')
    if (error) throw error
    return data || 0
  } catch (e) {
    if (!tabelleMancanti(e)) console.warn('[team] inviti non collegati:', e?.message || e)
    return 0
  }
}

// ---- permessi ------------------------------------------------------------
// `ctx` = { userId, teams, membri, condivisioni }

// le "tessere" di membro che appartengono a me (una per ogni team a cui sono stato invitato)
function mieTessere(ctx) {
  return (ctx.membri || []).filter(m => m.user_id && m.user_id === ctx.userId)
}
// i team di cui faccio parte: quelli che ho creato + quelli in cui sono membro attivo
export function mieiTeamIds(ctx) {
  const s = new Set()
  for (const t of ctx.teams || []) if (t.owner_id === ctx.userId) s.add(t.id)
  for (const m of mieTessere(ctx)) if (m.stato === 'attivo') s.add(m.team_id)
  return s
}

// Permesso dell'utente corrente su un progetto:
//   'proprietario' | 'modifica' | 'vista' | null (nessun accesso)
export function permessoVisione(vis, ctx) {
  if (!vis) return null
  // in modalità demo le righe locali non hanno user_id: è tutto tuo
  if (!vis.user_id || vis.user_id === ctx.userId) return 'proprietario'
  const tessere = new Set(mieTessere(ctx).map(m => m.id))
  const team = mieiTeamIds(ctx)
  const righe = (ctx.condivisioni || []).filter(c => c.visione_id === vis.id)
  // l'eccezione personale vince sempre sul permesso di squadra
  const eccezione = righe.find(c => c.membro_id && tessere.has(c.membro_id))
  if (eccezione) return eccezione.permesso
  const diSquadra = righe.filter(c => !c.membro_id && team.has(c.team_id))
  if (!diSquadra.length) return null
  return diSquadra.some(c => c.permesso === 'modifica') ? 'modifica' : 'vista'
}

// Mappa visione_id -> permesso, per l'intera app (Pipe, Tree, editor…).
export function mappaPermessi(visioni, ctx) {
  const m = new Map()
  for (const v of visioni || []) m.set(v.id, permessoVisione(v, ctx))
  return m
}

export const puoModificare = (p) => p === 'proprietario' || p === 'modifica'
export const soloLettura = (p) => p === 'vista'

// Permesso che UNA persona ha su un progetto (serve al pannello di condivisione
// del proprietario: "chi vede cosa"). `membro` è una riga di team_membro.
export function permessoDelMembro(visioneId, membro, condivisioni) {
  const righe = (condivisioni || []).filter(c => c.visione_id === visioneId)
  const ecc = righe.find(c => c.membro_id === membro.id)
  if (ecc) return { permesso: ecc.permesso, eccezione: true, riga: ecc }
  const team = righe.find(c => !c.membro_id && c.team_id === membro.team_id)
  if (team) return { permesso: team.permesso, eccezione: false, riga: team }
  return { permesso: null, eccezione: false, riga: null }
}

// ---- scritture: team -----------------------------------------------------
export const creaTeam = (nome, userId) => insert('team', { nome: nome || 'Nuovo team', owner_id: userId })
export const rinominaTeam = (id, nome) => store.update('team', id, { nome })
export const eliminaTeam = (id) => store.remove('team', id)

export const invitaMembro = (teamId, email, ruolo = 'membro') =>
  insert('team_membro', { team_id: teamId, email: (email || '').trim().toLowerCase(), ruolo, stato: 'invitato' })
export const cambiaRuolo = (membroId, ruolo) => store.update('team_membro', membroId, { ruolo })
export const rimuoviMembro = (membroId) => store.remove('team_membro', membroId)

// ---- scritture: condivisioni --------------------------------------------
// Condivide un progetto con un TEAM intero (o ne cambia il permesso).
export async function condividiConTeam(visione, teamId, permesso, userId, condivisioni) {
  const esistente = (condivisioni || []).find(
    c => c.visione_id === visione.id && !c.membro_id && c.team_id === teamId)
  if (esistente) return store.update('condivisione', esistente.id, { permesso })
  return insert('condivisione', {
    visione_id: visione.id, owner_id: visione.user_id || userId, team_id: teamId, permesso,
  })
}
export const revocaCondivisione = (id) => store.remove('condivisione', id)

// Eccezione per una persona: `permesso` null = torna a seguire il team.
export async function impostaEccezione(visione, membro, permesso, userId, condivisioni) {
  const esistente = (condivisioni || []).find(
    c => c.visione_id === visione.id && c.membro_id === membro.id)
  if (permesso == null) {
    if (esistente) await store.remove('condivisione', esistente.id)
    return null
  }
  if (esistente) return store.update('condivisione', esistente.id, { permesso })
  return insert('condivisione', {
    visione_id: visione.id, owner_id: visione.user_id || userId,
    team_id: membro.team_id, membro_id: membro.id, permesso,
  })
}
