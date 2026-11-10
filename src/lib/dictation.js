// ============================================================
// Dettatura vocale — Web Speech API del browser, zero dipendenze.
// Chrome/Edge/Safari la espongono; altrove `dettaturaDisponibile()`
// è false e il pulsante non compare.
// Restituiamo solo i pezzi DEFINITIVI: gli interim cambiano a ogni
// respiro e riscriverebbero la riga sotto le dita di chi scrive.
// Il browser chiude la sessione da solo (Android a ogni frase, desktop
// dopo un po' di silenzio): se ha sentito voce la riapriamo, così si
// detta di seguito; se era muta ci fermiamo.
// ============================================================
// letto a ogni uso (non al caricamento): così si può sostituire nei test
const getSR = () => typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export const dettaturaDisponibile = () => !!getSR()

// errori per cui riprovare non serve: permesso negato o microfono assente
const FATALI = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

let rec = null
// Chrome Android: in modalità continua le sessioni si chiudono a ogni frase e
// spesso perdono l'ultima. Lì una sessione = una frase, poi si riapre.
const ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

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
// onEnd({ errore }) quando si spegne da sola.
export function startDettatura({ lang = 'it-IT', onText, onEnd, onError, onStato } = {}) {
  const SR = getSR()
  if (!SR) return false
  stopDettatura()
  let ultimoErr = null
  const avvia = () => {
    const r = new SR()
    let sentito = false     // questa sessione ha sentito qualcosa? Solo allora si riapre
    let provv = ''          // testo provvisorio non ancora confermato dal browser
    let fatale = false
    r.lang = lang
    r.continuous = !ANDROID
    r.interimResults = true   // i provvisori servono al feedback (e a non perdere l'ultima frase)
    const stato = (s) => { if (rec === r) onStato?.(s) }
    r.onstart = () => stato({ fase: 'ascolto' })
    r.onspeechstart = () => { sentito = true; stato({ fase: 'voce' }) }
    r.onspeechend = () => stato({ fase: 'ascolto' })
    // un evento può portare più pezzi definitivi: li uniamo e chiamiamo onText UNA volta,
    // così chi riceve non lavora due volte sullo stesso stato
    r.onresult = (e) => {
      sentito = true; ultimoErr = null
      const parti = []
      provv = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i][0]?.transcript || '').trim()
        if (!t) continue
        if (e.results[i].isFinal) parti.push(t); else provv += (provv ? ' ' : '') + t
      }
      stato({ fase: 'voce', sentito: provv || parti.join(' ') })
      if (parti.length && rec === r) onText?.(parti.join(' '))
    }
    r.onerror = (e) => {
      const err = e?.error || 'errore'
      if (FATALI.has(err)) { fatale = true; if (rec === r) rec = null; onError?.(err); return }
      ultimoErr = err
      stato({ fase: 'ascolto', errore: err })
    }
    r.onend = () => {
      if (rec !== r) return                       // fermata dall'utente (o sostituita)
      // bug Android: la sessione si chiude con l'ultima frase ancora "provvisoria".
      // Era detta davvero: la scriviamo noi.
      if (provv) { onText?.(provv); provv = '' }
      // Sessione muta (silenzio, o il telefono non capta): NON si riapre. Riaprire a
      // vuoto faceva chiudere e riaprire il microfono di continuo.
      if (fatale || !sentito) { rec = null; onEnd?.({ errore: ultimoErr }); return }
      onStato?.({ fase: 'riavvio' })
      // pausa: su Android il microfono va liberato prima di riaprirlo
      setTimeout(() => {
        if (rec !== r) return                     // nel frattempo l'utente ha premuto stop
        try { rec = avvia() } catch (e) { rec = null; onEnd?.({ errore: e?.name || 'start' }) }
      }, 250)
    }
    r.start()
    return r
  }
  onStato?.({ fase: 'avvio' })
  try { rec = avvia() } catch { return false }
  return true
}
