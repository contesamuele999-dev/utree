import { useEffect, useRef, useState } from 'react'

// ============================================================
// Timer Pomodoro + modalità Focus.
// Default 25+5, editabile fino a 50+10. Al cambio di fase compare un
// suggerimento; mentre gira, il tempo restante finisce anche nel titolo
// della scheda, così si vede da un'altra applicazione.
// Le durate scelte restano fra una sessione e l'altra.
// ============================================================

const PREF = 'utree-pomodoro'
const leggiPref = () => {
  try { return JSON.parse(localStorage.getItem(PREF) || '{}') } catch { return {} }
}

const clampWork = (n) => Math.min(50, Math.max(5, Math.round(n) || 25))
const clampRest = (n) => Math.min(10, Math.max(1, Math.round(n) || 5))
const due = (n) => String(n).padStart(2, '0')

export default function Pomodoro({ focusMode, onToggleFocus, onClose }) {
  const pref = useRef(leggiPref()).current
  const [open, setOpen] = useState(true)
  const [work, setWork] = useState(() => clampWork(pref.work))
  const [rest, setRest] = useState(() => clampRest(pref.rest))
  const [phase, setPhase] = useState('work')      // work | rest
  const [left, setLeft] = useState(() => clampWork(pref.work) * 60)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const durata = (f) => (f === 'work' ? work : rest) * 60

  const avvisa = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 7000)
  }

  // Cambiare le durate rimette il timer a nuovo SOLO se è fermo — e non quando
  // si mette in pausa: prima bastava premere "Pausa" per perdere il conto e
  // ritrovarsi i 25 minuti pieni.
  const primaVolta = useRef(true)
  useEffect(() => {
    try { localStorage.setItem(PREF, JSON.stringify({ work, rest })) } catch { /* quota */ }
    if (primaVolta.current) { primaVolta.current = false; return }
    if (!running) setLeft(durata(phase))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, rest])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      setLeft(l => {
        if (l > 1) return l - 1
        const next = phase === 'work' ? 'rest' : 'work'
        setPhase(next)
        avvisa(next === 'rest'
          ? '🌿 Pausa! Allontanati un attimo: il cervello rielabora meglio le idee quando stacchi.'
          : '🌱 Si riparte. Riprendi il filo con la mente fresca.')
        try { navigator.vibrate?.([80, 60, 80]) } catch { /* ignore */ }
        return (next === 'work' ? work : rest) * 60
      })
    }, 1000)
    return () => clearInterval(t)
  }, [running, phase, work, rest])

  const mm = due(Math.floor(left / 60))
  const ss = due(left % 60)

  // Il tempo restante nel titolo della scheda: si tiene d'occhio il pomodoro
  // anche mentre si lavora in un'altra finestra.
  useEffect(() => {
    const base = 'uTree'
    document.title = running ? `${mm}:${ss} ${phase === 'work' ? '🎯' : '🌿'} · ${base}` : base
    return () => { document.title = base }
  }, [running, mm, ss, phase])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const reset = () => { setRunning(false); setPhase('work'); setLeft(work * 60) }

  return (
    <>
      {toast && <div className="break-toast">{toast}</div>}
      <div className="pomodoro">
        {open ? (
          <div className="pomo-panel">
            <div className="pomo-phase">{phase === 'work' ? '🎯 Lavoro' : '🌿 Pausa'}</div>
            <div className="pomo-time">{mm}:{ss}</div>
            <div className="pomo-row">
              <button className="btn" onClick={() => setRunning(r => !r)}>{running ? 'Pausa' : 'Avvia'}</button>
              <button className="btn ghost" onClick={reset}>Reset</button>
            </div>
            <div className="pomo-cfg">
              lavoro <input type="number" value={work} min={5} max={50} disabled={running}
                title={running ? 'Ferma il timer per cambiare le durate' : 'Minuti di lavoro (5-50)'}
                onChange={e => setWork(clampWork(+e.target.value))} />
              pausa <input type="number" value={rest} min={1} max={10} disabled={running}
                title={running ? 'Ferma il timer per cambiare le durate' : 'Minuti di pausa (1-10)'}
                onChange={e => setRest(clampRest(+e.target.value))} />
            </div>
            {onToggleFocus && (
              <div className="pomo-row">
                <button className="btn ghost" onClick={onToggleFocus}>{focusMode ? 'Esci da Focus' : 'Modalità Focus'}</button>
              </div>
            )}
            <div className="pomo-row">
              <button className="link-btn" onClick={() => setOpen(false)}>riduci</button>
              {onClose && <button className="link-btn" onClick={onClose}>chiudi</button>}
            </div>
          </div>
        ) : (
          <button className="pomo-btn" onClick={() => setOpen(true)}
            title={running ? `${phase === 'work' ? 'Lavoro' : 'Pausa'} · ${mm}:${ss}` : 'Apri il timer Pomodoro'}>
            🍅 {running ? `${mm}:${ss}` : 'Pomodoro'}
          </button>
        )}
      </div>
    </>
  )
}
