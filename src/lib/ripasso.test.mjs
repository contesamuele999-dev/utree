import test from 'node:test'
import assert from 'node:assert/strict'
import { scegliRipasso } from './ripasso.js'

const visioni = [{ id: 'kb', titolo: 'Knowledge base' }, { id: 'altro', titolo: 'Lavoro' }]
const v = (titolo, ordine, visione_id = 'kb') => ({ titolo, ordine, visione_id, blocchi: [{ text: 'x' }] })
const viste = [v('Respiro', 1), v('Meditazione', 2), v('📥 Da valutare', 0), v('Clienti', 0, 'altro'), { ...v('Vuota', 3), blocchi: [] }]
const rip = (titolo, giorno, done = true) => ({ text: `📚 Ripassa ((${titolo}))`, giorno, done })

test('prima volta: la prima vista della knowledge base, mai quelle dell\'agente o di altre visioni', () => {
  assert.equal(scegliRipasso(viste, visioni, [], '2026-11-14').titolo, 'Respiro')
})

test('un ripasso al giorno: se oggi c\'è già, niente', () => {
  assert.equal(scegliRipasso(viste, visioni, [rip('Respiro', '2026-11-14', false)], '2026-11-14'), null)
})

test('intervalli crescenti: dopo 1 ripasso torna dopo 1 giorno, dopo 2 dopo 3', () => {
  const t1 = [rip('Respiro', '2026-11-10'), rip('Meditazione', '2026-11-10'), rip('Meditazione', '2026-11-12')]
  // Respiro: 1 ripasso il 10 → scade l'11; Meditazione: 2 ripassi, ultimo il 12 → scade il 15
  assert.equal(scegliRipasso(viste, visioni, t1, '2026-11-14').titolo, 'Respiro')
  // il 15: Respiro ripassato il 10 e il 13 → scade il 16; Meditazione (ultimo il 12, 2 ripassi) scade il 15
  const t2 = [rip('Respiro', '2026-11-10'), rip('Respiro', '2026-11-13'), ...t1.slice(1)]
  assert.equal(scegliRipasso(viste, visioni, t2, '2026-11-15').titolo, 'Meditazione')
})

test('nessuna vista in scadenza → null', () => {
  const t = [rip('Respiro', '2026-11-14'), rip('Meditazione', '2026-11-14')]
  assert.equal(scegliRipasso(viste, visioni, t, '2026-11-14'), null)
})
