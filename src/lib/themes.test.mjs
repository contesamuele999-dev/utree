// Regressione: uTree si apriva ogni tanto su una schermata BIANCA.
// `loadTheme()` gira nel modulo di avvio, PRIMA che React monti. Toccava
// localStorage senza rete di protezione: in navigazione privata, con lo storage
// negato o — il caso vero — con la quota piena, `getItem`/`setItem` LANCIANO.
// L'eccezione fermava la valutazione di main.jsx prima di `createRoot().render()`:
// niente React, niente ErrorBoundary, `#root` vuoto. Pagina bianca, zero indizi.
// Qui il tema si carica con uno storage che lancia sempre: deve solo funzionare.
import test from 'node:test'
import assert from 'node:assert/strict'

const stiloFinto = () => ({ setProperty() {}, colorScheme: '', background: '' })
globalThis.document = {
  documentElement: { style: stiloFinto() },
  body: { style: stiloFinto() },
}
globalThis.localStorage = {
  getItem() { throw new DOMException('storage negato', 'SecurityError') },
  setItem() { throw new DOMException('quota superata', 'QuotaExceededError') },
  removeItem() { throw new Error('no') },
}

const { loadTheme, applyTheme, THEMES } = await import('./themes.js')

test('loadTheme non lancia se lo storage lancia', () => {
  assert.doesNotThrow(() => loadTheme())
})

test('senza storage si parte comunque da un tema valido', () => {
  const id = loadTheme()
  assert.ok(THEMES[id], `"${id}" non e' un tema conosciuto`)
})

test('applyTheme non lancia se setItem lancia', () => {
  assert.doesNotThrow(() => applyTheme('notte'))
})
