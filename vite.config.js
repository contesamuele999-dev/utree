import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// IMPORTANTE per GitHub Pages:
// se pubblichi su https://<utente>.github.io/arbora/ lascia base = '/arbora/'
// se usi un dominio custom o un repo "user.github.io", metti base = '/'
const base = process.env.VITE_BASE || '/arbora/'

export default defineConfig({
  base,
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
