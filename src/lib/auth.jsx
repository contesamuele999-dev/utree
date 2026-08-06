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
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
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
