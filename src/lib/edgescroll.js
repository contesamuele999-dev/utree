// Auto-scorrimento ai bordi durante un trascinamento.
// Avvicinando il puntatore (dito, pennino o mouse) al bordo alto/basso dell'area
// scorrevole, la lista scorre da sola: tanto più veloce quanto più si è vicini al
// bordo. Serve per spostare una riga molto più su/giù di quanto sia visibile.
//
// Perché un ciclo rAF e non lo spostamento a ogni evento: fermando il dito (o il
// mouse durante un drag HTML5) gli eventi smettono di arrivare, e con essi lo
// scorrimento. Il ciclo continua finché il puntatore resta nella fascia.

const EDGE = 120   // altezza della fascia sensibile, in px
const MAX = 24     // px per frame al massimo (~1400 px/s a 60fps)

let raf = 0
let y = null
let getScroller = null

const boundsOf = (sc) => (
  sc === document.scrollingElement || sc === document.documentElement || sc === document.body
    ? { top: 0, bottom: window.innerHeight }
    : sc.getBoundingClientRect()
)

function step() {
  const sc = getScroller?.()
  if (y == null || !sc) { raf = 0; return }
  const r = boundsOf(sc)
  let f = 0
  if (y < r.top + EDGE) f = (y - r.top - EDGE) / EDGE            // negativo → verso l'alto
  else if (y > r.bottom - EDGE) f = (y - r.bottom + EDGE) / EDGE  // positivo → verso il basso
  f = Math.max(-1, Math.min(1, f))
  // f*f: partenza dolce all'ingresso nella fascia, massima velocità a filo di bordo
  if (f) sc.scrollTop += Math.sign(f) * MAX * f * f
  raf = requestAnimationFrame(step)
}

/** Aggiorna la posizione del puntatore e avvia (se serve) il ciclo di scorrimento. */
export function edgeScroll(clientY, scroller) {
  y = clientY
  getScroller = typeof scroller === 'function' ? scroller : () => scroller
  if (!raf) raf = requestAnimationFrame(step)
}

/** Ferma il ciclo: da chiamare a fine trascinamento. */
export function stopEdgeScroll() {
  y = null
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}
