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
const SILENZIO_MS = 10000   // 10 s senza voce: la dettatura si ferma da sola
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
  // Silenzio tollerato: si continua a riaprire finché sono passati meno di
  // SILENZIO_MS dall'avvio o dall'ultima voce sentita. Senza, su Android si
  // fermava al primo ascolto (si chiude prima che si cominci a parlare).
  let ultimoSegno = Date.now()
  // diario degli eventi del microfono, mostrato a schermo: serve a capire dal
  // telefono cosa fa davvero il browser
  const diario = []
  const segna = (ev) => { diario.push(ev); if (diario.length > 8) diario.shift(); onStato?.({ diario: diario.slice() }) }
  const avvia = () => {
    const r = new SR()
    const t0 = Date.now()
    let sentito = false     // questa sessione ha sentito qualcosa? Solo allora si riapre
    let provv = ''          // testo provvisorio non ancora confermato dal browser
    let fatale = false
    r.lang = lang
    r.continuous = !ANDROID
    r.interimResults = true   // i provvisori servono al feedback (e a non perdere l'ultima frase)
    const stato = (s) => { if (rec === r) onStato?.(s) }
    r.onstart = () => { segna('start'); stato({ fase: 'ascolto' }) }
    r.onaudiostart = () => segna('audio')
    r.onspeechstart = () => { sentito = true; ultimoSegno = Date.now(); segna('voce'); stato({ fase: 'voce' }) }
    r.onspeechend = () => stato({ fase: 'ascolto' })
    // un evento può portare più pezzi definitivi: li uniamo e chiamiamo onText UNA volta,
    // così chi riceve non lavora due volte sullo stesso stato
    r.onresult = (e) => {
      sentito = true; ultimoErr = null; ultimoSegno = Date.now()
      const parti = []
      provv = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i][0]?.transcript || '').trim()
        if (!t) continue
        if (e.results[i].isFinal) parti.push(t); else provv += (provv ? ' ' : '') + t
      }
      stato({ fase: 'voce', sentito: provv || parti.join(' ') })
      if (parti.length && rec === r) { segna('testo'); onText?.(parti.join(' ')) }
    }
    r.onerror = (e) => {
      const err = e?.error || 'errore'
      if (FATALI.has(err)) { fatale = true; if (rec === r) rec = null; onError?.(err); return }
      ultimoErr = err
      segna('err:' + err)
      stato({ fase: 'ascolto', errore: err })
    }
    r.onend = () => {
      if (rec !== r) return                       // fermata dall'utente (o sostituita)
      segna('fine ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
      // bug Android: la sessione si chiude con l'ultima frase ancora "provvisoria".
      // Era detta davvero: la scriviamo noi.
      if (provv) { segna('testo*'); onText?.(provv); provv = '' }
      // Troppo silenzio (o il telefono non capta): ci si ferma. Riaprire a vuoto
      // all'infinito faceva chiudere e riaprire il microfono di continuo.
      // 'network' senza aver sentito nulla = il servizio vocale del browser non
      // risponde (Brave, Opera, Chromium… espongono l'API ma non il servizio):
      // riprovare non serve
      const morto = !sentito && ultimoErr === 'network'
      if (fatale || morto || (!sentito && Date.now() - ultimoSegno > SILENZIO_MS)) { rec = null; onEnd?.({ errore: ultimoErr, diario: diario.slice() }); return }
      onStato?.({ fase: 'riavvio' })
      // pausa: su Android il microfono va liberato prima di riaprirlo
      setTimeout(() => {
        if (rec !== r) return                     // nel frattempo l'utente ha premuto stop
        try { rec = avvia() } catch (e) { rec = null; onEnd?.({ errore: e?.name || 'start', diario: diario.slice() }) }
      }, 250)
    }
    r.start()
    return r
  }
  onStato?.({ fase: 'avvio' })
  try { rec = avvia() } catch { return false }
  return true
}
