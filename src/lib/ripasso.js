// ============================================================
// Ripasso delle knowledge base: una vista al giorno in Today, a
// intervalli crescenti (1, 3, 7, 14, 30, 60 giorni) — la fase "Ricordo"
// del metodo applicata alle tue note. Lo storico sono le task stesse:
// "📚 Ripassa ((Vista))" spuntate. Niente tabelle nuove.
// ============================================================
import { IS_KB } from '../../supabase/functions/_shared/agente.js'

export const PREFISSO = '📚 Ripassa '
const INTERVALLI = [1, 3, 7, 14, 30, 60]
const RE = /^📚 Ripassa \(\((.+?)\)\)/
const piu = (giorno, n) => new Date(Date.parse(giorno + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/**
 * La vista da ripassare oggi, o null (già c'è un ripasso oggi, o nessuna è in scadenza).
 * `viste` con titolo/visione_id/blocchi/ordine, `visioni` con id/titolo, `task` con text/giorno/done.
 */
export function scegliRipasso(viste, visioni, task, oggi) {
  if (task.some(t => t.giorno === oggi && RE.test(t.text || ''))) return null
  const kb = new Set(visioni.filter(v => IS_KB.test(v.titolo || '')).map(v => v.id))
  const candidate = viste.filter(v => kb.has(v.visione_id) && !v.is_template
    && !/Da valutare|Temi da seguire/.test(v.titolo || '')
    && (v.blocchi || []).some(b => (b.text || '').trim()))
  if (!candidate.length) return null
  const fatti = {}   // titolo → giorni in cui il ripasso è stato spuntato
  for (const t of task) {
    const m = t.done && (t.text || '').match(RE)
    if (m) (fatti[m[1]] ||= []).push(t.giorno)
  }
  const scadenza = (v) => {
    const g = (fatti[v.titolo] || []).sort()
    return g.length ? piu(g[g.length - 1], INTERVALLI[Math.min(g.length - 1, INTERVALLI.length - 1)]) : ''
  }
  const pronte = candidate.map(v => ({ v, s: scadenza(v) })).filter(x => x.s <= oggi)
  pronte.sort((a, b) => a.s.localeCompare(b.s) || (a.v.ordine || 0) - (b.v.ordine || 0))
  return pronte[0]?.v || null
}
