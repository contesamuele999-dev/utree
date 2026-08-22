import { useEffect, useMemo, useRef, useState } from 'react'
import { completamento, fatteInFondo, streak, todayKey, parseDay, riepilogoSettimana } from '../lib/today.js'
import { renderInline } from '../lib/markdown.jsx'
import { edgeScroll, stopEdgeScroll } from '../lib/edgescroll.js'

// ============================================================
// TODAY — le task della giornata.
// Il livello temporale di uTree: le viste dicono cosa esiste,
// Progress a che punto è, Today cosa tocca oggi.
// Il tono è deliberatamente gentile: nessun rosso sulle task
// aperte, nessun contatore che azzera con rimprovero.
// ============================================================

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

function dataLunga(key) {
  const d = parseDay(key)
  if (!d) return ''
  return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`
}
function dataBreve(key) {
  const d = parseDay(key)
  return d ? `${d.getDate()}/${d.getMonth() + 1}` : key
}
const oraDelGiorno = () => new Date().getHours()

// Oltre questa soglia l'app lo fa notare, ma non impedisce nulla:
// la giornata è tua, il limite è un'osservazione, non una regola.
const SOGLIA_GIORNATA = 10

// preferenza persistente: "sposta in fondo le task completate"
const PREF_FATTE = 'utree-today-fatte-fondo'

// Nidificazione: stesse regole delle viste (stesso tetto, stessa larghezza di guida).
const MAX_INDENT = 6
const INDENT_STEP = 26   // px di trascinamento orizzontale per cambiare livello
const SWIPE_MIN = 42     // px minimi di uno swipe perché valga come rientro
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Racchiude la prima occorrenza "libera" di `name` in un collegamento ((Nome)).
function linkifyName(text, name) {
  const re = new RegExp('(?<![\\(\\[])\\b' + escapeRe(name) + '\\b(?![\\)\\]])', 'i')
  return (text || '').replace(re, (m) => '((' + m + '))')
}

export default function Today({
  task = [], tuttoLoStorico = [], visioni = [], oggi = todayKey(), proposte = [],
  giorni = [], giornoCorrente = null, allViste = [],
  onAdd, onToggle, onEditText, onDelete, onReorder, onOpenOrigine, onAccettaProposta,
  onApriRicorrenti, onRendiRicorrente, onChiudiGiornata, onWikilink, onIndent,
}) {
  const [proposteAperte, setProposteAperte] = useState(true)
  const [vittoria, setVittoria] = useState('')
  const [mood, setMood] = useState(0)
  const [settimanaAperta, setSettimanaAperta] = useState(false)
  const [nuova, setNuova] = useState('')
  const [editId, setEditId] = useState(null)
  const [editText, setEditText] = useState('')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  // "fatte in fondo" è una preferenza, non uno stato di sessione: si ricorda
  // fra le aperture dell'app (prima si azzerava a ogni ricarica).
  const [riordinaFatte, setRiordinaFatte] = useState(
    () => { try { return localStorage.getItem(PREF_FATTE) === '1' } catch { return false } }
  )
  const nuovaRef = useRef(null)
  const editRef = useRef(null)

  const diOggi = useMemo(
    () => task.filter(t => t && t.giorno === oggi).sort((a, b) => (a.ordine || 0) - (b.ordine || 0)),
    [task, oggi]
  )
  // "fatte in fondo" ordina i fratelli a ogni livello e sposta sempre rami
  // interi: una task figlia non può mai separarsi dal suo genitore.
  const lista = useMemo(() => {
    if (!riordinaFatte) return diOggi
    return fatteInFondo(diOggi, MAX_INDENT)
  }, [diOggi, riordinaFatte])

  const { done, mezze, tot, pct } = completamento(diOggi)
  const serie = useMemo(() => streak(tuttoLoStorico.length ? tuttoLoStorico : task, oggi),
    [tuttoLoStorico, task, oggi])

  const visById = useMemo(() => new Map(visioni.map(v => [v.id, v])), [visioni])
  const sett = useMemo(
    () => riepilogoSettimana(tuttoLoStorico.length ? tuttoLoStorico : task, giorni, oggi),
    [tuttoLoStorico, task, giorni, oggi]
  )

  // ---- albero: guide di rientro, conteggio figli, righe piegate --------------
  // Stessa logica dell'editor delle viste: il sotto-albero di una task sono le
  // righe che la seguono con un rientro maggiore, fino alla prima di pari livello.
  const [collapsed, setCollapsed] = useState(() => new Set())
  const { guides, figli, nascosti } = useMemo(() => {
    const n = lista.length
    const depth = lista.map(t => Math.min(t.indent || 0, MAX_INDENT))
    const lastChild = new Array(n).fill(true)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (depth[j] < depth[i]) break
        if (depth[j] === depth[i]) { lastChild[i] = false; break }
      }
    }
    const guides = new Array(n)
    const stack = []
    for (let i = 0; i < n; i++) {
      const d = depth[i]
      stack.length = d
      const cols = []
      for (let c = 0; c < d; c++) {
        if (c === d - 1) cols.push(lastChild[i] ? 'end' : 'tee')
        else { const anc = stack[c + 1]; cols.push(anc != null && !lastChild[anc] ? 'line' : 'space') }
      }
      guides[i] = cols
      stack[d] = i
    }
    const figli = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      let c = 0
      for (let j = i + 1; j < n; j++) { if (depth[j] > depth[i]) c++; else break }
      figli[i] = c
    }
    const nascosti = new Set()
    for (let i = 0; i < n; i++) {
      if (!collapsed.has(lista[i].id)) continue
      for (let j = i + 1; j <= i + figli[i] && j < n; j++) nascosti.add(lista[j].id)
    }
    return { guides, figli, nascosti }
  }, [lista, collapsed])

  const toggleCollapse = (id) => setCollapsed(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // Rientro: come nelle viste, una task può scendere al massimo un livello
  // sotto quella che la precede — così l'albero non ha buchi.
  const rientra = (t, delta) => {
    if (!onIndent) return
    const i = lista.findIndex(x => x.id === t.id)
    if (i < 0) return
    const max = i === 0 ? 0 : Math.min((lista[i - 1].indent || 0) + 1, MAX_INDENT)
    const next = Math.max(0, Math.min((t.indent || 0) + delta, max))
    if (next !== (t.indent || 0)) onIndent(t, next)
  }

  // ---- suggerimenti di collegamento: se scrivi il nome di una vista ----------
  const suggestions = useMemo(() => {
    const t = editText
    if (!t.trim()) return []
    const seen = new Set(); const out = []
    for (const v of allViste) {
      const name = (v.titolo || '').trim()
      if (name.length < 2 || seen.has(name.toLowerCase())) continue
      if (t.includes('((' + name + '))') || t.includes('[[' + name + ']]')) continue
      const re = new RegExp('(?<![\\(\\[])\\b' + escapeRe(name) + '\\b(?![\\)\\]])', 'i')
      if (re.test(t)) { seen.add(name.toLowerCase()); out.push(name) }
      if (out.length >= 4) break
    }
    return out
  }, [editText, allViste])

  const applyLink = (name) => setEditText(t => linkifyName(t, name))

  // click su un ((collegamento)) dentro il testo di una task: apre la vista
  // invece di entrare in modifica.
  const clickTesto = (e, t) => {
    if (swipeFatto.current) { swipeFatto.current = false; return }   // era uno swipe, non un tap
    const link = e.target.getAttribute?.('data-link')
    if (link && onWikilink) { e.stopPropagation(); onWikilink(link); return }
    setEditId(t.id); setEditText(t.text || '')
  }

  // ---- SWIPE orizzontale sulla riga = ±1 livello di rientro -------------------
  // Stesso gesto delle viste: si scorre la task a destra per nidificarla sotto
  // quella sopra, a sinistra per riportarla su. Lo scorrimento verticale della
  // lista resta nativo (touch-action: pan-y), quindi il gesto non ruba nulla.
  const swipe = useRef(null)
  const swipeFatto = useRef(false)
  const [swipeDx, setSwipeDx] = useState(null)   // { id, dx } — anteprima mentre trascini

  const onRowDown = (e, t) => {
    if (editId === t.id || !onIndent) return
    if (e.target.closest?.('button, input, .drag-handle')) return
    swipe.current = { id: t.id, sx: e.clientX, sy: e.clientY, attivo: false, dx: 0 }
  }
  const onRowMove = (e) => {
    const s = swipe.current
    if (!s) return
    const dx = e.clientX - s.sx, dy = e.clientY - s.sy
    if (!s.attivo) {
      if (Math.hypot(dx, dy) < 12) return
      // gesto verticale → è uno scroll: si lascia perdere
      if (Math.abs(dy) >= Math.abs(dx)) { swipe.current = null; return }
      s.attivo = true
    }
    s.dx = dx
    setSwipeDx({ id: s.id, dx: Math.max(-3 * INDENT_STEP, Math.min(3 * INDENT_STEP, dx)) })
  }
  const onRowUp = (t) => {
    const s = swipe.current
    swipe.current = null; setSwipeDx(null)
    if (!s || !s.attivo) return
    // il click che segue lo swipe non deve aprire la modifica; la bandierina si
    // spegne da sola se quel click non arriva (es. dito alzato fuori dal testo)
    swipeFatto.current = true
    setTimeout(() => { swipeFatto.current = false }, 400)
    if (Math.abs(s.dx) < SWIPE_MIN) return
    rientra(t, s.dx > 0 ? 1 : -1)
  }
  const onRowCancel = () => { swipe.current = null; setSwipeDx(null) }

  useEffect(() => { if (editId && editRef.current) editRef.current.focus() }, [editId])
  useEffect(() => {
    try { localStorage.setItem(PREF_FATTE, riordinaFatte ? '1' : '0') } catch { /* quota */ }
  }, [riordinaFatte])
  // se la giornata era già stata annotata (senza chiuderla) si riprende da lì
  useEffect(() => {
    if (giornoCorrente && !giornoCorrente.chiuso_at) {
      setVittoria(giornoCorrente.vittoria || '')
      setMood(giornoCorrente.mood || 0)
    }
  }, [giornoCorrente?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const chiudi = () => {
    onChiudiGiornata?.({ vittoria: vittoria.trim() || null, mood: mood || null })
  }

  const aggiungi = (testo, mantieniFocus = true) => {
    const t = (testo ?? nuova).trim()
    if (!t) return
    onAdd?.({ text: t, giorno: oggi, ordine: (diOggi[diOggi.length - 1]?.ordine || 0) + 1 })
    setNuova('')
    if (mantieniFocus) requestAnimationFrame(() => nuovaRef.current?.focus())
  }

  const confermaEdit = () => {
    if (editId == null) return
    const t = editText.trim()
    const orig = diOggi.find(x => x.id === editId)
    if (orig && t && t !== orig.text) onEditText?.(orig, t)
    setEditId(null); setEditText('')
  }

  // --- riordino: handle ⠿ + linea di rilascio. Come nelle viste, lo spostamento
  //     ORIZZONTALE durante il trascinamento cambia anche il livello di rientro. ---
  const dragStartX = useRef(0)
  const rootRef = useRef(null)
  const scrollerOf = () => rootRef.current?.closest('.content') || document.scrollingElement
  // Auto-scorrimento ai bordi: l'ascolto è sul documento, non sulle righe. Sopra la
  // lista ci sono intestazione e riepilogo — puntando lassù nessuna riga riceveva
  // dragover e la lista non risaliva, mentre verso il basso funzionava.
  useEffect(() => {
    if (!dragId) return
    const onOver = (e) => { if (e.clientY) edgeScroll(e.clientY, scrollerOf) }
    document.addEventListener('dragover', onOver)
    return () => { document.removeEventListener('dragover', onOver); stopEdgeScroll() }
  }, [dragId])

  const onDrop = (target, clientX) => {
    stopEdgeScroll()
    const step = onIndent ? Math.round(((clientX || dragStartX.current) - dragStartX.current) / INDENT_STEP) : 0
    if (dragId && dragId !== target.id) onReorder?.(dragId, target.id, step)
    else if (dragId === target.id && step !== 0) {
      const t = lista.find(x => x.id === dragId)
      if (t) rientra(t, step)
    }
    setDragId(null); setOverId(null)
  }

  return (
    <div className="today" ref={rootRef}>
      <div className="section-head">
        <h2>Today</h2>
        <span className="crumb">{dataLunga(oggi)}</span>
        <div className="spacer" />
        {tot > 0 && (
          <span className="crumb" title={mezze ? `${mezze} a metà` : undefined}>
            {done}/{tot}{mezze ? ` · ${mezze} a metà` : ''}
          </span>
        )}
        {onApriRicorrenti && (
          <button className="iconbtn mini" title="Task ricorrenti" onClick={onApriRicorrenti}>↻</button>
        )}
      </div>

      {/* --- barra di completamento + streak --- */}
      {tot > 0 && (
        <div className="today-summary">
          <div className="today-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
            aria-label={`${done} task su ${tot} completate`}>
            <div className={'today-bar-fill' + (pct === 100 ? ' full' : '')} style={{ width: `${pct}%` }} />
          </div>
          <span className="today-pct">{pct}%</span>
          <StreakChip serie={serie} />
        </div>
      )}

      {tot > SOGLIA_GIORNATA && (
        <div className="today-avviso">
          Giornata piena: {tot} task. Va benissimo — ma sicuro che ci stiano tutte?
        </div>
      )}

      {/* --- elenco --- */}
      <ul className="today-list">
        {lista.map((t, ti) => {
          const vis = t.vista_id ? visById.get(t.visione_id) : null
          if (nascosti.has(t.id)) return null
          const nFigli = figli[ti]
          const piegata = nFigli > 0 && collapsed.has(t.id)
          return (
            <li key={t.id}
              className={'today-item'
                + (t.done ? ' done' : '')
                + (!t.done && t.parziale ? ' mezza' : '')
                + ((t.indent || 0) ? ' nested' : '')
                + (dragId === t.id ? ' dragging' : '')
                + (overId === t.id && dragId && dragId !== t.id ? ' over' : '')
                + (swipeDx?.id === t.id ? ' swiping' : '')}
              style={swipeDx?.id === t.id ? { transform: `translateX(${swipeDx.dx}px)` } : undefined}
              onDragOver={e => { if (dragId) { e.preventDefault(); setOverId(t.id) } }}
              onDragLeave={() => setOverId(id => id === t.id ? null : id)}
              onDrop={e => { e.preventDefault(); onDrop(t, e.clientX) }}
              onPointerDown={e => onRowDown(e, t)}
              onPointerMove={onRowMove}
              onPointerUp={() => onRowUp(t)}
              onPointerCancel={onRowCancel}>

              {/* guide di nidificazione continue, come nelle viste */}
              {(guides[ti] || []).map((g, i) => (
                <span key={i} className={'indent-guide guide-' + g} />
              ))}

              {/* piega/dispiega i sotto-task */}
              {nFigli > 0 && (
                <button className={'row-fold' + (piegata ? ' on' : '')} tabIndex={-1}
                  title={piegata ? `Mostra i sotto-task (${nFigli})` : `Nascondi i sotto-task (${nFigli})`}
                  aria-label={piegata ? 'Mostra i sotto-task' : 'Nascondi i sotto-task'}
                  aria-expanded={!piegata}
                  onClick={() => toggleCollapse(t.id)}>{piegata ? '▸' : '▾'}</button>
              )}
              {piegata && <span className="row-fold-count" title={`${nFigli} task nascoste`}>{nFigli}</span>}

              <span className="drag-handle" title="Trascina per riordinare · ←/→ per nidificare"
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragStartX.current = e.clientX; setDragId(t.id) }}
                onDragEnd={() => { stopEdgeScroll(); setDragId(null); setOverId(null) }}>⠿</span>

              {/* tre stati: da fare → a metà → fatta → da fare */}
              <button className={'today-check' + (t.done ? ' done' : t.parziale ? ' mezza' : '')}
                onClick={() => onToggle?.(t)}
                aria-pressed={!!t.done}
                title={t.done ? 'Fatta — clicca per riaprirla'
                  : t.parziale ? 'A metà — clicca per completarla'
                    : 'Da fare — clicca per segnarla a metà'}
                aria-label={t.done ? 'Segna come da fare'
                  : t.parziale ? 'Segna come completata' : 'Segna come fatta a metà'}>
                <span className="today-box" />
              </button>

              {editId === t.id ? (
                <div className="today-editwrap">
                  <input className="today-edit" ref={editRef} value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onBlur={confermaEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        // se c'è un collegamento suggerito, Invio conferma quello
                        if (suggestions.length) applyLink(suggestions[0]); else confermaEdit()
                      } else if (e.key === 'Tab') {
                        // Tab / ⇧Tab = rientra / riduci, come nelle viste
                        e.preventDefault(); rientra(t, e.shiftKey ? -1 : 1)
                      } else if (e.key === 'Escape') {
                        // Esc NON annulla: conferma quello che hai scritto ed esce dalla riga.
                        // (stessa regola in tutte le sezioni: uscire da una riga = salvarla)
                        e.preventDefault(); e.stopPropagation(); confermaEdit()
                      }
                    }} />
                  {suggestions.length > 0 && (
                    <div className="link-suggest">
                      <span className="link-suggest-lbl">Collega a:</span>
                      {suggestions.map((name, i) => (
                        <button key={name} type="button" className={'link-suggest-chip' + (i === 0 ? ' first' : '')}
                          onMouseDown={e => e.preventDefault()} onClick={() => applyLink(name)}>
                          🔗 {name}{i === 0 ? ' ↵' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="today-text rendered" onClick={e => clickTesto(e, t)}
                  title="Clicca per modificare">
                  {t.text ? renderInline(t.text) : 'Senza testo'}
                </span>
              )}

              <div className="today-badges">
                {onIndent && (
                  <>
                    <button className="iconbtn mini" title="Riduci il rientro (⇧Tab)"
                      disabled={!(t.indent || 0)}
                      onClick={() => rientra(t, -1)}>⇤</button>
                    <button className="iconbtn mini" title="Rientra sotto la task sopra (Tab)"
                      disabled={ti === 0 || (t.indent || 0) >= Math.min((lista[ti - 1].indent || 0) + 1, MAX_INDENT)}
                      onClick={() => rientra(t, 1)}>⇥</button>
                  </>
                )}
                {t.ricorrenza_id && <span className="today-badge ric" title="Task ricorrente">↻</span>}
                {(t.rollover || 0) >= 3 && (
                  <span className="today-badge rinvii" title={`Rimandata ${t.rollover} volte: vale ancora la pena?`}>
                    ↻{t.rollover}
                  </span>
                )}
                {t.vista_id && (
                  <button className="today-chip" title="Apri la nota di origine"
                    onClick={() => onOpenOrigine?.(t)}>
                    ⚡ {t.vistaTitolo || vis?.titolo || 'origine'}
                  </button>
                )}
                {t.vista_id && t.orfana && (
                  <span className="today-badge orfana" title="La riga di origine non esiste più">🔗</span>
                )}
                {!t.ricorrenza_id && onRendiRicorrente && (
                  <button className="iconbtn mini" title="Rendi ricorrente"
                    onClick={() => onRendiRicorrente(t)}>↻</button>
                )}
                <button className="iconbtn mini danger" title="Elimina task"
                  onClick={() => onDelete?.(t)}>🗑</button>
              </div>
            </li>
          )
        })}

        {/* --- riga di aggiunta --- */}
        <li className="today-item today-add">
          <span className="drag-handle ghost">＋</span>
          <input className="today-new" ref={nuovaRef} value={nuova}
            placeholder="Aggiungi task…"
            onChange={e => setNuova(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); aggiungi() }
              else if (e.key === 'Escape') {
                // anche qui Esc salva: se hai scritto qualcosa la task viene aggiunta,
                // altrimenti si esce e basta dal campo.
                e.preventDefault(); e.stopPropagation()
                if (nuova.trim()) aggiungi(undefined, false)
                e.currentTarget.blur()
              }
            }} />
          {nuova && <button className="add-btn mini" onClick={() => aggiungi()}>Aggiungi</button>}
        </li>
      </ul>

      {tot > 0 && done > 0 && (
        <div className="today-foot">
          <button className={'iconbtn mini' + (riordinaFatte ? ' on' : '')}
            title="Sposta in fondo le task completate"
            onClick={() => setRiordinaFatte(v => !v)}>⇅ fatte in fondo</button>
          {done === tot && <span className="today-complete">Giornata completa.</span>}
        </div>
      )}

      {tot === 0 && (
        <div className="today-empty">
          <p>Giornata bianca.</p>
          <p className="sub">Cosa sposterebbe davvero le cose, oggi?</p>
        </div>
      )}

      {/* --- proposte: righe scadute o in scadenza oggi, non ancora prese in carico.
              Sono un invito, non una lista di doveri: si aggiungono una per una. --- */}
      {proposte.length > 0 && (
        <div className="today-proposte">
          <div className="today-proposte-head">
            <button className="archivio-toggle" onClick={() => setProposteAperte(a => !a)}>
              {proposteAperte ? '▾' : '▸'} Proposte di oggi · {proposte.length}
            </button>
            <span className="crumb">righe con scadenza dalle tue viste</span>
          </div>
          {proposteAperte && (
            <ul className="today-list">
              {proposte.map(p => (
                <li key={`${p.vista_id}|${p.blocco_id}`} className="today-item today-proposta">
                  <button className="today-take" title="Aggiungi alle task di oggi"
                    onClick={() => onAccettaProposta?.(p)}>＋</button>
                  <span className="today-text">{p.text}</span>
                  <div className="today-badges">
                    {p.scaduta && <span className="today-badge scaduta" title={'Scadeva il ' + p.due}>scaduta</span>}
                    <span className="today-chip" title={`${p.visione} · ${p.vista}`}>{p.visione} / {p.vista}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* --- rito serale: il momento in cui la giornata diventa qualcosa di
              guardato, non solo fatto. Compare quando c'è qualcosa da
              guardare (almeno una task chiusa) o quando la sera è arrivata. --- */}
      {onChiudiGiornata && !giornoCorrente?.chiuso_at && (done > 0 || oraDelGiorno() >= 18) && (
        <div className="today-sera">
          <h3>Come è andata oggi?</h3>
          <p className="crumb">
            {done > 0
              ? `${done} ${done === 1 ? 'cosa portata a casa' : 'cose portate a casa'}. Vale la pena annotarlo.`
              : 'Anche una giornata storta merita una riga.'}
          </p>
          <input className="input" placeholder="La cosa buona di oggi…"
            value={vittoria} onChange={e => setVittoria(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') chiudi() }} />
          <div className="today-mood">
            {[1, 2, 3, 4, 5].map(m => (
              <button key={m} className={'mood-btn' + (mood === m ? ' on' : '')}
                title={['difficile', 'fiacca', 'normale', 'buona', 'ottima'][m - 1]}
                onClick={() => setMood(m === mood ? 0 : m)}>{['😞', '😐', '🙂', '😄', '🤩'][m - 1]}</button>
            ))}
          </div>
          <button className="btn" onClick={chiudi}>Chiudi la giornata</button>
        </div>
      )}

      {giornoCorrente?.chiuso_at && (
        <div className="today-sera chiusa">
          <h3>Giornata chiusa.</h3>
          <p className="crumb">{done} {done === 1 ? 'task completata' : 'task completate'}.</p>
          {giornoCorrente.vittoria && <p className="today-vittoria">“{giornoCorrente.vittoria}”</p>}
        </div>
      )}

      {/* --- riepilogo settimanale: guardare indietro sette giorni --- */}
      {sett.chiuse > 0 && (
        <div className="today-settimana">
          <button className="archivio-toggle" onClick={() => setSettimanaAperta(a => !a)}>
            {settimanaAperta ? '▾' : '▸'} La tua settimana · {sett.chiuse} task
          </button>
          {settimanaAperta && (
            <div className="today-sett-body">
              <p className="crumb">
                Dal {dataBreve(sett.start)} al {dataBreve(sett.fine)} ·
                {' '}{sett.chiuse} su {sett.pianificate} pianificate
                {sett.migliore ? ` · giorno migliore: ${dataBreve(sett.migliore)}` : ''}
                {sett.moodMedio ? ` · umore medio ${sett.moodMedio}/5` : ''}
              </p>
              {sett.vittorie.length > 0 && (
                <ul className="today-vittorie">
                  {sett.vittorie.map(v => (
                    <li key={v.giorno}><span className="crumb">{dataBreve(v.giorno)}</span> {v.vittoria}</li>
                  ))}
                </ul>
              )}

              {/* Cosa hai fatto, non solo quanto: l'elenco per giorno delle task chiuse. */}
              {(sett.fatte || []).length > 0 && (
                <div className="sett-fatte">
                  {sett.fatte.map(g => (
                    <div key={g.giorno} className="sett-giorno">
                      <div className="sett-giorno-head">
                        <b>{dataLunga(g.giorno)}</b>
                        <span className="crumb">{g.task.length}</span>
                      </div>
                      <ul className="sett-task">
                        {g.task.map(t => <li key={t.id}>✓ {t.text}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Lo streak non è mai rosso e non "si perde": al massimo ricomincia.
function StreakChip({ serie }) {
  if (!serie || (!serie.attuale && !serie.record)) return null
  if (!serie.attuale) {
    return <span className="today-streak nuovo" title="Ogni serie comincia da un giorno">nuovo inizio · giorno 1</span>
  }
  return (
    <span className={'today-streak' + (serie.inPausa ? ' pausa' : '')}
      title={serie.inPausa
        ? 'Serie viva: un giorno mancato è stato graziato questo mese'
        : `Record: ${serie.record} giorni`}>
      🔥 {serie.attuale} {serie.attuale === 1 ? 'giorno' : 'giorni'}{serie.inPausa ? ' · in pausa' : ''}
    </span>
  )
}
