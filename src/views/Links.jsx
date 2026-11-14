import { useEffect, useMemo, useRef, useState } from 'react'
import { stageOf } from '../lib/stages.js'
import { IS_KB } from '../../supabase/functions/_shared/agente.js'

// ============================================================
// Links — mappa delle connessioni tra le viste (stile Obsidian).
// I collegamenti sono i LINK INTERNI: ((Nome vista)) e [[Nome vista]]
// scritti nel testo delle righe. Ogni link è una linea; i nodi si
// comportano come "pianeti" con gravità (simulazione a forze) e si
// possono trascinare. Doppio click su un nodo = apre la vista.
// ============================================================

// estrae i nomi collegati (in minuscolo) dal testo di una vista
function linkNamesOf(vista) {
  const out = new Set()
  const re = /\(\(([^()]+)\)\)|\[\[([^\]]+)\]\]/g
  for (const b of vista.blocchi || []) {
    const t = b.text || ''
    let m
    while ((m = re.exec(t)) !== null) {
      const name = (m[1] || m[2] || '').split('|')[0].trim().toLowerCase()   // ((Vista|parola))
      if (name) out.add(name)
    }
  }
  return out
}

export default function Links({ viste = [], visioni = [], onOpen }) {
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })   // pan + zoom
  const [, setTick] = useState(0)
  const [hover, setHover] = useState(null)
  const [showIsolated, setShowIsolated] = useState(true)
  const [filtro, setFiltro] = useState('')   // id visione: solo le sue viste e i link fra loro
  // visioni nel menu: prima le knowledge base
  const visioniMenu = useMemo(() => [...visioni.filter(v => IS_KB.test(v.titolo || '')), ...visioni.filter(v => !IS_KB.test(v.titolo || ''))], [visioni])

  // ---- costruzione del grafo (nodi = viste, archi = link interni) ----
  const graph = useMemo(() => {
    const reali = viste.filter(v => !v.is_template && (!filtro || v.visione_id === filtro))
    const byName = new Map()
    for (const v of reali) {
      const k = (v.titolo || '').trim().toLowerCase()
      if (k && !byName.has(k)) byName.set(k, v.id)
    }
    const nodes = reali.map(v => ({
      id: v.id, titolo: v.titolo || 'Senza titolo',
      color: stageOf(v).color, visione: v.visione_id, deg: 0,
    }))
    const nodeIds = new Set(nodes.map(n => n.id))
    const seen = new Set()
    const edges = []
    for (const v of reali) {
      for (const name of linkNamesOf(v)) {
        const target = byName.get(name)
        if (!target || target === v.id || !nodeIds.has(target)) continue
        const key = v.id < target ? v.id + '|' + target : target + '|' + v.id
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ source: v.id, target })
      }
    }
    const degree = new Map()
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1)
      degree.set(e.target, (degree.get(e.target) || 0) + 1)
    }
    for (const n of nodes) n.deg = degree.get(n.id) || 0
    return { nodes, edges }
  }, [viste, filtro])

  // stato fisico dei nodi (in un ref: aggiornato ~60fps senza re-render pesanti)
  const simRef = useRef(new Map())   // id -> { x, y, vx, vy, fx, fy }
  const dragRef = useRef(null)       // trascinamento di un nodo o pan
  const runningRef = useRef(true)

  // (ri)inizializza le posizioni quando cambia l'insieme di nodi
  useEffect(() => {
    const m = simRef.current
    const next = new Map()
    const R = Math.min(size.w, size.h) * 0.32 || 240
    graph.nodes.forEach((n, i) => {
      const prev = m.get(n.id)
      if (prev) { next.set(n.id, prev); return }
      const a = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2
      next.set(n.id, { x: Math.cos(a) * R + (Math.random() - 0.5) * 40, y: Math.sin(a) * R + (Math.random() - 0.5) * 40, vx: 0, vy: 0, fx: null, fy: null })
    })
    simRef.current = next
    runningRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // misura il contenitore
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- ciclo di simulazione a forze ----
  useEffect(() => {
    let raf
    const step = () => {
      const sim = simRef.current
      const nodes = graph.nodes
      const REPULSION = 5200      // repulsione tra nodi (come cariche/pianeti)
      const SPRING = 0.045        // rigidità delle molle (archi)
      const LINK_LEN = 96         // lunghezza a riposo di un arco
      const GRAVITY = 0.012       // attrazione verso il centro
      const DAMP = 0.86           // smorzamento (attrito)
      let energy = 0

      // repulsione a coppie
      for (let i = 0; i < nodes.length; i++) {
        const a = sim.get(nodes[i].id); if (!a) continue
        for (let j = i + 1; j < nodes.length; j++) {
          const b = sim.get(nodes[j].id); if (!b) continue
          let dx = a.x - b.x, dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 0.01 }
          const d = Math.sqrt(d2)
          // massa ~ (1 + grado): i nodi molto connessi respingono di più (gravità)
          const ma = 1 + nodes[i].deg * 0.35, mb = 1 + nodes[j].deg * 0.35
          const f = (REPULSION * ma * mb) / d2
          const fx = (dx / d) * f, fy = (dy / d) * f
          a.vx += fx; a.vy += fy
          b.vx -= fx; b.vy -= fy
        }
      }
      // molle sugli archi
      for (const e of graph.edges) {
        const a = sim.get(e.source), b = sim.get(e.target)
        if (!a || !b) continue
        let dx = b.x - a.x, dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const f = SPRING * (d - LINK_LEN)
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      }
      // gravità centrale + integrazione
      for (const n of nodes) {
        const p = sim.get(n.id); if (!p) continue
        if (p.fx != null) { p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; continue }
        p.vx += -p.x * GRAVITY
        p.vy += -p.y * GRAVITY
        p.vx *= DAMP; p.vy *= DAMP
        // limite di velocità per stabilità
        const sp = Math.hypot(p.vx, p.vy)
        if (sp > 30) { p.vx = (p.vx / sp) * 30; p.vy = (p.vy / sp) * 30 }
        p.x += p.vx; p.y += p.vy
        energy += sp * sp
      }
      setTick(t => (t + 1) & 0xffff)
      // ferma quando è "a riposo" (riparte al drag / cambio grafo)
      if (energy < 0.4 && !dragRef.current) runningRef.current = false
      if (runningRef.current || dragRef.current) raf = requestAnimationFrame(step)
    }
    runningRef.current = true
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [graph])

  const kick = () => { runningRef.current = true }

  // ---- coordinate schermo -> mondo ----
  const toWorld = (clientX, clientY) => {
    const el = wrapRef.current
    const rect = el.getBoundingClientRect()
    const sx = clientX - rect.left, sy = clientY - rect.top
    return { x: (sx - size.w / 2 - view.x) / view.k, y: (sy - size.h / 2 - view.y) / view.k }
  }

  // ---- trascinamento nodo / pan sfondo ----
  const onNodePointerDown = (e, id) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const w = toWorld(e.clientX, e.clientY)
    const p = simRef.current.get(id)
    dragRef.current = { type: 'node', id, offx: p ? p.x - w.x : 0, offy: p ? p.y - w.y : 0, moved: false }
    if (p) { p.fx = p.x; p.fy = p.y }
    kick()
  }
  const onBgPointerDown = (e) => {
    dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    d.moved = true
    if (d.type === 'node') {
      const w = toWorld(e.clientX, e.clientY)
      const p = simRef.current.get(d.id)
      if (p) { p.fx = w.x + d.offx; p.fy = w.y + d.offy }
      kick()
    } else if (d.type === 'pan') {
      setView(v => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }))
    }
  }
  const onPointerUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.type === 'node') {
      const p = simRef.current.get(d.id)
      if (p) { p.fx = null; p.fy = null }
      kick()
    }
  }
  const onWheel = (e) => {
    e.preventDefault()
    setView(v => {
      const k = Math.min(3, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.89)))
      return { ...v, k }
    })
  }

  const resetView = () => { setView({ x: 0, y: 0, k: 1 }); kick() }

  const sim = simRef.current
  const { nodes, edges } = graph
  const pos = (id) => sim.get(id) || { x: 0, y: 0 }
  const visName = (id) => visioni.find(v => v.id === id)?.titolo || ''

  const visible = showIsolated ? nodes : nodes.filter(n => n.deg > 0)
  const visIds = new Set(visible.map(n => n.id))
  const visEdges = edges.filter(e => visIds.has(e.source) && visIds.has(e.target))

  if (!nodes.length && !filtro) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
      Nessuna vista da collegare. Crea qualche vista e collegale con ((Nome vista)).
    </div>
  }

  return (
    <div className="links-wrap" ref={wrapRef}>
      <div className="links-bar" data-noswipe="">
        <select className="links-filtro" value={filtro} onChange={e => setFiltro(e.target.value)} title="Mostra solo le viste di una visione">
          <option value="">Tutte le visioni</option>
          {visioniMenu.map(v => <option key={v.id} value={v.id}>{IS_KB.test(v.titolo || '') ? '📚 ' : ''}{v.titolo}</option>)}
        </select>
        <span className="links-stat">{nodes.length} viste · {edges.length} collegamenti</span>
        <button className={'pillbtn' + (!showIsolated ? ' on' : '')} title="Mostra solo le viste collegate (nascondi quelle isolate)"
          onClick={() => setShowIsolated(s => !s)}>{showIsolated ? '🔗 Solo link' : '👁 Solo link'}</button>
        <button className="pillbtn" title="Reimposta vista" onClick={resetView}>⌂ Centra</button>
      </div>

      <svg className="links-svg" width={size.w} height={size.h} data-noswipe=""
        onPointerDown={onBgPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel}
        style={{ touchAction: 'none' }}>
        <g transform={`translate(${size.w / 2 + view.x} ${size.h / 2 + view.y}) scale(${view.k})`}>
          {/* archi */}
          <g stroke="var(--border)" strokeWidth={1.4 / view.k}>
            {visEdges.map((e, i) => {
              const a = pos(e.source), b = pos(e.target)
              const on = hover && (hover === e.source || hover === e.target)
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={on ? 'var(--green-bright)' : 'var(--border)'}
                strokeOpacity={on ? 0.95 : 0.5} strokeWidth={(on ? 2.2 : 1.4) / view.k} />
            })}
          </g>
          {/* nodi */}
          {visible.map(n => {
            const p = pos(n.id)
            const r = 7 + Math.min(16, n.deg * 2.2)
            const dim = hover && hover !== n.id && !visEdges.some(e => (e.source === hover && e.target === n.id) || (e.target === hover && e.source === n.id))
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.28 : 1 }}
                onPointerDown={e => onNodePointerDown(e, n.id)}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(h => h === n.id ? null : h)}
                onDoubleClick={() => onOpen?.(viste.find(v => v.id === n.id))}
                onClick={e => { /* singolo click: evita apertura accidentale dopo drag */ }}>
                <circle r={r} fill={n.color} stroke="var(--bg)" strokeWidth={2 / view.k} />
                <circle r={Math.max(2, r * 0.34)} fill="var(--bg)" opacity={0.35} />
                <text y={r + 12 / view.k} textAnchor="middle"
                  fontSize={12 / view.k} fill="var(--text)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {n.titolo.length > 22 ? n.titolo.slice(0, 21) + '…' : n.titolo}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {hover && (() => {
        const n = nodes.find(x => x.id === hover); if (!n) return null
        return <div className="links-tip" data-noswipe="">
          <b>{n.titolo}</b>
          <span>{visName(n.visione)} · {n.deg} collegament{n.deg === 1 ? 'o' : 'i'}</span>
          <span className="links-tip-hint">doppio click per aprire</span>
        </div>
      })()}
    </div>
  )
}
