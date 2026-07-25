import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './lib/auth.jsx'
import App from './App.jsx'
import ErrorBoundary from './lib/ErrorBoundary.jsx'
import './styles/app.css'
import { loadTheme } from './lib/themes.js'

loadTheme()

// L'ErrorBoundary sta FUORI da tutto: un errore di render, senza, smonta
// l'intero albero React e lascia lo schermo nero senza spiegazioni.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
