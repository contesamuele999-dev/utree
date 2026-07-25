import { useEffect, useMemo, useRef, useState } from 'react'
import { completamento, streak, todayKey, parseDay, riepilogoSettimana } from '../lib/today.js'

// ============================================================
// TODAY — le task della giornata.
// Il livello temporale di Arbora: le viste dicono cosa esiste,
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

export default function Today({
  task = [], tuttoLoStorico = [], visioni = [], oggi = todayKey(), proposte = [],
  giorni = [], giornoCorrente = null,
  onAdd, onToggle, onEditText, onDelete, onReorder, onOpenOrigine, onAccettaProposta,
  onApriRicorrenti, onRendiRicorrente, onChiudiGiornata,
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
  const [riordinaFatte, setRiordinaFatte] = useState(false)
  const nuovaRef = useRef(null)
  const editRef = useRef(null)

  const diOggi = useMemo(
    () => task.filter(t => t && t.giorno === oggi).sort((a, b) => (a.ordine || 0) - (b.ordine || 0)),
    [task, oggi]
  )
  const lista = useMemo(() => {
    if (!riordinaFatte) return diOggi
    return [...diOggi].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  }, [diOggi, riordinaFatte])

  const { done, tot, pct } = completamento(diOggi)
  const serie = useMemo(() => streak(tuttoLoStorico.length ? tuttoLoStorico : task, oggi),
    [tuttoLoStorico, task, oggi])

  const visById = useMemo(() => new Map(visioni.map(v => [v.id, v])), [visioni])
  const sett = useMemo(
    () => riepilogoSettimana(tuttoLoStorico.length ? tuttoLoStorico : task, giorni, oggi),
    [tuttoLoStorico, task, giorni, oggi]
  )

  useEffect(() => { if (editId && editRef.current) editRef.current.focus() }, [editId])
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

  // --- riordino: stessa gestualità di Pipe (handle ⠿ + linea di rilascio) ---
  const onDrop = (target) => {
    if (dragId && dragId !== target.id) onReorder?.(dragId, target.id)
    setDragId(null); setOverId(null)
  }

  return (
    <div className="today">
      <div className="section-head">
        <h2>Today</h2>
        <span className="crumb">{dataLunga(oggi)}</span>
        <div className="spacer" />
        {tot > 0 && <span className="crumb">{done}/{tot}</span>}
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
        {lista.map(t => {
          const vis = t.vista_id ? visById.get(t.visione_id) : null
          return (
            <li key={t.id}
              className={'today-item'
                + (t.done ? ' done' : '')
                + (dragId === t.id ? ' dragging' : '')
                + (overId === t.id && dragId && dragId !== t.id ? ' over' : '')}
              onDragOver={e => { if (dragId) { e.preventDefault(); setOverId(t.id) } }}
              onDragLeave={() => setOverId(id => id === t.id ? null : id)}
              onDrop={e => { e.preventDefault(); onDrop(t) }}>

              <span className="drag-handle" title="Trascina per riordinare"
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(t.id) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}>⠿</span>

              <label className="today-check">
                <input type="checkbox" checked={!!t.done} onChange={() => onToggle?.(t)}
                  aria-label={t.done ? 'Segna come da fare' : 'Segna come completata'} />
                <span className="today-box" />
              </label>

              {editId === t.id ? (
                <input className="today-edit" ref={editRef} value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onBlur={confermaEdit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); confermaEdit() }
                    else if (e.key === 'Escape') { setEditId(null); setEditText('') }
                  }} />
              ) : (
                <span className="today-text"
                  onClick={() => { setEditId(t.id); setEditText(t.text || '') }}
                  title="Clicca per modificare">{t.text || 'Senza testo'}</span>
              )}

              <div className="today-badges">
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
              else if (e.key === 'Escape') { setNuova(''); e.currentTarget.blur() }
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
