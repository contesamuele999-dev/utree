import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Se le variabili non sono configurate, l'app gira comunque in modalità DEMO (locale).
export const hasSupabase = Boolean(url && key)

// "Ricordami": se attivo (default) la sessione vive in localStorage e sopravvive alla
// chiusura del browser; se disattivato usa sessionStorage e sparisce alla chiusura.
export const REMEMBER_KEY = 'utree-remember'
const remember = () => {
  try { return localStorage.getItem(REMEMBER_KEY) !== '0' } catch { return true }
}
// storage ibrido: scrive/legge dal magazzino scelto e tiene pulito l'altro
const hybridStorage = {
  getItem: (k) => {
    try { return (remember() ? localStorage : sessionStorage).getItem(k) ?? localStorage.getItem(k) ?? sessionStorage.getItem(k) } catch { return null }
  },
  setItem: (k, v) => {
    try {
      const on = remember() ? localStorage : sessionStorage
      const off = remember() ? sessionStorage : localStorage
      on.setItem(k, v); off.removeItem(k)
    } catch { /* ignore */ }
  },
  removeItem: (k) => {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k) } catch { /* ignore */ }
  },
}

export const supabase = hasSupabase
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storage: hybridStorage } })
  : null
