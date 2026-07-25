import { useMemo, useState } from 'react'
import { prossimeOccorrenze, todayKey, parseDay } from '../lib/today.js'

// ============================================================
// RICORRENTI — pannello delle regole che generano task ripetute.
// Una regola non è una task: produce istanze reali in Today, una
// per giorno di occorrenza. Per questo disattivare o cancellare
// una regola non tocca lo storico già generato.
// ============================================================

const TIPI = [
  { id: 'giornaliera', label: 'Ogni giorno' },
  { id: 'settimanale', label: 'Giorni della settimana' },
  { id: 'mensile', label: 'Giorni del mese' },
  { id: 'intervallo', label: 'Ogni N giorni' },
]
// 0 = domenica, come Date.getDay(); mostrati però a partire da lunedì
const DOW = [
  { n: 1, l: 'lun' }, { n: 2, l: 'mar' }, { n: 3, l: 'mer' }, { n: 4, l: 'gio' },
  { n: 5, l: 'ven' }, { n: 6, l: 'sab' }, { n: 0, l: 'dom' },
]
const MESI_ABBR = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const dataBreve = (k) => { const d = parseDay(k); return d ? `${d.getDate()} ${MESI_ABBR[d.getMonth()]}` : k }

function regolaVuota(text = '') {
  return { text, tipo: 'giornaliera', giorni: [], ogni: 2, dal: todayKey(), al: null, attiva: true }
}

// Riassunto leggibile della regola, per l'elenco.
export function descriviRegola(r) {
  switch (r.tipo) {
    case 'giornaliera': return 'ogni giorno'
    case 'settimanale': {
      const g = DOW.filter(d => (r.giorni || []).includes(d.n)).map(d => d.l)
      return g.length ? g.join(' · ') : 'nessun giorno scelto'
    }
    case 'mensile': {
      const g = [...(r.giorni || [])].sort((a, b) => a - b)
      return g.length ? 'il ' + g.join(', ') + ' del mese' : 'nessun giorno scelto'
    }
    case 'intervallo': return `ogni ${r.ogni || 1} giorni`
    default: return ''
  }
}

export default function Ricorrenti({ regole = [], iniziale, tenuta = [], onSave, onDelete, onClose }) {
  // `iniziale` (facoltativo) = testo con cui aprire già il modulo di creazione,
  // usato da "Rendi ricorrente" su una task esistente.
  const [bozza, setBozza] = useState(iniziale ? regolaVuota(iniziale) : null)

  const anteprima = useMemo(
    () => bozza ? prossimeOccorrenze(bozza, todayKey(), 5) : [],
    [bozza]
  )
  const tenutaById = useMemo(() => new Map(tenuta.map(t => [t.id, t])), [tenuta])

  const set = (patch) => setBozza(b => ({ ...b, ...patch }))
  const toggleGiorno = (n) => set({
    giorni: (bozza.giorni || []).includes(n)
      ? bozza.giorni.filter(x => x !== n)
      : [...(bozza.giorni || []), n],
  })

  const valida = bozza && bozza.text.trim() &&
    (bozza.tipo === 'giornaliera' || bozza.tipo === 'intervallo' || (bozza.giorni || []).length > 0)

  return (
    <div className="due-scrim due-scrim-center" onClick={onClose}>
      <div className="ric-pop" onClick={e => e.stopPropagation()}>
        <div className="ric-head">
          <h3>↻ Task ricorrenti</h3>
          <div className="spacer" />
          <button className="iconbtn" title="Chiudi" onClick={onClose}>✕</button>
        </div>

        <p className="ric-nota">
          Le ricorrenti non vengono mai rimandate: se salti un giorno, domani arriva
          l’istanza nuova invece di accumulare arretrati.
        </p>

        {/* ---- elenco delle regole ---- */}
        <div className="ric-list">
          {regole.map(r => {
            const t = tenutaById.get(r.id)
            return (
              <div key={r.id} className={'ric-row' + (r.attiva === false ? ' spenta' : '')}>
                <div className="ric-row-main">
                  <span className="ric-text">{r.text || 'Senza testo'}</span>
                  <span className="crumb">{descriviRegola(r)}</span>
                </div>
                {t && t.generate > 0 && (
                  <span className="ric-tenuta" title={`${t.chiuse} chiuse su ${t.generate} generate`}>
                    {t.pct}%
                  </span>
                )}
                <button className={'iconbtn mini' + (r.attiva !== false ? ' on' : '')}
                  title={r.attiva !== false ? 'Sospendi: smette di generare nuove istanze' : 'Riattiva'}
                  onClick={() => onSave({ ...r, attiva: r.attiva === false })}>
                  {r.attiva !== false ? '⏸' : '▶'}
                </button>
                <button className="iconbtn mini" title="Modifica" onClick={() => setBozza({ ...r })}>✎</button>
                <button className="iconbtn mini danger"
                  title="Elimina la regola (le task già create restano nello storico)"
                  onClick={() => onDelete(r)}>🗑</button>
              </div>
            )
          })}
          {!regole.length && !bozza && (
            <div className="vista-empty">Nessuna regola. Le abitudini si costruiscono una alla volta.</div>
          )}
        </div>

        {/* ---- modulo nuova/modifica ---- */}
        {bozza ? (
          <div className="ric-form">
            <input className="input" autoFocus placeholder="Cosa si ripete?"
              value={bozza.text} onChange={e => set({ text: e.target.value })} />

            <div className="ric-tipi">
              {TIPI.map(t => (
                <button key={t.id} className={'pillbtn' + (bozza.tipo === t.id ? ' on' : '')}
                  onClick={() => set({ tipo: t.id })}>{t.label}</button>
              ))}
            </div>

            {bozza.tipo === 'settimanale' && (
              <div className="ric-giorni">
                {DOW.map(d => (
                  <button key={d.n} className={'pillbtn mini' + ((bozza.giorni || []).includes(d.n) ? ' on' : '')}
                    onClick={() => toggleGiorno(d.n)}>{d.l}</button>
                ))}
              </div>
            )}

            {bozza.tipo === 'mensile' && (
              <>
                <div className="ric-giorni ric-mese">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(n => (
                    <button key={n} className={'pillbtn mini' + ((bozza.giorni || []).includes(n) ? ' on' : '')}
                      onClick={() => toggleGiorno(n)}>{n}</button>
                  ))}
                </div>
                <p className="ric-hint">Nei mesi più corti l’occorrenza cade sull’ultimo giorno: il 31 non si salta mai.</p>
              </>
            )}

            {bozza.tipo === 'intervallo' && (
              <label className="ric-campo">
                Ogni
                <input className="input mini" type="number" min="1" max="365" value={bozza.ogni}
                  onChange={e => set({ ogni: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                giorni, a partire dal {dataBreve(bozza.dal)}
              </label>
            )}

            <div className="ric-periodo">
              <label className="ric-campo">Dal
                <input className="input mini" type="date" value={bozza.dal || ''}
                  onChange={e => set({ dal: e.target.value })} />
              </label>
              <label className="ric-campo">Al (facoltativo)
                <input className="input mini" type="date" value={bozza.al || ''}
                  onChange={e => set({ al: e.target.value || null })} />
              </label>
            </div>

            <div className="ric-anteprima">
              <span className="crumb">Prossime occorrenze:</span>
              {anteprima.length
                ? anteprima.map(k => <span key={k} className="ric-chip">{dataBreve(k)}</span>)
                : <span className="crumb">nessuna — controlla i giorni scelti</span>}
            </div>

            <div className="due-pop-row">
              <button className="pillbtn" onClick={() => setBozza(null)}>Annulla</button>
              <button className="btn" disabled={!valida}
                onClick={() => { onSave(bozza); setBozza(null) }}>
                {bozza.id ? 'Salva' : 'Crea regola'}
              </button>
            </div>
          </div>
        ) : (
          <button className="add-btn" onClick={() => setBozza(regolaVuota())}>＋ Nuova regola</button>
        )}
      </div>
    </div>
  )
}
