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
// letto a ogni uso (non al caricamento): così si può sostituire nei test
const getSR = () => typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export const dettaturaDisponibile = () => !!getSR()

// errori per cui riprovare non serve: permesso negato o microfono assente
const FATALI = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

let rec = null

export function stopDettatura() {
  const r = rec
  rec = null
  try { r?.stop() } catch { /* già ferma */ }
}

// onStato({ fase, sentito, errore }) racconta cosa succede, per il feedback a schermo:
//   fase: 'avvio' (chiesto il microfono) · 'ascolto' (microfono aperto) ·
//         'voce' (sta sentendo parlare) · 'riavvio' (sessione caduta, riparte)
//   sentito: testo provvisorio mentre parli (NON finisce nella riga)
//   errore: ultimo errore non fatale del browser (no-speech, network…)
export function startDettatura({ lang = 'it-IT', onText, onEnd, onError, onStato } = {}) {
  const SR = getSR()
  if (!SR) return false
  stopDettatura()
  let fatale = false
  let riavvii = 0          // riavvii senza aver sentito nulla: evita un giro infinito a vuoto
  const avvia = () => {
    const r = new SR()
    r.lang = lang
    r.continuous = true
    r.interimResults = true   // i provvisori servono SOLO al feedback; in riga vanno i definitivi
    const stato = (s) => { if (rec === r) onStato?.(s) }
    r.onstart = () => stato({ fase: 'ascolto' })
    r.onaudiostart = () => stato({ fase: 'ascolto' })
    r.onspeechstart = () => stato({ fase: 'voce' })
    r.onspeechend = () => stato({ fase: 'ascolto' })
    // un evento può portare più pezzi definitivi: li uniamo e chiamiamo onText UNA volta,
    // così chi riceve non lavora due volte sullo stesso stato
    r.onresult = (e) => {
      riavvii = 0
      const parti = []
      let provv = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i][0]?.transcript || '').trim()
        if (!t) continue
        if (e.results[i].isFinal) parti.push(t); else provv += (provv ? ' ' : '') + t
      }
      stato({ fase: 'voce', sentito: provv || parti.join(' ') })
      if (parti.length) onText?.(parti.join(' '))
    }
    r.onerror = (e) => {
      const err = e?.error || 'errore'
      if (FATALI.has(err)) { fatale = true; if (rec === r) rec = null; onError?.(err); return }
      // no-speech / network / aborted: ci pensa onend a ripartire, ma lo diciamo
      stato({ fase: 'ascolto', errore: err })
    }
    r.onend = () => {
      if (rec !== r) return                       // fermata dall'utente (o sostituita)
      // ponytail: tetto fisso di 20 riavvii muti (~qualche minuto di silenzio), poi si spegne
      if (!fatale && riavvii++ < 20) {
        try { onStato?.({ fase: 'riavvio' }); const n = avvia(); rec = n; return } catch { /* cade sotto */ }
      }
      rec = null
      onEnd?.()
    }
    r.start()
    return r
  }
  onStato?.({ fase: 'avvio' })
  try { rec = avvia() } catch { return false }
  return true
}
