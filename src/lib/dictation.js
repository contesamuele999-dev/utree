// ============================================================
// Dettatura vocale — Web Speech API del browser, zero dipendenze.
// Chrome/Edge/Safari la espongono; altrove `dettaturaDisponibile()`
// è false e il pulsante non compare.
// Restituiamo solo i pezzi DEFINITIVI: gli interim cambiano a ogni
// respiro e riscriverebbero la riga sotto le dita di chi scrive.
// ============================================================
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export const dettaturaDisponibile = () => !!SR

let rec = null

export function stopDettatura() {
  const r = rec
  rec = null
  try { r?.stop() } catch { /* già ferma */ }
}

export function startDettatura({ lang = 'it-IT', onText, onEnd, onError } = {}) {
  if (!SR) return false
  stopDettatura()
  const r = new SR()
  r.lang = lang
  r.continuous = true
  r.interimResults = false
  // un evento può portare più pezzi definitivi: li uniamo e chiamiamo onText UNA volta,
  // così chi riceve non lavora due volte sullo stesso stato
  r.onresult = (e) => {
    const parti = []
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue
      const t = (e.results[i][0]?.transcript || '').trim()
      if (t) parti.push(t)
    }
    if (parti.length) onText?.(parti.join(' '))
  }
  r.onerror = (e) => onError?.(e?.error || 'errore')
  r.onend = () => { if (rec === r) rec = null; onEnd?.() }
  try { r.start() } catch { return false }
  rec = r
  return true
}
