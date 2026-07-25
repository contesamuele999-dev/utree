import { useEffect, useMemo, useRef, useState } from 'react'
import { getActivity } from '../lib/activity.js'
import { bucketize, streak, oreDiChiusura, tassoDiRinvio, tenutaRicorrenti, heatmapAnno, todayKey } from '../lib/today.js'

// ============================================================
// STATISTICHE — quante viste crei e quanti caratteri scrivi,
// su base giornaliera · mensile · annuale. Utile per capire
// i tuoi periodi più creativi. Grafici SVG, nessuna dipendenza.
// ============================================================
const p2 = (n) => String(n).padStart(2, '0')
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

export default function Stats({ viste, task = [], regole = [], giorni = [] }) {
  const [range, setRange] = useState('day')   // day | month | year
  const [sezione, setSezione] = useState('scrittura')   // scrittura | today
  const activity = useMemo(() => getActivity(), [])

  const data = useMemo(() => {
    const items = (viste || []).filter(v => !v.is_template && v.created_at)
    const notesByDay = {}
    for (const v of items) {
      const d = new Date(v.created_at)
      if (isNaN(d)) continue
      const k = dayKey(d)
      notesByDay[k] = (notesByDay[k] || 0) + 1
    }
    const charsByDay = {}
    for (const [k, val] of Object.entries(activity)) charsByDay[k] = val.chars || 0

    const buckets = []
    const now = new Date()
    if (range === 'day') {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i)
        const k = dayKey(d)
        buckets.push({ key: k, label: `${d.getDate()}/${d.getMonth() + 1}`, notes: notesByDay[k] || 0, chars: charsByDay[k] || 0 })
      }
    } else if (range === 'month') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const pref = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`
        let notes = 0, chars = 0
        for (const [k, n] of Object.entries(notesByDay)) if (k.startsWith(pref)) notes += n
        for (const [k, c] of Object.entries(charsByDay)) if (k.startsWith(pref)) chars += c
        buckets.push({ key: pref, label: `${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, notes, chars })
      }
    } else {
      const years = new Set()
      Object.keys(notesByDay).forEach(k => years.add(k.slice(0, 4)))
      Object.keys(charsByDay).forEach(k => years.add(k.slice(0, 4)))
      years.add(String(now.getFullYear()))
      ;[...years].sort().forEach(y => {
        let notes = 0, chars = 0
        for (const [k, n] of Object.entries(notesByDay)) if (k.startsWith(y)) notes += n
        for (const [k, c] of Object.entries(charsByDay)) if (k.startsWith(y)) chars += c
        buckets.push({ key: y, label: y, notes, chars })
      })
    }

    const totNotes = buckets.reduce((s, b) => s + b.notes, 0)
    const totChars = buckets.reduce((s, b) => s + b.chars, 0)
    const bestNotes = buckets.reduce((a, b) => (b.notes > (a?.notes || 0) ? b : a), null)
    const bestChars = buckets.reduce((a, b) => (b.chars > (a?.chars || 0) ? b : a), null)
    return { buckets, totNotes, totChars, bestNotes, bestChars }
  }, [viste, activity, range])

  if (sezione === 'today') {
    return (
      <div className="stats">
        <div className="stats-range">
          <button className="chip" onClick={() => setSezione('scrittura')}>Scrittura</button>
          <button className="chip active">Today</button>
        </div>
        <StatsToday task={task} regole={regole} giorni={giorni} />
      </div>
    )
  }

  return (
    <div className="stats">
      <div className="stats-range" style={{ marginBottom: 4 }}>
        <button className="chip active">Scrittura</button>
        <button className="chip" onClick={() => setSezione('today')}>Today</button>
      </div>
      <div className="stats-range">
        {[['day', 'Giorno'], ['month', 'Mese'], ['year', 'Anno']].map(([id, lbl]) => (
          <button key={id} className={'chip' + (range === id ? ' active' : '')} onClick={() => setRange(id)}>{lbl}</button>
        ))}
      </div>

      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-num">{data.totNotes}</div>
          <div className="stat-lbl">viste create</div>
          {data.bestNotes?.notes > 0 && <div className="stat-sub">picco: {data.bestNotes.label} ({data.bestNotes.notes})</div>}
        </div>
        <div className="stat-card">
          <div className="stat-num">{data.totChars.toLocaleString('it-IT')}</div>
          <div className="stat-lbl">lettere scritte</div>
          {data.bestChars?.chars > 0 && <div className="stat-sub">picco: {data.bestChars.label} ({data.bestChars.chars.toLocaleString('it-IT')})</div>}
        </div>
      </div>

      <Chart title="Viste create" color="var(--green-bright)" buckets={data.buckets} field="notes" best={data.bestNotes?.key} />
      <Chart title="Lettere scritte" color="var(--accent)" buckets={data.buckets} field="chars" best={data.bestChars?.key} />

      <p className="stats-note">Le viste create si basano sulla data di creazione. Le lettere scritte vengono registrate su questo dispositivo a partire dal loro monitoraggio: lo storico cresce con l’uso.</p>
    </div>
  )
}

// ============================================================
// STORICO DI TODAY — quanto e quando porti a casa le cose.
// I bucket senza dati non sono zeri: sono "non c'era niente".
// Vengono disegnati tratteggiati, così la storia non mente.
// ============================================================
function StatsToday({ task, regole, giorni }) {
  const [range, setRange] = useState('day')   // day | week | month | year
  const oggi = todayKey()

  const buckets = useMemo(() => bucketize(task, range, oggi), [task, range, oggi])
  const serie = useMemo(() => streak(task, oggi), [task, oggi])
  const ore = useMemo(() => oreDiChiusura(task), [task])
  const tenuta = useMemo(() => tenutaRicorrenti(task, regole), [task, regole])
  const heat = useMemo(() => heatmapAnno(task, oggi), [task, oggi])

  const chiuse = task.filter(t => t.done).length
  const rinvii = tassoDiRinvio(task)
  const oraTop = ore.indexOf(Math.max(...ore))
  const moods = giorni.map(g => g.mood).filter(m => typeof m === 'number' && m >= 1)
  const moodMedio = moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null

  if (!task.length) {
    return <p className="stats-note">Lo storico di Today comincia con la prima task. Non c’è ancora nulla da mostrare — è normale.</p>
  }

  return (
    <>
      <div className="stats-range">
        {[['day', 'Giorni'], ['week', 'Settimane'], ['month', 'Mesi'], ['year', 'Anni']].map(([id, lbl]) => (
          <button key={id} className={'chip' + (range === id ? ' active' : '')} onClick={() => setRange(id)}>{lbl}</button>
        ))}
      </div>

      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-num">{chiuse}</div>
          <div className="stat-lbl">task completate</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{serie.attuale}</div>
          <div className="stat-lbl">giorni di serie</div>
          {serie.record > 0 && <div className="stat-sub">record: {serie.record}</div>}
        </div>
        <div className="stat-card">
          <div className="stat-num">{Math.max(...ore) > 0 ? `${oraTop}:00` : '—'}</div>
          <div className="stat-lbl">ora tipica di chiusura</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{rinvii}%</div>
          <div className="stat-lbl">task rimandate</div>
          {moodMedio && <div className="stat-sub">umore medio {moodMedio}/5</div>}
        </div>
      </div>

      <ChartTask title="Task completate" buckets={buckets} />
      <Heatmap heat={heat} />

      {Math.max(...ore) > 0 && (
        <div className="chart">
          <div className="chart-title">Quando chiudi le task</div>
          <div className="chart-scroll" data-noswipe="scroll">
            <svg width={24 * 26} height={110} className="chart-svg">
              {ore.map((n, h) => {
                const max = Math.max(1, ...ore)
                const H = 110, PADB = 20
                const x = (h + 0.5) * 26
                const alt = (n / max) * (H - PADB - 8)
                return (
                  <g key={h}>
                    <rect x={x - 8} y={H - PADB - alt} width={16} height={Math.max(alt, n ? 2 : 0)} rx="3"
                      fill={n ? 'var(--accent)' : 'transparent'} />
                    {h % 3 === 0 && <text x={x} y={H - 5} textAnchor="middle" className="chart-lbl">{h}</text>}
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      )}

      {tenuta.some(t => t.generate > 0) && (
        <div className="chart">
          <div className="chart-title">Tenuta delle ricorrenti</div>
          <div className="tenuta-list">
            {tenuta.filter(t => t.generate > 0).sort((a, b) => b.pct - a.pct).map(t => (
              <div key={t.id} className="tenuta-row">
                <span className="tenuta-text">{t.text}</span>
                <div className="tenuta-bar"><div className="tenuta-fill" style={{ width: `${t.pct}%` }} /></div>
                <span className="crumb">{t.chiuse}/{t.generate}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="stats-note">
        I periodi senza dati sono tratteggiati: “nessuna task pianificata” non è la stessa cosa di “nessuna task fatta”.
      </p>
    </>
  )
}

function ChartTask({ title, buckets }) {
  const max = Math.max(1, ...buckets.map(b => b.tot))
  const W = Math.max(320, buckets.length * 26)
  const H = 140, PADB = 22
  const bw = (W / buckets.length) * 0.62
  const scrollRef = useRef(null)
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollLeft = el.scrollWidth }, [W, buckets.length])

  return (
    <div className="chart">
      <div className="chart-title">{title}</div>
      <div className="chart-scroll" data-noswipe="scroll" ref={scrollRef}>
        <svg width={W} height={H} className="chart-svg">
          {buckets.map((b, i) => {
            const x = (i + 0.5) * (W / buckets.length)
            const hTot = (b.tot / max) * (H - PADB - 10)
            const hDone = (b.done / max) * (H - PADB - 10)
            if (!b.hasData) {
              // nessun dato: contorno tratteggiato all'altezza minima
              return (
                <g key={b.key}>
                  <rect x={x - bw / 2} y={H - PADB - 6} width={bw} height={6} rx="2"
                    fill="none" stroke="var(--border)" strokeDasharray="2 2" />
                  <text x={x} y={H - 6} textAnchor="middle" className="chart-lbl">{b.label}</text>
                </g>
              )
            }
            return (
              <g key={b.key}>
                <rect x={x - bw / 2} y={H - PADB - hTot} width={bw} height={Math.max(hTot, 2)} rx="3"
                  fill="color-mix(in srgb, var(--green-bright) 22%, var(--panel-2))" />
                <rect x={x - bw / 2} y={H - PADB - hDone} width={bw} height={Math.max(hDone, b.done ? 2 : 0)} rx="3"
                  fill="var(--green-bright)" />
                {b.done > 0 && <text x={x} y={H - PADB - hDone - 3} textAnchor="middle" className="chart-val">{b.done}</text>}
                <text x={x} y={H - 6} textAnchor="middle" className="chart-lbl">{b.label}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// Heatmap annuale: la continuità si vede meglio di qualunque numero.
function Heatmap({ heat }) {
  const CELL = 11, GAP = 2
  const max = Math.max(1, ...heat.celle.map(c => c.done))
  const W = heat.settimane * (CELL + GAP)
  const scrollRef = useRef(null)
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollLeft = el.scrollWidth }, [W])

  return (
    <div className="chart">
      <div className="chart-title">Un anno di giornate</div>
      <div className="chart-scroll" data-noswipe="scroll" ref={scrollRef}>
        <svg width={W} height={7 * (CELL + GAP)} className="chart-svg">
          {heat.celle.map(c => {
            const intensita = c.done / max
            return (
              <rect key={c.key} x={c.col * (CELL + GAP)} y={c.row * (CELL + GAP)}
                width={CELL} height={CELL} rx="2.5"
                fill={c.done
                  ? `color-mix(in srgb, var(--green-bright) ${Math.round(25 + intensita * 75)}%, var(--panel))`
                  : (c.hasData ? 'var(--panel-2)' : 'transparent')}
                stroke={c.hasData ? 'none' : 'var(--border)'}
                strokeDasharray={c.hasData ? undefined : '1 2'}>
                <title>{c.key}: {c.hasData ? `${c.done}/${c.tot}` : 'nessun dato'}</title>
              </rect>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function Chart({ title, color, buckets, field, best }) {
  const max = Math.max(1, ...buckets.map(b => b[field]))
  const W = Math.max(320, buckets.length * 26)
  const H = 140, PADB = 22
  const bw = (W / buckets.length) * 0.62
  const scrollRef = useRef(null)

  // di default lo scroll mostra i dati più recenti (a destra), non l'inizio della serie
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [W, buckets.length])

  return (
    <div className="chart">
      <div className="chart-title">{title}</div>
      <div className="chart-scroll" data-noswipe="scroll" ref={scrollRef}>
        <svg width={W} height={H} className="chart-svg">
          {buckets.map((b, i) => {
            const x = (i + 0.5) * (W / buckets.length)
            const h = (b[field] / max) * (H - PADB - 10)
            const y = H - PADB - h
            return (
              <g key={b.key}>
                <rect x={x - bw / 2} y={y} width={bw} height={Math.max(h, b[field] ? 2 : 0)} rx="3"
                  fill={b.key === best && b[field] > 0 ? color : `color-mix(in srgb, ${color} 45%, var(--panel-2))`} />
                {b[field] > 0 && <text x={x} y={y - 3} textAnchor="middle" className="chart-val">{b[field]}</text>}
                <text x={x} y={H - 6} textAnchor="middle" className="chart-lbl">{b.label}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
