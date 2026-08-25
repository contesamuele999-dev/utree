// ============================================================
// Cache locale delle viste (anti-perdita dati).
// Ogni modifica viene scritta QUI in modo SINCRONO su localStorage,
// così sopravvive a refresh/chiusura app anche se il salvataggio
// cloud (asincrono) viene interrotto dall'unload della pagina.
// Al reload i dati locali "dirty" (non ancora confermati dal cloud)
// vengono uniti alle righe del server e ri-spediti.
// ============================================================
import { mergeBlocchi } from './store.js'

const KEY = 'utree-vista-cache'
// Flag: la colonna `cestino` non esiste ancora su Supabase.
const NO_CESTINO = 'utree-no-cestino-col'

// Specchio in memoria della cache. `cacheVistaLocal` viene chiamata a OGNI battuta:
// senza questo, ogni tasto premuto costava un JSON.parse dell'intera cache (tutte le
// viste toccate, non solo quella aperta) oltre allo stringify. Ora si rilegge da
// localStorage una volta sola per sessione; la scrittura resta sincrona, che è tutto
// ciò che serve alla garanzia anti-perdita.
let mem = null

function read() {
  if (mem) return mem
  try { mem = JSON.parse(localStorage.getItem(KEY)) || {} } catch { mem = {} }
  return mem
}
function write(obj) {
  mem = obj
  try { localStorage.setItem(KEY, JSON.stringify(obj)) } catch { /* quota */ }
}

// Alleggerisce la cache. Una voce NON dirty è già confermata dal cloud: di essa
// serve solo la `base` (lo stato da cui ripartirà il prossimo merge a 3 vie), non
// una seconda copia di blocchi, titolo e cestino. Lasciandocela, la cache cresceva
// a ogni vista toccata e ogni singola battuta ne riscriveva l'intero contenuto.
// Le voci dirty non si toccano mai: contengono lavoro non ancora salito.
// `idsVivi` (facoltativo) = le viste che esistono ancora: le altre spariscono.
export function pruneVistaCache(idsVivi) {
  const db = read()
  const ids = idsVivi ? (idsVivi instanceof Set ? idsVivi : new Set(idsVivi)) : null
  const out = {}
  let cambiato = false
  for (const [id, c] of Object.entries(db)) {
    if (c?.dirty) { out[id] = c; continue }
    if (ids && !ids.has(id)) { cambiato = true; continue }     // vista eliminata: via del tutto
    if (c && c.base !== undefined) {
      const snello = { base: c.base, dirty: false, ts: c.ts }
      if (Object.keys(c).length !== Object.keys(snello).length) cambiato = true
      out[id] = snello
    } else cambiato = true                                      // niente base: non serve a nulla
  }
  if (cambiato) write(out)
}

// Dimentica anche lo specchio in memoria: va chiamata insieme a `purgeLocalData()`,
// altrimenti la copia in RAM riscriverebbe subito quella appena cancellata.
export function dropVistaCache() {
  mem = {}
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

// Scrive (sincrono) le modifiche di una vista nella cache, marcandola "dirty".
// `base` = stato cloud da cui è partita questa modifica (per il merge a 3 vie).
// Serve a distinguere una riga NUOVA di qui da una riga ELIMINATA altrove: senza
// base il flush sarebbe "additivo" e resusciterebbe le righe cancellate su un altro
// dispositivo. La base va impostata solo da chi la conosce davvero (saveVista);
// le scritture sincrone anti-perdita (Editor a ogni battuta) la lasciano invariata.
export function cacheVistaLocal(id, patch, base) {
  if (!id) return
  const db = read()
  const prev = db[id] || {}
  db[id] = { ...prev, ...patch, ts: Date.now(), dirty: true }
  if (base !== undefined) db[id].base = base
  write(db)
}

// Segna una vista come sincronizzata col cloud (non più dirty).
// `syncedBlocchi` (opzionale) = risultato del merge appena salvato: diventa la nuova base.
export function markVistaSynced(id, syncedBlocchi) {
  const db = read()
  if (db[id]) {
    db[id].dirty = false
    if (Array.isArray(syncedBlocchi)) db[id].base = syncedBlocchi
    write(db)
  }
}

// Unisce le righe del server con la cache locale. Se la cache ha una versione dirty
// (non confermata), si fonde a 3 vie con la base salvata: così le modifiche locali non
// ancora salite restano, MA le eliminazioni fatte su un altro dispositivo vengono
// comunque applicate (prima la cache dirty "vinceva" tutto e nascondeva le eliminazioni).
export function mergeVisteWithCache(rows) {
  const db = read()
  if (!Object.keys(db).length) return rows
  return rows.map(r => {
    const c = db[r.id]
    if (!c || !c.dirty) return r
    const localBlocchi = c.blocchi ?? r.blocchi
    const blocchi = c.base !== undefined
      ? mergeBlocchi(c.base, localBlocchi, r.blocchi)   // fonde edit locali + eliminazioni remote
      : localBlocchi                                     // nessuna base nota: fallback al comportamento precedente
    const out = { ...r, titolo: c.titolo ?? r.titolo, blocchi }
    if (c.cestino !== undefined) out.cestino = c.cestino
    return out
  })
}

// Ri-spedisce al cloud tutte le viste rimaste "dirty" (best-effort).
// Usa il merge a 3 vie (updateVistaMerged) invece di una sovrascrittura piena, così
// una entry dirty vecchia non cancella le modifiche/eliminazioni fatte altrove.
export async function flushDirtyToCloud(store) {
  const db = read()
  const ids = Object.keys(db).filter(id => db[id]?.dirty)
  for (const id of ids) {
    const c = db[id]
    const base = c.base   // può essere undefined su entry vecchie: updateVistaMerged degrada in modo sicuro
    try {
      const patch = { titolo: c.titolo, blocchi: c.blocchi }
      if (c.cestino !== undefined && !cestinoDisabled()) patch.cestino = c.cestino
      const saved = await store.updateVistaMerged(id, patch, base)
      markVistaSynced(id, saved?.blocchi)
    } catch (e) {
      if (isMissingCestino(e) && c.cestino !== undefined) {
        disableCestinoCloud()
        try {
          const saved = await store.updateVistaMerged(id, { titolo: c.titolo, blocchi: c.blocchi }, base)
          markVistaSynced(id, saved?.blocchi)
        } catch { /* ritenta al prossimo reload */ }
      }
      /* se fallisce resta dirty: ritenteremo più avanti */
    }
  }
}

// ---- gestione colonna cestino mancante (fallback graduale) ----
export function cestinoDisabled() { return localStorage.getItem(NO_CESTINO) === '1' }
export function disableCestinoCloud() { try { localStorage.setItem(NO_CESTINO, '1') } catch {} }
export function isMissingCestino(e) {
  const m = ((e && (e.message || e.error || e.details)) || '').toString().toLowerCase()
  return m.includes('cestino') || m.includes('column') || e?.code === '42703' || e?.code === 'PGRST204'
}
