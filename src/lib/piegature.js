// ============================================================
// Piegature dei sottorami (quali righe hanno i rami chiusi).
// Vivono SOLO su questo dispositivo: non sono contenuto della vista ma un modo
// di guardarla, e finire nel documento le farebbe viaggiare sul cloud (e sugli
// altri) a ogni apertura/chiusura di un ramo. Qui invece uscire da una vista e
// rientrarci la ritrova esattamente com'era.
// Forma: { [vistaId]: [idRiga, ...] }
// ============================================================

const KEY = 'utree-piegature'

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
function write(db) {
  try {
    if (Object.keys(db).length) localStorage.setItem(KEY, JSON.stringify(db))
    else localStorage.removeItem(KEY)
  } catch { /* quota o storage negato */ }
}

// Le righe piegate di una vista, pronte per lo stato del componente.
export function leggiPiegature(vistaId) {
  const v = read()[vistaId]
  return new Set(Array.isArray(v) ? v : [])
}

// `ids` = elenco (o Set) delle righe piegate. Vuoto ⇒ la voce sparisce del tutto:
// senza rami chiusi non c'è niente da ricordare.
export function scriviPiegature(vistaId, ids) {
  if (!vistaId) return
  const arr = [...(ids || [])]
  const db = read()
  if (arr.length) db[vistaId] = arr
  else if (db[vistaId] === undefined) return      // non c'era e non ci sarà: niente da riscrivere
  else delete db[vistaId]
  write(db)
}

// Toglie le viste che non esistono più (eliminate, o di un altro account).
export function prunePiegature(idsVivi) {
  if (!idsVivi) return
  const ids = idsVivi instanceof Set ? idsVivi : new Set(idsVivi)
  const db = read()
  let cambiato = false
  for (const id of Object.keys(db)) if (!ids.has(id)) { delete db[id]; cambiato = true }
  if (cambiato) write(db)
}

export function dropPiegature() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
