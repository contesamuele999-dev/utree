import { useEffect, useMemo, useRef, useState } from 'react'
import { stageOf } from '../lib/stages.js'
import { edgeScroll, stopEdgeScroll } from '../lib/edgescroll.js'

// Classe di urgenza di una vista in base alle scadenze delle sue righe:
// evidenzia con lo sfondo se ha righe scadute / in scadenza oggi / entro 3 giorni.
const DAY_MS = 24 * 60 * 60 * 1000
function urgentCls(v) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let best = null
  for (const b of (v.blocchi || [])) {
    if (!b.due) continue
    const d = new Date(b.due + 'T00:00:00'); if (isNaN(d.getTime())) continue
    const days = Math.round((d.getTime() - today.getTime()) / DAY_MS)
    if (best === null || days < best) best = days
  }
  if (best === null) return ''
  if (best < 0) return ' due-over'
  if (best === 0) return ' due-today'
  if (best <= 3) return ' due-soon'
  return ''
}

// ============================================================
// PIPE — visioni (contenitori, sfondo tinto col loro colore)
// e viste (card neutre con indicatore colore della fase).
// Ricerca: priorità ai titoli delle viste, poi al contenuto.
// ============================================================
export default function Pipeline({ visioni, viste, permessi, onApriTeam, query: queryProp, onQueryChange, onOpen, onAddVisione, onAddVista, onRenameVisione, onRecolorVisione, onDeleteVista, onDeleteVisione, onReorderVisioni, onMoveVistaToVisione, onTogglePin, onToggleArchivio }) {
  // Permesso sul progetto: 'proprietario' (il tuo) | 'modifica' | 'vista' (condiviso).
  // Senza mappa dei permessi è tutto tuo, come prima dei team.
  const permessoDi = (vis) => permessi?.get(vis.id) || 'proprietario'
  const mioProgetto = (vis) => permessoDi(vis) === 'proprietario'
  const scrivibile = (vis) => permessoDi(vis) !== 'vista'
  // la ricerca è controllata dall'alto (App) così non si azzera aprendo/chiudendo una vista;
  // fallback a stato locale se il componente viene usato senza le prop.
  const [queryLocal, setQueryLocal] = useState('')
  const query = queryProp !== undefined ? queryProp : queryLocal
  const setQuery = onQueryChange || setQueryLocal
  const [archivioAperto, setArchivioAperto] = useState(false)
  const [dragVisId, setDragVisId] = useState(null)
  const [overVisId, setOverVisId] = useState(null)          // visione target per lo spostamento di una VISTA (evidenzia il contenitore)
  const [reorderOver, setReorderOver] = useState(null)       // { id, edge } per il riordino VISIONI (mostra una riga separatrice)
  const reorderRef = useRef(null)                            // ultimo edge "bloccato": serve per l'isteresi anti-tremolio
  const [dragVistaId, setDragVistaId] = useState(null)   // vista trascinata verso un'altra visione
  const preview = (v) => (v.blocchi || []).map(b => b.text).join(' ').replace(/[#*`>]/g, '').slice(0, 140)

  const q = query.trim().toLowerCase()
  // punteggio: 2 = match nel titolo (priorità), 1 = solo nel contenuto, 0 = nessun match
  const scoreVista = (v) => {
    if (!q) return 1
    if ((v.titolo || '').toLowerCase().includes(q)) return 2
    const content = (v.blocchi || []).map(b => b.text).join(' ').toLowerCase()
    return content.includes(q) ? 1 : 0
  }

  // ordinamento di default (nessuna ricerca): viste fissate in cima, poi per modifica
  // più recente (updated_at, fallback created_at).
  const modTs = (v) => Date.parse(v.updated_at || v.created_at || 0) || 0
  const byPinnedRecent = (a, b) => {
    const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0
    if (pa !== pb) return pb - pa
    return modTs(b) - modTs(a)
  }

  // per ogni visione: viste filtrate e ordinate.
  // Senza ricerca: fissate in cima, poi più recenti. Con ricerca: prima il punteggio
  // (titolo > contenuto), poi a parità le fissate/più recenti.
  const sezioni = useMemo(() => {
    let out = visioni.map(vis => {
      const mie = viste.filter(v => v.visione_id === vis.id && !v.is_template)
      const visMatch = q && (vis.titolo || '').toLowerCase().includes(q)
      let list = mie.map(v => ({ v, s: scoreVista(v) }))
      if (q) list = list.filter(x => x.s > 0 || visMatch)
      list.sort((a, b) => (b.s - a.s) || byPinnedRecent(a.v, b.v))
      return { vis, mie, list, visMatch, total: mie.length }
    }).filter(sez => !q || sez.list.length > 0 || sez.visMatch)
    if (q) {
      // priorità: sezioni con match nei TITOLI (visione o vista = punteggio 2) sopra
      // quelle con match solo nel contenuto (1). Preserva l'ordine originale a parità.
      const secScore = (s) => Math.max(s.visMatch ? 2 : 0, ...s.list.map(x => x.s), 0)
      out = out.map((s, i) => ({ s, i })).sort((a, b) => secScore(b.s) - secScore(a.s) || a.i - b.i).map(x => x.s)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visioni, viste, q])

  const nResults = sezioni.reduce((n, s) => n + s.list.length, 0)

  // Archivio: le visioni archiviate scendono in fondo, in un gruppo richiudibile.
  // Archiviare non nasconde e non cancella: toglie rumore da Pipe e smette di
  // proporre le loro righe scadute in Today.
  const attive = sezioni.filter(s => !s.vis.archiviata)
  const archiviate = sezioni.filter(s => s.vis.archiviata)
  // durante una ricerca l'archivio si apre da solo: cercare deve trovare tutto
  const mostraArchivio = archivioAperto || !!q
  const daMostrare = [
    ...attive,
    ...(archiviate.length ? [{ archivioHeader: true, n: archiviate.length }] : []),
    ...(mostraArchivio ? archiviate : []),
  ]

  // prima vista fra i risultati (per aprirla con Invio dalla barra di ricerca)
  const firstResult = useMemo(() => {
    for (const s of sezioni) { if (s.list.length) return s.list[0].v }
    return null
  }, [sezioni])

  // digitando da tastiera (fuori dai campi) il testo va nella barra di ricerca
  const searchRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape' && query) {   // Esc fuori dal campo: svuota comunque la ricerca
        setQuery('')
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key.length === 1) {
        setQuery(query + e.key)   // append al testo corrente
        requestAnimationFrame(() => searchRef.current?.focus())
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // auto-scorrimento ai bordi mentre si trascina una visione o una vista
  const rootRef = useRef(null)
  useEffect(() => {
    if (!dragVisId && !dragVistaId) return
    const onOver = (e) => {
      if (e.clientY) edgeScroll(e.clientY, () => rootRef.current?.closest('.content') || document.scrollingElement)
    }
    document.addEventListener('dragover', onOver)
    return () => { document.removeEventListener('dragover', onOver); stopEdgeScroll() }
  }, [dragVisId, dragVistaId])

  return (
    <div className="pipe" ref={rootRef}>
      <div className="section-head">
        <h2>Pipe</h2>
        <span className="crumb">{visioni.length} visioni · {viste.length} viste</span>
        <div className="spacer" />
        <button className="add-btn" onClick={onAddVisione}>＋ Nuova visione</button>
      </div>

      <div className="pipe-search-sticky">
        <div className="pipe-search">
          <span className="pipe-search-ico">🔍</span>
          <input className="pipe-search-input" ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              // stopPropagation OBBLIGATORIO: l'evento nativo continua a salire fino a
              // window DOPO che React ha già montato l'editor della vista aperta, e il
              // suo listener globale lo leggerebbe come "Invio a vuoto" creando una riga
              // in fondo (che poi si mette in modifica e trascina lo scroll a fine vista).
              if (e.key === 'Enter' && firstResult) { e.preventDefault(); e.stopPropagation(); onOpen(firstResult, q) }
              else if (e.key === 'Escape') { e.stopPropagation(); if (query) setQuery(''); else e.currentTarget.blur() }
            }}
            placeholder="Cerca viste (titolo, poi contenuto)…" />
          {query && <button className="pipe-search-clear" title="Pulisci" onClick={() => setQuery('')}>✕</button>}
        </div>
      </div>

      {daMostrare.map((sez) => {
        // voce sentinella: la riga separatrice del gruppo "Archivio".
        // Sta dentro l'elenco (invece che in un secondo map) così la sezione
        // di una visione resta definita in un punto solo.
        if (sez.archivioHeader) return (
          <div key="__archivio__" className="archivio-head">
            <button className="archivio-toggle" onClick={() => setArchivioAperto(a => !a)}>
              {mostraArchivio ? '▾' : '▸'} 📦 Archivio · {sez.n}
            </button>
            <span className="crumb">Restano cercabili e apribili: non propongono più task in Today.</span>
          </div>
        )
        const { vis, list, total } = sez
        return (
        <div key={vis.id} className={'vision-drop-wrap' + (vis.archiviata ? ' archiviata' : '')}>
        <div className={'pipe-dropline'
          + (reorderOver?.id === vis.id && dragVisId && dragVisId !== vis.id ? ' show' : '')
          + (reorderOver?.edge === 'after' ? ' at-bottom' : ' at-top')} />
        <section
          className={'vision-block'
            + (dragVisId === vis.id ? ' dragging' : '')
            + (overVisId === vis.id && dragVistaId && vis.id !== viste.find(v => v.id === dragVistaId)?.visione_id ? ' drop-target' : '')}
          style={{ '--vcol': vis.colore || 'var(--green)' }}
          onDragOver={e => {
            if (q) return
            if (dragVisId) {
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              const mid = r.top + r.height / 2
              const BUFFER = 14   // zona morta attorno al centro: evita che l'edge sfarfalli avanti/indietro
              const cur = reorderRef.current?.id === vis.id ? reorderRef.current.edge : (e.clientY < mid ? 'before' : 'after')
              let edge = cur
              if (cur === 'before' && e.clientY > mid + BUFFER) edge = 'after'
              else if (cur === 'after' && e.clientY < mid - BUFFER) edge = 'before'
              if (reorderRef.current?.id !== vis.id || reorderRef.current.edge !== edge) {
                reorderRef.current = { id: vis.id, edge }
                setReorderOver({ id: vis.id, edge })
              }
            } else if (dragVistaId) {
              e.preventDefault(); setOverVisId(vis.id)
            }
          }}
          onDragLeave={() => {
            setOverVisId(id => id === vis.id ? null : id)
            if (reorderRef.current?.id === vis.id) { reorderRef.current = null; setReorderOver(null) }
          }}
          onDrop={e => {
            e.preventDefault()
            if (!q && dragVisId && dragVisId !== vis.id) onReorderVisioni(dragVisId, vis.id, reorderOver?.edge || 'before')
            else if (!q && dragVistaId) {
              const v = viste.find(x => x.id === dragVistaId)
              if (v && v.visione_id !== vis.id) onMoveVistaToVisione?.(dragVistaId, vis.id)
            }
            reorderRef.current = null
            setDragVisId(null); setDragVistaId(null); setOverVisId(null); setReorderOver(null)
          }}>
          <header className="vision-head">
            {!q && mioProgetto(vis) && (
              <span className="drag-handle" title="Trascina per riordinare"
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragVisId(vis.id) }}
                onDragEnd={() => { reorderRef.current = null; setDragVisId(null); setReorderOver(null) }}>⠿</span>
            )}
            {mioProgetto(vis) ? (
              <label className="vision-swatch" title="Colore della visione">
                <input type="color" value={vis.colore || '#2e9e63'}
                  onChange={e => onRecolorVisione(vis, e.target.value)} />
              </label>
            ) : (
              <span className="vision-swatch static" title="Progetto condiviso con te"
                style={{ background: vis.colore || '#2e9e63' }} />
            )}
            <h3>{vis.titolo}</h3>
            {/* progetto di qualcun altro: si dice subito cosa ci puoi fare */}
            {!mioProgetto(vis) && (
              <button className={'share-badge' + (scrivibile(vis) ? ' can-edit' : '')}
                title={scrivibile(vis)
                  ? 'Progetto condiviso con te: puoi modificarlo'
                  : 'Progetto condiviso con te solo per visibilità: puoi leggerlo, non modificarlo'}
                onClick={() => onApriTeam?.()}>
                {scrivibile(vis) ? '👥 condiviso · modifica' : '👁 condiviso · sola visibilità'}
              </button>
            )}
            {mioProgetto(vis) && (
              <>
                <button className="iconbtn mini" title="Rinomina" onClick={() => onRenameVisione(vis)}>✎</button>
                <button className="iconbtn mini" title="Condividi questo progetto con un team"
                  onClick={() => onApriTeam?.()}>👥</button>
                <button className={'iconbtn mini' + (vis.archiviata ? ' on' : '')}
                  title={vis.archiviata
                    ? 'Togli dall’archivio: tornerà in cima e proporrà di nuovo le sue scadenze in Today'
                    : 'Archivia: scende in fondo e smette di proporre task in Today (resta cercabile)'}
                  onClick={() => onToggleArchivio?.(vis)}>📦</button>
                <button className="iconbtn mini danger" title="Elimina visione (e tutte le sue viste)" onClick={() => onDeleteVisione(vis)}>🗑</button>
              </>
            )}
            <div className="spacer" />
            <span className="crumb">{q ? `${list.length}/${total}` : total} viste</span>
            {scrivibile(vis) && <button className="add-btn mini" onClick={() => onAddVista(vis.id)}>＋ Vista</button>}
          </header>

          <div className="vista-grid">
            {list.map(({ v }) => {
              const st = stageOf(v)
              return (
                <article key={v.id} className={'vista-card' + (dragVistaId === v.id ? ' dragging' : '') + (v.pinned ? ' pinned' : '') + urgentCls(v)} style={{ '--stage': st.color }}
                  draggable={scrivibile(vis)}
                  title={scrivibile(vis) ? "Trascina su un'altra visione per spostarla" : 'Apri (sola lettura)'}
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragVistaId(v.id) }}
                  onDragEnd={() => { setDragVistaId(null); setOverVisId(null) }}
                  onClick={() => onOpen(v, q)}>
                  <div className="vista-top">
                    <span className="stage-dot" title={st.label} />
                    <h4>{v.titolo || 'Senza titolo'}</h4>
                    {scrivibile(vis) && (
                      <>
                        <button className={'iconbtn mini pin-btn' + (v.pinned ? ' on' : '')}
                          title={v.pinned ? 'Rimuovi da fissate' : 'Fissa in cima alla visione'}
                          onClick={e => { e.stopPropagation(); onTogglePin?.(v) }}>📌</button>
                        <button className="iconbtn mini danger" title="Elimina vista"
                          onClick={e => { e.stopPropagation(); onDeleteVista(v) }}>🗑</button>
                      </>
                    )}
                  </div>
                  <p className="vista-preview">{preview(v) || 'Vuota…'}</p>
                </article>
              )
            })}
            {!list.length && <div className="vista-empty">{q ? 'Nessuna vista corrisponde qui.' : 'Nessuna vista: aggiungine una.'}</div>}
          </div>
        </section>
        </div>
        )
      })}

      {q && nResults === 0 && !sezioni.length && (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-dim)' }}>
          Nessun risultato per “{query}”.
        </div>
      )}

      {!visioni.length && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
          Crea la tua prima visione per iniziare.
        </div>
      )}
    </div>
  )
}
