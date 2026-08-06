import React from 'react'

// ============================================================
// Rete di sicurezza: senza di questa, QUALUNQUE errore durante il
// render fa smontare tutto l'albero React e lascia lo schermo nero,
// senza dire cosa è successo. Con questa, si vede l'errore, lo si
// può copiare, e i dati locali restano al sicuro.
// ============================================================
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null, info: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    this.setState({ info })
    console.error('[uTree] errore di render:', err, info?.componentStack)
  }

  copia = () => {
    const txt = [
      this.state.err?.message || String(this.state.err),
      this.state.err?.stack || '',
      this.state.info?.componentStack || '',
    ].join('\n\n')
    try { navigator.clipboard.writeText(txt) } catch { /* niente clipboard */ }
  }

  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="crash">
        <h1>Qualcosa si è rotto</h1>
        <p>
          I tuoi dati sono al sicuro: le note sono salvate in locale e sul cloud.
          Ricaricare la pagina di solito basta.
        </p>
        <pre className="crash-msg">{this.state.err?.message || String(this.state.err)}</pre>
        <details>
          <summary>Dettagli tecnici</summary>
          <pre className="crash-stack">
            {(this.state.err?.stack || '') + '\n' + (this.state.info?.componentStack || '')}
          </pre>
        </details>
        <div className="crash-row">
          <button className="btn" onClick={() => window.location.reload()}>Ricarica</button>
          <button className="pillbtn" onClick={this.copia}>Copia l’errore</button>
          <button className="pillbtn" onClick={async () => {
            // ripulisce il service worker: uno schermo nero è spesso una
            // versione vecchia in cache che punta a file non più esistenti
            try {
              const regs = await navigator.serviceWorker?.getRegistrations?.() || []
              await Promise.all(regs.map(r => r.unregister()))
              const keys = await caches?.keys?.() || []
              await Promise.all(keys.map(k => caches.delete(k)))
            } catch { /* ignora */ }
            window.location.reload()
          }}>Svuota la cache dell’app</button>
        </div>
      </div>
    )
  }
}
