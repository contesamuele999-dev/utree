import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useAuth } from './lib/auth.jsx'
import { store } from './lib/store.js'
import Auth from './pages/Auth.jsx'
import Editor from './views/Editor.jsx'
import Today from './views/Today.jsx'
import Ricorrenti from './views/Ricorrenti.jsx'
import Pipeline from './views/Pipeline.jsx'
import Tree from './views/Tree.jsx'
import Links from './views/Links.jsx'
import Progress from './views/Progress.jsx'
import Stats from './views/Stats.jsx'
import Profile from './views/Profile.jsx'
import Guide from './views/Guide.jsx'
import { Privacy, Terms } from './pages/Legal.jsx'
import { THEMES, applyTheme, loadTheme } from './lib/themes.js'
import { exportBackup, importBackup } from './lib/backup.js'
import { importGoogleKeep } from './lib/keepImport.js'
import { DEFAULT_STAGE } from './lib/stages.js'
import { cacheVistaLocal, markVistaSynced, mergeVisteWithCache, flushDirtyToCloud, cestinoDisabled, disableCestinoCloud, isMissingCestino } from './lib/localcache.js'
import { saveSnapshot, loadSnapshot, replayOutbox, outboxCount, purgeLocalData } from './lib/offline.js'
import { todayKey, pianificaRollover, pianificaRicorrenti, proposte, tenutaRicorrenti } from './lib/today.js'

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'pipe', label: 'Pipe' },
  { id: 'tree', label: 'Tree' },
  { id: 'links', label: 'Links' },
  { id: 'progress', label: 'Progress' },
]

// ---- ripresa di sessione: l'app riparte da dove l'hai lasciata ----
const LAST_TAB = 'utree-last-tab'
const LAST_VISTA = 'utree-last-vista'
const lastTab = () => {
  try { const t = localStorage.getItem(LAST_TAB); return TABS.some(x => x.id === t) ? t : 'today' }
  catch { return 'today' }
}

export default function App() {
  const { user, loading, signOut, isDemo } = useAuth()
  const [tab, setTab] = useState(lastTab)
  const [tabDir, setTabDir] = useState(0)      // -1 sx, +1 dx (per l'animazione swipe)
  const [swipeHint, setSwipeHint] = useState(null)   // { scope, dir, ready, label } feedback live durante lo swipe
  const swipeHintRef = useRef('')
  const [pipeQuery, setPipeQuery] = useState('')   // ricerca Pipe sollevata qui: sopravvive all'apertura di una vista.
  const [visioni, setVisioni] = useState([])
  const [viste, setViste] = useState([])
  const [links, setLinks] = useState([])
  const [task, setTask] = useState([])          // Today: le task di tutti i giorni (serve lo storico per lo streak)
  const [regole, setRegole] = useState([])      // Today: regole delle task ricorrenti
  const [giorni, setGiorni] = useState([])      // Today: il rito serale, una riga per data
  const [ricorrentiOpen, setRicorrentiOpen] = useState(null)   // null | { iniziale?: string } pannello regole
  const todayWarned = useRef(false)             // avviso "esegui la migrazione" una volta sola
  const manutFatta = useRef(null)               // giorno per cui rollover+ricorrenti sono già girati
  const [vistaAperta, setVistaAperta] = useState(null)
  const [vistaStack, setVistaStack] = useState([])   // storia delle viste aperte via link/ricerca (per il tasto ←)
  const [jumpText, setJumpText] = useState(null)     // termine cercato: la vista aperta scrolla alla riga che lo contiene
  const [remoteRev, setRemoteRev] = useState(0)      // sale quando la vista aperta cambia sul cloud: l'editor si ri-sincronizza
  const [focusMode, setFocusMode] = useState(false)
  const [page, setPage] = useState(null)       // 'privacy' | 'terms' | 'profile' | 'stats'
  const [guide, setGuide] = useState(null)     // sezione della guida
  const [menu, setMenu] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [prompt, setPrompt] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [theme, setTheme] = useState('foresta')
  const [themeOpen, setThemeOpen] = useState(false)
  const [editorEditing, setEditorEditing] = useState(false)   // una riga è in modifica nell'editor?
  const [templatePick, setTemplatePick] = useState(false)   // modale "usa template"
  const [busy, setBusy] = useState('')
  const defaultVita = useRef(null)
  const stageWarned = useRef(false)
  const pinWarned = useRef(false)
  // NB: tutti gli hook stanno QUI, prima dei return anticipati per `loading` e
  // `!user`. Dichiararne uno più in basso significa eseguirne un numero diverso
  // prima e dopo il login: React lo rifiuta (errore #310) e smonta tutto.
  const archivioWarned = useRef(false)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [inCoda, setInCoda] = useState(() => outboxCount())
  const editorApi = useRef({})          // ponte verso l'Editor (per il tasto indietro: esci dall'editing riga)
  const sessioneRipresa = useRef(false) // la vista dell'ultima sessione è già stata riaperta?
  const contentRef = useRef(null)       // contenitore scrollabile delle schede (Pipe/Tree/…)
  const pipeScrollRef = useRef(0)       // scroll di Pipe salvato all'apertura di una vista, ripristinato al ritorno
  const vistaScroll = useRef(new Map()) // vistaId -> scrollTop dentro l'editor: tornando indietro si riparte da dov'eri
  const baseBlocchi = useRef({})        // { vistaId: blocchi } = ultimo stato cloud noto, per il merge multi-dispositivo
  // Visione di SISTEMA che raccoglie i template: nascosta ovunque (griglia, mappa, elenco).
  // Serve perché nello schema ogni template deve avere una visione: così i template
  // sopravvivono anche se elimini TUTTE le visioni reali.
  const TEMPLATE_VIS = '__templates__'
  const templateVis = useRef(null)      // riga della visione-contenitore template (o null se non esiste ancora)

  // ---- TASK "in volo": modifiche ottimistiche non ancora confermate dal cloud ----
  // Un click su un checkbox può far tornare la finestra in primo piano (evento `focus`),
  // che innesca un reload: la lettura parte PRIMA che la scrittura sia arrivata e
  // riscrive lo stato vecchio sopra quello nuovo (la spunta "si riempiva e tornava
  // vuota"). Qui teniamo traccia delle patch ancora in volo e le ri-applichiamo
  // sopra i dati appena letti, finché il cloud non le conferma.
  const taskInVolo = useRef(new Map())     // id -> patch
  const taskRimosse = useRef(new Set())    // id eliminati ma non ancora confermati
  const applicaInVolo = (lista) => {
    if (!taskInVolo.current.size && !taskRimosse.current.size) return lista
    return lista
      .filter(t => !taskRimosse.current.has(t.id))
      .map(t => taskInVolo.current.has(t.id) ? { ...t, ...taskInVolo.current.get(t.id) } : t)
  }
  const inVolo = (id, patch) => {
    taskInVolo.current.set(id, { ...(taskInVolo.current.get(id) || {}), ...patch })
  }
  // La patch resta "in volo" ancora un attimo dopo la conferma: una lettura partita
  // prima della scrittura può atterrare subito dopo, portando con sé il dato vecchio.
  const fineVolo = (id, subito = false) => {
    if (subito) taskInVolo.current.delete(id)
    else setTimeout(() => taskInVolo.current.delete(id), 2000)
  }

  const reload = useCallback(async () => {
    // Prima di leggere: se ci sono scritture rimaste in coda (fatte offline) le
    // rigiochiamo, così la lettura che segue vede già il risultato.
    try { await replayOutbox(store); setInCoda(outboxCount()) } catch { /* si ritenta */ }

    // resiliente: se una singola query fallisce non azzeriamo tutta l'app
    let fallite = 0
    const safe = (p) => p.catch(e => { fallite++; console.warn('[reload] lettura fallita:', e?.message || e); return [] })
    let [vt, vs, allViste, allLinks, allTask, allRegole] = await Promise.all([
      safe(store.list('vite')), safe(store.list('visioni')), safe(store.list('viste')), safe(store.list('links')),
      safe(store.list('task')), safe(store.list('ricorrenza')),
    ])
    let allGiorni = await safe(store.list('giorno'))

    // SENZA RETE: il cloud non risponde. Invece di mostrare un'app vuota,
    // ripartiamo dall'ultimo stato conosciuto (snapshot locale).
    //
    // Due regole di prudenza, imparate a caro prezzo: lo snapshot è una RETE DI
    // SICUREZZA, mai una fonte di verità.
    //  1) si usa SOLO tabella per tabella, e SOLO se quella lettura è fallita e non
    //     ha restituito nulla: una lettura riuscita non viene mai scavalcata da una
    //     copia vecchia;
    //  2) non si salva MAI uno snapshot vuoto. Un momento sfortunato (sessione non
    //     ancora pronta, permessi non ancora validi) restituisce liste vuote senza
    //     errore: memorizzarlo significherebbe sovrascrivere la copia buona col nulla.
    const usaSnapshot = (fresche) => {
      const snap = loadSnapshot()
      if (!snap) return fresche
      return fresche.map(([chiave, valore]) =>
        (!valore?.length && snap[chiave]?.length) ? snap[chiave] : valore)
    }
    if (fallite) {
      ;[vt, vs, allViste, allLinks, allTask, allRegole, allGiorni] = usaSnapshot([
        ['vite', vt], ['visioni', vs], ['viste', allViste], ['links', allLinks],
        ['task', allTask], ['ricorrenza', allRegole], ['giorno', allGiorni],
      ])
      setOffline(true)
    } else {
      setOffline(typeof navigator !== 'undefined' && navigator.onLine === false)
      // niente snapshot se non c'è proprio niente da salvare
      if (vs.length || allViste.length || allTask.length) {
        saveSnapshot({ vite: vt, visioni: vs, viste: allViste, links: allLinks, task: allTask, ricorrenza: allRegole, giorno: allGiorni })
      }
    }
    setTask(applicaInVolo(allTask))
    setRegole(allRegole)
    setGiorni(allGiorni)
    defaultVita.current = vt[0] || null
    // separa la visione-contenitore dei template dalle visioni reali (mostrate all'utente)
    templateVis.current = vs.find(v => v.titolo === TEMPLATE_VIS) || null
    const visReali = vs.filter(v => v.titolo !== TEMPLATE_VIS)
    setVisioni(visReali)
    // istantanea dello stato cloud: base per il merge a 3 vie al prossimo salvataggio
    baseBlocchi.current = Object.fromEntries(allViste.map(v => [v.id, v.blocchi || []]))
    const merged = mergeVisteWithCache(allViste)   // ripristina modifiche locali non ancora confermate
    setViste(merged)
    const ids = new Set(merged.map(v => v.id))
    setLinks(allLinks.filter(l => ids.has(l.da_vista) && ids.has(l.a_vista)))
    flushDirtyToCloud(store)   // ri-spedisce in background ciò che non era stato salvato sul cloud
    manutenzioneToday(allTask, allRegole)
  }, [])

  // ---- TODAY: manutenzione di inizio giornata ---------------------------------
  // Gira PIGRA alla prima apertura di ogni giorno (niente cron):
  //   1) le task aperte dei giorni scorsi passano a oggi (le ricorrenti no);
  //   2) si materializzano le istanze delle regole ricorrenti.
  // Il flag su localStorage impedisce di rifarla più volte nello stesso giorno:
  // senza, aprendo l'app due volte il contatore `rollover` crescerebbe a doppio.
  // Il flag si scrive SOLO a operazione riuscita, così se si è offline si ritenta.
  const manutenzioneToday = useCallback(async (tk, rc) => {
    const oggi = todayKey()
    const CHIAVE = 'utree-today-manut'
    if (manutFatta.current === oggi) return
    if (localStorage.getItem(CHIAVE) === oggi) { manutFatta.current = oggi; return }

    try {
      const patches = pianificaRollover({ task: tk, oggi })
      const { daCreare, genUpdates } = pianificaRicorrenti({ regole: rc, task: tk, oggi })
      if (!patches.length && !daCreare.length && !genUpdates.length) {
        manutFatta.current = oggi
        localStorage.setItem(CHIAVE, oggi)
        return
      }
      for (const p of patches) await store.update('task', p.id, p.patch)
      const nuove = daCreare.length ? await store.insertMany('task', daCreare) : []
      for (const g of genUpdates) await store.update('ricorrenza', g.id, { ultima_gen: g.ultima_gen })

      setTask(prev => {
        const byId = new Map(prev.map(t => [t.id, t]))
        for (const p of patches) if (byId.has(p.id)) byId.set(p.id, { ...byId.get(p.id), ...p.patch })
        for (const n of nuove) byId.set(n.id, n)
        return [...byId.values()]
      })
      setRegole(prev => prev.map(r => {
        const g = genUpdates.find(x => x.id === r.id)
        return g ? { ...r, ultima_gen: g.ultima_gen } : r
      }))
      manutFatta.current = oggi
      localStorage.setItem(CHIAVE, oggi)
    } catch (e) {
      // niente flag: si ritenta alla prossima apertura (es. offline al primo avvio)
      console.warn('[today] manutenzione rimandata:', e?.message || e)
    }
  }, [])

  // ---- TODAY: operazioni sulle task ------------------------------------------
  // Tutte ottimistiche: la UI si aggiorna subito, il cloud segue. Se la tabella
  // non esiste ancora (migrazione non eseguita) lo diciamo una volta sola.
  const avvisaMigrazione = (e) => {
    console.warn('[today]', e?.message || e)
    if (todayWarned.current) return
    todayWarned.current = true
    alert('La sezione Today ha bisogno delle sue tabelle.\nEsegui su Supabase il file migrazione_today.sql (SQL Editor).')
  }

  const addTask = async (dati) => {
    const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2, 9), done: false, rollover: 0, origin_giorno: dati.giorno, ...dati }
    setTask(ts => [...ts, tmp])
    try {
      const saved = await store.insert('task', { ...dati, done: false, rollover: 0, origin_giorno: dati.giorno })
      setTask(ts => ts.map(t => t.id === tmp.id ? saved : t))
    } catch (e) {
      setTask(ts => ts.filter(t => t.id !== tmp.id))   // rollback: meglio niente che una task fantasma
      avvisaMigrazione(e)
    }
  }

  // Tre stati, non due: da fare → a metà → fatta → da fare.
  // "A metà" non è chiusa (fa rollover come una task aperta), ma la giornata
  // se ne accorge: nella barra vale mezzo passo.
  const toggleTask = async (t) => {
    const patch = t.done
      ? { done: false, parziale: false, done_at: null }              // fatta  → da fare
      : t.parziale
        ? { done: true, parziale: false, done_at: new Date().toISOString() }  // a metà → fatta
        : { done: false, parziale: true, done_at: null }             // da fare → a metà
    setTask(ts => ts.map(x => x.id === t.id ? { ...x, ...patch } : x))
    inVolo(t.id, patch)
    try { await store.update('task', t.id, patch); fineVolo(t.id) }
    catch (e) {
      fineVolo(t.id, true)
      setTask(ts => ts.map(x => x.id === t.id ? { ...x, done: t.done, parziale: t.parziale, done_at: t.done_at } : x))
      avvisaMigrazione(e)
    }
  }

  const editTaskText = async (t, text) => {
    setTask(ts => ts.map(x => x.id === t.id ? { ...x, text } : x))
    inVolo(t.id, { text })
    try { await store.update('task', t.id, { text }); fineVolo(t.id) }
    catch (e) { fineVolo(t.id, true); avvisaMigrazione(e) }
  }

  // Nidificazione delle task di Today: `indent` è un semplice livello, come
  // nelle righe delle viste. L'albero è dato dall'ordine + dal rientro.
  const indentTask = async (t, indent) => {
    const prima = t.indent || 0
    setTask(ts => ts.map(x => x.id === t.id ? { ...x, indent } : x))
    inVolo(t.id, { indent })
    try { await store.update('task', t.id, { indent }); fineVolo(t.id) }
    catch (e) {
      fineVolo(t.id, true)
      setTask(ts => ts.map(x => x.id === t.id ? { ...x, indent: prima } : x))
      avvisaMigrazione(e)
    }
  }

  const deleteTask = async (t) => {
    setTask(ts => ts.filter(x => x.id !== t.id))
    taskRimosse.current.add(t.id)
    const scorda = () => setTimeout(() => taskRimosse.current.delete(t.id), 2000)
    try { await store.remove('task', t.id) } catch (e) { avvisaMigrazione(e) } finally { scorda() }
  }

  const MAX_INDENT_TASK = 6   // stesso tetto di rientro delle righe delle viste

  // Riordino: si riscrive `ordine` sull'elenco del giorno, così resta stabile
  // anche dopo un reload da un altro dispositivo.
  // `stepDelta` = scostamento orizzontale del trascinamento: sposta il livello di
  // rientro del ramo spostato, mantenendone i rientri relativi (come nelle viste).
  const reorderTask = async (dragId, targetId, stepDelta = 0) => {
    const oggi = todayKey()
    const delGiorno = task.filter(t => t.giorno === oggi).sort((a, b) => (a.ordine || 0) - (b.ordine || 0))
    const from = delGiorno.findIndex(t => t.id === dragId)
    const to = delGiorno.findIndex(t => t.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    // si trascina il RAMO, non la singola riga: le sotto-task seguono il genitore
    const d = delGiorno[from].indent || 0
    let n = 1
    while (from + n < delGiorno.length && (delGiorno[from + n].indent || 0) > d) n++
    if (to > from && to < from + n) return   // non ci si può spostare dentro sé stessi
    const next = [...delGiorno]
    let ramo = next.splice(from, n)
    if (stepDelta) {
      // il ramo si muove tutto insieme: il rientro minimo non scende sotto 0
      const shift = Math.max(stepDelta, -Math.min(...ramo.map(t => t.indent || 0)))
      ramo = ramo.map(t => ({ ...t, indent: Math.max(0, Math.min(MAX_INDENT_TASK, (t.indent || 0) + shift)) }))
    }
    next.splice(to > from ? to - n + 1 : to, 0, ...ramo)
    // dopo lo spostamento il rientro può essere diventato impossibile (un ramo
    // finito in cima): si normalizza, nessuna riga può saltare più di un livello.
    let prev = -1
    const conOrdine = next.map((t, i) => {
      const ind = i === 0 ? 0 : Math.max(0, Math.min(t.indent || 0, prev + 1))
      prev = ind
      return { ...t, ordine: i, indent: ind }
    })
    setTask(ts => ts.map(t => conOrdine.find(x => x.id === t.id) || t))
    conOrdine.forEach(t => inVolo(t.id, { ordine: t.ordine, indent: t.indent }))
    try {
      for (const t of conOrdine) {
        const old = delGiorno.find(x => x.id === t.id)
        const patch = {}
        if (t.ordine !== (old?.ordine)) patch.ordine = t.ordine
        if (t.indent !== (old?.indent || 0)) patch.indent = t.indent
        if (Object.keys(patch).length) await store.update('task', t.id, patch)
      }
    } catch (e) { avvisaMigrazione(e) }
    finally { conOrdine.forEach(t => fineVolo(t.id)) }
  }

  const openOrigineTask = (t) => {
    const v = viste.find(x => x.id === t.vista_id)
    if (v) openFromList(v)
  }

  // Teletrasporto: la riga viene SPOSTATA dall'editor a Today (l'editor l'ha già
  // tolta dai blocchi e messa nel suo cestino). Qui nasce solo la task.
  // Teniamo `vista_id` come provenienza — serve al chip di origine e alle
  // statistiche per visione — ma non `blocco_id`: quella riga non esiste più.
  const sendToToday = async ({ testo, giorno }, vistaId) => {
    const vid = vistaId || vistaAperta?.id
    const text = (testo || '').trim()
    if (!text) return
    const ordini = task.filter(t => t.giorno === giorno).map(t => t.ordine || 0)
    await addTask({
      text,
      giorno,
      ordine: (ordini.length ? Math.max(...ordini) : 0) + 1,
      vista_id: vid || null,
    })
  }

  // Accetta una proposta: come il teletrasporto, la riga SI SPOSTA. Esce dalla
  // nota (finisce nel suo cestino, recuperabile) e diventa una task di oggi.
  const accettaProposta = async (p) => {
    const oggi = todayKey()
    const ordini = task.filter(t => t.giorno === oggi).map(t => t.ordine || 0)
    await addTask({
      text: p.text, giorno: oggi,
      ordine: (ordini.length ? Math.max(...ordini) : 0) + 1,
      vista_id: p.vista_id,
    })
    const v = viste.find(x => x.id === p.vista_id)
    if (!v) return
    const riga = (v.blocchi || []).find(b => b.id === p.blocco_id)
    let blocchi = (v.blocchi || []).filter(b => b.id !== p.blocco_id)
    if (!blocchi.length) blocchi = [{ id: 'b-' + Math.random().toString(36).slice(2, 9), text: '' }]
    const cestino = riga
      ? [{ ...riga, deletedAt: Date.now(), inToday: true }, ...(v.cestino || [])].slice(0, 200)
      : (v.cestino || [])
    saveVista({ ...v, blocchi, cestino })
  }

  // ---- TODAY: regole ricorrenti ----------------------------------------------
  // Salvare una regola genera SUBITO l'istanza di oggi se le compete: altrimenti
  // creare "ogni giorno" alle 9 del mattino non produrrebbe nulla fino a domani.
  const salvaRegola = async (r) => {
    const dati = {
      text: (r.text || '').trim(), tipo: r.tipo, giorni: r.giorni?.length ? r.giorni : null,
      ogni: r.ogni || 1, dal: r.dal || todayKey(), al: r.al || null, attiva: r.attiva !== false,
      vista_id: r.vista_id || null, blocco_id: r.blocco_id || null,
    }
    try {
      let salvata
      if (r.id) {
        salvata = await store.update('ricorrenza', r.id, dati)
        setRegole(rs => rs.map(x => x.id === r.id ? salvata : x))
      } else {
        salvata = await store.insert('ricorrenza', dati)
        setRegole(rs => [...rs, salvata])
      }
      // genera l'istanza di oggi se la regola la prevede
      const oggi = todayKey()
      const { daCreare } = pianificaRicorrenti({ regole: [salvata], task, oggi, maxIndietro: 0 })
      // Se la regola nasce da una task già presente in Today ("Rendi ricorrente"),
      // quella task DIVENTA l'istanza di oggi. Prima se ne creava una seconda
      // identica accanto: la ricorrente sembrava duplicarsi.
      const daAdottare = r.daTask
        ? task.find(t => t.id === r.daTask && t.giorno === oggi && !t.ricorrenza_id
          && (t.text || '').trim() === dati.text)
        : null
      if (daCreare.length && daAdottare) {
        const patch = { ricorrenza_id: salvata.id, origin_giorno: daAdottare.origin_giorno || oggi }
        setTask(ts => ts.map(t => t.id === daAdottare.id ? { ...t, ...patch } : t))
        await store.update('task', daAdottare.id, patch)
      } else if (daCreare.length) {
        const nuove = await store.insertMany('task', daCreare)
        if (nuove.length) setTask(ts => [...ts, ...nuove])
      }
      await store.update('ricorrenza', salvata.id, { ultima_gen: oggi }).catch(() => {})
    } catch (e) { avvisaMigrazione(e) }
  }

  // Cancellare una regola NON tocca le istanze già generate: lo storico resta.
  const eliminaRegola = async (r) => {
    setRegole(rs => rs.filter(x => x.id !== r.id))
    setTask(ts => ts.map(t => t.ricorrenza_id === r.id ? { ...t, ricorrenza_id: null } : t))
    try { await store.remove('ricorrenza', r.id) } catch (e) { avvisaMigrazione(e) }
  }

  // ---- TODAY: rito serale -----------------------------------------------------
  const giornoOggi = giorni.find(g => g.giorno === todayKey()) || null
  const chiudiGiornata = async ({ vittoria, mood }) => {
    const oggi = todayKey()
    const patch = { vittoria, mood, chiuso_at: new Date().toISOString() }
    setGiorni(gs => {
      const i = gs.findIndex(g => g.giorno === oggi)
      if (i >= 0) return gs.map(g => g.giorno === oggi ? { ...g, ...patch } : g)
      return [...gs, { id: 'tmp-giorno', giorno: oggi, ...patch }]
    })
    try {
      const saved = await store.upsertGiorno(oggi, patch)
      setGiorni(gs => gs.map(g => g.giorno === oggi ? saved : g))
    } catch (e) { avvisaMigrazione(e) }
  }

  useEffect(() => { setTheme(loadTheme()) }, [])
  useEffect(() => { if (user) reload() }, [user, reload])

  // ---- ripresa di sessione ---------------------------------------------------
  // Chiudere e riaprire la PWA non deve far ricominciare da capo: ricordiamo la
  // scheda e l'eventuale vista aperta, e le ripristiniamo al primo caricamento.
  useEffect(() => { try { localStorage.setItem(LAST_TAB, tab) } catch { /* quota */ } }, [tab])
  useEffect(() => {
    try {
      if (vistaAperta) localStorage.setItem(LAST_VISTA, vistaAperta.id)
      else if (sessioneRipresa.current) localStorage.removeItem(LAST_VISTA)
    } catch { /* quota */ }
  }, [vistaAperta])
  useEffect(() => {
    if (sessioneRipresa.current || !viste.length) return
    sessioneRipresa.current = true
    let id = null
    try { id = localStorage.getItem(LAST_VISTA) } catch { /* ignore */ }
    if (!id) return
    const v = viste.find(x => x.id === id)
    if (v) { setVistaStack([]); setVistaAperta(v) }
  }, [viste])

  // ---- rete: banner offline + ri-spedizione automatica al ritorno del segnale ----
  useEffect(() => {
    const giuLaRete = () => setOffline(true)
    const suLaRete = async () => {
      setOffline(false)
      try { await replayOutbox(store) } finally { setInCoda(outboxCount()) }
      flushDirtyToCloud(store)
      if (user) reload()
    }
    window.addEventListener('offline', giuLaRete)
    window.addEventListener('online', suLaRete)
    const t = setInterval(() => setInCoda(outboxCount()), 4000)
    return () => {
      window.removeEventListener('offline', giuLaRete)
      window.removeEventListener('online', suLaRete)
      clearInterval(t)
    }
  }, [user, reload])

  // Sync cross-dispositivo: quando l'app torna in primo piano (cambio scheda, sblocco
  // schermo, ritorno da un'altra app) rileggiamo dal cloud, così le modifiche fatte su un
  // ALTRO dispositivo compaiono qui. Il reload fonde con la cache locale (mergeVisteWithCache)
  // e ri-spedisce le modifiche non ancora salvate, quindi non perde il lavoro locale.
  // Evitiamo di ricaricare mentre una vista è aperta in modifica (per non disturbare
  // l'editing) e non più spesso di una volta ogni 4 secondi.
  const lastReload = useRef(0)
  useEffect(() => {
    if (!user) return
    const maybeReload = () => {
      if (document.visibilityState !== 'visible') return
      if (editorEditing) return                   // riga in modifica: non disturbare chi scrive
      if (Date.now() - lastReload.current < 4000) return
      lastReload.current = Date.now()
      reload()
    }
    window.addEventListener('visibilitychange', maybeReload)
    window.addEventListener('focus', maybeReload)
    return () => {
      window.removeEventListener('visibilitychange', maybeReload)
      window.removeEventListener('focus', maybeReload)
    }
  }, [user, reload, editorEditing])

  // La vista APERTA segue le modifiche arrivate dal cloud (fatte su un altro
  // dispositivo): se i blocchi riletti differiscono da quelli mostrati li adottiamo
  // e alziamo `remoteRev`, che fa ri-sincronizzare l'editor senza uscire e rientrare.
  // Mentre una riga è IN MODIFICA non si adotta nulla: alzare `remoteRev` rimonta
  // l'editor, che perde riga in modifica, focus e scroll (si finiva a scrivere nella
  // barra di ricerca). L'effetto rigira appena l'editing finisce.
  useEffect(() => {
    if (!vistaAperta || editorEditing) return
    const fresh = viste.find(v => v.id === vistaAperta.id)
    if (!fresh || fresh === vistaAperta) return
    if (fresh.titolo === vistaAperta.titolo
      && JSON.stringify(fresh.blocchi) === JSON.stringify(vistaAperta.blocchi)) return
    setVistaAperta(fresh)
    setRemoteRev(n => n + 1)
  }, [viste, vistaAperta, editorEditing])

  // ripristina lo scroll di Pipe quando si chiude una vista e si torna all'elenco
  useLayoutEffect(() => {
    if (!vistaAperta && !page && tab === 'pipe' && contentRef.current) {
      contentRef.current.scrollTop = pipeScrollRef.current
    }
  }, [vistaAperta, page, tab])

  // ripristina lo scroll DENTRO una vista: tornando indietro (←, swipe, wikilink)
  // si riparte dal punto in cui l'avevi lasciata, non dall'inizio.
  // ponytail: le immagini che caricano dopo possono spostare l'altezza; se capita,
  // ri-applicare lo scroll al load delle immagini.
  useLayoutEffect(() => {
    if (!vistaAperta || !contentRef.current) return
    contentRef.current.scrollTop = vistaScroll.current.get(vistaAperta.id) || 0
  }, [vistaAperta?.id])

  // ---- tasto INDIETRO (mobile): chiude l'overlay in cima invece di uscire dall'app ----
  const overlaysRef = useRef([])
  overlaysRef.current = [
    confirm && (() => setConfirm(null)),
    prompt && (() => setPrompt(null)),
    templatePick && (() => setTemplatePick(false)),
    fabOpen && (() => setFabOpen(false)),
    themeOpen && (() => setThemeOpen(false)),
    ricorrentiOpen && (() => setRicorrentiOpen(null)),
    guide && (() => setGuide(null)),
    menu && (() => setMenu(false)),
    page && (() => setPage(null)),
    // Dentro una vista: se stai MODIFICANDO una riga, il primo "indietro" chiude
    // solo l'editing della riga (su mobile è il gesto naturale per "ho finito di
    // scrivere"); serve un secondo indietro per uscire dalla vista.
    (vistaAperta && editorEditing) && (() => editorApi.current.exitEditing?.()),
    vistaAperta && (() => closeVista()),
    // in Pipe con una ricerca attiva: il back cancella prima la ricerca (utile su tablet)
    (!vistaAperta && !page && tab === 'pipe' && pipeQuery) && (() => setPipeQuery('')),
  ].filter(Boolean)

  useEffect(() => {
    window.history.pushState({ utree: true }, '')
    const onPop = () => {
      const top = overlaysRef.current[0]
      if (top) { top(); window.history.pushState({ utree: true }, '') }
      // se non c'è nulla da chiudere lasciamo procedere (comportamento nativo)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Una vista viene aperta nello stato React, senza una vera navigazione del
  // browser. Su alcune PWA Android la sola sentinella iniziale può essere già
  // stata consumata: aggiungiamo quindi una voce di history quando si entra in
  // una vista, così il tasto Indietro genera sempre popstate e chiude la vista.
  useEffect(() => {
    if (vistaAperta) window.history.pushState({ utree: true, vista: vistaAperta.id }, '')
  }, [vistaAperta?.id])

  // ---- swipe fra le schede ----
  const changeTab = (next, dir) => { setTabDir(dir); setTab(next) }
  const swipe = useRef(null)
  const editSwipe = useRef(null)   // swipe fra viste dentro l'editor
  // aggiorna l'indicatore di swipe solo quando cambia davvero (evita re-render inutili)
  const showSwipeHint = (h) => {
    const sig = h ? `${h.scope}|${h.dir}|${h.ready ? 1 : 0}|${h.label}` : ''
    if (sig === swipeHintRef.current) return
    swipeHintRef.current = sig
    setSwipeHint(h)
  }
  const onTouchStart = (e) => {
    const t = e.touches[0]
    const noswipe = e.target.closest('[data-noswipe]')
    let scroller = null
    if (noswipe?.dataset?.noswipe === 'scroll') scroller = noswipe
    swipe.current = { x: t.clientX, y: t.clientY, blocked: noswipe && !scroller, scroller, sl: scroller?.scrollLeft ?? 0 }
  }
  // feedback live: mentre trascini in orizzontale mostra dove stai per andare
  const onTouchMove = (e) => {
    const s = swipe.current
    if (!s || s.blocked || vistaAperta) return
    const t = e.touches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) < 20 || Math.abs(dx) < Math.abs(dy)) { showSwipeHint(null); return }
    if (s.scroller) {
      const el = s.scroller
      const atStart = el.scrollLeft <= 1
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      if ((dx > 0 && !atStart) || (dx < 0 && !atEnd)) { showSwipeHint(null); return }
    }
    const idx = TABS.findIndex(x => x.id === tab)
    const next = dx < 0 ? idx + 1 : idx - 1
    if (next < 0 || next >= TABS.length) { showSwipeHint(null); return }
    showSwipeHint({ scope: 'tab', dir: dx < 0 ? 1 : -1, ready: Math.abs(dx) >= 70 && Math.abs(dy) <= 60, label: TABS[next].label })
  }
  const onTouchEnd = (e) => {
    const s = swipe.current; swipe.current = null
    showSwipeHint(null)
    if (!s || s.blocked || vistaAperta) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) < 70 || Math.abs(dy) > 60 || Math.abs(dx) < Math.abs(dy)) return
    if (s.scroller) {
      const el = s.scroller
      if (el.scrollLeft !== s.sl) return
      const atStart = el.scrollLeft <= 1
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      if ((dx > 0 && !atStart) || (dx < 0 && !atEnd)) return
    }
    const idx = TABS.findIndex(x => x.id === tab)
    const next = dx < 0 ? idx + 1 : idx - 1
    if (next >= 0 && next < TABS.length) changeTab(TABS[next].id, dx < 0 ? 1 : -1)
  }

  const saveChain = useRef({})
  const saveSeq = useRef({})   // numero dell'ultimo salvataggio richiesto per vista

  if (loading) return <div style={{display:'grid',placeItems:'center',height:'100dvh'}}>Caricamento…</div>
  if (!user) return <Auth />

  const ensureVita = async () => {
    if (defaultVita.current) return defaultVita.current
    const v = await store.insert('vite', { titolo: 'uTree', colore: '#1f7a4d', ordine: 0 })
    defaultVita.current = v
    return v
  }

  // Ritorna (creandola se serve) la visione di SISTEMA che contiene i template.
  // È nascosta ovunque: esiste solo per dare una `visione_id` valida ai template, così
  // sopravvivono anche quando l'utente elimina tutte le sue visioni reali.
  const ensureTemplateVisione = async () => {
    if (templateVis.current) return templateVis.current
    const vita = await ensureVita()
    const v = await store.insert('visioni', { vita_id: vita.id, titolo: TEMPLATE_VIS, colore: '#888888', ordine: 9999 })
    templateVis.current = v
    return v
  }

  const addVisione = () => {
    setPrompt({ titolo: 'Nuova visione', label: 'Nome della visione', valore: '', onOk: async (nome) => {
      const vita = await ensureVita()
      const v = await store.insert('visioni', { vita_id: vita.id, titolo: nome, colore: '#2e9e63', ordine: visioni.length })
      setVisioni(prev => [...prev, v])
    }})
  }

  // ＋ dalla scheda Today: una nuova attività per la giornata di oggi.
  const addTaskOggi = () => {
    setPrompt({ titolo: 'Nuova task di oggi', label: 'Cosa vuoi fare oggi?', valore: '', onOk: async (testo) => {
      const oggi = todayKey()
      const ordini = task.filter(t => t.giorno === oggi).map(t => t.ordine || 0)
      await addTask({ text: testo, giorno: oggi, ordine: (ordini.length ? Math.max(...ordini) : 0) + 1 })
    }})
  }

  const addVista = ({ visioneId, parent = null, open = false } = {}) => {
    const vid = visioneId || parent?.visione_id || visioni[0]?.id
    if (!vid) { alert('Crea prima una visione.'); return }
    setPrompt({ titolo: 'Nuova vista', label: 'Titolo della vista', valore: '', onOk: async (nome) => {
      const v = await store.insert('viste', {
        visione_id: vid, titolo: nome, blocchi: [{ id: 'b1', text: '' }],
        is_template: false, livello: parent ? (parent.livello || 0) + 1 : 0,
        parent_id: parent?.id || null, pos_x: 0, pos_y: 0, ordine: viste.length,
      })
      setViste(prev => [...prev, v])
      if (parent) {
        const lk = await store.insert('links', { da_vista: parent.id, a_vista: v.id, tipo: 'maggiore' })
        setLinks(ls => [...ls, lk])
      }
      if (open) setVistaAperta(v)
    }})
  }

  // ---- Template ----
  // Clona i blocchi con id nuovi (i template si copiano fra viste): conserva testo,
  // rientro e immagini; scarta scadenze ed eventi Google Calendar (specifici dell'istanza).
  // Un template è uno SCHELETRO, non una copia. Conserva il testo solo delle righe
  // che definiscono la struttura — i titoli markdown (#, ##, …), i separatori (---)
  // e le righe che hanno figli nidificati (l'inizio di una sezione) — mentre le
  // righe di contenuto restano vuote, pronte da riempire. Rientri conservati,
  // immagini/scadenze/eventi scartati (appartengono all'istanza, non al modello).
  const tuid = () => 'b-' + Math.random().toString(36).slice(2, 9)
  const isTitolo = (t) => /^#{1,6}\s/.test(t || '') || (t || '').trim() === '---'
  const cloneBlocchi = (blocchi) => {
    const arr = blocchi || []
    return arr.map((b, i) => {
      const indent = b.indent || 0
      const haFigli = (arr[i + 1]?.indent || 0) > indent   // inizio di una sezione a rientro
      const n = { id: tuid(), text: (isTitolo(b.text) || haFigli) ? (b.text || '') : '' }
      if (indent) n.indent = indent
      if (b.check) n.check = true                          // il checkbox fa parte della struttura
      return n
    })
  }

  // Salva la vista corrente come template (is_template: true), copiandone il contenuto.
  // Il template va nella visione di SISTEMA nascosta, così è indipendente dalle visioni
  // reali e non viene mai eliminato insieme a una di esse.
  const saveAsTemplate = ({ titolo, blocchi }) => {
    setPrompt({ titolo: 'Salva come template', label: 'Nome del template', valore: (titolo || 'Vista') + ' (template)', onOk: async (nome) => {
      const contenitore = await ensureTemplateVisione()
      const t = await store.insert('viste', {
        visione_id: contenitore.id, titolo: nome, blocchi: cloneBlocchi(blocchi),
        is_template: true, livello: 0, parent_id: null, pos_x: 0, pos_y: 0, ordine: viste.length,
      })
      setViste(prev => [...prev, t])
    }})
  }

  // Crea una nuova vista (normale) copiando i blocchi di un template.
  // La nuova vista va in una visione REALE (non nel contenitore nascosto dei template):
  // usiamo la visione aperta se disponibile, altrimenti la prima visione reale.
  const createFromTemplate = (template) => {
    const vid = vistaAperta?.visione_id || visioni[0]?.id
    if (!vid) { alert('Crea prima una visione.'); return }
    setTemplatePick(false)
    setPrompt({ titolo: 'Nuova vista da template', label: 'Titolo della vista', valore: '', onOk: async (nome) => {
      const v = await store.insert('viste', {
        visione_id: vid, titolo: nome, blocchi: cloneBlocchi(template.blocchi),
        is_template: false, livello: 0, parent_id: null, pos_x: 0, pos_y: 0, ordine: viste.length,
      })
      setViste(prev => [...prev, v])
      setVistaAperta(v)
    }})
  }

  const renameVisione = (visione) => {
    setPrompt({ titolo: 'Rinomina visione', label: 'Nome della visione', valore: visione.titolo, onOk: async (nome) => {
      await store.update('visioni', visione.id, { titolo: nome })
      setVisioni(prev => prev.map(v => v.id === visione.id ? { ...v, titolo: nome } : v))
    }})
  }

  const recolorVisione = async (visione, colore) => {
    await store.update('visioni', visione.id, { colore })
    setVisioni(prev => prev.map(v => v.id === visione.id ? { ...v, colore } : v))
  }

  // drag & drop per riordinare le visioni in Pipe (edge: 'before' | 'after' rispetto al bersaglio)
  const reorderVisioni = async (draggedId, targetId, edge = 'before') => {
    if (draggedId === targetId) return
    const arr = [...visioni]
    const from = arr.findIndex(v => v.id === draggedId)
    if (from === -1) return
    const [item] = arr.splice(from, 1)
    const to = arr.findIndex(v => v.id === targetId)
    if (to === -1) return
    arr.splice(edge === 'after' ? to + 1 : to, 0, item)
    const before = new Map(visioni.map(v => [v.id, v.ordine]))
    const withOrdine = arr.map((v, i) => ({ ...v, ordine: i }))
    setVisioni(withOrdine)
    for (const v of withOrdine) {
      if (before.get(v.id) !== v.ordine) { try { await store.update('visioni', v.id, { ordine: v.ordine }) } catch {} }
    }
  }

  // ---- Eliminazione rapida (con conferma) ----
  const deleteVista = (vista) => {
    setConfirm({
      titolo: 'Eliminare la vista?',
      messaggio: `"${vista.titolo || 'Senza titolo'}" verrà eliminata definitivamente.`,
      okLabel: 'Elimina',
      onOk: async () => {
        const childIds = viste.filter(v => v.parent_id === vista.id).map(v => v.id)
        const badLinks = links.filter(l => l.da_vista === vista.id || l.a_vista === vista.id).map(l => l.id)
        try {
          await store.remove('viste', vista.id)
          for (const cid of childIds) { try { await store.update('viste', cid, { parent_id: null }) } catch {} }
          for (const lid of badLinks) { try { await store.remove('links', lid) } catch {} }
        } catch (e) { alert('Errore eliminazione: ' + (e?.message || e)); return }
        setViste(vs => vs.filter(v => v.id !== vista.id).map(v => v.parent_id === vista.id ? { ...v, parent_id: null } : v))
        setLinks(ls => ls.filter(l => l.da_vista !== vista.id && l.a_vista !== vista.id))
        if (vistaAperta?.id === vista.id) setVistaAperta(null)
      },
    })
  }

  const deleteVisione = (vis) => {
    // I template esistono INDIPENDENTEMENTE dalle visioni: eliminando una visione NON
    // vanno cancellati. Le viste reali si eliminano; i template (nuovi già nella visione
    // di sistema, oppure vecchi ancora dentro questa visione) vengono spostati/tenuti nel
    // contenitore nascosto, così sopravvivono anche eliminando TUTTE le visioni.
    const mie = viste.filter(v => v.visione_id === vis.id && !v.is_template)   // viste reali
    const mieiTemplate = viste.filter(v => v.visione_id === vis.id && v.is_template)   // template "vecchi" ancora qui
    const mieIds = new Set(mie.map(v => v.id))
    setConfirm({
      titolo: 'Eliminare la visione?',
      messaggio: (mie.length
        ? `"${vis.titolo}" e le sue ${mie.length} vist${mie.length === 1 ? 'a' : 'e'} verranno eliminate definitivamente.`
        : `"${vis.titolo}" verrà eliminata definitivamente.`)
        + (mieiTemplate.length ? ` I ${mieiTemplate.length} template al suo interno verranno conservati.` : ''),
      okLabel: 'Elimina',
      onOk: async () => {
        const badLinks = links.filter(l => mieIds.has(l.da_vista) || mieIds.has(l.a_vista)).map(l => l.id)
        try {
          // 1) metti al sicuro i template ancora dentro questa visione: spostali nel
          //    contenitore di sistema PRIMA di eliminare, così il cascade cloud non li tocca.
          let rifugioId = null
          if (mieiTemplate.length) {
            const contenitore = await ensureTemplateVisione()
            rifugioId = contenitore.id
            for (const t of mieiTemplate) { try { await store.update('viste', t.id, { visione_id: rifugioId }) } catch {} }
          }
          // 2) elimina solo le viste reali
          for (const v of mie) { try { await store.remove('viste', v.id) } catch {} }
          for (const lid of badLinks) { try { await store.remove('links', lid) } catch {} }
          // 3) elimina la visione
          await store.remove('visioni', vis.id)
          const rid = rifugioId
          setViste(vs => vs
            .filter(v => !mieIds.has(v.id))                                                  // togli le viste reali eliminate
            .map(v => (rid && v.visione_id === vis.id && v.is_template) ? { ...v, visione_id: rid } : v))  // sposta i template
        } catch (e) { alert('Errore eliminazione: ' + (e?.message || e)); return }
        setVisioni(vs => vs.filter(v => v.id !== vis.id))
        setLinks(ls => ls.filter(l => !mieIds.has(l.da_vista) && !mieIds.has(l.a_vista)))
        if (vistaAperta && mieIds.has(vistaAperta.id)) setVistaAperta(null)
      },
    })
  }

  // Una scrittura cloud per volta PER VISTA. Due salvataggi sovrapposti partivano
  // dalla stessa `base` (la seconda parte prima che la prima aggiorni la base): il
  // merge a 3 vie vedeva la riga solo nel cloud, la credeva creata su un altro
  // dispositivo e la RESUSCITAVA subito dopo la cancellazione.

  const saveVista = (updated) => {
    // 1) mirror SINCRONO in locale: sopravvive a refresh/chiusura anche se il cloud fallisce.
    //    Registra anche la BASE (ultimo stato cloud noto) così un eventuale ri-flush di questa
    //    entry dirty userà il merge a 3 vie e non resusciterà righe eliminate su un altro device.
    cacheVistaLocal(updated.id, { titolo: updated.titolo, blocchi: updated.blocchi, ...(updated.cestino !== undefined ? { cestino: updated.cestino } : {}) }, baseBlocchi.current[updated.id])
    // 2) aggiornamento ottimistico della UI (aggiorna anche updated_at così Pipe
    //    riordina subito per modifica più recente, senza attendere il reload dal cloud)
    const nowIso = new Date().toISOString()
    setViste(vs => vs.map(v => v.id === updated.id ? { ...v, ...updated, updated_at: nowIso } : v))
    setVistaAperta(va => (va && va.id === updated.id) ? { ...va, ...updated, updated_at: nowIso } : va)
    // 3) salvataggio cloud, in coda dietro all'eventuale salvataggio già in volo
    //    per questa vista (vedi `saveChain`).
    const seq = saveSeq.current[updated.id] = (saveSeq.current[updated.id] || 0) + 1
    const prec = saveChain.current[updated.id] || Promise.resolve()
    const p = prec.then(() => salvaSulCloud(updated, seq))
    saveChain.current[updated.id] = p.catch(() => {})
    return p
  }

  // Salvataggio cloud con MERGE per riga: rilegge la versione cloud e fonde i
  // blocchi per id, così le modifiche fatte in contemporanea su un altro
  // dispositivo non vengono sovrascritte. (best-effort, fallback se manca `cestino`)
  // La `base` si legge QUI, non prima: dentro la coda è già quella aggiornata dal
  // salvataggio precedente.
  const salvaSulCloud = async (updated, seq = 0) => {
    const base = baseBlocchi.current[updated.id]
    const patch = { titolo: updated.titolo, blocchi: updated.blocchi }
    if (updated.cestino !== undefined && !cestinoDisabled()) patch.cestino = updated.cestino
    const applyMerged = (saved) => {
      // allinea base + UI al risultato del merge (può contenere righe di un altro dispositivo).
      // La UI la tocca solo l'ULTIMO salvataggio richiesto: un salvataggio più vecchio che
      // atterra dopo rimetterebbe a schermo righe già cancellate da quello nuovo.
      const mb = saved?.blocchi
      const ultimo = seq === (saveSeq.current[updated.id] || seq)
      if (Array.isArray(mb)) {
        baseBlocchi.current[updated.id] = mb
        if (!ultimo) return
        setViste(vs => vs.map(v => v.id === updated.id ? { ...v, blocchi: mb } : v))
        setVistaAperta(va => (va && va.id === updated.id) ? { ...va, blocchi: mb } : va)
      } else {
        baseBlocchi.current[updated.id] = updated.blocchi
      }
    }
    try {
      const saved = await store.updateVistaMerged(updated.id, patch, base)
      applyMerged(saved)
      markVistaSynced(updated.id, baseBlocchi.current[updated.id])
      return 'cloud'
    } catch (e) {
      if (isMissingCestino(e) && updated.cestino !== undefined) {
        disableCestinoCloud()
        try {
          const saved = await store.updateVistaMerged(updated.id, { titolo: updated.titolo, blocchi: updated.blocchi }, base)
          applyMerged(saved)
          markVistaSynced(updated.id, baseBlocchi.current[updated.id])   // testo salvato; il cestino resta in cache locale
          return 'cloud'
        } catch (e2) { console.warn('Salvataggio cloud fallito (conservato in locale):', e2) }
      } else {
        console.warn('Salvataggio cloud fallito (conservato in locale):', e)
      }
      return 'local'   // il dato è comunque al sicuro in localStorage
    }
  }

  const setStage = async (vistaId, stage) => {
    setViste(vs => vs.map(v => v.id === vistaId ? { ...v, stage } : v))
    // aggiorna anche la vista aperta: senza questo, il pill della fase nella
    // schermata di modifica restava con l'etichetta vecchia (sembrava "non funzionare").
    setVistaAperta(va => (va && va.id === vistaId) ? { ...va, stage } : va)
    try {
      await store.update('viste', vistaId, { stage })
    } catch (e) {
      const map = JSON.parse(localStorage.getItem('utree-stages') || '{}')
      map[vistaId] = stage
      localStorage.setItem('utree-stages', JSON.stringify(map))
      if (!stageWarned.current) {
        stageWarned.current = true
        alert('Per sincronizzare le fasi sul cloud esegui su Supabase:\nALTER TABLE public.viste ADD COLUMN IF NOT EXISTS stage text DEFAULT \'' + DEFAULT_STAGE + '\';\n(Nel frattempo le fasi sono salvate solo su questo dispositivo.)')
      }
    }
  }

  // ---- Archivio visioni: toglie rumore da Pipe e da Today senza cancellare nulla.
  //      Come per fasi e pin: se la colonna `archiviata` non esiste ancora sul cloud,
  //      si ripiega su questo dispositivo con un avviso una tantum. ----
  const toggleArchivioVisione = async (vis) => {
    const archiviata = !vis.archiviata
    setVisioni(vs => vs.map(v => v.id === vis.id ? { ...v, archiviata } : v))
    try {
      await store.update('visioni', vis.id, { archiviata })
    } catch (e) {
      const map = JSON.parse(localStorage.getItem('utree-archivio') || '{}')
      if (archiviata) map[vis.id] = true; else delete map[vis.id]
      localStorage.setItem('utree-archivio', JSON.stringify(map))
      if (!archivioWarned.current) {
        archivioWarned.current = true
        alert('Per sincronizzare l\'archivio sul cloud esegui su Supabase:\nALTER TABLE public.visioni ADD COLUMN IF NOT EXISTS archiviata boolean NOT NULL DEFAULT false;\n(Nel frattempo l\'archivio vale solo su questo dispositivo.)')
      }
    }
  }

  const withLocalArchivio = (vs) => {
    const map = JSON.parse(localStorage.getItem('utree-archivio') || '{}')
    return vs.map(v => (v.archiviata == null && map[v.id]) ? { ...v, archiviata: true } : v)
  }

  const withLocalStages = (vs) => {
    const map = JSON.parse(localStorage.getItem('utree-stages') || '{}')
    return vs.map(v => (v.stage == null && map[v.id]) ? { ...v, stage: map[v.id] } : v)
  }

  // ---- Pin: fissa una vista in cima alla sua visione (Pipe). Sincronizzato sul cloud
  //      con la colonna `pinned`; se la colonna non esiste ancora, fallback su questo
  //      dispositivo (localStorage) con avviso una tantum + script SQL da eseguire. ----
  const setPinned = async (vistaId, pinned) => {
    setViste(vs => vs.map(v => v.id === vistaId ? { ...v, pinned } : v))
    setVistaAperta(va => (va && va.id === vistaId) ? { ...va, pinned } : va)
    try {
      await store.update('viste', vistaId, { pinned })
    } catch (e) {
      const map = JSON.parse(localStorage.getItem('utree-pins') || '{}')
      if (pinned) map[vistaId] = true; else delete map[vistaId]
      localStorage.setItem('utree-pins', JSON.stringify(map))
      if (!pinWarned.current) {
        pinWarned.current = true
        alert('Per sincronizzare le viste fissate sul cloud esegui su Supabase:\nALTER TABLE public.viste ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false;\n(Nel frattempo i "fissati" sono salvati solo su questo dispositivo.)')
      }
    }
  }

  const withLocalPins = (vs) => {
    const map = JSON.parse(localStorage.getItem('utree-pins') || '{}')
    return vs.map(v => (v.pinned == null && map[v.id]) ? { ...v, pinned: true } : v)
  }

  // Fotografa lo scroll della vista aperta: va chiamato PRIMA di cambiare vista.
  const salvaScrollVista = () => {
    if (vistaAperta && contentRef.current) vistaScroll.current.set(vistaAperta.id, contentRef.current.scrollTop)
  }

  const openByName = async (name) => {
    let target = viste.find(v => (v.titolo || '').toLowerCase() === name.toLowerCase())
    if (!target) {
      const vid = vistaAperta?.visione_id || visioni[0]?.id
      if (!vid) return
      target = await store.insert('viste', { visione_id: vid, titolo: name, blocchi: [{id:'b1',text:''}], livello: (vistaAperta?.livello||0)+1, parent_id: vistaAperta?.id||null, pos_x: 0, pos_y: 0, ordine: viste.length })
      setViste(vs => [...vs, target])
      if (vistaAperta) {
        const lk = await store.insert('links', { da_vista: vistaAperta.id, a_vista: target.id, tipo: 'maggiore' })
        setLinks(ls => [...ls, lk])
      }
    }
    // apertura via wikilink: registra la vista corrente per poter tornare indietro
    salvaScrollVista()
    if (vistaAperta && vistaAperta.id !== target.id) setVistaStack(s => [...s, vistaAperta])
    setVistaAperta(target)
  }

  // Collegamento cliccato da Today: apre la vista se esiste, ma non la CREA —
  // da una task un nome sconosciuto non deve generare viste a caso.
  const openVistaByName = (name) => {
    const target = viste.find(v => (v.titolo || '').toLowerCase() === (name || '').toLowerCase())
    if (target) openFromList(target)
  }

  // apre una vista partendo dall'elenco (Pipe/Tree/Links/Progress): azzera la storia.
  // Salva lo scroll di Pipe così, al ritorno, si riparte dallo stesso punto.
  // `term` (opzionale) = testo cercato nell'elenco: la vista aperta scrolla alla riga che lo contiene.
  const openFromList = (v, term = null) => {
    if (tab === 'pipe' && contentRef.current) pipeScrollRef.current = contentRef.current.scrollTop
    setJumpText(term || null); setVistaStack([]); setVistaAperta(v)
  }
  // naviga a un'altra vista da dentro l'editor (ricerca "vai a"): impila quella corrente.
  // `term` (opzionale) = testo cercato: la vista aperta scrolla alla riga che lo contiene.
  const pushVista = (v, term = null) => {
    setJumpText(term || null)
    salvaScrollVista()
    setVistaAperta(cur => { if (cur && cur.id !== v.id) setVistaStack(s => [...s, cur]); return v })
  }
  // tasto ← / back: se sei arrivato qui da un link torna alla vista precedente, altrimenti chiudi
  const closeVista = () => {
    setJumpText(null)
    salvaScrollVista()
    setVistaStack(s => {
      if (s.length) { setVistaAperta(s[s.length - 1]); return s.slice(0, -1) }
      setVistaAperta(null); return s
    })
  }

  const chooseTheme = (id) => { applyTheme(id); setTheme(id); }

  const doExport = async () => {
    setBusy('export')
    try { await exportBackup() } finally { setBusy(''); setMenu(false) }
  }
  const doImport = async (file) => {
    setBusy('import')
    try {
      await importBackup(file)
      await reload()
      alert('Backup importato con successo.')
    } catch (e) {
      alert('Errore import: ' + (e?.message || e))
    } finally { setBusy(''); setMenu(false) }
  }
  const doImportKeep = async (files) => {
    if (!files?.length) return
    setBusy('keep')
    try {
      const res = await importGoogleKeep(files)
      await reload()
      alert(`Importazione da Google Keep completata: ${res.imported} note importate` + (res.skipped ? `, ${res.skipped} saltate (cestino)` : '') + `.\nTrovi le note nella visione "Google Keep" appena creata.`)
    } catch (e) {
      alert('Errore import Google Keep: ' + (e?.message || e))
    } finally { setBusy(''); setMenu(false) }
  }

  const reparent = async (childId, parentId) => {
    const parent = viste.find(v => v.id === parentId)
    const newLevel = parent ? (parent.livello || 0) + 1 : 0
    await store.update('viste', childId, { parent_id: parentId, livello: newLevel })
    setViste(vs => vs.map(v => v.id === childId ? { ...v, parent_id: parentId, livello: newLevel } : v))
    if (parentId) {
      const exists = links.find(l => l.a_vista === childId && l.tipo === 'maggiore')
      if (!exists) {
        const lk = await store.insert('links', { da_vista: parentId, a_vista: childId, tipo: 'maggiore' })
        setLinks(ls => [...ls, lk])
      }
    }
  }

  // sposta una vista sotto un'altra VISIONE (diventa vista radice di quella visione)
  const moveVistaToVisione = async (childId, visioneId) => {
    const badLinks = links.filter(l => l.a_vista === childId && l.tipo === 'maggiore').map(l => l.id)
    try {
      await store.update('viste', childId, { visione_id: visioneId, parent_id: null, livello: 0 })
      for (const lid of badLinks) { try { await store.remove('links', lid) } catch {} }
    } catch (e) { alert('Errore spostamento: ' + (e?.message || e)); return }
    setViste(vs => vs.map(v => v.id === childId ? { ...v, visione_id: visioneId, parent_id: null, livello: 0 } : v))
    setLinks(ls => ls.filter(l => !(l.a_vista === childId && l.tipo === 'maggiore')))
  }

  // ---- swipe fra viste (dentro l'editor): passa alla vista prec/succ della stessa visione ----
  const adjacentVista = (dir) => {
    if (!vistaAperta) return null
    const sibs = viste
      .filter(v => v.visione_id === vistaAperta.visione_id && !v.is_template)
      .sort((a, b) => (a.ordine || 0) - (b.ordine || 0))
    const i = sibs.findIndex(v => v.id === vistaAperta.id)
    if (i === -1) return null
    const j = i + dir
    return (j >= 0 && j < sibs.length) ? sibs[j] : null
  }
  const openAdjacentVista = (dir) => { const t = adjacentVista(dir); if (t) { salvaScrollVista(); setVistaAperta(t) } }
  const onEditorTouchStart = (e) => {
    if (e.touches.length !== 1 || e.target.closest('textarea, input, [data-noswipe]')) { editSwipe.current = null; return }
    const t = e.touches[0]
    editSwipe.current = { x: t.clientX, y: t.clientY }
  }
  const onEditorTouchMove = (e) => {
    const s = editSwipe.current
    if (!s) { showSwipeHint(null); return }
    const t = e.touches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy) * 1.5) { showSwipeHint(null); return }
    const dir = dx < 0 ? 1 : -1
    const target = adjacentVista(dir)
    if (!target) { showSwipeHint(null); return }
    showSwipeHint({ scope: 'vista', dir, ready: Math.abs(dx) >= 80, label: target.titolo || 'Senza titolo' })
  }
  const onEditorTouchEnd = (e) => {
    const s = editSwipe.current; editSwipe.current = null
    showSwipeHint(null)
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) < 80 || Math.abs(dy) > 55 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    openAdjacentVista(dx < 0 ? 1 : -1)   // swipe verso sinistra = vista successiva
  }

  const visteConFasi = withLocalPins(withLocalStages(viste))
  const visioniConArchivio = withLocalArchivio(visioni)
  // Proposte di oggi: righe con scadenza ≤ oggi non ancora prese in carico.
  // Escluse template, cestino e visioni archiviate (vedi lib/today.js).
  const proposteOggi = proposte({ viste, visioni: visioniConArchivio, task, oggi: todayKey() })
  // Task arricchite con la loro origine: titolo della vista e visione, e il flag
  // `orfana` se la riga di partenza è stata eliminata (la task resta, lo storico
  // non deve mai perdere pezzi).
  const taskConOrigine = task.map(t => {
    if (!t.vista_id) return t
    const v = viste.find(x => x.id === t.vista_id)
    return { ...t, vistaTitolo: v?.titolo, visione_id: v?.visione_id, orfana: !v }
  })
  const pageTitles = { privacy: 'Privacy', terms: 'Termini e condizioni', profile: 'Profilo', stats: 'Statistiche' }

  // ---------- Pagine a schermo intero (profilo, statistiche, legali) ----------
  if (page) {
    return (
      <div className="app">
        <div className="topbar">
          <button className="iconbtn" onClick={() => setPage(null)}>←</button>
          <div className="brand"><span>{pageTitles[page]}</span></div>
          <div className="spacer" />
        </div>
        <div className="content">
          {page === 'privacy' && <Privacy />}
          {page === 'terms' && <Terms />}
          {page === 'profile' && <Profile />}
          {page === 'stats' && <Stats viste={visteConFasi} task={task} regole={regole} giorni={giorni} />}
        </div>
      </div>
    )
  }

  // ---------- Editor di una vista ----------
  if (vistaAperta) {
    return (
      <div className="app">
        <div className="topbar">
          <button className="iconbtn" title={vistaStack.length ? 'Torna alla vista precedente' : 'Chiudi'} onClick={closeVista}>←</button>
          <div className="brand editor-brand"><span>{visioni.find(v => v.id === vistaAperta.visione_id)?.titolo}</span></div>
          <EditorVistaSearch viste={viste} visioni={visioni} current={vistaAperta} onOpen={pushVista} />
          <button className="iconbtn" title="Guida" onClick={() => setGuide('editor')}>?</button>
          <button className="iconbtn" title="Focus" onClick={() => setFocusMode(f => !f)}>{focusMode ? '🔅' : '🎯'}</button>
        </div>
        <div className="content" ref={contentRef} onTouchStart={onEditorTouchStart} onTouchMove={onEditorTouchMove} onTouchEnd={onEditorTouchEnd}>
          <Editor key={vistaAperta.id} vista={vistaAperta} onChange={saveVista} onWikilink={openByName} focusMode={focusMode} allViste={viste} onSetStage={setStage} onClose={closeVista} jumpTo={jumpText} onSaveTemplate={saveAsTemplate}
            api={editorApi} onEditingChange={setEditorEditing} remoteRev={remoteRev}
            onSendToToday={(dati) => sendToToday(dati, vistaAperta.id)} />
        </div>
        <SwipeHint hint={swipeHint} />
        {prompt && <NamePrompt data={prompt} onClose={() => setPrompt(null)} />}
        {guide && <GuideModal section={guide} onClose={() => setGuide(null)} />}
      </div>
    )
  }

  // ---------- Vista principale a schede ----------
  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><BrandLogo /><span>uTree</span></div>
        <div className="spacer" />
        <div className="tabs">
          {TABS.map((t, i) => {
            const cur = TABS.findIndex(x => x.id === tab)
            return (
              <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')}
                onClick={() => changeTab(t.id, i > cur ? 1 : -1)}>{t.label}</button>
            )
          })}
        </div>
        <div className="spacer" />
        {(offline || inCoda > 0) && (
          <span className={'net-badge' + (offline ? ' off' : ' coda')}
            title={offline
              ? `Senza rete: stai lavorando sui dati salvati su questo dispositivo.${inCoda ? ` ${inCoda} modifiche in attesa di sincronizzazione.` : ''}`
              : `${inCoda} modifiche in attesa di salire sul cloud.`}>
            {offline ? '⚡ offline' : `↻ ${inCoda}`}
          </span>
        )}
        <button className="iconbtn" title="Usa un template per creare una nuova vista" onClick={() => setTemplatePick(true)}>🧩</button>
        <button className="iconbtn" title="Guida" onClick={() => setGuide(tab)}>?</button>
        <button className="iconbtn" onClick={() => setMenu(true)}>☰</button>
      </div>

      <div className="content" ref={contentRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div key={tab} className={'tab-pane ' + (tabDir < 0 ? 'from-left' : tabDir > 0 ? 'from-right' : '')}>
          {tab === 'today' && (
            <Today task={taskConOrigine} tuttoLoStorico={taskConOrigine} visioni={visioniConArchivio}
              proposte={proposteOggi} giorni={giorni} giornoCorrente={giornoOggi}
              allViste={viste} onWikilink={openVistaByName} onIndent={indentTask}
              onAdd={addTask} onToggle={toggleTask} onEditText={editTaskText}
              onDelete={deleteTask} onReorder={reorderTask} onOpenOrigine={openOrigineTask}
              onAccettaProposta={accettaProposta}
              onApriRicorrenti={() => setRicorrentiOpen({})}
              onRendiRicorrente={(t) => setRicorrentiOpen({ iniziale: t.text || '', daTask: t.id })}
              onChiudiGiornata={chiudiGiornata} />
          )}
          {tab === 'pipe' && (
            <Pipeline visioni={visioniConArchivio} viste={visteConFasi}
              query={pipeQuery} onQueryChange={setPipeQuery}
              onOpen={openFromList}
              onAddVisione={addVisione} onAddVista={(visioneId) => addVista({ visioneId })}
              onRenameVisione={renameVisione} onRecolorVisione={recolorVisione}
              onDeleteVista={deleteVista} onDeleteVisione={deleteVisione}
              onReorderVisioni={reorderVisioni} onMoveVistaToVisione={moveVistaToVisione}
              onTogglePin={(v) => setPinned(v.id, !v.pinned)}
              onToggleArchivio={toggleArchivioVisione} />
          )}
          {tab === 'tree' && (
            (visioni.length || viste.length)
              ? <Tree viste={visteConFasi} visioni={visioni} onOpen={openFromList}
                  onAddChild={(parent) => addVista({ parent })}
                  onAddToVisione={(visioneId) => addVista({ visioneId })}
                  onReparent={reparent} onMoveToVisione={moveVistaToVisione} onQuickSave={saveVista}
                  onDeleteVista={deleteVista} />
              : <Empty msg="Crea una visione in Pipe per vedere l'albero." />
          )}
          {tab === 'links' && (
            (viste.length)
              ? <Links viste={visteConFasi} visioni={visioni} onOpen={openFromList} />
              : <Empty msg="Crea qualche vista e collegale con ((Nome vista)) per vedere la mappa." />
          )}
          {tab === 'progress' && (
            <Progress viste={visteConFasi} onOpen={openFromList} onSetStage={setStage} />
          )}
        </div>
      </div>

      {/* FAB: crea la cosa giusta per la scheda in cui sei.
          In Today il gesto atteso è "aggiungi un'attività di oggi", non "nuova vista":
          il ＋ apre direttamente il prompt della task. Altrove resta il menu di creazione. */}
      <div className="fab-wrap">
        {fabOpen && tab !== 'today' && (
          <div className="fab-menu">
            <button onClick={() => { setFabOpen(false); addVisione() }}>🌱 Nuova visione</button>
            <button onClick={() => { setFabOpen(false); addVista({}) }}>📄 Nuova vista</button>
          </div>
        )}
        <button className={'fab' + (fabOpen && tab !== 'today' ? ' open' : '')}
          title={tab === 'today' ? 'Aggiungi una task di oggi' : 'Crea'}
          onClick={() => { if (tab === 'today') addTaskOggi(); else setFabOpen(o => !o) }}>
          {/* croce disegnata, non un carattere: i glifi "+" hanno spallature e
              linea di base asimmetriche e restavano scentrati nel cerchio */}
          <svg className="fab-plus" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {fabOpen && tab !== 'today' && <div className="fab-scrim" onClick={() => setFabOpen(false)} />}

      <SwipeHint hint={swipeHint} />

      {ricorrentiOpen && (
        <Ricorrenti regole={regole} iniziale={ricorrentiOpen.iniziale}
          tenuta={tenutaRicorrenti(task, regole)}
          onSave={(r) => salvaRegola(r.id ? r : { ...r, daTask: ricorrentiOpen.daTask })}
          onDelete={eliminaRegola}
          onClose={() => setRicorrentiOpen(null)} />
      )}
      {prompt && <NamePrompt data={prompt} onClose={() => setPrompt(null)} />}
      {confirm && <ConfirmModal data={confirm} onClose={() => setConfirm(null)} />}
      {guide && <GuideModal section={guide} onClose={() => setGuide(null)} />}

      {templatePick && (() => {
        const templates = viste.filter(v => v.is_template)
        return (
          <div className="modal-bg" onClick={() => setTemplatePick(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>Nuova vista da template</h3>
              {templates.length ? (
                <div className="template-list">
                  {templates.map(t => (
                    <button key={t.id} className="template-opt" onClick={() => createFromTemplate(t)}>
                      <span className="template-name">🧩 {t.titolo || 'Senza titolo'}</span>
                      <span className="template-meta">{(t.blocchi || []).length} righe</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{color:'var(--text-dim)'}}>Nessun template ancora. Apri una vista e usa il pulsante 🧩 fra i modificatori di testo per salvarla come template.</p>
              )}
              <div className="row"><button className="btn" onClick={() => setTemplatePick(false)}>Chiudi</button></div>
            </div>
          </div>
        )
      })()}

      {themeOpen && (
        <div className="modal-bg" onClick={() => setThemeOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Tema dell'app</h3>
            <div className="theme-grid">
              {Object.entries(THEMES).map(([id, t]) => (
                <button key={id} className={'theme-opt' + (theme===id ? ' active' : '')}
                  onClick={() => chooseTheme(id)}>
                  <div className="theme-swatches">
                    <span style={{background:t.vars['--bg']}} />
                    <span style={{background:t.vars['--green-bright']}} />
                    <span style={{background:t.vars['--panel-2']}} />
                  </div>
                  <span>{t.emoji} {t.nome}</span>
                </button>
              ))}
            </div>
            <div className="row"><button className="btn" onClick={() => setThemeOpen(false)}>Fatto</button></div>
          </div>
        </div>
      )}

      {/* L'anteprima (pulsante 👁) è stata rimossa da Pipe: toccare una card apre
          direttamente la vista, che è la cosa che si voleva fare comunque. */}

      {menu && (
        <div className="modal-bg" onClick={() => setMenu(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Menu</h3>
            <div className="menu-list">
              <button onClick={() => { setMenu(false); setPage('profile') }}>👤 Profilo</button>
              <button onClick={() => { setMenu(false); setPage('stats') }}>📊 Statistiche</button>
              <button onClick={() => { setMenu(false); setGuide(tab) }}>❓ Guida comandi</button>
              <button onClick={() => { setMenu(false); setThemeOpen(true) }}>🎨 Tema dell'app</button>
              <button onClick={() => {
                setMenu(false)
                setConfirm({
                  titolo: 'Ripulire le copie locali?',
                  messaggio: 'Cancella snapshot, coda di sincronizzazione e cache delle viste salvati su QUESTO dispositivo, poi ricarica tutto dal cloud. Non tocca nulla su Supabase.'
                    + (inCoda ? `\n\nAttenzione: ci sono ${inCoda} modifiche non ancora salite. Andrebbero perse.` : ''),
                  okLabel: 'Ripulisci e ricarica',
                  onOk: async () => { purgeLocalData(); await reload() },
                })
              }}>🧹 Ripulisci le copie locali</button>
              <button onClick={doExport} disabled={busy==='export'}>⬇ Esporta backup (JSON)</button>
              <label className="menu-import">
                ⬆ Importa backup (JSON)
                <input type="file" accept="application/json" style={{display:'none'}}
                  onChange={e => e.target.files[0] && doImport(e.target.files[0])} />
              </label>
              <label className="menu-import" title="Seleziona la cartella 'Takeout/Keep' scaricata da Google Takeout">
                📥 Importa da Google Keep {busy==='keep' ? '…' : ''}
                <input type="file" accept="application/json" multiple webkitdirectory="" directory="" style={{display:'none'}}
                  onChange={e => { const files = Array.from(e.target.files); e.target.value = ''; doImportKeep(files) }} />
              </label>
              <button onClick={() => { setPage('privacy'); setMenu(false) }}>Privacy</button>
              <button onClick={() => { setPage('terms'); setMenu(false) }}>Termini e condizioni</button>
              {!isDemo && <button onClick={() => { signOut(); setMenu(false) }}>Esci ({user.email})</button>}
            </div>
            <div className="copyright" style={{marginTop:16,borderTop:'none'}}>
              uTree © {new Date().getFullYear()} — Sviluppata da <b>Samuele Contessa</b>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Barra di ricerca nell'header dell'editor: salta rapidamente a un'altra vista.
// Priorità ai match nel titolo, poi nel contenuto. Enter apre il primo risultato.
function EditorVistaSearch({ viste, visioni, current, onOpen }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef(null)
  const visName = (id) => visioni.find(v => v.id === id)?.titolo || ''
  const s = q.trim().toLowerCase()
  const results = useMemo(() => {
    if (!s) return []
    const scored = []
    for (const v of viste) {
      if (v.is_template) continue
      const title = (v.titolo || '').toLowerCase()
      let sc = 0
      if (title.includes(s)) sc = 2
      else if ((v.blocchi || []).some(b => (b.text || '').toLowerCase().includes(s))) sc = 1
      if (sc) scored.push({ v, sc, same: v.visione_id === current?.visione_id })
    }
    scored.sort((a, b) => b.sc - a.sc || (b.same ? 1 : 0) - (a.same ? 1 : 0) || (a.v.titolo || '').localeCompare(b.v.titolo || ''))
    return scored.slice(0, 8)
  }, [s, viste, current])

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])
  useEffect(() => { setHi(0) }, [s])

  // passa il termine cercato solo per i match nel testo (sc===1): la vista aperta scrolla alla riga trovata
  const pick = (v, sc) => { if (!v) return; onOpen(v, sc === 1 ? s : null); setQ(''); setOpen(false) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHi(h => Math.min(results.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') {
      // apre SEMPRE e solo la vista evidenziata (mai crearne una nuova)
      e.preventDefault(); e.stopPropagation()
      const target = results[hi] || results[0]
      if (target) pick(target.v, target.sc)   // results contiene {v, sc, same}: passa la vista, non il wrapper
    }
    else if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setOpen(false); e.currentTarget.blur() }
  }

  return (
    <div className="editor-nav" ref={boxRef} data-noswipe="">
      <span className="editor-nav-ico">🔍</span>
      <input className="editor-nav-input" value={q} placeholder="Vai a una vista…"
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onKeyDown={onKey} />
      {q && <button className="editor-nav-clear" title="Pulisci" onClick={() => { setQ(''); setOpen(false) }}>✕</button>}
      {open && s && (
        <div className="editor-nav-menu">
          {results.length === 0 && <div className="editor-nav-empty">Nessuna vista trovata.</div>}
          {results.map((r, i) => (
            <button key={r.v.id} className={'editor-nav-item' + (i === hi ? ' hi' : '')}
              onMouseEnter={() => setHi(i)} onClick={() => pick(r.v, r.sc)}>
              <span className="editor-nav-title">{r.v.titolo || 'Senza titolo'}</span>
              <span className="editor-nav-vis">{visName(r.v.visione_id)}{r.sc === 1 ? ' · nel testo' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Indicatore che appare durante lo swipe orizzontale: mostra dove si sta per andare
// (sezione o vista adiacente) e si "accende" quando lo spostamento è sufficiente a cambiare.
function SwipeHint({ hint }) {
  if (!hint) return null
  const right = hint.dir > 0
  return (
    <div className={'swipe-hint ' + (right ? 'right' : 'left') + (hint.ready ? ' ready' : '')}>
      <span className="swipe-hint-arrow">{right ? '›' : '‹'}</span>
      <span className="swipe-hint-body">
        <span className="swipe-hint-kind">{hint.scope === 'vista' ? 'Vista' : 'Sezione'}</span>
        <span className="swipe-hint-label">{hint.label}</span>
      </span>
    </div>
  )
}

function GuideModal({ section, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <Guide section={section} />
        <div className="row"><button className="btn" onClick={onClose}>Ho capito</button></div>
      </div>
    </div>
  )
}

function NamePrompt({ data, onClose }) {
  const [val, setVal] = useState(data.valore || '')
  const ok = () => {
    const nome = val.trim()
    if (!nome) return
    data.onOk(nome)
    onClose()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{data.titolo}</h3>
        <div className="field">
          <label>{data.label}</label>
          <input className="input" autoFocus value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') onClose() }}
            placeholder="Scrivi un nome…" />
        </div>
        <div className="row">
          <button className="btn ghost" onClick={onClose}>Annulla</button>
          <button className="btn" onClick={ok}>Conferma</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ data, onClose }) {
  const ok = async () => { await data.onOk(); onClose() }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{data.titolo}</h3>
        <p style={{ color: 'var(--text-dim)', lineHeight: 1.5, margin: '0 0 4px' }}>{data.messaggio}</p>
        <div className="row">
          <button className="btn ghost" onClick={onClose}>Annulla</button>
          <button className="btn danger" onClick={ok}>{data.okLabel || 'Elimina'}</button>
        </div>
      </div>
    </div>
  )
}

function Empty({ msg }) {
  return <div style={{padding:40,textAlign:'center',color:'var(--text-dim)'}}>{msg}</div>
}

// Logo uTree inline: albero con nodi a cerchio, usa le variabili CSS del tema.
function BrandLogo() {
  return (
    <svg className="brand-logo" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="var(--panel-2)" stroke="var(--border)" strokeWidth="6" />
      {/* connettori a gomito */}
      <g fill="none" stroke="var(--green-bright)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity="0.9">
        <path d="M150 182 V236 Q150 248 162 248 H244" />
        <path d="M150 182 V346 Q150 358 162 358 H244" />
        <path d="M296 248 V300 Q296 312 308 312 H360" />
      </g>
      {/* nodi = cerchi */}
      <circle cx="150" cy="182" r="40" fill="var(--green)" stroke="var(--green-bright)" strokeWidth="5" />
      <circle cx="150" cy="182" r="15" fill="var(--text)" />
      <circle cx="270" cy="248" r="30" fill="var(--panel)" stroke="var(--green-bright)" strokeWidth="5" />
      <circle cx="270" cy="248" r="10" fill="var(--green-bright)" />
      <circle cx="386" cy="312" r="26" fill="var(--panel)" stroke="var(--green-bright)" strokeWidth="5" />
      <circle cx="386" cy="312" r="9" fill="var(--accent)" />
      <circle cx="270" cy="358" r="30" fill="var(--panel)" stroke="var(--green-bright)" strokeWidth="5" />
      <circle cx="270" cy="358" r="10" fill="var(--green-bright)" />
    </svg>
  )
}
