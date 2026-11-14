import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// IMPORTANTE per GitHub Pages:
// se pubblichi su https://<utente>.github.io/utree/ lascia base = '/utree/'
// se usi un dominio custom o un repo "user.github.io", metti base = '/'
const base = process.env.VITE_BASE || '/utree/'

export default defineConfig({
  base,
  build: {
    // Le librerie (React, Supabase) cambiano di rado: tenerle in un pezzo separato
    // significa che una nuova versione dell'app non costringe a riscaricarle.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'uTree',
        short_name: 'uTree',
        description: 'Note ad albero per imprenditori: Visioni, Viste, Progresso.',
        theme_color: '#1f7a4d',
        background_color: '#0f1411',
        display: 'standalone',
        start_url: base,
        scope: base,
        // "Condividi → uTree" dal telefono: il link finisce in 📥 Da valutare (vedi App.jsx)
        share_target: { action: base, method: 'GET', params: { title: 'kb_title', text: 'kb_text', url: 'kb_url' } },
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: base + 'index.html'
      }
    })
  ]
})
