// ============================================================
// Modalità OFFLINE
//
// Due pezzi indipendenti, entrambi su localStorage:
//
//  1) SNAPSHOT — una copia completa dell'ultimo stato letto dal cloud
//     (vite, visioni, viste, links, task, ricorrenze, giorni). Serve ad
//     APRIRE l'app senza rete: il service worker già serve il codice,
//     lo snapshot serve i dati. Senza, l'app partiva vuota.
//
//  2) OUTBOX — la coda delle scritture fatte mentre si era offline.
//     Ogni voce è {op, table, id, payload}. Al ritorno della rete si
//     rigioca in ordine. Gli insert offline creano un id provvisorio
//     "off-…": quando l'insert va a buon fine il vero id sostituisce
//     quello provvisorio anche nelle voci successive della coda
//     (altrimenti un update su una riga appena creata fallirebbe).
//
// Le VISTE non passano da qui: hanno già la loro cache dirty con merge
// a 3 vie (lib/localcache.js), più adatta al testo modificato in continuo.
// ============================================================

const SNAP_KEY = 'arbora-snapshot'
const OUT_KEY = 'arbora-outbox'

const readJSON = (k, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v }
  catch { return fallback }
}
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota */ } }

// ---------- 1) snapshot ----------
export function saveSnapshot(data) {
  writeJSON(SNAP_KEY, { ...data, ts: Date.now() })
}
export function loadSnapshot() {
  return readJSON(SNAP_KEY, null)
}
export function hasSnapshot() {
  return !!loadSnapshot()
}

// ---------- 2) outbox ----------
export const offlineId = () => 'off-' + Math.random().toString(36).slice(2, 10)
export const isOfflineId = (id) => typeof id === 'string' && id.startsWith('off-')

export function outbox() { return readJSON(OUT_KEY, []) }
export function outboxCount() { return outbox().length }

export function enqueue(entry) {
  const q = outbox()
  q.push({ ...entry, at: Date.now() })
  writeJSON(OUT_KEY, q)
}

// Un errore "di rete" (offline, DNS, server irraggiungibile) va messo in coda;
// un errore vero del database (vincolo violato, colonna assente) NO: rigiocarlo
// fallirebbe per sempre e bloccherebbe la coda.
export function isNetworkError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = ((e && (e.message || e.error_description || e.details)) || '').toString().toLowerCase()
  return m.includes('failed to fetch') || m.includes('networkerror') ||
    m.includes('network request failed') || m.includes('load failed') ||
    m.includes('fetch') && m.includes('error')
}

// Sostituisce un id provvisorio col suo id reale in tutta la coda rimanente.
function remap(queue, tmpId, realId) {
  if (!tmpId || !realId) return queue
  return queue.map(e => e.id === tmpId ? { ...e, id: realId } : e)
}

// Rigioca la coda. `store` è passato dall'esterno per evitare un import circolare.
// Ritorna { fatte, rimaste }.
export async function replayOutbox(store) {
  let q = outbox()
  if (!q.length) return { fatte: 0, rimaste: 0 }
  let fatte = 0
  while (q.length) {
    const e = q[0]
    try {
      if (e.op === 'insert') {
        const saved = await store.insert(e.table, e.payload, { noQueue: true })
        q = remap(q.slice(1), e.id, saved?.id)
      } else if (e.op === 'update') {
        if (isOfflineId(e.id)) { q = q.slice(1) }   // la riga non è mai nata: scarta
        else { await store.update(e.table, e.id, e.payload, { noQueue: true }); q = q.slice(1) }
      } else if (e.op === 'remove') {
        if (!isOfflineId(e.id)) await store.remove(e.table, e.id, { noQueue: true })
        q = q.slice(1)
      } else if (e.op === 'upsertGiorno') {
        await store.upsertGiorno(e.id, e.payload, { noQueue: true })
        q = q.slice(1)
      } else {
        q = q.slice(1)   // voce sconosciuta (versione vecchia): scarta
      }
      fatte++
      writeJSON(OUT_KEY, q)
    } catch (err) {
      if (isNetworkError(err)) break         // ancora offline: si ritenta più tardi
      q = q.slice(1)                          // errore definitivo: scarta e prosegui
      writeJSON(OUT_KEY, q)
      console.warn('[offline] voce scartata:', e.op, e.table, err?.message || err)
    }
  }
  writeJSON(OUT_KEY, q)
  return { fatte, rimaste: q.length }
}
