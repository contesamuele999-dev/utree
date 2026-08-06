// ============================================================
// Log attività locale: tiene conto dei caratteri ("lettere")
// scritti giorno per giorno. Lo storico dei caratteri non esiste
// prima di oggi, quindi parte da ora e cresce con l'uso.
// Struttura: { "2026-07-04": { chars: 1234 }, ... }
// ============================================================
const LS_KEY = 'utree-activity'

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} }
  catch { return {} }
}
function save(map) { try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch {} }

function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Registra i caratteri scritti oggi (delta positivo).
export function logChars(delta) {
  if (!delta || delta <= 0) return
  const map = load()
  const k = todayKey()
  map[k] = map[k] || { chars: 0 }
  map[k].chars += Math.round(delta)
  save(map)
}

// Ritorna la mappa completa { 'YYYY-MM-DD': { chars } }.
export function getActivity() { return load() }
