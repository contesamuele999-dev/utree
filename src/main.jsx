import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './lib/auth.jsx'
import App from './App.jsx'
import ErrorBoundary from './lib/ErrorBoundary.jsx'
import './styles/app.css'
import { loadTheme } from './lib/themes.js'

// L'app si chiamava "arbora": le chiavi salvate nel browser sono passate a
// "utree-". Al primo avvio dopo l'aggiornamento le ricopiamo, altrimenti tema,
// preferenze, cache offline e coda di sincronizzazione ripartirebbero da zero.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('arbora-')) continue
    const nuova = 'utree-' + k.slice(7)
    if (localStorage.getItem(nuova) === null) localStorage.setItem(nuova, localStorage.getItem(k))
    localStorage.removeItem(k)
  }
} catch { /* storage non disponibile: si riparte pulito */ }

loadTheme()

// L'ErrorBoundary sta FUORI da tutto: un errore di render, senza, smonta
// l'intero albero React e lascia lo schermo nero senza spiegazioni.
//
// Ma l'ErrorBoundary e' un componente React: puo' intervenire SOLO da qui in giu'.
// Se qualcosa esplode PRIMA — un import fallito, un modulo che lancia mentre viene
// valutato, `createRoot` stesso — React non monta mai e `#root` resta vuoto: la
// schermata bianca senza una riga di spiegazione. Per quel caso c'e' il try/catch
// qui sotto, che disegna a mano (senza React) la stessa via d'uscita.
try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
} catch (err) {
  console.error('[uTree] avvio fallito:', err)
  window.__utreeBootError = err
  // `mostraErroreAvvio` e' definita inline in index.html, quindi esiste sempre:
  // e' l'unico pezzo di UI che non dipende da nessun modulo caricato.
  window.mostraErroreAvvio?.(err?.message || String(err))
}
