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
let topInset = 0   // altezza delle barre ancorate in cima all'area scorrevole

const boundsOf = (sc) => (
  sc === document.scrollingElement || sc === document.documentElement || sc === document.body
    ? { top: 0, bottom: window.innerHeight }
    : sc.getBoundingClientRect()
)

// Le barre di pulsanti ancorate (position: sticky, in cima) coprono la parte alta
// dell'area scorrevole: se la fascia sensibile partisse dal bordo del contenitore
// resterebbe nascosta sotto la barra, e per far risalire la lista bisognerebbe
// arrivare fin sopra i pulsanti. La misuriamo e facciamo partire la fascia da lì.
function misuraTopInset(sc) {
  let inset = 0
  const scan = (el, prof) => {
    const larghezza = el.getBoundingClientRect().width || 1
    for (const ch of el.children) {
      const rect = ch.getBoundingClientRect()
      if (!rect.height) continue
      const stile = getComputedStyle(ch)
      const ancorata = stile.position === 'sticky' || stile.position === 'fixed'
      // solo le barre vere: ancorate in cima (top ≈ 0) e larghe quanto il loro contenitore.
      // Escluse così le manigliette ancorate a lato, che non coprono la lista.
      // L'altezza si somma allo scarto CSS, non si legge dal rettangolo: a lista non
      // ancora scorsa la barra è più in basso, ma quando serve si incolla lì in cima.
      const scarto = parseFloat(stile.top)
      if (ancorata && scarto >= 0 && scarto <= 40 && rect.width >= larghezza * 0.6) {
        inset = Math.max(inset, scarto + rect.height)
      } else if (prof < 2) scan(ch, prof + 1)
    }
  }
  try { scan(sc, 0) } catch { /* elementi non ispezionabili: nessun margine */ }
  return inset
}

function step() {
  const sc = getScroller?.()
  if (y == null || !sc) { raf = 0; return }
  const r = boundsOf(sc)
  const alto = r.top + topInset   // sotto le barre ancorate, non sotto il bordo
  let f = 0
  if (y < alto + EDGE) f = (y - alto - EDGE) / EDGE               // negativo → verso l'alto
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
  if (!raf) {
    // misurato una volta per trascinamento: le barre non cambiano altezza mentre trascini
    const sc = getScroller()
    topInset = sc ? misuraTopInset(sc) : 0
    raf = requestAnimationFrame(step)
  }
}

/** Ferma il ciclo: da chiamare a fine trascinamento. */
export function stopEdgeScroll() {
  y = null
  topInset = 0
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}
