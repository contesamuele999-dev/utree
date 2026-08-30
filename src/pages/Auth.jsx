import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { REMEMBER_KEY } from '../lib/supabase.js'

// Chi arriva dal link di un invito porta con se' l'indirizzo a cui l'invito e'
// stato mandato: `?invito=tizio@esempio.it`. Precompilarlo non e' una comodita',
// e' la condizione perche' l'invito funzioni — si aggancia SOLO all'account
// registrato con quella email (vedi utree_collega_inviti in migrazione_team.sql).
function emailInvitata() {
  try { return new URLSearchParams(window.location.search).get('invito') || '' }
  catch { return '' }
}

export default function Auth() {
  const { signIn, signUp, isDemo } = useAuth()
  const invitato = emailInvitata()
  const [mode, setMode] = useState(invitato ? 'up' : 'in')
  const [email, setEmail] = useState(invitato)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [remember, setRemember] = useState(() => {
    try { return localStorage.getItem(REMEMBER_KEY) !== '0' } catch { return true }
  })

  const submit = async (e) => {
    e.preventDefault()
    // registra la scelta "ricordami" PRIMA del login: lo storage di Supabase la legge subito
    try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0') } catch { /* ignore */ }
    setErr(''); setMsg(''); setBusy(true)
    const fn = mode === 'in' ? signIn : signUp
    const { error } = await fn(email, pw)
    setBusy(false)
    if (error) setErr(error.message)
    else if (mode === 'up') setMsg('Registrazione ok! Controlla la mail per confermare, poi accedi.')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="44" alt="uTree" />
        <h1>uTree</h1>
        <p className="sub">Le tue idee, ad albero. Vite · Visioni · Viste.</p>

        {isDemo && (
          <p className="demo-badge" style={{display:'inline-block',marginBottom:16}}>
            Modalità DEMO locale — configura Supabase per il login reale
          </p>
        )}

        {invitato && (
          <p style={{fontSize:13,lineHeight:1.5,color:'var(--green-bright)',margin:'0 0 16px'}}>
            Sei stato invitato in un team su uTree.
            Crea l’account con <b>{invitato}</b> (o accedi, se ce l’hai già):
            i progetti condivisi compariranno da soli.
          </p>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" required value={email}
              onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" required minLength={6} value={pw}
              onChange={e => setPw(e.target.value)} placeholder="••••••••" />
          </div>
          <label className="remember-row">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>Ricordami su questo dispositivo</span>
          </label>
          {err && <div className="err">{err}</div>}
          {msg && <div style={{color:'var(--green-bright)',fontSize:13,margin:'8px 0'}}>{msg}</div>}
          <button className="btn" disabled={busy}>
            {busy ? '…' : mode === 'in' ? 'Accedi' : 'Crea account'}
          </button>
        </form>

        <div style={{textAlign:'center',marginTop:12}}>
          <button className="link-btn" onClick={() => { setMode(mode==='in'?'up':'in'); setErr(''); setMsg('') }}>
            {mode === 'in' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
          </button>
        </div>
      </div>
    </div>
  )
}
