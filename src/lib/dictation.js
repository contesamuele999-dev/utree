// ============================================================
// Dettatura vocale — Web Speech API del browser, zero dipendenze.
// Chrome/Edge/Safari la espongono; altrove `dettaturaDisponibile()`
// è false e il pulsante non compare.
// Restituiamo solo i pezzi DEFINITIVI: gli interim cambiano a ogni
// respiro e riscriverebbero la riga sotto le dita di chi scrive.
// Il browser chiude la sessione da solo dopo qualche secondo di
// silenzio (Android quasi subito, desktop dopo ~1 minuto): finché
// l'utente non preme stop la riapriamo, così la dettatura non "cade".
// ============================================================
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export const dettaturaDisponibile = () => !!SR

// errori per cui riprovare non serve: permesso negato o microfono assente
const FATALI = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

let rec = null

export function stopDettatura() {
  const r = rec
  rec = null
  try { r?.stop() } catch { /* già ferma */ }
}

export function startDettatura({ lang = 'it-IT', onText, onEnd, onError } = {}) {
  if (!SR) return false
  stopDettatura()
  let fatale = false
  let riavvii = 0          // riavvii senza aver sentito nulla: evita un giro infinito a vuoto
  const avvia = () => {
    const r = new SR()
    r.lang = lang
    r.continuous = true
    r.interimResults = false
    // un evento può portare più pezzi definitivi: li uniamo e chiamiamo onText UNA volta,
    // così chi riceve non lavora due volte sullo stesso stato
    r.onresult = (e) => {
      riavvii = 0
      const parti = []
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue
        const t = (e.results[i][0]?.transcript || '').trim()
        if (t) parti.push(t)
      }
      if (parti.length) onText?.(parti.join(' '))
    }
    r.onerror = (e) => {
      const err = e?.error || 'errore'
      if (FATALI.has(err)) { fatale = true; if (rec === r) rec = null; onError?.(err) }
      // no-speech / network / aborted: ci pensa onend a ripartire
    }
    r.onend = () => {
      if (rec !== r) return                       // fermata dall'utente (o sostituita)
      // ponytail: tetto fisso di 20 riavvii muti (~qualche minuto di silenzio), poi si spegne
      if (!fatale && riavvii++ < 20) {
        try { const n = avvia(); rec = n; return } catch { /* cade sotto */ }
      }
      rec = null
      onEnd?.()
    }
    r.start()
    return r
  }
  try { rec = avvia() } catch { return false }
  return true
}
