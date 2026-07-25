import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { RenderedBlock, evalFormula } from '../lib/markdown.jsx'
import { logChars } from '../lib/activity.js'
import { cacheVistaLocal } from '../lib/localcache.js'
import { STAGES, stageOf } from '../lib/stages.js'
import { store } from '../lib/store.js'
import { prepareImage } from '../lib/images.js'
import * as gcal from '../lib/gcal.js'

const uid = () => 'b-' + Math.random().toString(36).slice(2, 9)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MAX_INDENT = 6
const INDENT_PX = 22     // larghezza di ogni guida di rientro (= un livello)
const INDENT_STEP = 26   // px di trascinamento orizzontale per cambiare livello
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

// Clipboard delle SEZIONI a livello di modulo: sopravvive al cambio vista,
// così puoi tagliare/copiare una sezione da una vista e incollarla in un'altra.
let SECTION_CLIP = []   // [{ text, indent }] con indent normalizzato (il più basso = 0)

// Racchiude la prima occorrenza "libera" di `name` (non già dentro (( )) o [[ ]]) in un collegamento.
function linkifyName(text, name) {
  const re = new RegExp('(?<![\\(\\[])\\b' + escapeRe(name) + '\\b(?![\\)\\]])', 'i')
  return text.replace(re, (match) => '((' + match + '))')
}

const DAY_MS = 24 * 60 * 60 * 1000
// Info scadenza di una riga: classe di colore + etichetta countdown, dai giorni di distanza.
// `due` è una stringa 'YYYY-MM-DD'. Confronto per giorni di calendario (mezzanotte).
function dueInfo(due) {
  if (!due) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due + 'T00:00:00'); if (isNaN(d.getTime())) return null
  const days = Math.round((d.getTime() - today.getTime()) / DAY_MS)
  if (days < 0)  return { cls: 'due-over',  days, label: days === -1 ? 'scaduta ieri' : `scaduta ${-days} g fa` }
  if (days === 0) return { cls: 'due-today', days, label: 'scade oggi' }
  if (days === 1) return { cls: 'due-soon',  days, label: 'scade domani' }
  if (days <= 3)  return { cls: 'due-soon',  days, label: `tra ${days} g` }
  if (days <= 7)  return { cls: 'due-week',  days, label: `tra ${days} g` }
  return { cls: 'due-later', days, label: `tra ${days} g` }
}

const totalChars = (blocks) => (blocks || []).reduce((n, b) => n + (b.text?.length || 0), 0)
const purgeTrash = (t) => (t || []).filter(x => x && x.deletedAt && Date.now() - x.deletedAt < SEVEN_DAYS)
const relTime = (ts) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'ora'
  if (s < 3600) return Math.floor(s / 60) + ' min fa'
  if (s < 86400) return Math.floor(s / 3600) + ' h fa'
  return Math.floor(s / 86400) + ' g fa'
}
const shortText = (t) => (t || '').replace(/[#*`>]/g, '').trim().slice(0, 44) || 'riga'

// ---- Scorciatoie con "/" (slash) durante la scrittura di una riga ----
const MESI_FULL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const MESI_ABBR = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const pad2 = (n) => String(n).padStart(2, '0')
// valore inserito da una scorciatoia, calcolato al momento dell'inserimento
const slashValue = (key) => {
  const d = new Date()
  switch (key) {
    case 'date':  return `${d.getDate()} ${MESI_FULL[d.getMonth()]} ${d.getFullYear()}`
    case 'sdate': return `${d.getDate()} ${MESI_ABBR[d.getMonth()]}`
    case 'ndate': return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
    case 'time':  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    case 'now':   return `${d.getDate()} ${MESI_ABBR[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    case 'day':   return GIORNI[d.getDay()]
    default:      return ''
  }
}
// Due famiglie di comandi:
//  - INSERIMENTO: sostituiscono il token /parola con del testo (date, ore…);
//  - AZIONE (`azione: true`): tolgono il token e fanno qualcosa alla riga.
const SLASH_CMDS = [
  { key: 'check', label: '/check', desc: 'aggiungi un checkbox alla riga', azione: true, prev: '☐' },
  { key: 'oggi',  label: '/oggi',  desc: 'porta la riga fra le task di oggi', azione: true, prev: '⚡' },
  { key: 'date',  label: '/date',  desc: 'giorno mese anno' },
  { key: 'sdate', label: '/sdate', desc: 'giorno e mese abbreviato' },
  { key: 'ndate', label: '/ndate', desc: 'gg/mm/aaaa' },
  { key: 'time',  label: '/time',  desc: 'ora:minuti' },
  { key: 'now',   label: '/now',   desc: 'data e ora' },
  { key: 'day',   label: '/day',   desc: 'giorno della settimana' },
]

// Divide un testo multilinea in righe con livello di rientro dedotto dagli spazi/tab iniziali
// (2 spazi = 1 livello, oppure 1 tab = 1 livello). `base` è il rientro di partenza.
function parseIndented(text, base = 0) {
  return (text || '').replace(/\r/g, '').split('\n').map(line => {
    const ws = (line.match(/^[\t ]*/) || [''])[0]
    const tabs = (ws.match(/\t/g) || []).length
    const spaces = ws.replace(/\t/g, '').length
    const lvl = tabs + Math.floor(spaces / 2)
    return { text: line.slice(ws.length), indent: Math.max(0, Math.min(MAX_INDENT, base + lvl)) }
  })
}

// Editor della singola VISTA: blocchi markdown, drag&drop (riordino + nidificazione),
// click=modifica · doppio click=copia · icona cestino=elimina (con recupero 7 giorni),
// selezione multipla + copia/taglia/incolla di sezioni intere, undo/redo.
export default function Editor({ vista, onChange, onWikilink, focusMode, allViste = [], onSetStage, onClose, jumpTo, onSaveTemplate, onSendToToday }) {
  const [stagePick, setStagePick] = useState(false)
  const [blocks, setBlocks] = useState(vista.blocchi?.length ? vista.blocchi : [{ id: uid(), text: '' }])
  const [title, setTitle] = useState(vista.titolo || '')
  const [trash, setTrash] = useState(purgeTrash(vista.cestino))
  const [editing, setEditing] = useState(null)     // id del blocco in edit
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const [ghost, setGhost] = useState(null)         // { x, y, text } fantasma che segue il cursore
  const [flash, setFlash] = useState(null)
  const [refFlash, setRefFlash] = useState(() => new Set())   // indici righe referenziate da #n (evidenziazione temporanea)
  const refFlashTimer = useRef(null)
  const [toast, setToast] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [showTrash, setShowTrash] = useState(false)
  const [showHints, setShowHints] = useState(false)   // pannello suggerimenti (aperto/chiuso col pulsante ?)
  const [saveState, setSaveState] = useState('idle')   // idle | saving | saved | local
  const [clipCount, setClipCount] = useState(SECTION_CLIP.length)
  const [search, setSearch] = useState('')             // ricerca fra le righe DENTRO questa vista
  const [duePick, setDuePick] = useState(null)         // id della riga di cui si sta impostando la scadenza
  const [bulkDue, setBulkDue] = useState(false)        // popup scadenza per le righe selezionate (Ctrl+D in selezione)
  const [jumpId, setJumpId] = useState(null)           // riga a cui scrollare (arrivo da ricerca fra viste)
  const [lightbox, setLightbox] = useState(null)       // { blockId, i } immagine aperta a schermo intero
  const [imgBusy, setImgBusy] = useState(false)        // caricamento immagine in corso
  const [, setTick] = useState(0)                      // ri-valuta le scadenze nel tempo (senza interazione)
  const [slash, setSlash] = useState(null)             // { blockId, start, query, sel } menu scorciatoie "/"
  const [menuId, setMenuId] = useState(null)           // id della riga con il menu azioni (⋮) aperto su mobile
  const [copyChoice, setCopyChoice] = useState(null)   // { text, link } popup: copia riga intera o solo il link
  const editRef = useRef(null)                          // textarea della riga in modifica (per il caret dopo una scorciatoia)
  const pendingCaret = useRef(null)                     // posizione del caret da applicare all'apertura della modifica (dove hai premuto)
  const searchRef = useRef(null)                       // input ricerca vista (per la digitazione libera)
  const imgInputRef = useRef(null)                     // input file nascosto per allegare immagini
  const imgTargetId = useRef(null)                     // riga a cui allegare l'immagine scelta
  const undoStack = useRef([])
  const redoStack = useRef([])
  const saveTimer = useRef(null)
  const lastEdit = useRef(null)          // ultimo blocco editato: i tasti toolbar agiscono su questo
  const dragStartX = useRef(0)
  const clickTimer = useRef(null)        // discrimina click (modifica) da doppio-click (copia)
  const prevChars = useRef(totalChars(vista.blocchi))
  const pending = useRef(null)           // { blocks, title, trash } da salvare al volo se si esce
  const rootRef = useRef(null)           // contenitore della vista: riceve il focus all'apertura

  useEffect(() => { if (editing) lastEdit.current = editing }, [editing])

  // uscendo dall'editing togliamo l'evidenziazione delle righe referenziate
  useEffect(() => { if (!editing) { clearTimeout(refFlashTimer.current); setRefFlash(s => s.size ? new Set() : s) } }, [editing])

  // Mobile: quando si apre la tastiera la riga in modifica può finire nascosta
  // (soprattutto se è fra le ultime). Portiamola sempre al centro dello schermo
  // sia all'apertura sia quando la tastiera cambia l'altezza visibile (visualViewport).
  useEffect(() => {
    if (!editing) return
    const bring = () => {
      const el = editRef.current
      if (el) { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch { /* ignore */ } }
    }
    const t = setTimeout(bring, 320)   // attende la comparsa della tastiera
    const vv = window.visualViewport
    vv?.addEventListener('resize', bring)
    return () => { clearTimeout(t); vv?.removeEventListener('resize', bring) }
  }, [editing])

  // aggiorna periodicamente i colori/etichette delle scadenze (una volta al minuto)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60000); return () => clearInterval(t) }, [])

  // Arrivo da una ricerca fra viste con match nel testo: scrolla (animato) alla
  // prima riga che contiene il termine e la evidenzia per qualche secondo.
  useEffect(() => {
    const term = (jumpTo || '').trim().toLowerCase()
    if (!term) return
    const hit = blocks.find(b => (b.text || '').toLowerCase().includes(term))
    if (!hit) return
    setJumpId(hit.id)
    const tScroll = setTimeout(() => {
      const el = rootRef.current?.querySelector(`[data-block-id="${hit.id}"]`)
      if (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* ignore */ } }
    }, 140)   // attende il montaggio della lista righe
    const tClear = setTimeout(() => setJumpId(null), 2400)
    return () => { clearTimeout(tScroll); clearTimeout(tClear) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, vista.id])

  // Scrive l'eventId di Google Calendar in una riga senza sporcare undo/redo.
  const patchBlockGcal = (id, gcalId) => {
    setBlocks(prev => {
      const next = prev.map(b => b.id === id ? { ...b, gcal: gcalId || undefined } : b)
      persist(next, title, trash)
      return next
    })
  }

  // Sincronizza la scadenza di una riga con Google Calendar (se collegato).
  // Best-effort: non blocca l'UI, mostra solo un toast di esito.
  // `prev` = riga com'era PRIMA della modifica (per recuperare l'eventId).
  const syncDueToCalendar = async (prev, due) => {
    if (!gcal.hasGoogleCalendar || !gcal.isConnected()) return
    try {
      if (!due) {
        if (prev?.gcal) { await gcal.deleteEvent(prev.gcal); patchBlockGcal(prev.id, null) }
        setToast('🗑 Rimosso da Google Calendar')
      } else {
        const eventId = await gcal.upsertEvent({ ...prev, due }, title)
        patchBlockGcal(prev.id, eventId)
        setToast('📅 Sincronizzato su Google Calendar')
      }
    } catch (e) {
      setToast('⚠️ Calendar: ' + (e?.message || 'errore'))
    }
    setTimeout(() => setToast(''), 1800)
  }

  // imposta o rimuove la scadenza di una riga ('' = rimuovi)
  const setDue = (id, due) => {
    const prev = blocks.find(b => b.id === id)
    const next = blocks.map(b => b.id === id ? { ...b, due: due || undefined } : b)
    commit(next)
    syncDueToCalendar(prev, due || '')
  }
  // ---- CHECKBOX di riga (/check) -------------------------------------------
  // `check` = la riga ha un checkbox · `done` = è spuntata.
  // Sono proprietà della riga, non testo: così restano leggibili anche se il
  // contenuto cambia, e Today può spuntarle da fuori senza toccare il markdown.
  // `testo` (facoltativo) viene applicato nello stesso commit: serve a /check,
  // che deve anche togliere il token "/check" dal testo.
  const setCheck = (id, on, testo) => {
    const next = blocks.map(b => b.id === id
      ? {
        ...b,
        check: on || undefined,
        done: on ? (b.done || undefined) : undefined,
        ...(testo !== undefined ? { text: testo } : {}),
      }
      : b)
    commit(next)
  }
  const toggleCheck = (id) => {
    const b = blocks.find(x => x.id === id)
    if (b) setCheck(id, !b.check)
  }
  // spunta / de-spunta (solo per le righe che hanno il checkbox)
  const toggleDone = (id) => {
    const next = blocks.map(b => b.id === id ? { ...b, done: b.done ? undefined : true } : b)
    commit(next)
  }
  // stesso comando sulle righe selezionate: se ne ha già una, si toglie a tutte
  const toggleCheckMany = () => {
    if (!selected.size) return
    const tutteCheck = blocks.filter(b => selected.has(b.id)).every(b => b.check)
    const next = blocks.map(b => selected.has(b.id)
      ? { ...b, check: tutteCheck ? undefined : true, done: tutteCheck ? undefined : b.done }
      : b)
    commit(next)
  }

  // ---- TELETRASPORTO in Today (/oggi) ---------------------------------------
  // La riga viene SPOSTATA: esce dalla nota ed entra fra le task di oggi.
  // Niente doppioni fra la nota e Today — la stessa cosa non deve risultare
  // "da fare" in due posti. Per non perdere nulla la riga finisce nel CESTINO
  // della vista (recuperabile 7 giorni) ed è annullabile con Ctrl+Z.
  const oggiKey = () => {
    const d = new Date(); const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const avvisa = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1800) }

  // Sposta in Today le righe indicate, con UN SOLO commit (un ciclo di commit
  // ripartirebbe ogni volta dallo stesso `blocks` e salverebbe solo l'ultimo).
  // `testiPuliti` (facoltativo) = testo già ripulito per riga, usato da /oggi
  // che deve anche togliere il token dal testo.
  const spostaInToday = (targets, testiPuliti = {}) => {
    if (!onSendToToday || !targets.length) return
    const giorno = oggiKey()
    const daPortare = targets
      .map(b => ({ b, text: (testiPuliti[b.id] ?? b.text ?? '').replace(/[#*`>]/g, '').trim() }))
      .filter(x => x.text)
    if (!daPortare.length) { avvisa('⚠️ Riga vuota: niente da portare in Today'); return }

    const ids = new Set(daPortare.map(x => x.b.id))
    let nextBlocks = blocks.filter(b => !ids.has(b.id))
    if (!nextBlocks.length) nextBlocks = [{ id: uid(), text: '', indent: 0 }]   // la vista non resta senza righe
    const nextTrash = [
      ...daPortare.map(x => ({ ...x.b, deletedAt: Date.now(), inToday: true })),
      ...trash,
    ].slice(0, 200)

    pushUndo(blocks)
    setBlocks(nextBlocks); setTrash(nextTrash)
    setEditing(e => ids.has(e) ? null : e)
    setSelected(s => { const n = new Set(s); ids.forEach(i => n.delete(i)); return n })
    persist(nextBlocks, title, nextTrash)

    daPortare.forEach(x => onSendToToday({ testo: x.text, giorno }))
    avvisa(daPortare.length === 1
      ? '⚡ Spostata in Today (Ctrl+Z per annullare)'
      : `⚡ ${daPortare.length} righe spostate in Today`)
  }

  const mandaOggi = (b, testo) => spostaInToday([b], testo !== undefined ? { [b.id]: testo } : {})
  const mandaOggiMany = () => spostaInToday(blocks.filter(b => selected.has(b.id)))

  // imposta la stessa scadenza su tutte le righe selezionate ('' = rimuovi)
  const setDueMany = (due) => {
    if (!selected.size) return
    const targets = blocks.filter(b => selected.has(b.id))
    const next = blocks.map(b => selected.has(b.id) ? { ...b, due: due || undefined } : b)
    commit(next)
    targets.forEach(t => syncDueToCalendar(t, due || ''))
  }

  // Fallback per Safari e browser che non generano l'evento "paste" senza
  // un'interazione precedente: porta il focus sul contenitore appena si apre
  // la vista, così Ctrl+V funziona subito anche senza aver cliccato altrove.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [vista.id])

  // re-sync se cambia la vista aperta (+ pulizia cestino oltre 7 giorni)
  useEffect(() => {
    const b = vista.blocchi?.length ? vista.blocchi : [{ id: uid(), text: '' }]
    const cleanTrash = purgeTrash(vista.cestino)
    setBlocks(b)
    setTitle(vista.titolo || '')
    setTrash(cleanTrash)
    setEditing(null); setSelectMode(false); setSelected(new Set()); setShowTrash(false); setSearch('')
    setSlash(null); setMenuId(null)
    prevChars.current = totalChars(vista.blocchi)
    undoStack.current = []; redoStack.current = []
    if ((vista.cestino || []).length !== cleanTrash.length) {
      onChange({ ...vista, blocchi: b, titolo: vista.titolo || '', cestino: cleanTrash })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista.id])

  // salvataggio debounced (+ log caratteri scritti). Include sempre titolo e cestino correnti.
  const persist = (nextBlocks, nextTitle = title, nextTrash = trash) => {
    // SICUREZZA ANTI-PERDITA: scrivi SUBITO e in modo SINCRONO su localStorage, a ogni battuta.
    cacheVistaLocal(vista.id, { titolo: nextTitle, blocchi: nextBlocks, cestino: nextTrash })
    setSaveState('saving')
    pending.current = { blocks: nextBlocks, title: nextTitle, trash: nextTrash }
    const now = totalChars(nextBlocks)
    logChars(now - prevChars.current)
    prevChars.current = now
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      pending.current = null
      const r = await onChange({ ...vista, blocchi: nextBlocks, titolo: nextTitle, cestino: nextTrash })
      setSaveState(r === 'local' ? 'local' : 'saved')
    }, 400)
  }

  // Il conteggio caratteri normale si basa sul delta di lunghezza totale del documento
  // (persist -> logChars). Con un incolla che SOSTITUISCE testo esistente il delta netto
  // può essere quasi nullo o negativo anche se hai incollato molto testo: va registrato
  // esplicitamente qui, e il "prevChars" va avanzato per non farlo poi ricontare due volte.
  const logPasteChars = (len) => {
    if (!(len > 0)) return
    logChars(len)
    prevChars.current += len
  }

  const flush = useCallback(() => {
    if (!pending.current) return
    clearTimeout(saveTimer.current)
    const { blocks: b, title: t, trash: tr } = pending.current
    pending.current = null
    cacheVistaLocal(vista.id, { titolo: t, blocchi: b, cestino: tr })
    // IMPORTANTE: aggiorna anche l'indicatore. Senza questo, se si cambia scheda/app o si
    // chiude la vista durante i 400ms di debounce, il salvataggio parte ma la clessidra ⏳
    // resta "appesa" per sempre (sembrava bloccarsi ogni tanto).
    Promise.resolve(onChange({ ...vista, blocchi: b, titolo: t, cestino: tr }))
      .then(r => setSaveState(r === 'local' ? 'local' : 'saved'))
      .catch(() => setSaveState('local'))
  }, [vista, onChange])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flush])

  // fantasma di trascinamento che segue il cursore durante il drag HTML5
  useEffect(() => {
    if (!dragId) return
    const onOver = (e) => { if (e.clientX || e.clientY) setGhost(g => g ? { ...g, x: e.clientX, y: e.clientY } : g) }
    document.addEventListener('dragover', onOver)
    // durante il trascinamento consenti di scorrere la lista con la rotellina del mouse.
    // Il contenitore scrollabile è `.content` (l'editor sta dentro), con fallback all'elemento
    // di scroll del documento. Aggiorniamo lo scroll sia sul contenitore sia sul window,
    // perché a seconda del layout può scorrere l'uno o l'altro.
    const scroller = rootRef.current?.closest('.content') || document.scrollingElement || document.documentElement
    const onWheel = (e) => {
      e.preventDefault()
      const dy = e.deltaY
      if (scroller) scroller.scrollTop += dy
      window.scrollBy(0, dy)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => { document.removeEventListener('dragover', onOver); window.removeEventListener('wheel', onWheel) }
  }, [dragId])

  const pushUndo = (snapshot) => {
    undoStack.current.push(JSON.stringify(snapshot))
    if (undoStack.current.length > 100) undoStack.current.shift()
    redoStack.current = []
  }

  const commit = (next, { undo = true } = {}) => {
    if (undo) pushUndo(blocks)
    setBlocks(next)
    persist(next, title, trash)
  }

  const undo = () => {
    if (!undoStack.current.length) return
    redoStack.current.push(JSON.stringify(blocks))
    const prev = JSON.parse(undoStack.current.pop())
    setBlocks(prev); persist(prev, title, trash)
  }
  const redo = () => {
    if (!redoStack.current.length) return
    undoStack.current.push(JSON.stringify(blocks))
    const next = JSON.parse(redoStack.current.pop())
    setBlocks(next); persist(next, title, trash)
  }

  // keyboard shortcuts undo/redo + copia righe selezionate
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      // Ctrl+S in selezione con righe di UNA sola sezione → seleziona tutta la sezione (escluso il padre);
      // in selezione senza righe o su più sezioni → esci; fuori dalla selezione → entra in selezione vuota.
      // (blocca sempre il "salva pagina" del browser.)
      else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (selectMode && selected.size && singleSectionParent()) selectSection()
        else if (selectMode) exitSelect()
        else { setEditing(null); setSelectMode(true); setSelected(new Set()) }
      }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && selectMode && selected.size) {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return   // lascia fare la copia nativa dentro un campo
        e.preventDefault()
        copySection()
      }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X') && selectMode && selected.size) {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return   // lascia fare il taglio nativo dentro un campo
        e.preventDefault()
        cutSection()
      }
      // Ctrl+M = MAIUSCOLO (righe selezionate oppure la riga in modifica)
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        upperShortcut()
      }
      // Ctrl+D = imposta la scadenza (riga in modifica → il suo popup; selezione → popup multiplo)
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        if (editing) { e.preventDefault(); setDuePick(editing) }
        else if (selectMode && selected.size) { e.preventDefault(); setBulkDue(true) }
      }
      // Ctrl+Shift+T = porta in Today (riga in modifica, ultima toccata, o selezione)
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        if (selectMode && selected.size) { e.preventDefault(); mandaOggiMany() }
        else {
          const id = editing || lastEdit.current
          const b = id && blocks.find(x => x.id === id)
          if (b) { e.preventDefault(); mandaOggi(b) }
        }
      }
      // Ctrl+Shift+K = aggiungi/togli il checkbox (K come "check": Ctrl+Shift+C
      // è già preso dagli strumenti sviluppatore del browser)
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
        if (selectMode && selected.size) { e.preventDefault(); toggleCheckMany() }
        else {
          const id = editing || lastEdit.current
          if (id) { e.preventDefault(); toggleCheck(id) }
        }
      }
      // ---- scorciatoie in MODALITÀ SELEZIONE (solo fuori dai campi di testo) ----
      else if (selectMode && selected.size && e.key === 'Delete') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        deleteSelected()   // Canc = elimina le righe selezionate (nel cestino)
      }
      else if (selectMode && selected.size && e.key === 'Backspace') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        clearSelected()    // Backspace = svuota solo il contenuto delle righe selezionate
      }
      else if (selectMode && e.key === 'Escape') {
        e.preventDefault()
        exitSelect()   // Esc = esci dalla selezione
      }
      else if (selectMode && (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        selectAll()    // Ctrl+A = seleziona tutte le righe
      }
      else if (selectMode && selected.size && e.key === 'Tab') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        indentSelected(e.shiftKey ? -1 : 1)   // Tab = indenta · Shift+Tab = de-indenta
      }
      // Invio senza nulla in modifica/selezione → aggiungi una riga in fondo alla vista
      else if (e.key === 'Enter' && !e.shiftKey && !selectMode && !editing) {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        addBlock(null)
      }
      // Esc senza nulla aperto → chiudi la vista (torna all'elenco). L'editing di riga
      // e la ricerca gestiscono Esc per conto loro e fermano la propagazione.
      else if (e.key === 'Escape' && !selectMode && !editing) {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        onClose?.()
      }
      // Digitando una lettera (fuori da campi, non in editing/selezione) il testo va
      // automaticamente nella barra di ricerca della vista.
      else if (!selectMode && !editing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        setSearch(s => s + e.key)
        requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const setText = (id, text) => {
    const next = blocks.map(b => b.id === id ? { ...b, text } : b)
    setBlocks(next); persist(next, title, trash)
    flashRefs(text, next)
  }

  // Evidenzia temporaneamente le righe richiamate da #n mentre si scrive una formula.
  const flashRefs = (text, arr = blocks) => {
    const t = text || ''
    if (!t.trim().startsWith('=')) { if (refFlash.size) setRefFlash(new Set()); return }
    const s = new Set()
    const re = /#(\d+)/g; let m
    while ((m = re.exec(t)) !== null) {
      const idx = parseInt(m[1], 10) - 1
      if (idx >= 0 && idx < arr.length) s.add(idx)
    }
    setRefFlash(s)
    clearTimeout(refFlashTimer.current)
    if (s.size) refFlashTimer.current = setTimeout(() => setRefFlash(new Set()), 1400)
  }

  const setIndent = (id, indent) => {
    const next = blocks.map(b => b.id === id ? { ...b, indent } : b)
    commit(next)
  }

  const addBlock = (afterId = null, text = '') => {
    const src = afterId != null ? blocks.find(b => b.id === afterId) : blocks[blocks.length - 1]
    const nb = { id: uid(), text, indent: src?.indent || 0 }
    let next
    if (afterId == null) next = [...blocks, nb]
    else {
      const idx = blocks.findIndex(b => b.id === afterId)
      next = [...blocks.slice(0, idx + 1), nb, ...blocks.slice(idx + 1)]
    }
    commit(next)
    setEditing(nb.id)
  }

  // Incolla multilinea: divide in più righe con i livelli dedotti dall'indentazione.
  const pasteMultiline = (b, text) => {
    let parts = parseIndented(text, b.indent || 0)
    while (parts.length && parts[parts.length - 1].text.trim() === '') parts.pop()
    if (!parts.length) return
    const made = parts.map(p => ({ id: uid(), text: p.text, indent: p.indent }))
    const idx = blocks.findIndex(x => x.id === b.id)
    const empty = (blocks[idx]?.text || '').trim() === ''
    const next = empty
      ? [...blocks.slice(0, idx), ...made, ...blocks.slice(idx + 1)]      // rimpiazza il blocco vuoto
      : [...blocks.slice(0, idx + 1), ...made, ...blocks.slice(idx + 1)]  // inserisci dopo
    logPasteChars(made.reduce((s, p) => s + p.text.length, 0))
    pushUndo(blocks)
    setBlocks(next); persist(next, title, trash)
    setEditing(null)
    setToast(`Incollate ${made.length} righe`); setTimeout(() => setToast(''), 1300)
  }

  // Incolla "libero": quando NON si sta modificando una riga specifica (nessun blocco in edit),
  // Ctrl+V in qualunque punto della vista crea comunque nuove righe, in fondo alla vista.
  const pasteAtEnd = (text) => {
    let parts = parseIndented(text, 0)
    while (parts.length && parts[parts.length - 1].text.trim() === '') parts.pop()
    if (!parts.length) return
    const made = parts.map(p => ({ id: uid(), text: p.text, indent: p.indent }))
    const last = blocks[blocks.length - 1]
    const emptyLast = last && (last.text || '').trim() === ''
    const next = emptyLast ? [...blocks.slice(0, -1), ...made] : [...blocks, ...made]
    logPasteChars(made.reduce((s, p) => s + p.text.length, 0))
    pushUndo(blocks)
    setBlocks(next); persist(next, title, trash)
    setToast(`Incollate ${made.length} riga${made.length > 1 ? 'e' : ''}`); setTimeout(() => setToast(''), 1300)
  }

  // ascolta il paste di sistema quando non si sta scrivendo in un campo specifico
  // (titolo, ricerca o riga in modifica hanno già il loro onPaste dedicato)
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const text = e.clipboardData?.getData('text') || ''
      if (!text.trim()) return
      e.preventDefault()
      pasteAtEnd(text)
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, title, trash])

  // ---- svuota il contenuto di una riga, mantenendo la riga (niente cestino) ----
  const clearBlock = (id) => {
    const next = blocks.map(b => b.id === id ? { ...b, text: '' } : b)
    commit(next)
  }

  // ---- selezione: svuota il contenuto (Backspace) o elimina le righe (Canc) ----
  const clearSelected = () => {
    if (!selected.size) return
    const next = blocks.map(b => selected.has(b.id) ? { ...b, text: '' } : b)
    commit(next)
  }
  const deleteSelected = () => {
    if (!selected.size) return
    const removed = blocks.filter(b => selected.has(b.id))
    let nextBlocks = blocks.filter(b => !selected.has(b.id))
    if (!nextBlocks.length) nextBlocks = [{ id: uid(), text: '', indent: 0 }]
    const nextTrash = [...removed.map(b => ({ ...b, deletedAt: Date.now() })), ...trash].slice(0, 200)
    pushUndo(blocks)
    setBlocks(nextBlocks); setTrash(nextTrash); setSelected(new Set())
    persist(nextBlocks, title, nextTrash)
    setToast(`Eliminate ${removed.length} riga${removed.length > 1 ? 'e' : ''}`); setTimeout(() => setToast(''), 1300)
  }

  // ---- MAIUSCOLO via scorciatoia (Ctrl+M): righe selezionate, oppure la riga in modifica ----
  const upperShortcut = () => {
    if (selectMode && selected.size) {
      const next = blocks.map(b => selected.has(b.id) ? { ...b, text: (b.text || '').toUpperCase() } : b)
      commit(next)
      return
    }
    upperActive()
  }

  // ---- immagini allegate alle righe: upload su Supabase Storage (o base64 in demo) ----
  const openImagePicker = (id) => { imgTargetId.current = id; imgInputRef.current?.click() }
  const onImageChosen = async (file) => {
    const id = imgTargetId.current
    if (!file || !id || !file.type?.startsWith('image/')) return
    setImgBusy(true)
    setToast('Carico immagine…')
    try {
      const { blob, base64 } = await prepareImage(file)
      let entry
      if (store.isCloud) { const r = await store.uploadImage(blob, vista.id); entry = { url: r.url, path: r.path } }
      else entry = { url: base64, path: null }
      const next = blocks.map(b => b.id === id ? { ...b, imgs: [...(b.imgs || []), entry] } : b)
      commit(next)
      setToast('Immagine allegata')
    } catch (e) {
      setToast('Errore immagine: ' + (e?.message || e))
    } finally {
      setImgBusy(false); imgTargetId.current = null
      setTimeout(() => setToast(''), 1500)
    }
  }
  const removeImageAt = (blockId, i) => {
    const b = blocks.find(x => x.id === blockId)
    const img = (b?.imgs || [])[i]
    const next = blocks.map(x => x.id === blockId ? { ...x, imgs: (x.imgs || []).filter((_, j) => j !== i) } : x)
    commit(next)
    if (img?.path && store.isCloud) store.removeImage(img.path).catch(() => {})
    setLightbox(null)
  }

  // sezione (blocco + suo sotto-albero) per la selezione con Shift+click
  const sectionIdsOf = (b) => {
    const i = blocks.findIndex(x => x.id === b.id)
    const ids = new Set([b.id])
    if (i < 0) return ids
    const hl = headingLevel(b.text)
    if (hl > 0) {
      for (let j = i + 1; j < blocks.length; j++) {
        const jl = headingLevel(blocks[j].text)
        if (jl > 0 && jl <= hl) break
        ids.add(blocks[j].id)
      }
    } else {
      const base = b.indent || 0
      for (let j = i + 1; j < blocks.length; j++) {
        if ((blocks[j].indent || 0) > base) ids.add(blocks[j].id); else break
      }
    }
    return ids
  }

  // ---- elimina riga: va nel CESTINO (recuperabile 7 giorni) ----
  const deleteBlock = (id) => {
    const b = blocks.find(x => x.id === id)
    let nextBlocks = blocks.filter(x => x.id !== id)
    if (!nextBlocks.length) nextBlocks = [{ id: uid(), text: '', indent: 0 }]
    const nextTrash = b ? [{ ...b, deletedAt: Date.now() }, ...trash].slice(0, 200) : trash
    pushUndo(blocks)
    setBlocks(nextBlocks); setTrash(nextTrash)
    setEditing(e => e === id ? null : e)
    persist(nextBlocks, title, nextTrash)
  }

  const restoreBlock = (tb) => {
    const { deletedAt, ...clean } = tb
    const nb = { ...clean, id: uid() }
    const nextBlocks = [...blocks, nb]
    const nextTrash = trash.filter(x => x !== tb)
    pushUndo(blocks)
    setBlocks(nextBlocks); setTrash(nextTrash)
    persist(nextBlocks, title, nextTrash)
    setToast('Riga ripristinata'); setTimeout(() => setToast(''), 1200)
  }

  const purgeOne = (tb) => {
    const nextTrash = trash.filter(x => x !== tb)
    setTrash(nextTrash); persist(blocks, title, nextTrash)
  }
  const emptyTrash = () => { setTrash([]); persist(blocks, title, []) }

  // ---- copia (doppio click / doppio tap sul testo) ----
  // link presente nella riga: URL http(s) oppure collegamento interno ((Nome)) / [[Nome]]
  const linkInBlock = (t) => {
    const url = (t || '').match(/https?:\/\/\S+/)
    if (url) return url[0]
    const wk = (t || '').match(/\(\(([^)]+)\)\)|\[\[([^\]]+)\]\]/)
    if (wk) return (wk[1] || wk[2] || '').trim()
    return null
  }
  const doCopyText = (text, flashId) => {
    navigator.clipboard?.writeText(text || '').catch(() => {})
    if (flashId) { setFlash(flashId); setTimeout(() => setFlash(null), 700) }
  }
  const copyBlock = (b) => {
    const link = linkInBlock(b.text)
    // se la riga contiene un link chiedi cosa copiare (riga intera o solo il link)
    if (link) { setCopyChoice({ id: b.id, text: b.text, link }); return }
    doCopyText(b.text, b.id)
  }

  // ---- Stampa foglio: struttura ad albero, formato eco (nero su bianco, poco inchiostro) ----
  const printSheet = () => {
    const esc = (s) => (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    const plain = (s) => (s || '')
      .replace(/\*\*/g, '').replace(/\^\^/g, '').replace(/`/g, '')
      .replace(/\(\(([^)]+)\)\)/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/^\*|\*$/g, '')
    const rowsHtml = blocks.map((b, bi) => {
      const lvl = Math.min(b.indent || 0, MAX_INDENT)
      const hl = headingLevel(b.text)
      if ((b.text || '').trim() === '---') return '<hr class="d">'
      let txt = b.text || ''
      if (hl > 0) txt = txt.replace(/^#{1,6}\s/, '')
      if (txt.startsWith('=') && txt.length > 1) {
        const r = evalFormula(txt.slice(1), blocks, new Set([bi]))
        if (r !== null) txt = `${txt} = ${r}`
      }
      txt = plain(txt)
      const due = b.due ? ` <span class="due">— scad. ${esc(b.due)}</span>` : ''
      const branch = lvl ? '<span class="br">└ </span>' : ''
      const cls = 'r' + (hl ? ' h h' + hl : '')
      return `<div class="${cls}" style="margin-left:${lvl * 16}px">${branch}${esc(txt) || '·'}${due}</div>`
    }).join('')
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>${esc(title || 'Vista')}</title>
<style>
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 12.5px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#000; background:#fff; margin:0; }
  h1.t { font-size: 19px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1.5px solid #000; }
  .r { padding: 1.5px 0; }
  .r.h { font-weight: 700; margin-top: 7px; }
  .r.h1 { font-size: 15px; } .r.h2 { font-size: 14px; } .r.h3 { font-size: 13px; }
  .br { color:#888; }
  .due { color:#555; font-size: 11px; }
  hr.d { border: none; border-top: 1px dashed #999; margin: 6px 0; }
  .foot { margin-top: 16px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 10px; color:#666; }
</style></head><body>
<h1 class="t">${esc(title || 'Senza titolo')}</h1>
${rowsHtml}
<div class="foot">Arbora — stampato il ${new Date().toLocaleDateString('it-IT')}</div>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) { setToast('Consenti i popup per stampare'); setTimeout(() => setToast(''), 1800); return }
    w.document.write(html); w.document.close(); w.focus()
    setTimeout(() => { try { w.print() } catch { /* ignore */ } }, 300)
  }

  const copySheet = () => {
    const text = blocks.map(b => '  '.repeat(b.indent || 0) + b.text).join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
    setToast('Foglio copiato'); setTimeout(() => setToast(''), 1200)
  }

  // ---- 1 tap = modifica · 2 tap = copia · 3 tap = selezione ----
  // Conteggio unificato dei tap ravvicinati (funziona identico su desktop e mobile:
  // non dipende più dall'evento nativo "dblclick", che sul touch spesso non arriva —
  // era la causa per cui doppio/triplo tocco aprivano solo la modifica).
  const tapRef = useRef({ id: null, n: 0 })
  const TAP_MS = 260
  // offset di testo (nella riga renderizzata) sotto il punto x,y: serve per posizionare
  // il caret dove hai premuto quando si apre la modifica.
  const caretFromPoint = (x, y) => {
    if (x == null || y == null) return null
    try {
      let node = null, offset = 0
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; offset = r.startOffset }
      } else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; offset = p.offset }
      }
      if (!node) return null
      const host = (node.nodeType === 3 ? node.parentElement : node)?.closest?.('.rendered')
      if (!host) return null
      const range = document.createRange()
      range.selectNodeContents(host)
      range.setEnd(node, offset)
      return range.toString().length
    } catch { return null }
  }
  const activateBlock = (b, e) => {
    if (rowJustHandled.current) { rowJustHandled.current = false; return }  // veniamo da un drag/swipe della riga
    const cx = e?.clientX, cy = e?.clientY   // dove hai premuto (per il caret all'apertura)
    // Shift+click in selezione (da PC) = seleziona l'INTERVALLO dalla riga ancora (ultima
    // toccata) fino a questa, comprese. Se non c'è un'ancora, seleziona solo questa riga.
    if (selectMode && e?.shiftKey) {
      selectRange(b.id)
      return
    }
    const tr = tapRef.current
    if (tr.id !== b.id) { tr.id = b.id; tr.n = 0 }
    tr.n++
    clearTimeout(clickTimer.current)   // annulla l'azione in sospeso del tap precedente

    if (selectMode) {
      // in selezione: 3 tocchi = esci (comodo su telefono, dove la ✕ può essere fuori schermo)
      if (tr.n >= 3) {
        tr.n = 0; tr.id = null; clickTimer.current = null
        exitSelect()
        try { navigator.vibrate?.(12) } catch { /* ignore */ }
        return
      }
      toggleSelect(b.id)   // il toggle è reversibile: 1° tocco seleziona, 2° deseleziona, 3° esce
      selAnchor.current = b.id   // aggiorna l'ancora: un successivo Shift+click seleziona l'intervallo fin qui
      clickTimer.current = setTimeout(() => { tr.id = null; tr.n = 0 }, TAP_MS)
      return
    }

    // 3° tocco → attiva la selezione su questa riga
    if (tr.n >= 3) {
      tr.n = 0; tr.id = null; clickTimer.current = null
      setEditing(null); setSelectMode(true); setSelected(new Set([b.id]))
      selAnchor.current = b.id
      try { navigator.vibrate?.(12) } catch { /* ignore */ }
      return
    }
    // 1° o 2° tocco: rimanda l'azione, così un tocco successivo può "promuoverla"
    const n = tr.n
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null; tr.id = null; tr.n = 0
      if (n === 1) { pendingCaret.current = caretFromPoint(cx, cy); setEditing(b.id) }   // singolo = modifica (caret dove hai premuto)
      else copyBlock(b)                 // doppio = copia
    }, TAP_MS)
  }

  // ---- selezione multipla ----
  const toggleSelect = (id) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const selectAll = () => setSelected(new Set(blocks.map(b => b.id)))

  // trascina sopra più caselle ☑ per selezionarle/deselezionarle in blocco
  const selDrag = useRef(null)   // { adding: bool, touched: Set }
  const selAnchor = useRef(null) // ultima casella toccata: ancora per la selezione a intervallo (Shift+click)
  const selDragOn = (id) => {
    selAnchor.current = id
    setSelected(s => {
      const willAdd = !s.has(id)
      selDrag.current = { adding: willAdd, touched: new Set([id]) }
      const n = new Set(s); willAdd ? n.add(id) : n.delete(id); return n
    })
  }
  // Shift+click su una casella: seleziona tutte le righe dall'ancora (ultima casella
  // toccata) fino a quella cliccata, comprese. L'ancora si sposta sulla riga cliccata.
  const selectRange = (toId) => {
    const from = selAnchor.current
    const j = blocks.findIndex(b => b.id === toId)
    const i = from ? blocks.findIndex(b => b.id === from) : -1
    if (j < 0) return
    if (i < 0) { selDragOn(toId); return }   // nessuna ancora: comportati come un click normale
    const [a, z] = i <= j ? [i, j] : [j, i]
    setSelected(s => { const n = new Set(s); for (let k = a; k <= z; k++) n.add(blocks[k].id); return n })
    selAnchor.current = toId
  }
  const selDragEnter = (id) => {
    const d = selDrag.current
    if (!d || d.touched.has(id)) return
    d.touched.add(id)
    setSelected(s => {
      const n = new Set(s); d.adding ? n.add(id) : n.delete(id); return n
    })
  }
  useEffect(() => {
    const end = () => { selDrag.current = null }
    // pointerenter funziona solo col mouse: per il touch (il dito "trascina" mantenendo
    // il pointer capture sul primo elemento) serviamo elementFromPoint sotto il dito.
    const move = (e) => {
      if (!selDrag.current || e.pointerType !== 'touch') return
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sel-box')
      const id = el?.getAttribute('data-block-id')
      if (id) selDragEnter(id)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointermove', move)
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointermove', move) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const indentSelected = (dir) => {
    if (!selected.size) return
    pushUndo(blocks)
    const next = blocks.map(b => {
      if (!selected.has(b.id)) return b
      const cur = b.indent || 0
      return { ...b, indent: dir > 0 ? Math.min(MAX_INDENT, cur + 1) : Math.max(0, cur - 1) }
    })
    setBlocks(next); persist(next, title, trash)
  }
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }

  // ---- Copia / Taglia / Incolla SEZIONI (blocco + suo sotto-albero) ----
  // livello di un titolo markdown: "# "=1, "## "=2, "### "=3; 0 se non è un titolo
  const headingLevel = (t) => { const m = (t || '').match(/^(#{1,6})\s/); return m ? m[1].length : 0 }
  const expandToSection = () => {
    if (!selected.size) return
    const ids = new Set(selected)
    blocks.forEach((b, i) => {
      if (!selected.has(b.id)) return
      const hl = headingLevel(b.text)
      if (hl > 0) {
        // sezione a TITOLI: dal titolo fino al prossimo titolo di pari o maggiore livello
        for (let j = i + 1; j < blocks.length; j++) {
          const jl = headingLevel(blocks[j].text)
          if (jl > 0 && jl <= hl) break
          ids.add(blocks[j].id)
        }
      } else {
        // sezione a RIENTRO: il blocco + il suo sotto-albero (figli più indentati)
        const base = b.indent || 0
        for (let j = i + 1; j < blocks.length; j++) {
          if ((blocks[j].indent || 0) > base) ids.add(blocks[j].id)
          else break
        }
      }
    })
    setSelected(ids)
  }
  // Se la selezione è tutta dentro un'unica sezione, restituisce il ramo PADRE e la sua
  // sezione (padre + discendenti). Serve per "seleziona tutta la sezione escluso il padre".
  const singleSectionParent = () => {
    const sel = selectedInOrder()
    if (!sel.length) return null
    const idxs = sel.map(b => blocks.findIndex(x => x.id === b.id))
    const top = Math.min(...idxs)
    const minIndent = Math.min(...sel.map(b => b.indent || 0))
    let parent = null
    for (let i = top - 1; i >= 0; i--) {
      if (headingLevel(blocks[i].text) > 0) { parent = blocks[i]; break }
      if ((blocks[i].indent || 0) < minIndent) { parent = blocks[i]; break }
    }
    if (!parent) return null
    const sec = sectionIdsOf(parent)             // padre + discendenti
    if (!sel.every(b => sec.has(b.id))) return null   // la selezione esce dalla sezione: non è "una sola sezione"
    return { parent, sec }
  }
  // Ramo PADRE che contiene il blocco `b` (titolo di livello superiore, oppure
  // primo antenato con rientro minore). Null se `b` è già a livello radice.
  const parentOf = (b) => {
    const i = blocks.findIndex(x => x.id === b.id)
    if (i < 0) return null
    const myLevel = b.indent || 0
    for (let k = i - 1; k >= 0; k--) {
      if (headingLevel(blocks[k].text) > 0) return blocks[k]
      if ((blocks[k].indent || 0) < myLevel) return blocks[k]
    }
    return null
  }
  // ⤵ Sezione / Ctrl+S: se la selezione è dentro una sola sezione, seleziona TUTTA la
  // sezione escluso il ramo padre. Con più righe (o righe di sezioni diverse), estende
  // OGNI riga selezionata all'intera sezione che la contiene (padre + fratelli + discendenti),
  // così "⤵ Sezione" funziona anche con una selezione multipla sparsa.
  const selectSection = () => {
    const info = singleSectionParent()
    if (info) {
      const ids = new Set(info.sec)
      ids.delete(info.parent.id)                 // escludi il ramo padre
      if (ids.size) { setSelected(ids); return }
    }
    // fallback multi-sezione: per ogni riga selezionata risali al padre e prendi la
    // sua intera sezione (escluso il padre stesso). Se non c'è padre, espandi il sotto-albero.
    const sel = selectedInOrder()
    if (sel.length > 1) {
      const ids = new Set(selected)
      for (const b of sel) {
        const p = parentOf(b)
        if (p) { const sec = sectionIdsOf(p); sec.forEach(id => { if (id !== p.id) ids.add(id) }) }
        else sectionIdsOf(b).forEach(id => ids.add(id))
      }
      setSelected(ids)
      return
    }
    expandToSection()
  }
  const selectedInOrder = () => blocks.filter(b => selected.has(b.id))
  const asText = (arr) => arr.map(b => '  '.repeat(b.indent || 0) + b.text).join('\n')
  const putClip = (arr) => {
    const min = Math.min(...arr.map(b => b.indent || 0))
    SECTION_CLIP = arr.map(b => ({ text: b.text, indent: (b.indent || 0) - min }))
    setClipCount(SECTION_CLIP.length)
    navigator.clipboard?.writeText(asText(arr)).catch(() => {})
  }
  const copySection = () => {
    const sel = selectedInOrder(); if (!sel.length) return
    putClip(sel)
    setToast(`Sezione copiata (${sel.length} righe)`); setTimeout(() => setToast(''), 1300)
  }
  const cutSection = () => {
    const sel = selectedInOrder(); if (!sel.length) return
    putClip(sel)
    const nextTrash = [...sel.map(b => ({ ...b, deletedAt: Date.now() })), ...trash].slice(0, 200)
    let nextBlocks = blocks.filter(b => !selected.has(b.id))
    if (!nextBlocks.length) nextBlocks = [{ id: uid(), text: '', indent: 0 }]
    pushUndo(blocks)
    setBlocks(nextBlocks); setTrash(nextTrash); setSelected(new Set())
    persist(nextBlocks, title, nextTrash)
    setToast(`Sezione tagliata (${sel.length} righe)`); setTimeout(() => setToast(''), 1300)
  }
  // incolla dopo l'ultima riga selezionata (o in fondo se non c'è selezione)
  const pasteSection = () => {
    if (!SECTION_CLIP.length) return
    const sel = selectedInOrder()
    const anchor = sel.length ? sel[sel.length - 1] : blocks[blocks.length - 1]
    const idx = anchor ? blocks.findIndex(b => b.id === anchor.id) : blocks.length - 1
    const base = sel.length && anchor ? (anchor.indent || 0) : 0
    const inserted = SECTION_CLIP.map(c => ({ id: uid(), text: c.text, indent: Math.min(MAX_INDENT, base + c.indent) }))
    const next = [...blocks.slice(0, idx + 1), ...inserted, ...blocks.slice(idx + 1)]
    logPasteChars(inserted.reduce((s, c) => s + c.text.length, 0))
    pushUndo(blocks)
    setBlocks(next); persist(next, title, trash)
    setToast(`Incollate ${inserted.length} righe`); setTimeout(() => setToast(''), 1300)
  }

  // rientro massimo consentito per un blocco: al più (rientro del precedente + 1)
  const maxIndentFor = (arr, index) => {
    if (index <= 0) return 0
    return Math.min(MAX_INDENT, (arr[index - 1].indent || 0) + 1)
  }

  // ---- drag & drop: riordino (verticale) + nidificazione (orizzontale) ----
  const onDragStart = (e, id) => {
    setDragId(id)
    dragStartX.current = e.clientX
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', blocks.find(b => b.id === id)?.text || '')
    // nasconde il fantasma nativo: usiamo il nostro (.drag-ghost) che segue il cursore
    try {
      const img = new Image()
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      e.dataTransfer.setDragImage(img, 0, 0)
    } catch { /* ignore */ }
    setGhost({ x: e.clientX, y: e.clientY, text: blocks.find(b => b.id === id)?.text || '' })
  }
  const onDragOver = (e, id) => { e.preventDefault(); if (id !== dropId) setDropId(id) }

  // sposta TUTTE le righe selezionate (nell'ordine attuale) subito prima della riga bersaglio.
  // `stepDelta` (dal trascinamento orizzontale) sposta il livello di rientro di tutte le
  // righe spostate, mantenendone i rientri relativi → si può nidificare un gruppo trascinandolo a destra.
  const moveSelectedTo = (targetId, stepDelta = 0) => {
    if (!selected.size || selected.has(targetId)) return
    let moving = blocks.filter(b => selected.has(b.id))
    if (stepDelta) {
      const minIndent = Math.min(...moving.map(b => b.indent || 0))
      // non far scendere sotto 0 il rientro minimo del gruppo
      const shift = Math.max(stepDelta, -minIndent)
      moving = moving.map(b => ({ ...b, indent: Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + shift)) }))
    }
    const rest = blocks.filter(b => !selected.has(b.id))
    let to = rest.findIndex(b => b.id === targetId)
    if (to === -1) to = rest.length
    const next = [...rest.slice(0, to), ...moving, ...rest.slice(to)]
    commit(next)
  }

  const applyDrag = (targetId, clientX) => {
    // se stiamo trascinando una riga che fa parte di una selezione multipla,
    // spostiamo insieme tutte le righe selezionate (con eventuale nidificazione orizzontale)
    if (selectMode && selected.size && selected.has(dragId)) {
      const stepDelta = Math.round((clientX - dragStartX.current) / INDENT_STEP)
      moveSelectedTo(targetId, stepDelta)
      return
    }
    const stepDelta = Math.round((clientX - dragStartX.current) / INDENT_STEP)
    let next = [...blocks]
    if (dragId !== targetId) {
      const from = next.findIndex(b => b.id === dragId)
      const to = next.findIndex(b => b.id === targetId)
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
    }
    if (stepDelta !== 0) {
      const idx = next.findIndex(b => b.id === dragId)
      const cur = next[idx]?.indent || 0
      const want = Math.max(0, cur + stepDelta)
      const capped = Math.min(want, maxIndentFor(next, idx))
      next = next.map(b => b.id === dragId ? { ...b, indent: capped } : b)
    }
    commit(next)
  }

  const onDrop = (e, id) => {
    e.preventDefault()
    if (!dragId) { setDragId(null); setDropId(null); setGhost(null); return }
    applyDrag(id, e.clientX)
    setDragId(null); setDropId(null); setGhost(null)
  }
  const endDrag = () => { setDragId(null); setDropId(null); setGhost(null) }

  // ---- TOUCH: trascina la riga premendo in mezzo ----
  // Tocco+attesa (long-press) al centro della riga → modalità trascinamento:
  //   • muovi in verticale = riordina · muovi in orizzontale = cambia livello di nidificazione.
  // Swipe orizzontale rapido (senza attesa) al centro della riga → ±1 livello.
  // (Su desktop resta il drag HTML5 con la maniglia ⠿.)
  const rowDrag = useRef(null)
  const rowJustHandled = useRef(false)   // evita che il click apra la modifica dopo drag/swipe
  const LONGPRESS_MS = 260
  const SWIPE_MIN = 42

  const onRowDown = (e, b) => {
    rowJustHandled.current = false
    if (editing === b.id) return
    // In SELEZIONE: tenere premuto su una riga seleziona quella riga + tutti i rami
    // nidificati (la sua sezione). Funziona sia con mouse sia con touch.
    if (selectMode) {
      const d = { id: b.id, sx: e.clientX, sy: e.clientY, sel: true, fired: false }
      d.timer = setTimeout(() => {
        d.fired = true
        rowJustHandled.current = true   // impedisce che il click "toggli" la riga
        const sec = sectionIdsOf(b)
        setSelected(s => { const n = new Set(s); sec.forEach(id => n.add(id)); return n })
        try { navigator.vibrate?.(12) } catch { /* ignore */ }
      }, LONGPRESS_MS)
      rowDrag.current = d
      return
    }
    if (e.pointerType === 'mouse') return
    const el = e.currentTarget
    const d = {
      id: b.id, el, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY,
      lastX: e.clientX, lastY: e.clientY, startIndent: b.indent || 0, text: b.text,
      active: false, over: null, scrolling: false,
      scroller: rootRef.current?.closest('.content') || document.scrollingElement,
    }
    d.timer = setTimeout(() => {
      d.active = true
      try { el.setPointerCapture?.(d.pointerId) } catch { /* ignore */ }
      setDragId(b.id)
      setGhost({ x: d.lastX, y: d.lastY, text: d.text })
      try { navigator.vibrate?.(12) } catch { /* ignore */ }
    }, LONGPRESS_MS)
    rowDrag.current = d
  }
  const onRowMove = (e) => {
    const d = rowDrag.current
    if (!d) return
    // long-press in selezione: se il dito/mouse si sposta troppo, annulla (era uno scroll o un drag)
    if (d.sel) {
      if (!d.fired && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 12) clearTimeout(d.timer)
      return
    }
    const prevY = d.lastY
    d.lastX = e.clientX; d.lastY = e.clientY
    if (!d.active) {
      // prima del long-press: se il dito si muove troppo è uno scroll/swipe → annulla il timer.
      // Poiché la riga ha touch-action:none (per rendere affidabile il long-press-drag su
      // tablet), il browser non scorre più la lista da solo: lo facciamo noi a mano finché
      // il gesto resta un semplice scroll verticale.
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 12) {
        clearTimeout(d.timer); d.timedOut = true
        const dx = Math.abs(e.clientX - d.sx), dy = Math.abs(e.clientY - d.sy)
        if (dy > dx && !d.scrolling) {
          d.scrolling = true   // gesto verticale → è uno scroll della lista
          try { d.el.setPointerCapture?.(d.pointerId) } catch { /* ignore */ }
        }
      }
      if (d.scrolling && d.scroller) { e.preventDefault(); d.scroller.scrollTop -= (e.clientY - prevY) }
      return
    }
    e.preventDefault()
    setGhost(g => (g ? { ...g, x: e.clientX, y: e.clientY } : g))
    // auto-scroll quando il dito/pennino è vicino al bordo alto/basso dello schermo,
    // così si può trascinare una riga oltre la porzione di lista visibile (utile su tablet)
    const scroller = rootRef.current?.closest('.content') || document.scrollingElement
    if (scroller) {
      const EDGE = 70, SPEED = 14
      if (e.clientY < EDGE) scroller.scrollTop -= SPEED
      else if (e.clientY > window.innerHeight - EDGE) scroller.scrollTop += SPEED
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.block')
    const overId = el?.getAttribute('data-block-id')
    if (overId && overId !== d.id) { d.over = overId; setDropId(overId) }
    else if (!overId) setDropId(null)
  }
  const onRowUp = (e) => {
    const d = rowDrag.current
    if (!d) return
    clearTimeout(d.timer); rowDrag.current = null
    if (d.sel) return   // long-press in selezione: gestito dal timer; il click fa il toggle normale
    if (d.scrolling) { rowJustHandled.current = true; return }   // era uno scroll della lista, non un tap
    const dx = (e.clientX ?? d.lastX) - d.sx
    const dy = (e.clientY ?? d.lastY) - d.sy
    if (!d.active) {
      // niente long-press: swipe orizzontale rapido = ±1 livello di nidificazione
      if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.6) {
        rowJustHandled.current = true
        const i = blocks.findIndex(x => x.id === d.id)
        if (dx > 0) setIndent(d.id, Math.min(maxIndentFor(blocks, i), (blocks[i]?.indent || 0) + 1))
        else setIndent(d.id, Math.max(0, (blocks[i]?.indent || 0) - 1))
      }
      return   // altrimenti è un tap: lascia gestire la modifica a onClick
    }
    // era un drag: riordino (verticale) + eventuale cambio livello (delta orizzontale)
    rowJustHandled.current = true
    const stepDelta = Math.round(dx / INDENT_STEP)
    let next = [...blocks]
    if (d.over && d.over !== d.id) {
      const from = next.findIndex(x => x.id === d.id)
      const to = next.findIndex(x => x.id === d.over)
      if (from !== -1 && to !== -1) { const [m] = next.splice(from, 1); next.splice(to, 0, m) }
    }
    if (stepDelta !== 0) {
      const idx = next.findIndex(x => x.id === d.id)
      const want = Math.max(0, d.startIndent + stepDelta)
      const capped = Math.min(want, maxIndentFor(next, idx))
      next = next.map(x => x.id === d.id ? { ...x, indent: capped } : x)
    }
    setDragId(null); setDropId(null); setGhost(null)
    commit(next)
  }
  const onRowCancel = () => {
    const d = rowDrag.current
    if (!d) return
    clearTimeout(d.timer); rowDrag.current = null
    if (d.active) { setDragId(null); setDropId(null); setGhost(null) }
  }

  // ---- SWIPE orizzontale mentre si MODIFICA una riga: nidifica / riduce ----
  // Uno swipe ampio (≥ SWIPE_MIN) e nettamente orizzontale cambia il livello di
  // nidificazione della riga in modifica, senza rubare il normale posizionamento
  // del cursore nel testo (che avviene coi gesti piccoli / verticali).
  const editSwipe = useRef(null)
  const onEditSwipeDown = (e, b) => {
    // ignoriamo il mouse: lì ci sono i pulsanti ⇥/⇤ della toolbar
    if (e.pointerType === 'mouse') { editSwipe.current = null; return }
    editSwipe.current = { id: b.id, sx: e.clientX, sy: e.clientY, done: false }
  }
  const onEditSwipeMove = (e) => {
    const d = editSwipe.current
    if (!d || d.done) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.6) {
      d.done = true
      const i = blocks.findIndex(x => x.id === d.id)
      if (dx > 0) setIndent(d.id, Math.min(maxIndentFor(blocks, i), (blocks[i]?.indent || 0) + 1))
      else setIndent(d.id, Math.max(0, (blocks[i]?.indent || 0) - 1))
      try { navigator.vibrate?.(10) } catch { /* ignore */ }
    }
  }
  const onEditSwipeEnd = () => { editSwipe.current = null }

  const titleChange = (v) => { setTitle(v); persist(blocks, v, trash) }

  // ---- grassetto / corsivo: avvolge la selezione del textarea (Ctrl+B / Ctrl+I) ----
  const applyWrap = (el, id, mark) => {
    const s = el.selectionStart, e = el.selectionEnd, val = el.value
    const sel = val.slice(s, e) || 'testo'
    const nv = val.slice(0, s) + mark + sel + mark + val.slice(e)
    setText(id, nv)
    const ns = s + mark.length, ne = ns + sel.length
    requestAnimationFrame(() => { try { el.focus(); el.selectionStart = ns; el.selectionEnd = ne } catch {} })
  }

  // ---- MAIUSCOLO: trasforma in maiuscolo il testo selezionato nella riga in modifica;
  //      se non c'è selezione, mette in maiuscolo l'intera riga attiva. ----
  const upperActive = () => {
    const el = document.activeElement
    if (editing && el && el.tagName === 'TEXTAREA') {
      const s = el.selectionStart, e = el.selectionEnd, val = el.value
      if (s !== e) {
        const nv = val.slice(0, s) + val.slice(s, e).toUpperCase() + val.slice(e)
        setText(editing, nv)
        requestAnimationFrame(() => { try { el.focus(); el.selectionStart = s; el.selectionEnd = e } catch {} })
        return
      }
      setText(editing, val.toUpperCase())
      return
    }
    const id = editing || lastEdit.current
    if (!id) return
    const b = blocks.find(x => x.id === id)
    if (b) setText(id, (b.text || '').toUpperCase())
  }

  // ---- suggerimento collegamenti: se scrivi il nome di un'altra vista ----
  const editingText = blocks.find(b => b.id === editing)?.text || ''
  const suggestions = useMemo(() => {
    const t = editingText
    if (!t.trim()) return []
    const seen = new Set()
    const out = []
    for (const v of allViste) {
      if (v.id === vista.id) continue
      const name = (v.titolo || '').trim()
      if (name.length < 2 || seen.has(name.toLowerCase())) continue
      if (t.includes('((' + name + '))') || t.includes('[[' + name + ']]')) continue
      const re = new RegExp('(?<![\\(\\[])\\b' + escapeRe(name) + '\\b(?![\\)\\]])', 'i')
      if (re.test(t)) { seen.add(name.toLowerCase()); out.push(name) }
      if (out.length >= 4) break
    }
    return out
  }, [editingText, allViste, vista.id])

  const applyLink = (name) => {
    if (!editing) return
    const b = blocks.find(x => x.id === editing)
    if (!b) return
    setText(editing, linkifyName(b.text, name))
  }

  // ---- scorciatoie "/" : rileva il token /parola prima del cursore e propone i comandi ----
  const detectSlash = (id, el) => {
    const val = el.value
    const pos = el.selectionStart ?? val.length
    const m = val.slice(0, pos).match(/(^|\s)\/(\w*)$/)
    if (m) setSlash({ blockId: id, start: pos - m[2].length - 1, query: m[2].toLowerCase(), sel: 0 })
    else setSlash(null)
  }
  const slashOptions = () => {
    if (!slash) return []
    const q = slash.query
    return SLASH_CMDS.filter(c => c.key.startsWith(q))
  }
  // sostituisce il token /parola con il valore del comando scelto
  const applySlash = (cmd) => {
    if (!slash || !cmd) return
    const b = blocks.find(x => x.id === slash.blockId)
    if (!b) { setSlash(null); return }
    const val = b.text
    const before = val.slice(0, slash.start)
    const after = val.slice(slash.start + 1 + slash.query.length)

    // comandi AZIONE: il token sparisce e l'effetto è sulla riga, non sul testo
    if (cmd.azione) {
      const pulito = (before + after).replace(/\s+$/, '')
      setSlash(null)
      if (cmd.key === 'check') setCheck(b.id, true, pulito)
      else if (cmd.key === 'oggi') mandaOggi(b, pulito)
      const caretAz = before.length
      requestAnimationFrame(() => {
        const el = editRef.current
        if (el) { try { el.focus(); el.selectionStart = el.selectionEnd = Math.min(caretAz, el.value.length); autosize(el) } catch { /* ignore */ } }
      })
      return
    }

    const ins = slashValue(cmd.key)
    const nv = before + ins + after
    setText(b.id, nv)
    setSlash(null)
    const caret = (before + ins).length
    requestAnimationFrame(() => {
      const el = editRef.current
      if (el) { try { el.focus(); el.selectionStart = el.selectionEnd = caret; autosize(el) } catch { /* ignore */ } }
    })
  }

  const isPlain = (t) => t && !t.startsWith('#') && t.trim() !== '---'

  // ---- ricerca dentro la vista: evidenzia le righe che contengono il testo cercato ----
  const sq = search.trim().toLowerCase()
  const matchSet = useMemo(() => {
    if (!sq) return null
    const s = new Set()
    blocks.forEach(b => { if ((b.text || '').toLowerCase().includes(sq)) s.add(b.id) })
    return s
  }, [sq, blocks])
  const matchCount = matchSet ? matchSet.size : 0

  // auto-altezza della textarea: cresce col contenuto (anche con testo mandato a capo) così
  // si vede TUTTO il testo della riga in un colpo solo. Con box-sizing:border-box lo
  // scrollHeight non comprende i bordi: li aggiungiamo, altrimenti l'ultima riga verrebbe
  // tagliata di un paio di px.
  const autosize = (el) => {
    if (!el) return
    el.style.height = 'auto'
    const cs = window.getComputedStyle(el)
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    el.style.height = (el.scrollHeight + border) + 'px'
  }

  // Alla comparsa della textarea la misura fatta nel ref/onChange può essere imprecisa
  // (larghezza non ancora assestata, font non caricato, tastiera mobile che cambia il viewport):
  // il testo lungo resterebbe tagliato. Ri-misuriamo l'altezza DOPO il layout, ad ogni apertura
  // dell'editing e quando la finestra/tastiera cambia dimensione, così si vede sempre tutto.
  useEffect(() => {
    if (!editing) return
    const fit = () => autosize(editRef.current)
    fit()
    const r1 = requestAnimationFrame(fit)
    const r2 = requestAnimationFrame(() => requestAnimationFrame(fit))   // dopo il caricamento del font/layout
    const vv = window.visualViewport
    window.addEventListener('resize', fit)
    vv?.addEventListener('resize', fit)
    document.fonts?.ready?.then(fit).catch(() => {})
    return () => {
      cancelAnimationFrame(r1); cancelAnimationFrame(r2)
      window.removeEventListener('resize', fit)
      vv?.removeEventListener('resize', fit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // ---- guide di nidificazione CONTINUE (stile albero: │ ├ └ ) ----
  // Per ogni riga calcola, colonna per colonna, se disegnare una linea verticale di
  // passaggio ('line'), niente ('space'), un connettore intermedio ('tee' = ├) o
  // finale ('end' = └). Le linee dei livelli superiori proseguono senza interruzioni
  // finché il ramo ha altri "fratelli" più in basso.
  const guides = useMemo(() => {
    const n = blocks.length
    const depth = blocks.map(b => Math.min(b.indent || 0, MAX_INDENT))
    const lastChild = new Array(n).fill(true)   // la riga è l'ultima del suo gruppo di fratelli?
    for (let i = 0; i < n; i++) {
      const d = depth[i]
      for (let j = i + 1; j < n; j++) {
        if (depth[j] < d) break
        if (depth[j] === d) { lastChild[i] = false; break }
      }
    }
    const out = new Array(n)
    const stack = []   // stack[k] = indice dell'antenato al livello k
    for (let i = 0; i < n; i++) {
      const d = depth[i]
      stack.length = d
      const cols = []
      for (let c = 0; c < d; c++) {
        if (c === d - 1) cols.push(lastChild[i] ? 'end' : 'tee')
        else { const anc = stack[c + 1]; cols.push(anc != null && !lastChild[anc] ? 'line' : 'space') }
      }
      out[i] = cols
      stack[d] = i
    }
    return out
  }, [blocks])

  // Click "fuori" dalle righe mentre si è in selezione → esci dalla modalità selezione.
  // (I click sulle righe e sulle barre-strumenti della selezione sono esclusi.)
  const onEditorPointerDown = (e) => {
    if (!selectMode) return
    if (e.target.closest('.block') || e.target.closest('.editor-sticky') ||
        e.target.closest('.view-search') || e.target.closest('.trash-panel') ||
        e.target.closest('.due-scrim')) return   // il popup scadenza non deve deselezionare
    exitSelect()
  }

  return (
    <div className="editor" ref={rootRef} tabIndex={-1} onPointerDown={onEditorPointerDown}>
      <div className="editor-sticky">
      <div className="editor-head">
        <input className="editor-title" value={title} placeholder="Titolo della vista…"
          size={Math.min(Math.max((title.length || 18) + 1, 4), 38)}
          onChange={e => titleChange(e.target.value)} />
        {onSetStage && (
          <div className="stage-pick-wrap">
            <button type="button" className="stage-pill" style={{ '--stage': stageOf(vista).color }}
              title="Fase del progresso" onClick={() => setStagePick(s => !s)}>
              <span className="stage-dot" /> {stageOf(vista).label}
            </button>
            {stagePick && (
              <>
                <div className="stage-pick-scrim" onClick={() => setStagePick(false)} />
                <div className="stage-pick-menu">
                  {STAGES.map(s => (
                    <button key={s.id} type="button"
                      className={'stage-opt' + (stageOf(vista).id === s.id ? ' active' : '')}
                      style={{ '--stage': s.color }}
                      onClick={() => { onSetStage(vista.id, s.id); setStagePick(false) }}>
                      <span className="stage-dot" /> {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <span className={'save-state ' + saveState} title={
          saveState === 'saved' ? 'Salvato nel cloud' :
          saveState === 'local' ? 'Salvato su questo dispositivo (cloud non raggiungibile)' :
          saveState === 'saving' ? 'Salvataggio…' : 'Nessuna modifica'}>
          {saveState === 'saving' && '⏳'}
          {saveState === 'saved' && '☁'}
          {saveState === 'local' && '💾'}
          {saveState === 'idle' && '☁'}
        </span>
      </div>

      {!focusMode && (
        <>
        <div className="toolbar" data-noswipe="" onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}>
          <button className={'iconbtn' + (showHints ? ' on' : '')} title="Mostra/nascondi i suggerimenti"
            onClick={() => setShowHints(s => !s)}>?</button>
          <button className="iconbtn" title="Annulla (Ctrl+Z)" onClick={undo}>↶</button>
          <button className="iconbtn" title="Ripeti (Ctrl+Y)" onClick={redo}>↷</button>
          <button className="iconbtn" title="Rientra (nidifica)" onClick={() => { const id = editing || lastEdit.current; if (!id) return; const i = blocks.findIndex(b=>b.id===id); setIndent(id, Math.min(maxIndentFor(blocks, i), (blocks[i].indent||0)+1)) }}>⇥</button>
          <button className="iconbtn" title="Riduci rientro" onClick={() => { const id = editing || lastEdit.current; if (!id) return; const b = blocks.find(x=>x.id===id); setIndent(id, Math.max(0,(b.indent||0)-1)) }}>⇤</button>
          <button className="iconbtn" title="Titolo" onClick={() => { const id = editing || lastEdit.current; if (id) setText(id, '# ' + (blocks.find(b=>b.id===id)?.text||'')) }}>H</button>
          <button className="iconbtn" title="Grassetto (Ctrl+B)" onClick={() => { const id = editing || lastEdit.current; if (id) setText(id, (blocks.find(b=>b.id===id)?.text||'') + '**testo**') }}><b>B</b></button>
          <button className="iconbtn" title="Corsivo (Ctrl+I)" onClick={() => { const id = editing || lastEdit.current; if (id) setText(id, (blocks.find(b=>b.id===id)?.text||'') + '*testo*') }}><i>c</i></button>
          <button className="iconbtn" title="MAIUSCOLO — trasforma in maiuscolo il testo selezionato (o l'intera riga)" onClick={upperActive}><span style={{fontSize:'12px',fontWeight:800,letterSpacing:'.5px'}}>AA</span></button>
          <button className="iconbtn" title="Inserisci collegamento a un'altra vista" onClick={() => {
            const id = editing || lastEdit.current || (blocks[0] && blocks[0].id)
            if (!id) return
            if (!editing) setEditing(id)
            const t = blocks.find(b=>b.id===id)?.text || ''
            setText(id, t + (t && !t.endsWith(' ') ? ' ' : '') + '((Nome della vista))')
          }}>🔗</button>
          {onSaveTemplate && (
            <button className="iconbtn" title="Salva questa vista come template (riutilizzabile per nuove viste)" onClick={() => {
              flush()   // assicura che l'ultima modifica sia inclusa nel template
              onSaveTemplate({ titolo: title, blocchi: blocks })
              setToast('Template salvato'); setTimeout(() => setToast(''), 1500)
            }}>🧩</button>
          )}
        </div>

        {/* Riga azioni: copia foglio · selezione · incolla · cestino */}
        <div className="toolbar toolbar-2" data-noswipe="" onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}>
          {!selectMode ? (
            <>
              <button className="pillbtn" title="Copia tutto il foglio" onClick={copySheet}>⧉ Copia foglio</button>
              <button className="pillbtn" title="Stampa la vista (struttura ad albero, formato eco)" onClick={printSheet}>🖨 Stampa</button>
              <button className="pillbtn" title="Seleziona righe per copiarle/tagliarle/ri-tabularle" onClick={() => { setSelectMode(true); setEditing(null) }}>☑ Seleziona</button>
              {clipCount > 0 && (
                <button className="pillbtn" title="Incolla la sezione copiata in fondo alla vista" onClick={pasteSection}>📌 Incolla ({clipCount})</button>
              )}
              <button className={'pillbtn' + (showTrash ? ' on' : '')} title="Righe eliminate (ultimi 7 giorni)" onClick={() => setShowTrash(s => !s)}>🗑 Cestino{trash.length ? ` (${trash.length})` : ''}</button>
            </>
          ) : (
            <>
              <span className="sel-count">{selected.size} sel.</span>
              <button className="pillbtn" title="Seleziona tutte le righe" onClick={selectAll}>☑ Tutte</button>
              <button className="pillbtn" title="Seleziona tutta la sezione (escluso il ramo padre)" onClick={selectSection}>⤵ Sezione</button>
              <button className="pillbtn" title="Copia la sezione (mantiene i livelli)" onClick={copySection}>⧉ Copia</button>
              <button className="pillbtn" title="Taglia la sezione (va nel cestino)" onClick={cutSection}>✂ Taglia</button>
              <button className="pillbtn" title="Incolla dopo la riga selezionata" onClick={pasteSection} disabled={!clipCount}>📌 Incolla{clipCount ? ` (${clipCount})` : ''}</button>
              <button className="pillbtn" title="Imposta la scadenza per le righe selezionate" onClick={() => setBulkDue(true)}>📅 Scadenza</button>
              <button className="pillbtn danger" title="Chiudi selezione" onClick={exitSelect}>✕</button>
            </>
          )}
        </div>
        </>
      )}

      </div>

      {/* I suggerimenti di collegamento sono ora ancorati sotto la riga in modifica
          (dentro .row-edit), così non finiscono più coperti dall'header/barre in alto. */}

      {!focusMode && showHints && (
        <div className="link-hint">
          <ul className="hint-list">
            <li className="grp"><b className="hint-cat">Righe</b> <span><b>Click</b> = modifica la riga</span></li>
            <li><b className="hint-cat" /> <span><b>Doppio click</b> = copia la riga</span></li>
            <li><b className="hint-cat" /> <span><b>Triplo click</b> = selezione</span></li>
            <li><b className="hint-cat" /> <span><b>Rotellina</b> sulla riga = nuova riga sotto</span></li>
            <li><b className="hint-cat" /> <span><b>Invio</b> = nuova riga · frecce <code>↑</code>/<code>↓</code> = riga sopra/sotto</span></li>

            <li className="grp"><b className="hint-cat">Nidificazione</b> <span><code>Tab</code>/<code>⇧Tab</code> = rientra/riduci</span></li>
            <li><b className="hint-cat" /> <span>Trascina ←/→ per nidificare</span></li>
            <li><b className="hint-cat" /> <span>Su mobile: tieni premuto e sposta</span></li>

            <li className="grp"><b className="hint-cat">Task</b> <span><code>/check</code> o <code>Ctrl+⇧+K</code> = checkbox sulla riga</span></li>
            <li><b className="hint-cat" /> <span><code>/oggi</code> o <code>Ctrl+⇧+T</code> = <b>sposta</b> la riga in Today</span></li>
            <li><b className="hint-cat" /> <span>La riga esce dalla nota (va nel cestino): <code>Ctrl+Z</code> annulla</span></li>

            <li className="grp"><b className="hint-cat">Testo</b> <span><code>Ctrl+B</code> = grassetto · <code>Ctrl+I</code> = corsivo</span></li>
            <li><b className="hint-cat" /> <span><code>Ctrl+M</code> o <b>AA</b> = MAIUSCOLO</span></li>
            <li><b className="hint-cat" /> <span><code>/</code> = scorciatoie data/ora</span></li>

            <li className="grp"><b className="hint-cat">Formule</b> <span>inizia con <code>=</code> per calcolare (es. <code>=2+3*4</code>, <code>=sqrt(9)</code>). Richiama altre righe con <code>#n</code>: <code>=#1+#2</code> somma i valori delle righe 1 e 2</span></li>

            <li className="grp"><b className="hint-cat">Scadenze</b> <span><b>📅</b> o <code>Ctrl+D</code> = scadenza (sfondo colorato + countdown)</span></li>

            <li className="grp"><b className="hint-cat">Azioni riga</b> <span><b>＋</b> nuova · <b>⌫</b> svuota · <b>🗑</b> elimina (recupero 7 gg)</span></li>
            <li><b className="hint-cat" /> <span><b>🖼</b> immagine · su mobile: menu <b>⋮</b></span></li>

            <li className="grp"><b className="hint-cat">Selezione</b> <span><code>Ctrl+S</code> = entra/esci · <code>Ctrl+A</code> = tutte</span></li>
            <li><b className="hint-cat" /> <span><code>Shift+click</code> o tieni premuto = sezione</span></li>
            <li><b className="hint-cat" /> <span><code>Ctrl+C</code>/<code>Ctrl+X</code> = copia/taglia · <code>Tab</code> = rientro</span></li>
            <li><b className="hint-cat" /> <span><code>Canc</code> = elimina · <code>Backspace</code> = svuota · click fuori = esci</span></li>

            <li className="grp"><b className="hint-cat">Foglio</b> <span><b>⧉ Copia foglio</b> · <b>🖨 Stampa</b> · <b>🗑 Cestino</b></span></li>

            <li className="grp"><b className="hint-cat">Navigazione</b> <span><b>🔍</b> cerca · <b>🔗</b> collega vista</span></li>
            <li><b className="hint-cat" /> <span>Swipe ←/→ = cambia vista · <code>Esc</code> = chiudi</span></li>
          </ul>
        </div>
      )}

      {/* Pannello CESTINO (nascosto, si apre col pulsante) */}
      {showTrash && !focusMode && (
        <div className="trash-panel">
          <div className="trash-head">
            <b>🗑 Cestino</b> <span className="trash-sub">righe eliminate · conservate 7 giorni</span>
            {trash.length > 0 && <button className="pillbtn danger" onClick={emptyTrash}>Svuota</button>}
          </div>
          {trash.length === 0 ? (
            <div className="trash-empty">Nessuna riga eliminata di recente.</div>
          ) : trash.map((tb, i) => (
            <div key={i} className="trash-row">
              <div className="trash-text">{tb.text ? <RenderedBlock text={tb.text} /> : <span style={{color:'var(--text-dim)'}}>(riga vuota)</span>}</div>
              <span className="trash-when">{relTime(tb.deletedAt)}</span>
              <button className="iconbtn mini" title="Ripristina" onClick={() => restoreBlock(tb)}>↩</button>
              <button className="iconbtn mini danger" title="Elimina definitivamente" onClick={() => purgeOne(tb)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="view-search" data-noswipe="">
        <span className="view-search-ico">🔍</span>
        <input className="view-search-input" ref={searchRef} value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (search) setSearch(''); else e.currentTarget.blur() } }}
          placeholder="Cerca in questa vista…" />
        {sq && <span className="view-search-count">{matchCount} ris.</span>}
        {search && <button className="view-search-clear" title="Pulisci" onClick={() => setSearch('')}>✕</button>}
      </div>

      <div className="blocks-list" data-noswipe="">
      {blocks.map((b, bi) => {
        const indent = b.indent || 0
        const isSel = selected.has(b.id)
        const isHit = matchSet ? matchSet.has(b.id) : false
        const di = b.due ? dueInfo(b.due) : null
        return (
        <div key={b.id} className="block-wrap">
        <div data-block-id={b.id} data-noswipe=""
          className={'block' + (dragId === b.id ? ' dragging' : '') + (dropId === b.id ? ' drop-target' : '') + (indent ? ' nested' : '') + (isSel ? ' selected' : '') + (editing === b.id ? ' editing' : '') + (matchSet && !isHit ? ' search-dim' : '') + (isHit ? ' search-hit' : '') + (refFlash.has(bi) ? ' ref-flash' : '') + (jumpId === b.id ? ' jump-flash' : '') + (di ? ' ' + di.cls : '') + (b.check ? ' has-check' : '') + (b.check && b.done ? ' row-done' : '')}
          draggable={editing !== b.id && (!selectMode || selected.has(b.id))}
          onDragStart={e => onDragStart(e, b.id)}
          onDragOver={e => onDragOver(e, b.id)}
          onDrop={e => onDrop(e, b.id)}
          onDragEnd={endDrag}
        >
          {/* guide di nidificazione CONTINUE: linee verticali che proseguono senza
              interruzioni tra le righe, con connettori ad albero (│ ├ └) */}
          {(guides[bi] || []).map((g, i) => (
            <span key={i} className={'indent-guide guide-' + g} title={'Livello ' + indent} />
          ))}
          {selectMode && (
            <span className={'sel-box' + (isSel ? ' on' : '')} data-block-id={b.id}
              onPointerDown={e => { e.preventDefault(); if (e.shiftKey) selectRange(b.id); else selDragOn(b.id) }}
              onPointerEnter={() => { if (selDrag.current) selDragEnter(b.id) }}>{isSel ? '✓' : ''}</span>
          )}
          {/* checkbox di riga (/check): sta FUORI dal ramo editing/lettura, così
              resta visibile e cliccabile anche mentre scrivi nella riga */}
          {b.check && (
            <label className="row-check" data-noswipe="" title={b.done ? 'Fatta — clicca per riaprirla' : 'Da fare — clicca quando è fatta'}>
              <input type="checkbox" checked={!!b.done} onChange={() => toggleDone(b.id)}
                aria-label={b.done ? 'Segna come da fare' : 'Segna come completata'} />
              <span className="today-box" />
            </label>
          )}
          {editing === b.id ? (
            <div className="row-edit" data-noswipe=""
              onPointerDown={e => onEditSwipeDown(e, b)} onPointerMove={onEditSwipeMove}
              onPointerUp={onEditSwipeEnd} onPointerCancel={onEditSwipeEnd}>
            <textarea
              className="row-input"
              ref={el => { editRef.current = el; if (el) { autosize(el); if (document.activeElement !== el) el.focus({ preventScroll: true }); if (pendingCaret.current != null) { const p = Math.min(pendingCaret.current, el.value.length); try { el.selectionStart = el.selectionEnd = p } catch { /* ignore */ } pendingCaret.current = null } } }}
              value={b.text} rows={1}
              onInput={e => { autosize(e.target); try { e.target.scrollIntoView({ block: 'nearest' }) } catch { /* ignore */ } }}
              onChange={e => { autosize(e.target); setText(b.id, e.target.value); detectSlash(b.id, e.target) }}
              onKeyUp={e => detectSlash(b.id, e.currentTarget)}
              onClick={e => detectSlash(b.id, e.currentTarget)}
              onBlur={() => { setEditing(null); setSlash(null) }}
              onPaste={e => {
                const text = e.clipboardData?.getData('text') || ''
                if (!text) return
                if (text.includes('\n')) { e.preventDefault(); pasteMultiline(b, text) }
                else logPasteChars(text.length)   // incolla su una riga sola: lascia fare il browser, registra solo i caratteri
              }}
              onKeyDown={e => {
                const el = e.target
                // menu scorciatoie "/" aperto su questa riga: le frecce/Invio/Tab lo pilotano
                if (slash && slash.blockId === b.id) {
                  const opts = slashOptions()
                  if (opts.length) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSlash(s => ({ ...s, sel: (s.sel + 1) % opts.length })); return }
                    if (e.key === 'ArrowUp')   { e.preventDefault(); setSlash(s => ({ ...s, sel: (s.sel - 1 + opts.length) % opts.length })); return }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlash(opts[slash.sel] || opts[0]); return }
                    if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setSlash(null); return }
                  }
                }
                if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyWrap(el, b.id, '**') }
                else if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyWrap(el, b.id, '*') }
                else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  // se ci sono collegamenti suggeriti, Invio conferma il primo invece di creare una riga
                  if (suggestions.length) applyLink(suggestions[0])
                  else addBlock(b.id)
                }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                else if (e.key === 'Backspace' && b.text === '') { e.preventDefault(); deleteBlock(b.id) }
                // frecce su/giù: se il cursore è al bordo della riga, salta alla riga adiacente
                else if (e.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionStart === el.selectionEnd) {
                  const i = blocks.findIndex(x => x.id === b.id)
                  if (i > 0) { e.preventDefault(); setEditing(blocks[i - 1].id) }
                }
                else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length && el.selectionStart === el.selectionEnd) {
                  const i = blocks.findIndex(x => x.id === b.id)
                  if (i < blocks.length - 1) { e.preventDefault(); setEditing(blocks[i + 1].id) }
                }
                else if (e.key === 'Tab') { e.preventDefault(); const i = blocks.findIndex(x=>x.id===b.id); if (e.shiftKey) setIndent(b.id, Math.max(0,(b.indent||0)-1)); else setIndent(b.id, Math.min(maxIndentFor(blocks, i),(b.indent||0)+1)) }
              }} />
            {slash && slash.blockId === b.id && slashOptions().length > 0 && (
              <div className="slash-pop" data-noswipe="" onPointerDown={e => e.preventDefault()}>
                {slashOptions().map((c, i) => (
                  <button key={c.key} type="button"
                    className={'slash-opt' + (i === slash.sel ? ' active' : '')}
                    onPointerDown={e => { e.preventDefault(); applySlash(c) }}>
                    <b className="slash-key">{c.label}</b>
                    <span className="slash-desc">{c.desc}</span>
                    <span className="slash-prev">{c.azione ? c.prev : slashValue(c.key)}</span>
                  </button>
                ))}
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="link-suggest" data-noswipe="">
                <span className="link-suggest-lbl">Collega a:</span>
                {suggestions.map((name, i) => (
                  <button key={name} type="button" className={'link-suggest-chip' + (i === 0 ? ' first' : '')}
                    onMouseDown={e => e.preventDefault()} onClick={() => applyLink(name)}>🔗 {name}{i === 0 ? ' ↵' : ''}</button>
                ))}
              </div>
            )}
            </div>
          ) : (
            <div className="rendered"
              onPointerDown={e => onRowDown(e, b)} onPointerMove={onRowMove}
              onPointerUp={onRowUp} onPointerCancel={onRowCancel}
              onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); addBlock(b.id) } }}
              onClick={e => activateBlock(b, e)}
              title="1 tocco: modifica · 2 tocchi: copia · 3 tocchi: selezione · rotellina: nuova riga sotto · tieni premuto per trascinare · swipe ←/→ per nidificare">
              {b.text ? <RenderedBlock text={b.text} onWikilink={selectMode ? undefined : onWikilink} blocks={blocks} index={bi} /> : <span style={{color:'var(--text-dim)'}}>Vuoto — clicca per scrivere</span>}
            </div>
          )}
          {b.imgs?.length > 0 && (
            <div className="row-thumbs" data-noswipe="">
              {b.imgs.map((im, i) => (
                <button key={i} className="row-thumb" title="Apri immagine"
                  onClick={() => setLightbox({ blockId: b.id, i })}
                  style={{ backgroundImage: `url("${im.url}")` }} />
              ))}
            </div>
          )}
          {di && (
            <span className={'due-badge ' + di.cls} title={'Scadenza: ' + b.due}
              onClick={() => { if (!selectMode) setDuePick(b.id) }}>⏰ {di.label}</span>
          )}
          {b.gcal && (
            <span className="gcal-badge" title="Sincronizzato su Google Calendar">📅</span>
          )}
          <span className={'copytap' + (flash === b.id ? ' copied-flash' : '')}>{flash === b.id ? 'copiato!' : ''}</span>
          {!selectMode && (
            <>
              {/* su mobile le azioni della riga stanno dietro a un menu ⋮ (occupano meno spazio);
                  su desktop restano allineate in riga (vedi .row-actions{display:contents}) */}
              <button className={'iconbtn row-more' + (menuId === b.id ? ' on' : '')} title="Azioni riga"
                data-noswipe="" onClick={() => setMenuId(m => m === b.id ? null : b.id)}>⋮</button>
              {menuId === b.id && <div className="row-menu-scrim" onClick={() => setMenuId(null)} />}
              <div className={'row-actions' + (menuId === b.id ? ' open' : '')} data-noswipe="">
                <div className="due-wrap" data-noswipe="">
                  <button className={'iconbtn row-due' + (b.due ? ' has' : '') + (di ? ' ' + di.cls : '')}
                    title={b.due ? 'Scadenza: ' + b.due + ' — clicca per modificare' : 'Imposta una scadenza per questa riga'}
                    onClick={() => { setDuePick(b.id); setMenuId(null) }}>📅</button>
                </div>
                <button className={'iconbtn row-check-btn' + (b.check ? ' on' : '')}
                  title={b.check ? 'Togli il checkbox (/check)' : 'Aggiungi un checkbox alla riga (/check)'}
                  onClick={() => { toggleCheck(b.id); setMenuId(null) }}>☑</button>
                {onSendToToday && (
                  <button className="iconbtn row-oggi"
                    title="Sposta questa riga fra le task di oggi (/oggi · Ctrl+Shift+T). Esce dalla nota e finisce nel cestino, recuperabile."
                    onClick={() => { mandaOggi(b); setMenuId(null) }}>⚡</button>
                )}
                <button className="iconbtn row-img" title="Allega un'immagine a questa riga"
                  onClick={() => { openImagePicker(b.id); setMenuId(null) }} disabled={imgBusy}>🖼</button>
                {b.text && (
                  <button className="iconbtn row-clear" title="Svuota il contenuto della riga"
                    onClick={() => { clearBlock(b.id); setMenuId(null) }}>⌫</button>
                )}
                <button className="iconbtn row-del" title="Elimina riga (recuperabile 7 giorni)"
                  onClick={() => { deleteBlock(b.id); setMenuId(null) }}>🗑</button>
              </div>
            </>
          )}
        </div>
        {!selectMode && !focusMode && (
          <button className="row-add-between" data-noswipe="" tabIndex={-1}
            title="Inserisci una riga qui" aria-label="Inserisci una riga qui"
            onClick={() => addBlock(b.id)}>
            <span className="row-add-between-ico">＋</span>
          </button>
        )}
        </div>
        )
      })}
      </div>

      <button className="add-btn" style={{marginTop:12}} onClick={() => addBlock(null)}>＋ Aggiungi blocco in fondo</button>

      {/* input file nascosto per gli allegati immagine */}
      <input ref={imgInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onImageChosen(f) }} />

      {/* scadenza di una singola riga: modale centrato (niente sfarfallio di posizione) */}
      {duePick && (() => {
        const b = blocks.find(x => x.id === duePick)
        if (!b) return null
        return (
          <div className="due-scrim due-scrim-center" onClick={() => setDuePick(null)}>
            <div className="due-pop due-pop-center" onClick={e => e.stopPropagation()}>
              <label className="due-pop-lbl">Scadenza</label>
              <input type="date" className="due-input" autoFocus value={b.due || ''}
                onChange={e => { setDue(b.id, e.target.value); setDuePick(null); setMenuId(null) }} />
              <div className="due-pop-row">
                {b.due && <button className="pillbtn danger" onClick={() => { setDue(b.id, ''); setDuePick(null); setMenuId(null) }}>Rimuovi</button>}
                <button className="pillbtn" onClick={() => { setDuePick(null); setMenuId(null) }}>Fatto</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* scadenza per le righe selezionate (Ctrl+D in selezione) */}
      {bulkDue && (
        <div className="due-scrim due-scrim-center" onClick={() => setBulkDue(false)}>
          <div className="due-pop due-pop-center" onClick={e => e.stopPropagation()}>
            <label className="due-pop-lbl">Scadenza · {selected.size} righe</label>
            <input type="date" className="due-input" autoFocus
              onChange={e => { setDueMany(e.target.value); setBulkDue(false) }} />
            <div className="due-pop-row">
              <button className="pillbtn danger" onClick={() => { setDueMany(''); setBulkDue(false) }}>Rimuovi</button>
              <button className="pillbtn" onClick={() => setBulkDue(false)}>Chiudi</button>
            </div>
          </div>
        </div>
      )}

      {/* doppio click su una riga con un link: scegli cosa copiare */}
      {copyChoice && (
        <div className="due-scrim due-scrim-center" onClick={() => setCopyChoice(null)}>
          <div className="due-pop due-pop-center" onClick={e => e.stopPropagation()}>
            <label className="due-pop-lbl">Cosa vuoi copiare?</label>
            <div className="copy-choice-link" title={copyChoice.link}>🔗 {copyChoice.link}</div>
            <div className="due-pop-row" style={{ flexDirection: 'column', gap: 8 }}>
              <button className="pillbtn" onClick={() => { doCopyText(copyChoice.text, copyChoice.id); setCopyChoice(null); setToast('Riga copiata'); setTimeout(() => setToast(''), 1200) }}>⧉ Copia riga intera</button>
              <button className="pillbtn" onClick={() => { doCopyText(copyChoice.link); setCopyChoice(null); setToast('Link copiato'); setTimeout(() => setToast(''), 1200) }}>🔗 Copia solo il link</button>
            </div>
          </div>
        </div>
      )}

      {/* immagine a schermo intero (lightbox) */}
      {lightbox && (() => {
        const lb = blocks.find(b => b.id === lightbox.blockId)
        const im = lb?.imgs?.[lightbox.i]
        if (!im) return null
        return (
          <div className="img-lightbox" onClick={() => setLightbox(null)}>
            <img src={im.url} alt="" onClick={e => e.stopPropagation()} />
            <div className="img-lightbox-bar" onClick={e => e.stopPropagation()}>
              <button className="pillbtn danger" onClick={() => removeImageAt(lightbox.blockId, lightbox.i)}>🗑 Rimuovi</button>
              <button className="pillbtn" onClick={() => setLightbox(null)}>Chiudi</button>
            </div>
          </div>
        )
      })()}

      {ghost && <div className="drag-ghost" style={{ left: ghost.x + 14, top: ghost.y + 10 }}>{shortText(ghost.text)}</div>}
      {toast && <div className="editor-toast">{toast}</div>}
    </div>
  )
}
