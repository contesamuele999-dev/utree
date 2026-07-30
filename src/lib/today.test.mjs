// ============================================================
// Test della logica di Today. Nessuna dipendenza: si lancia con
//   node --test src/lib/today.test.mjs
// (Node 18+ ha il test runner integrato.)
// ============================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dayKey, parseDay, addDays, diffDays, weekStart, lastDayOfMonth,
  occorreIl, occorrenze, prossimeOccorrenze,
  pianificaRicorrenti, pianificaRollover,
  completamento, perGiorno, streak, tassoDiRinvio, oreDiChiusura,
  tenutaRicorrenti, bucketize, heatmapAnno, proposte, riepilogoSettimana,
} from './today.js'

// ---------- date ----------
test('date: parse, add, diff', () => {
  assert.equal(dayKey(parseDay('2026-07-25')), '2026-07-25')
  assert.equal(addDays('2026-07-25', 7), '2026-08-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(diffDays('2026-07-25', '2026-07-28'), 3)
  assert.equal(diffDays('2026-07-28', '2026-07-25'), -3)
  assert.equal(parseDay('non-una-data'), null)
})

test('date: il cambio di ora legale non sposta il giorno', () => {
  // 29 marzo 2026: in Italia si passa all'ora legale
  assert.equal(addDays('2026-03-28', 1), '2026-03-29')
  assert.equal(addDays('2026-03-29', 1), '2026-03-30')
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2)
  // e in autunno (25 ottobre 2026)
  assert.equal(addDays('2026-10-24', 2), '2026-10-26')
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2)
})

test('date: weekStart è sempre lunedì', () => {
  assert.equal(weekStart('2026-07-25'), '2026-07-20') // sabato -> lunedì 20
  assert.equal(weekStart('2026-07-20'), '2026-07-20') // lunedì -> se stesso
  assert.equal(weekStart('2026-07-26'), '2026-07-20') // domenica -> lunedì precedente
  assert.equal(lastDayOfMonth(2026, 1), 28)           // feb 2026
  assert.equal(lastDayOfMonth(2024, 1), 29)           // feb bisestile
})

// ---------- ricorrenze ----------
test('ricorrenza giornaliera: ogni giorno dentro il periodo', () => {
  const r = { id: 'r1', tipo: 'giornaliera', dal: '2026-07-01', al: '2026-07-03', attiva: true }
  assert.deepEqual(occorrenze(r, '2026-06-28', '2026-07-06'),
    ['2026-07-01', '2026-07-02', '2026-07-03'])
})

test('ricorrenza settimanale: lun/mer/ven', () => {
  const r = { id: 'r2', tipo: 'settimanale', giorni: [1, 3, 5], dal: '2026-07-20', attiva: true }
  // lun 20, mer 22, ven 24, lun 27
  assert.deepEqual(occorrenze(r, '2026-07-20', '2026-07-27'),
    ['2026-07-20', '2026-07-22', '2026-07-24', '2026-07-27'])
})

test('ricorrenza mensile: il 31 cade sull ultimo giorno dei mesi corti', () => {
  const r = { id: 'r3', tipo: 'mensile', giorni: [31], dal: '2026-01-01', attiva: true }
  const occ = occorrenze(r, '2026-01-01', '2026-06-30')
  assert.deepEqual(occ, [
    '2026-01-31',
    '2026-02-28', // febbraio: ultimo giorno, non saltato
    '2026-03-31',
    '2026-04-30', // aprile ha 30 giorni
    '2026-05-31',
    '2026-06-30',
  ])
})

test('ricorrenza mensile: giorni multipli senza duplicati', () => {
  const r = { id: 'r4', tipo: 'mensile', giorni: [1, 15], dal: '2026-07-01', attiva: true }
  assert.deepEqual(occorrenze(r, '2026-07-01', '2026-08-01'),
    ['2026-07-01', '2026-07-15', '2026-08-01'])
})

test('ricorrenza a intervallo: ogni 3 giorni da dal', () => {
  const r = { id: 'r5', tipo: 'intervallo', ogni: 3, dal: '2026-07-20', attiva: true }
  assert.deepEqual(occorrenze(r, '2026-07-20', '2026-07-30'),
    ['2026-07-20', '2026-07-23', '2026-07-26', '2026-07-29'])
  // prima di `dal` non esiste nulla
  assert.equal(occorreIl(r, '2026-07-17'), false)
})

test('ricorrenza disattivata o scaduta non produce occorrenze', () => {
  const spenta = { id: 'r6', tipo: 'giornaliera', dal: '2026-07-01', attiva: false }
  assert.deepEqual(occorrenze(spenta, '2026-07-01', '2026-07-05'), [])
  const finita = { id: 'r7', tipo: 'giornaliera', dal: '2026-07-01', al: '2026-07-02', attiva: true }
  assert.deepEqual(occorrenze(finita, '2026-07-03', '2026-07-05'), [])
})

test('prossimeOccorrenze: anteprima per il pannello regole', () => {
  const r = { id: 'r8', tipo: 'settimanale', giorni: [0], dal: '2026-07-01', attiva: true } // domenica
  assert.deepEqual(prossimeOccorrenze(r, '2026-07-25', 3),
    ['2026-07-26', '2026-08-02', '2026-08-09'])
})

// ---------- generazione istanze ----------
test('generazione ricorrenti: crea le istanze di oggi', () => {
  const regole = [{ id: 'r1', tipo: 'giornaliera', text: 'Stretching', dal: '2026-07-01', attiva: true, ultima_gen: '2026-07-24' }]
  const { daCreare, genUpdates } = pianificaRicorrenti({ regole, task: [], oggi: '2026-07-25' })
  assert.equal(daCreare.length, 1)
  assert.equal(daCreare[0].giorno, '2026-07-25')
  assert.equal(daCreare[0].text, 'Stretching')
  assert.equal(daCreare[0].ricorrenza_id, 'r1')
  assert.deepEqual(genUpdates, [{ id: 'r1', ultima_gen: '2026-07-25' }])
})

test('generazione ricorrenti: idempotente (due aperture, due device)', () => {
  const regole = [{ id: 'r1', tipo: 'giornaliera', text: 'Stretching', dal: '2026-07-01', attiva: true }]
  const primo = pianificaRicorrenti({ regole, task: [], oggi: '2026-07-25' })
  assert.equal(primo.daCreare.length, 1)
  // simuliamo che l'altro device abbia già creato l'istanza
  const gia = [{ id: 't1', giorno: '2026-07-25', ricorrenza_id: 'r1', done: false }]
  const secondo = pianificaRicorrenti({ regole, task: gia, oggi: '2026-07-25' })
  assert.equal(secondo.daCreare.length, 0)
})

test('generazione ricorrenti: app chiusa un mese -> max 7 giorni recuperati', () => {
  const regole = [{ id: 'r1', tipo: 'giornaliera', text: 'Stretching', dal: '2026-01-01', attiva: true, ultima_gen: '2026-06-01' }]
  const { daCreare } = pianificaRicorrenti({ regole, task: [], oggi: '2026-07-25' })
  assert.equal(daCreare.length, 8) // da 2026-07-18 a 2026-07-25 inclusi
  assert.equal(daCreare[0].giorno, '2026-07-18')
  assert.equal(daCreare[daCreare.length - 1].giorno, '2026-07-25')
})

test('generazione ricorrenti: regola futura non genera nulla', () => {
  const regole = [{ id: 'r1', tipo: 'giornaliera', text: 'Dopo', dal: '2026-09-01', attiva: true }]
  const { daCreare } = pianificaRicorrenti({ regole, task: [], oggi: '2026-07-25' })
  assert.equal(daCreare.length, 0)
})

// ---------- rollover ----------
test('rollover: le aperte passano a oggi, le chiuse restano indietro', () => {
  const task = [
    { id: 'a', giorno: '2026-07-23', done: false },
    { id: 'b', giorno: '2026-07-24', done: true },
    { id: 'c', giorno: '2026-07-25', done: false },   // già oggi
  ]
  const p = pianificaRollover({ task, oggi: '2026-07-25' })
  assert.equal(p.length, 1)
  assert.equal(p[0].id, 'a')
  assert.equal(p[0].patch.giorno, '2026-07-25')
  assert.equal(p[0].patch.rollover, 1)
  assert.equal(p[0].patch.origin_giorno, '2026-07-23')
})

test('rollover: le ricorrenti non vengono MAI rimandate', () => {
  const task = [{ id: 'r', giorno: '2026-07-20', done: false, ricorrenza_id: 'r1' }]
  assert.deepEqual(pianificaRollover({ task, oggi: '2026-07-25' }), [])
})

test('rollover: origin_giorno e contatore si conservano nei rinvii successivi', () => {
  const task = [{ id: 'a', giorno: '2026-07-24', done: false, rollover: 2, origin_giorno: '2026-07-10' }]
  const p = pianificaRollover({ task, oggi: '2026-07-25' })
  assert.equal(p[0].patch.rollover, 3)
  assert.equal(p[0].patch.origin_giorno, '2026-07-10')
})

test('rollover: eseguito due volte lo stesso giorno non incrementa due volte', () => {
  const task = [{ id: 'a', giorno: '2026-07-24', done: false }]
  const p1 = pianificaRollover({ task, oggi: '2026-07-25' })
  const dopo = task.map(t => ({ ...t, ...p1.find(p => p.id === t.id).patch }))
  const p2 = pianificaRollover({ task: dopo, oggi: '2026-07-25' })
  assert.deepEqual(p2, [])
})

// ---------- metriche ----------
test('completamento e perGiorno', () => {
  const task = [
    { id: '1', giorno: '2026-07-25', done: true },
    { id: '2', giorno: '2026-07-25', done: false },
    { id: '3', giorno: '2026-07-25', done: true },
  ]
  assert.deepEqual(completamento(task), { done: 2, mezze: 0, tot: 3, pct: 67 })
  assert.deepEqual(perGiorno(task)['2026-07-25'], { tot: 3, done: 2 })
  assert.deepEqual(completamento([]), { done: 0, mezze: 0, tot: 0, pct: 0 })
})

// una task "a metà" resta aperta ma vale mezzo passo nella barra
test('completamento: le task a metà valgono mezzo passo', () => {
  const task = [
    { id: '1', giorno: '2026-07-25', done: true },
    { id: '2', giorno: '2026-07-25', done: false, parziale: true },
    { id: '3', giorno: '2026-07-25', done: false },
    { id: '4', giorno: '2026-07-25', done: false },
  ]
  assert.deepEqual(completamento(task), { done: 1, mezze: 1, tot: 4, pct: 38 })
})

// e continua a fare rollover: non è chiusa
test('rollover: una task a metà passa al giorno dopo', () => {
  const p = pianificaRollover({
    task: [{ id: '1', giorno: '2026-07-24', done: false, parziale: true }],
    oggi: '2026-07-25',
  })
  assert.equal(p.length, 1)
  assert.equal(p[0].patch.giorno, '2026-07-25')
})

const T = (giorno, done) => ({ id: giorno + (done ? 'd' : 'o'), giorno, done })

test('streak: giorni consecutivi con almeno una task chiusa', () => {
  const task = [T('2026-07-23', true), T('2026-07-24', true), T('2026-07-25', true)]
  assert.equal(streak(task, '2026-07-25').attuale, 3)
})

test('streak: un giorno senza task pianificate e neutro, non spezza', () => {
  const task = [T('2026-07-23', true), /* 24 nessuna task */ T('2026-07-25', true)]
  assert.equal(streak(task, '2026-07-25').attuale, 2)
})

test('streak: oggi ancora senza spunte non azzera la serie', () => {
  const task = [T('2026-07-23', true), T('2026-07-24', true), T('2026-07-25', false)]
  const s = streak(task, '2026-07-25')
  assert.equal(s.attuale, 2)
  assert.equal(s.inPausa, false)   // oggi non è ancora finito: non è un giorno mancato
})

test('streak: una grazia al mese fa da ponte, la seconda mancanza chiude', () => {
  // camminando all'indietro da oggi: 25 ok, 24 ok, 23 mancato -> consuma la grazia
  // di luglio (ponte, la serie prosegue), 22 ok, 21 mancato -> grazia finita, stop.
  const task = [
    T('2026-07-20', true), T('2026-07-21', false), T('2026-07-22', true),
    T('2026-07-23', false), T('2026-07-24', true), T('2026-07-25', true),
  ]
  const s = streak(task, '2026-07-25')
  assert.equal(s.attuale, 3)       // 25, 24 e 22: il 23 è stato "graziato"
  assert.equal(s.inPausa, true)    // la serie è viva ma la grazia del mese è spesa
})

test('streak: storico vuoto non esplode', () => {
  assert.deepEqual(streak([], '2026-07-25'), { attuale: 0, record: 0, inPausa: false })
})

test('streak: il record è almeno pari alla serie corrente', () => {
  const task = [T('2026-07-23', true), T('2026-07-24', true), T('2026-07-25', true)]
  const s = streak(task, '2026-07-25')
  assert.ok(s.record >= s.attuale)
})

test('tasso di rinvio e ore di chiusura', () => {
  const task = [
    { id: '1', giorno: '2026-07-25', done: true, rollover: 0, done_at: '2026-07-25T09:30:00Z' },
    { id: '2', giorno: '2026-07-25', done: false, rollover: 2 },
    { id: '3', giorno: '2026-07-25', done: true, rollover: 1, done_at: 'non-una-data' },
    { id: '4', giorno: '2026-07-25', done: false, rollover: 0 },
  ]
  assert.equal(tassoDiRinvio(task), 50)
  const bins = oreDiChiusura(task)
  assert.equal(bins.length, 24)
  assert.equal(bins.reduce((a, b) => a + b, 0), 1)  // la data invalida viene ignorata
  assert.equal(tassoDiRinvio([]), 0)
})

test('tenuta delle ricorrenti: chiuse su generate', () => {
  const regole = [{ id: 'r1', text: 'Stretching' }, { id: 'r2', text: 'Lettura' }]
  const task = [
    { id: '1', giorno: '2026-07-23', done: true, ricorrenza_id: 'r1' },
    { id: '2', giorno: '2026-07-24', done: false, ricorrenza_id: 'r1' },
    { id: '3', giorno: '2026-07-25', done: true, ricorrenza_id: 'r1' },
    { id: '4', giorno: '2026-07-25', done: false, ricorrenza_id: 'r2' },
  ]
  const t = tenutaRicorrenti(task, regole)
  assert.deepEqual(t.find(x => x.id === 'r1'), { id: 'r1', text: 'Stretching', generate: 3, chiuse: 2, pct: 67 })
  assert.equal(t.find(x => x.id === 'r2').pct, 0)
})

// ---------- grafici ----------
test('bucketize: distingue "nessun dato" da "zero task"', () => {
  const task = [T('2026-07-25', true)]
  const b = bucketize(task, 'day', '2026-07-25', 3)
  assert.equal(b.length, 3)
  assert.equal(b[0].hasData, false)   // 23 luglio: nessun dato
  assert.equal(b[2].hasData, true)
  assert.equal(b[2].pct, 100)
})

test('bucketize: settimane e mesi aggregano', () => {
  const task = [T('2026-07-20', true), T('2026-07-22', true), T('2026-07-25', false)]
  const sett = bucketize(task, 'week', '2026-07-25', 1)
  assert.equal(sett[0].tot, 3)
  assert.equal(sett[0].done, 2)
  const mesi = bucketize(task, 'month', '2026-07-25', 1)
  assert.equal(mesi[0].key, '2026-07')
  assert.equal(mesi[0].done, 2)
  const anni = bucketize(task, 'year', '2026-07-25')
  assert.equal(anni[anni.length - 1].key, '2026')
})

test('heatmap: griglia allineata al lunedì', () => {
  const { celle } = heatmapAnno([], '2026-07-25', 371)
  assert.equal(celle[0].row, 0)
  assert.equal(parseDay(celle[0].key).getDay(), 1)   // lunedì
  assert.equal(celle[celle.length - 1].key, '2026-07-25')
})

// ---------- riepilogo settimanale ----------
test('riepilogo settimana: chiuse, giorno migliore, mood e vittorie', () => {
  // settimana del 25 luglio 2026 (sabato): lunedì 20 -> domenica 26
  const task = [
    T('2026-07-20', true), T('2026-07-21', true), T('2026-07-21', true),
    T('2026-07-22', false), T('2026-07-25', true),
    T('2026-07-19', true),   // domenica precedente: fuori settimana
  ]
  const giorni = [
    { giorno: '2026-07-20', mood: 4, vittoria: 'Spedita la proposta' },
    { giorno: '2026-07-21', mood: 5, vittoria: '  ' },
    { giorno: '2026-07-22', mood: 3 },
    { giorno: '2026-07-19', mood: 1, vittoria: 'Fuori settimana' },
  ]
  const r = riepilogoSettimana(task, giorni, '2026-07-25')
  assert.equal(r.start, '2026-07-20')
  assert.equal(r.fine, '2026-07-26')
  assert.equal(r.chiuse, 4)
  assert.equal(r.pianificate, 5)
  assert.equal(r.migliore, '2026-07-21')   // due chiuse
  assert.equal(r.moodMedio, 4)             // (4+5+3)/3
  assert.deepEqual(r.vittorie, [{ giorno: '2026-07-20', vittoria: 'Spedita la proposta' }])
})

test('riepilogo settimana: settimana vuota non inventa un giorno migliore', () => {
  const r = riepilogoSettimana([], [], '2026-07-25')
  assert.equal(r.chiuse, 0)
  assert.equal(r.migliore, null)
  assert.equal(r.moodMedio, null)
  assert.deepEqual(r.vittorie, [])
})

// ---------- proposte ----------
const visioni = [
  { id: 'v1', titolo: 'Lancio' },
  { id: 'v2', titolo: 'Vecchio progetto', archiviata: true },
  { id: 'v3', titolo: '__templates__' },
]
const viste = [
  { id: 'a', visione_id: 'v1', titolo: 'Fatture', blocchi: [
    { id: 'b1', text: 'Preparare fattura', due: '2026-07-25' },
    { id: 'b2', text: 'Cosa futura', due: '2026-08-10' },
    { id: 'b3', text: 'Scaduta', due: '2026-07-20' },
    { id: 'b4', text: 'Senza scadenza' },
  ] },
  { id: 'b', visione_id: 'v2', titolo: 'Archiviata', blocchi: [{ id: 'c1', text: 'Roba vecchia', due: '2026-07-25' }] },
  { id: 'c', visione_id: 'v3', titolo: 'Template', blocchi: [{ id: 'd1', text: 'Modello', due: '2026-07-25' }] },
  { id: 'd', visione_id: 'v1', is_template: true, titolo: 'Tmpl', blocchi: [{ id: 'e1', text: 'X', due: '2026-07-25' }] },
]

test('proposte: solo righe scadute/di oggi da visioni non archiviate', () => {
  const p = proposte({ viste, visioni, task: [], oggi: '2026-07-25' })
  assert.deepEqual(p.map(x => x.blocco_id), ['b3', 'b1'])  // scadute prima
  assert.equal(p[0].scaduta, true)
  assert.equal(p[1].scaduta, false)
})

test('proposte: esclude le righe già portate in Today', () => {
  const task = [{ id: 't1', giorno: '2026-07-25', vista_id: 'a', blocco_id: 'b1' }]
  const p = proposte({ viste, visioni, task, oggi: '2026-07-25' })
  assert.deepEqual(p.map(x => x.blocco_id), ['b3'])
})

test('proposte: una visione archiviata dopo non toglie le task già prese', () => {
  // la task esiste già, la proposta no: le due cose sono indipendenti
  const p = proposte({ viste, visioni, task: [], oggi: '2026-07-25' })
  assert.equal(p.some(x => x.visione === 'Vecchio progetto'), false)
})
