// Temi predefiniti di uTree. Ogni tema sovrascrive le variabili CSS :root.
export const THEMES = {
  foresta: {
    nome: 'Foresta', emoji: '🌲',
    vars: { '--bg':'#0f1411','--bg-2':'#15201a','--panel':'#18241d','--panel-2':'#1d2e24','--border':'#2a3b30',
      '--text':'#e7f0ea','--text-dim':'#9fb4a8','--green':'#2e9e63','--green-bright':'#34d27e','--green-deep':'#1f7a4d',
      '--accent':'#6fe3a8','--bg-grad':'radial-gradient(1200px 800px at 70% -10%, #16261c 0%, #0f1411 55%)' },
  },
  notte: {
    nome: 'Notte', emoji: '🌙',
    vars: { '--bg':'#0c0e16','--bg-2':'#11131f','--panel':'#161927','--panel-2':'#1c2030','--border':'#2a2f44',
      '--text':'#e6e8f5','--text-dim':'#9aa0c0','--green':'#6c8cff','--green-bright':'#8aa2ff','--green-deep':'#4257c4',
      '--accent':'#a9b8ff','--bg-grad':'radial-gradient(1200px 800px at 70% -10%, #161b2e 0%, #0c0e16 55%)' },
  },
  oceano: {
    nome: 'Oceano', emoji: '🌊',
    vars: { '--bg':'#08161a','--bg-2':'#0d2026','--panel':'#102a31','--panel-2':'#15363f','--border':'#1f4651',
      '--text':'#e2f3f6','--text-dim':'#92b8c0','--green':'#1fb6c9','--green-bright':'#36d6e8','--green-deep':'#127a8a',
      '--accent':'#6fe6f3','--bg-grad':'radial-gradient(1200px 800px at 70% -10%, #0d2a31 0%, #08161a 55%)' },
  },
  tramonto: {
    nome: 'Tramonto', emoji: '🌅',
    vars: { '--bg':'#16100f','--bg-2':'#201614','--panel':'#271a17','--panel-2':'#32211d','--border':'#46302a',
      '--text':'#f5e9e4','--text-dim':'#c0a89f','--green':'#e08a4a','--green-bright':'#f5a967','--green-deep':'#b8632a',
      '--accent':'#ffc089','--bg-grad':'radial-gradient(1200px 800px at 70% -10%, #2a1a16 0%, #16100f 55%)' },
  },
  chiaro: {
    nome: 'Chiaro', emoji: '☀️', chiaro: true,
    vars: { '--bg':'#f4f7f4','--bg-2':'#ffffff','--panel':'#ffffff','--panel-2':'#eef3ee','--border':'#d6e0d8',
      '--text':'#1a2620','--text-dim':'#5c7065','--green':'#1f7a4d','--green-bright':'#2e9e63','--green-deep':'#155c3a',
      '--accent':'#1f7a4d','--bg-grad':'radial-gradient(1200px 800px at 70% -10%, #e9f1ea 0%, #f4f7f4 55%)' },
  },
}

const KEY = 'utree-theme'

export function applyTheme(id) {
  const t = THEMES[id] || THEMES.foresta
  const root = document.documentElement
  Object.entries(t.vars).forEach(([k, v]) => {
    if (k === '--bg-grad') document.body.style.background = v
    else root.style.setProperty(k, v)
  })
  // color-scheme dice al browser di che "famiglia" è il tema: da questo dipendono
  // le parti che disegna LUI e che il CSS non può ritoccare — barre di scorrimento
  // di sistema, selettori data/ora, campi nativi. Senza, con un tema scuro il
  // browser continuava a disegnare scrollbar chiare, che spiccavano come un dito
  // in un occhio.
  root.style.colorScheme = t.chiaro ? 'light' : 'dark'
  localStorage.setItem(KEY, id)
}

export function loadTheme() {
  const id = localStorage.getItem(KEY) || 'foresta'
  applyTheme(id)
  return id
}
