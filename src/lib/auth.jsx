import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, hasSupabase } from './supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasSupabase) {
      // Modalità demo: utente fittizio locale
      setUser({ id: 'demo-user', email: 'demo@utree.local', demo: true })
      setLoading(false)
      return
    }
    // Finche' `loading` e' true l'app non disegna nulla di suo. Quindi questa
    // promessa DEVE chiudersi, sempre: se resta appesa, la schermata resta ferma
    // per sempre. Due reti di sicurezza, perche' i modi di restare appesi sono due:
    //   - getSession() RIFIUTA (token salvato illeggibile, storage negato, rete giu')
    //     -> senza `catch` il `finally` non arrivava mai;
    //   - getSession() non torna affatto: supabase-js serializza l'accesso alla
    //     sessione con un lock fra le schede, e una scheda rimasta appesa (tipico
    //     riaprendo la PWA) puo' tenerlo. Da qui il timeout.
    let vivo = true
    const chiudi = (u) => { if (!vivo) return; vivo = false; setUser(u ?? null); setLoading(false) }
    const scadenza = setTimeout(() => {
      if (!vivo) return
      console.warn('[auth] sessione non letta in tempo: si prosegue senza.')
      chiudi(null)   // onAuthStateChange aggancia comunque la sessione appena arriva
    }, 8000)

    supabase.auth.getSession()
      .then(({ data }) => chiudi(data?.session?.user ?? null))
      .catch(e => { console.warn('[auth] sessione non leggibile:', e?.message || e); chiudi(null) })
      .finally(() => clearTimeout(scadenza))

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      // arriva anche dopo il timeout: e' la via di rientro se la lettura era lenta
      vivo = false
      clearTimeout(scadenza)
      setUser(session?.user ?? null)
      setLoading(false)
    })
    return () => { vivo = false; clearTimeout(scadenza); sub.subscription.unsubscribe() }
  }, [])

  const value = {
    user, loading, isDemo: !hasSupabase,
    async signUp(email, password) {
      if (!hasSupabase) return { error: null }
      return supabase.auth.signUp({ email, password })
    },
    async signIn(email, password) {
      if (!hasSupabase) return { error: null }
      return supabase.auth.signInWithPassword({ email, password })
    },
    async signOut() {
      if (!hasSupabase) return
      await supabase.auth.signOut()
    },
    async updateEmail(email) {
      if (!hasSupabase) return { error: { message: 'Non disponibile in modalità demo.' } }
      return supabase.auth.updateUser({ email })
    },
    async updatePassword(password) {
      if (!hasSupabase) return { error: { message: 'Non disponibile in modalità demo.' } }
      return supabase.auth.updateUser({ password })
    },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
