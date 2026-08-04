// ============================================================
// TODAY — logica pura della sezione "oggi".
// Nessun React, nessun accesso a rete o localStorage: solo funzioni
// deterministiche su dati semplici, così sono testabili e i bug
// (rollover, streak, ricorrenze) si vedono subito invece che
// settimane dopo.
//
// Convenzione date: ovunque si usa la chiave 'YYYY-MM-DD' in ora
// LOCALE, la stessa già usata da `activity.js` e dal campo `due`
// dei blocchi. Le Date vengono costruite a mezzogiorno per non
// farsi spostare di un giorno dall'ora legale.
// ============================================================

const p2 = (n) => String(n).padStart(2, '0')

// --- chiavi giorno -------------------------------------------------
export function dayKey(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
export function todayKey() { return dayKey(new Date()) }

// Ordina le task completate in fondo senza spezzare la gerarchia. L'ordinamento
// avviene fra fratelli a ogni livello: un sotto-albero si muove sempre intero e
// scende fra i completati solo quando tutte le sue righe sono concluse.
// Normalizziamo anche eventuali rientri impossibili (per esempio una prima riga
// a livello 2), così dati vecchi o arrivati da due dispositivi non si agganciano
// per errore al ramo precedente.
export function fatteInFondo(task = [], maxIndent = 6) {
  let prev = -1
  const normalizzate = task.filter(Boolean).map((t, i) => {
    const raw = Math.max(0, Math.min(Number(t.indent) || 0, maxIndent))
    const indent = i === 0 ? 0 : Math.min(raw, prev + 1)
    prev = indent
    return { ...t, indent }
  })

  const radici = []
  const stack = []
  for (const task of normalizzate) {
    const nodo = { task, figli: [] }
    const depth = task.indent || 0
    if (depth === 0) radici.push(nodo)
    else stack[depth - 1].figli.push(nodo)
    stack.length = depth
    stack[depth] = nodo
  }

  const ordina = (nodi) => nodi
    .map((nodo, indice) => {
      nodo.figli = ordina(nodo.figli)
      const chiuso = !!nodo.task.done && nodo.figli.every(figlio => figlio.chiuso)
      return { ...nodo, chiuso, indice }
    })
    .sort((a, b) => Number(a.chiuso) - Number(b.chiuso) || a.indice - b.indice)

  const out = []
  const visita = (nodi) => nodi.forEach(nodo => {
    out.push(nodo.task)
    visita(nodo.figli)
  })
  visita(ordina(radici))
  return out
}

// 'YYYY-MM-DD' -> Date locale a mezzogiorno (immune ai salti DST).
export function parseDay(key) {
  if (typeof key !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0)
  return isNaN(d.getTime()) ? null : d
}
export function addDays(key, n) {
  const d = parseDay(key); if (!d) return null
  d.setDate(d.getDate() + n)
  return dayKey(d)
}
// giorni di calendario da `a` a `b` (positivo se b è dopo a)
export function diffDays(a, b) {
  const da = parseDay(a), db = parseDay(b)
  if (!da || !db) return NaN
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}
export function lastDayOfMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate()
}
// lunedì della settimana di `key` (settimana ISO: lun-dom)
export function weekStart(key) {
  const d = parseDay(key); if (!d) return null
  const dow = (d.getDay() + 6) % 7   // 0 = lunedì
  d.setDate(d.getDate() - dow)
  return dayKey(d)
}

// ============================================================
// RICORRENZE
// ============================================================

// La regola è "viva" nel giorno `key`? (attiva, dentro dal..al)
function regolaViva(r, key) {
  if (!r || r.attiva === false) return false
  if (r.dal && diffDays(r.dal, key) < 0) return false
  if (r.al && diffDays(r.al, key) > 0) return false
  return true
}

// La regola `r` produce un'occorrenza nel giorno `key`?
export function occorreIl(r, key) {
  const d = parseDay(key)
  if (!d || !regolaViva(r, key)) return false
  const giorni = Array.isArray(r.giorni) ? r.giorni : []

  switch (r.tipo) {
    case 'giornaliera':
      return true

    case 'settimanale':
      // 0 = domenica … 6 = sabato (come Date.getDay)
      return giorni.includes(d.getDay())

    case 'mensile': {
      // se il mese è più corto del giorno richiesto, l'occorrenza cade
      // sull'ULTIMO giorno del mese: non si salta mai un'occorrenza.
      const last = lastDayOfMonth(d.getFullYear(), d.getMonth())
      const dom = d.getDate()
      return giorni.some(g => Math.min(Math.max(1, g | 0), last) === dom)
    }

    case 'intervallo': {
      const ogni = Math.max(1, r.ogni | 0)
      const delta = diffDays(r.dal, key)
      return Number.isFinite(delta) && delta >= 0 && delta % ogni === 0
    }

    default:
      return false
  }
}

// Tutte le occorrenze della regola nell'intervallo [dalKey, alKey].
// `max` è una cintura di sicurezza contro intervalli assurdi.
export function occorrenze(r, dalKey, alKey, max = 400) {
  const out = []
  let k = dalKey
  const span = diffDays(dalKey, alKey)
  if (!Number.isFinite(span) || span < 0) return out
  for (let i = 0; i <= span && out.length < max; i++) {
    if (occorreIl(r, k)) out.push(k)
    k = addDays(k, 1)
  }
  return out
}

// Anteprima "prossime N occorrenze" per il pannello regole.
export function prossimeOccorrenze(r, daKey, n = 5, orizzonte = 400) {
  const out = []
  let k = daKey
  for (let i = 0; i < orizzonte && out.length < n; i++) {
    if (occorreIl(r, k)) out.push(k)
    k = addDays(k, 1)
  }
  return out
}

// Calcola quali istanze di task vanno create per le regole ricorrenti.
// NON scrive nulla: ritorna le righe da inserire e gli aggiornamenti di
// `ultima_gen`, così il chiamante decide come persisterli.
//
// - genera al massimo `maxIndietro` giorni nel passato: se l'app resta
//   chiusa un mese non deve materializzare 30 task arretrate;
// - salta le occorrenze per cui esiste già una task (idempotenza lato
//   client; lato Supabase c'è comunque l'indice unico).
export function pianificaRicorrenti({ regole = [], task = [], oggi = todayKey(), maxIndietro = 7 } = {}) {
  const daCreare = []
  const genUpdates = []

  // set delle coppie regola|giorno già materializzate
  const esistenti = new Set()
  for (const t of task) {
    if (t && t.ricorrenza_id) esistenti.add(`${t.ricorrenza_id}|${t.giorno}`)
  }

  const minKey = addDays(oggi, -Math.max(0, maxIndietro))

  for (const r of regole) {
    if (!r || r.attiva === false) continue
    // da dove riprendere: il giorno dopo l'ultima generazione, ma mai
    // oltre `maxIndietro` giorni indietro e mai prima dell'inizio regola.
    let from = r.ultima_gen ? addDays(r.ultima_gen, 1) : oggi
    if (!from || diffDays(from, minKey) > 0) from = minKey   // non più indietro di maxIndietro
    if (r.dal && diffDays(from, r.dal) > 0) from = r.dal      // né prima dell'inizio della regola
    if (diffDays(from, oggi) < 0) { // regola futura: niente da fare ora
      continue
    }

    for (const k of occorrenze(r, from, oggi)) {
      if (esistenti.has(`${r.id}|${k}`)) continue
      esistenti.add(`${r.id}|${k}`)
      daCreare.push({
        giorno: k,
        text: r.text || '',
        done: false,
        ordine: r.ordine || 0,
        ricorrenza_id: r.id,
        vista_id: r.vista_id || null,
        blocco_id: r.blocco_id || null,
        origin_giorno: k,
        rollover: 0,
      })
    }
    if (r.ultima_gen !== oggi) genUpdates.push({ id: r.id, ultima_gen: oggi })
  }

  return { daCreare, genUpdates }
}

// ============================================================
// ROLLOVER
// ============================================================

// Le task aperte dei giorni passati passano a oggi.
// Regole:
//  - le task COMPLETATE restano sul loro giorno (lo storico dice la verità);
//  - le RICORRENTI non vengono mai rimandate: resta l'istanza del giorno
//    nuovo, quella vecchia rimane aperta nel passato. Rimandare una
//    ricorrente crea una scia infinita di debiti.
// Ritorna solo le patch da applicare: nessuna scrittura qui dentro.
export function pianificaRollover({ task = [], oggi = todayKey() } = {}) {
  const patches = []
  for (const t of task) {
    if (!t || t.done) continue
    if (t.ricorrenza_id) continue
    const d = diffDays(t.giorno, oggi)
    if (!Number.isFinite(d) || d <= 0) continue
    patches.push({
      id: t.id,
      patch: {
        giorno: oggi,
        rollover: (t.rollover || 0) + 1,
        origin_giorno: t.origin_giorno || t.giorno,
      },
    })
  }
  return patches
}

// ============================================================
// METRICHE
// ============================================================

export function taskDelGiorno(task, key) {
  return (task || []).filter(t => t && t.giorno === key)
}

// Una task "a metà" (parziale) non è chiusa — resta aperta e fa rollover —
// ma nella barra vale mezzo passo: il progresso deve dire la verità anche
// quando la giornata è fatta di cose iniziate e non finite.
export function completamento(task) {
  const tot = (task || []).length
  const done = (task || []).filter(t => t && t.done).length
  const mezze = (task || []).filter(t => t && !t.done && t.parziale).length
  const peso = done + mezze * 0.5
  return { done, mezze, tot, pct: tot ? Math.round((peso / tot) * 100) : 0 }
}

// Raggruppa le task per giorno: { 'YYYY-MM-DD': { tot, done } }
export function perGiorno(task) {
  const map = {}
  for (const t of task || []) {
    if (!t || !t.giorno) continue
    const m = map[t.giorno] || (map[t.giorno] = { tot: 0, done: 0 })
    m.tot++
    if (t.done) m.done++
  }
  return map
}

// Streak "gentile":
//  - conta i giorni consecutivi con ALMENO una task chiusa;
//  - un giorno senza NESSUNA task pianificata è neutro: non spezza
//    la serie e non la incrementa (le vacanze non sono un fallimento);
//  - una grazia per mese di calendario: un solo giorno mancato non
//    azzera, mette la serie "in pausa". Il secondo la chiude;
//  - oggi non conta come mancato se non è ancora finito.
export function streak(task, oggi = todayKey()) {
  const map = perGiorno(task)
  const chiavi = Object.keys(map).sort()
  if (!chiavi.length) return { attuale: 0, record: 0, inPausa: false }

  // --- serie corrente: si cammina all'indietro da oggi ---
  const camminaIndietro = (daKey, saltaPrimoMancato) => {
    let n = 0, inPausa = false
    const grazie = new Set()
    let k = daKey
    let primo = true
    while (diffDays(chiavi[0], k) >= 0) {
      const g = map[k]
      if (!g || g.tot === 0) { k = addDays(k, -1); primo = false; continue }  // neutro
      if (g.done > 0) { n++; k = addDays(k, -1); primo = false; continue }
      // giorno mancato
      if (primo && saltaPrimoMancato) { k = addDays(k, -1); primo = false; continue } // oggi non è finito
      const mese = k.slice(0, 7)
      if (!grazie.has(mese)) { grazie.add(mese); inPausa = true; k = addDays(k, -1); primo = false; continue }
      break
    }
    return { attuale: n, inPausa }
  }
  const cur = camminaIndietro(oggi, true)

  // --- record storico: stessa logica in avanti su tutto lo storico ---
  let record = 0, run = 0
  const grazie = new Set()
  let k = chiavi[0]
  while (diffDays(k, oggi) >= 0) {
    const g = map[k]
    if (!g || g.tot === 0) { k = addDays(k, 1); continue }
    if (g.done > 0) { run++; if (run > record) record = run }
    else {
      const mese = k.slice(0, 7)
      if (!grazie.has(mese)) grazie.add(mese)   // grazia: la serie prosegue
      else { run = 0; grazie.clear() }
    }
    k = addDays(k, 1)
  }
  if (cur.attuale > record) record = cur.attuale

  return { attuale: cur.attuale, record, inPausa: cur.inPausa }
}

// Percentuale di task rimandate almeno una volta.
export function tassoDiRinvio(task) {
  const list = (task || []).filter(Boolean)
  if (!list.length) return 0
  const rinviate = list.filter(t => (t.rollover || 0) > 0).length
  return Math.round((rinviate / list.length) * 100)
}

// Istogramma 24 bin dell'ora di chiusura (da done_at).
export function oreDiChiusura(task) {
  const bins = new Array(24).fill(0)
  for (const t of task || []) {
    if (!t || !t.done || !t.done_at) continue
    const d = new Date(t.done_at)
    if (isNaN(d.getTime())) continue
    bins[d.getHours()]++
  }
  return bins
}

// Tenuta delle abitudini: per ogni regola, chiuse / generate.
export function tenutaRicorrenti(task, regole) {
  const out = new Map()
  for (const r of regole || []) out.set(r.id, { id: r.id, text: r.text, generate: 0, chiuse: 0, pct: 0 })
  for (const t of task || []) {
    if (!t || !t.ricorrenza_id) continue
    const row = out.get(t.ricorrenza_id)
    if (!row) continue
    row.generate++
    if (t.done) row.chiuse++
  }
  for (const row of out.values()) row.pct = row.generate ? Math.round((row.chiuse / row.generate) * 100) : 0
  return [...out.values()]
}

// ============================================================
// STORICO / GRAFICI
// ============================================================
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

// Bucket per i grafici. `hasData: false` distingue "nessun dato" da
// "zero task": i grafici devono disegnarli in modo diverso (tratteggio
// vs barra a zero), perché lo storico non esiste prima di oggi.
export function bucketize(task, range = 'day', oggi = todayKey(), n) {
  const map = perGiorno(task)
  const out = []
  const push = (key, label, tot, done, hasData) =>
    out.push({ key, label, tot, done, hasData, pct: tot ? Math.round((done / tot) * 100) : 0 })

  if (range === 'day') {
    const giorni = n || 30
    for (let i = giorni - 1; i >= 0; i--) {
      const k = addDays(oggi, -i)
      const d = parseDay(k)
      const g = map[k]
      push(k, `${d.getDate()}/${d.getMonth() + 1}`, g?.tot || 0, g?.done || 0, !!g)
    }
  } else if (range === 'week') {
    const sett = n || 12
    const cur = weekStart(oggi)
    for (let i = sett - 1; i >= 0; i--) {
      const start = addDays(cur, -i * 7)
      let tot = 0, done = 0, has = false
      for (let d = 0; d < 7; d++) {
        const g = map[addDays(start, d)]
        if (g) { has = true; tot += g.tot; done += g.done }
      }
      const ds = parseDay(start)
      push(start, `${ds.getDate()}/${ds.getMonth() + 1}`, tot, done, has)
    }
  } else if (range === 'month') {
    const mesi = n || 12
    const oggiD = parseDay(oggi)
    for (let i = mesi - 1; i >= 0; i--) {
      const d = new Date(oggiD.getFullYear(), oggiD.getMonth() - i, 1)
      const pref = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`
      let tot = 0, done = 0, has = false
      for (const [k, g] of Object.entries(map)) {
        if (k.startsWith(pref)) { has = true; tot += g.tot; done += g.done }
      }
      push(pref, `${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, tot, done, has)
    }
  } else { // year
    const anni = new Set(Object.keys(map).map(k => k.slice(0, 4)))
    anni.add(oggi.slice(0, 4))
    for (const y of [...anni].sort()) {
      let tot = 0, done = 0, has = false
      for (const [k, g] of Object.entries(map)) {
        if (k.startsWith(y)) { has = true; tot += g.tot; done += g.done }
      }
      push(y, y, tot, done, has)
    }
  }
  return out
}

// Heatmap annuale stile contribution graph: 53 colonne × 7 righe.
// Ritorna { celle: [{key, done, tot, hasData, col, row}], settimane }
export function heatmapAnno(task, oggi = todayKey(), giorni = 371) {
  const map = perGiorno(task)
  const celle = []
  // si parte dal lunedì della settimana di (oggi - giorni)
  const start = weekStart(addDays(oggi, -(giorni - 1)))
  const span = diffDays(start, oggi)
  for (let i = 0; i <= span; i++) {
    const k = addDays(start, i)
    const g = map[k]
    celle.push({
      key: k,
      tot: g?.tot || 0,
      done: g?.done || 0,
      hasData: !!g,
      col: Math.floor(i / 7),
      row: i % 7,
    })
  }
  return { celle, settimane: Math.ceil((span + 1) / 7) }
}

// Riepilogo della settimana che si chiude (lun-dom della data indicata):
// task chiuse, giorno migliore, mood medio e le vittorie annotate la sera.
// Serve al riquadro "La tua settimana": guardare indietro sette giorni è la
// dose giusta per accorgersi di aver fatto qualcosa.
export function riepilogoSettimana(task, giorni = [], oggi = todayKey()) {
  const start = weekStart(oggi)
  const chiavi = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const set = new Set(chiavi)
  const map = perGiorno((task || []).filter(t => set.has(t.giorno)))

  let chiuse = 0, pianificate = 0, migliore = null
  for (const k of chiavi) {
    const g = map[k]
    if (!g) continue
    chiuse += g.done
    pianificate += g.tot
    if (!migliore || g.done > map[migliore].done) migliore = k
  }
  if (migliore && map[migliore].done === 0) migliore = null

  const dellaSett = (giorni || []).filter(g => set.has(g.giorno))
  const moods = dellaSett.map(g => g.mood).filter(m => typeof m === 'number' && m >= 1)
  const moodMedio = moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null
  const vittorie = dellaSett.filter(g => (g.vittoria || '').trim())
    .sort((a, b) => (a.giorno < b.giorno ? -1 : 1))
    .map(g => ({ giorno: g.giorno, vittoria: g.vittoria.trim() }))

  // Non solo QUANTO, ma COSA: le task davvero portate a casa, giorno per giorno.
  // Un numero si dimentica; l'elenco di quello che hai chiuso no.
  const fatte = chiavi
    .map(k => ({
      giorno: k,
      task: (task || [])
        .filter(t => t && t.giorno === k && t.done)
        .sort((a, b) => (a.ordine || 0) - (b.ordine || 0))
        .map(t => ({ id: t.id, text: (t.text || '').trim() || 'Senza testo' })),
    }))
    .filter(g => g.task.length)

  return { start, fine: chiavi[6], chiuse, pianificate, migliore, moodMedio, vittorie, fatte }
}

// ============================================================
// PROPOSTE
// ============================================================

// Righe con scadenza ≤ oggi che non sono ancora task di Today.
// Esclusioni: template, visioni archiviate, visione di sistema
// '__templates__', righe già spuntate.
export function proposte({ viste = [], visioni = [], task = [], oggi = todayKey(), limite = 20 } = {}) {
  const visById = new Map(visioni.map(v => [v.id, v]))
  const gia = new Set()
  for (const t of task || []) {
    if (t && t.vista_id && t.blocco_id) gia.add(`${t.vista_id}|${t.blocco_id}`)
  }

  const out = []
  for (const v of viste) {
    if (!v || v.is_template) continue
    const vis = visById.get(v.visione_id)
    if (!vis) continue
    if (vis.archiviata) continue
    if (vis.titolo === '__templates__' || vis.sistema) continue
    for (const b of v.blocchi || []) {
      if (!b || !b.due || b.done) continue
      if (diffDays(b.due, oggi) < 0) continue      // scadenza futura: non è roba di oggi
      if (gia.has(`${v.id}|${b.id}`)) continue
      const testo = (b.text || '').replace(/[#*`>]/g, '').trim()
      if (!testo) continue
      out.push({
        vista_id: v.id, blocco_id: b.id, text: testo, due: b.due,
        vista: v.titolo || 'Senza titolo', visione: vis.titolo,
        scaduta: diffDays(b.due, oggi) > 0,
      })
    }
  }
  // prima le scadute (più vecchie in cima), poi quelle di oggi
  out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
  return out.slice(0, limite)
}
