import test from 'node:test'
import assert from 'node:assert/strict'

// Finestra finta: il modulo usa document/window solo per capire i bordi
// dell'area scorrevole e per il ciclo di animazione.
const frames = []
globalThis.document = { scrollingElement: null, documentElement: null, body: null }
globalThis.window = { innerHeight: 800 }
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length }
globalThis.cancelAnimationFrame = () => {}

const { edgeScroll, stopEdgeScroll } = await import('./edgescroll.js')

// scorrevole alto 600px che parte a y=100 (come .content sotto la barra dell'app)
const fakeScroller = () => ({
  scrollTop: 1000,
  getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
})

// esegue n cicli di animazione (il modulo ne accoda uno alla volta)
const run = (n) => { for (let i = 0; i < n; i++) frames.pop()?.() }

test('al centro non scorre', () => {
  const sc = fakeScroller()
  edgeScroll(400, sc); run(1)
  assert.equal(sc.scrollTop, 1000)
  stopEdgeScroll(); frames.length = 0
})

test('vicino al bordo basso scorre in giù, e più forte a filo di bordo', () => {
  const sc = fakeScroller()
  edgeScroll(640, sc); run(1)          // appena dentro la fascia
  const lento = sc.scrollTop - 1000
  sc.scrollTop = 1000
  edgeScroll(700, sc); run(1)          // a filo di bordo
  const veloce = sc.scrollTop - 1000
  assert.ok(lento > 0, 'deve scorrere verso il basso')
  assert.ok(veloce > lento, 'più vicino al bordo = più veloce')
  stopEdgeScroll(); frames.length = 0
})

test('vicino al bordo alto scorre in su', () => {
  const sc = fakeScroller()
  edgeScroll(110, sc); run(1)
  assert.ok(sc.scrollTop < 1000)
  stopEdgeScroll(); frames.length = 0
})

test('a puntatore fermo continua a scorrere (il ciclo si ri-accoda)', () => {
  const sc = fakeScroller()
  edgeScroll(700, sc); run(3)          // un solo evento, tre frame
  assert.ok(sc.scrollTop > 1000 + 24, 'deve accumulare più di un frame di scorrimento')
  stopEdgeScroll(); frames.length = 0
})

test('stopEdgeScroll ferma tutto', () => {
  const sc = fakeScroller()
  edgeScroll(700, sc); run(1)
  const dopo = sc.scrollTop
  stopEdgeScroll(); run(3)
  assert.equal(sc.scrollTop, dopo)
  frames.length = 0
})
