// Le piegature dei sottorami sopravvivono all'uscita dalla vista: qui si controlla
// che il giro scrivi → leggi torni davvero quello che era stato chiuso, che una
// vista senza rami piegati non lasci voci inutili e che uno storage che LANCIA
// (navigazione privata, quota piena) non porti giù l'editor.
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

const { leggiPiegature, scriviPiegature, prunePiegature, dropPiegature } = await import('./piegature.js')

test('quello che pieghi lo ritrovi piegato', () => {
  scriviPiegature('v1', ['b-1', 'b-7'])
  const p = leggiPiegature('v1')
  assert.ok(p instanceof Set)
  assert.deepEqual([...p].sort(), ['b-1', 'b-7'])
})

test('viste diverse non si mescolano, una vista mai piegata è vuota', () => {
  scriviPiegature('v2', ['b-9'])
  assert.deepEqual([...leggiPiegature('v1')].sort(), ['b-1', 'b-7'])
  assert.deepEqual([...leggiPiegature('v2')], ['b-9'])
  assert.equal(leggiPiegature('mai-vista').size, 0)
})

test('riaprire tutti i rami cancella la voce, non lascia scorie', () => {
  scriviPiegature('v2', [])
  assert.equal(leggiPiegature('v2').size, 0)
  assert.ok(!JSON.parse(localStorage.getItem('utree-piegature')).v2)
})

test('le viste eliminate spariscono con la potatura', () => {
  scriviPiegature('v3', ['b-3'])
  prunePiegature(new Set(['v1']))
  assert.deepEqual([...leggiPiegature('v1')].sort(), ['b-1', 'b-7'])
  assert.equal(leggiPiegature('v3').size, 0)
})

test('svuotate tutte, la chiave sparisce del tutto', () => {
  dropPiegature()
  assert.equal(localStorage.getItem('utree-piegature'), null)
  assert.equal(leggiPiegature('v1').size, 0)
})

test('storage che lancia: si legge vuoto e non si esplode', () => {
  const vero = globalThis.localStorage
  globalThis.localStorage = {
    getItem() { throw new DOMException('storage negato', 'SecurityError') },
    setItem() { throw new DOMException('quota superata', 'QuotaExceededError') },
    removeItem() { throw new Error('no') },
  }
  assert.doesNotThrow(() => scriviPiegature('v1', ['b-1']))
  assert.equal(leggiPiegature('v1').size, 0)
  assert.doesNotThrow(() => prunePiegature(new Set(['v1'])))
  assert.doesNotThrow(() => dropPiegature())
  globalThis.localStorage = vero
})
