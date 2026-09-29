// Conversione markdown <-> blocchi del server MCP.
// È il punto delicato: gli id dei blocchi sono l'aggancio delle task
// teletrasportate in Today e degli eventi su Google Calendar. Se una
// riscrittura li rigenera tutti, quei legami si spezzano in silenzio.
import test from 'node:test'
import assert from 'node:assert/strict'
import { blocchiInTesto, testoInBlocchi, dataLocale, TOOLS } from '../../scripts/mcp-server.mjs'

test('la data resta quella locale anche a mezzanotte e mezza (niente slittamento UTC)', () => {
  assert.equal(dataLocale(new Date(2026, 8, 29, 0, 30)), '2026-09-29')
  assert.equal(dataLocale(new Date(2026, 8, 29, 23, 59)), '2026-09-29')
})

test('una riga = un blocco, due spazi = un livello di rientro', () => {
  const b = testoInBlocchi('# Titolo\n- primo\n  - annidato\n\t- con tab')
  assert.deepEqual(b.map(x => x.text), ['# Titolo', '- primo', '- annidato', '- con tab'])
  assert.deepEqual(b.map(x => x.indent || 0), [0, 0, 1, 1])
  assert.ok(b.every(x => typeof x.id === 'string' && x.id.length > 1))
})

test('andata e ritorno: il testo torna identico', () => {
  const testo = '# Roadmap\n1. MVP\n  dettaglio\n2. Mappa'
  assert.equal(blocchiInTesto(testoInBlocchi(testo)), testo)
})

test('le righe finali vuote non diventano blocchi', () => {
  assert.equal(testoInBlocchi('una riga\n\n\n').length, 1)
})

test('riscrivendo, le righe invariate tengono il loro id', () => {
  const prima = testoInBlocchi('# Piano\n- passo uno\n- passo due')
  const dopo = testoInBlocchi('# Piano\n- passo uno cambiato\n- passo due', prima)
  assert.equal(dopo[0].id, prima[0].id, 'il titolo non è cambiato: stesso id')
  assert.equal(dopo[2].id, prima[2].id, 'riga spostata ma identica: stesso id')
  assert.notEqual(dopo[1].id, prima[1].id, 'riga riscritta: id nuovo')
})

test('una riga invariata conserva anche scadenza e immagini', () => {
  const prima = [{ id: 'b1', text: 'chiamare il commercialista', due: '2026-09-30', imgs: ['x'] }]
  const dopo = testoInBlocchi('chiamare il commercialista', prima)
  assert.equal(dopo[0].id, 'b1')
  assert.equal(dopo[0].due, '2026-09-30')
  assert.deepEqual(dopo[0].imgs, ['x'])
})

test('togliere il rientro toglie davvero il campo indent', () => {
  const prima = testoInBlocchi('  rientrata')
  assert.equal(prima[0].indent, 1)
  assert.equal(testoInBlocchi('rientrata', prima)[0].indent, undefined)
})

test('ogni strumento MCP ha nome, descrizione e schema', () => {
  assert.ok(TOOLS.length >= 15)
  for (const t of TOOLS) {
    assert.match(t.name, /^utree_[a-z_]+$/)
    assert.ok(t.description.length > 20, `${t.name}: descrizione troppo scarna`)
    assert.equal(t.inputSchema.type, 'object')
    assert.equal(typeof t.run, 'function')
  }
  assert.equal(new Set(TOOLS.map(t => t.name)).size, TOOLS.length, 'nomi duplicati')
})
