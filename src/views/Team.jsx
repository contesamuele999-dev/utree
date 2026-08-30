import { useMemo, useState } from 'react'
import {
  PERMESSI, etichettaPermesso, permessoVisione, permessoDelMembro, mieiTeamIds,
  creaTeam, rinominaTeam, eliminaTeam, invitaMembro, cambiaRuolo, rimuoviMembro,
  condividiConTeam, revocaCondivisione, impostaEccezione,
  inviaEmailInvito, linkInvito, testoInvito,
} from '../lib/team.js'

// ============================================================
// TEAM — le persone con cui condividi i progetti.
//
// Tre blocchi, nell'ordine in cui servono:
//   1. i tuoi team e chi ne fa parte (si invita per email)
//   2. i tuoi progetti: con chi sono condivisi e con quale permesso
//      (di squadra, con eccezioni per singola persona)
//   3. i progetti che gli altri hanno condiviso con te
//
// Un progetto = una visione. Condividere non sposta e non copia niente:
// il progetto resta del proprietario, gli altri lo vedono comparire
// nella loro app (Pipe, Tree, Links, Progress) esattamente dov'è.
// ============================================================
export default function Team({ visioni = [], userId, isDemo, dati, onRefresh }) {
  const { teams = [], membri = [], condivisioni = [], disponibile = false } = dati || {}
  const [nuovoTeam, setNuovoTeam] = useState('')
  const [invito, setInvito] = useState({})      // teamId -> email digitata
  const [apri, setApri] = useState(null)        // id del progetto col pannello condivisione aperto
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)          // { ok, text }
  const [copiato, setCopiato] = useState('')    // id del membro di cui si e' appena copiato il link

  const ctx = { userId, teams, membri, condivisioni }
  const mieiTeam = useMemo(() => {
    const ids = mieiTeamIds(ctx)
    return teams.filter(t => ids.has(t.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, membri, userId])
  const membriDi = (teamId) => membri.filter(m => m.team_id === teamId)

  const miei = visioni.filter(v => permessoVisione(v, ctx) === 'proprietario')
  const altrui = visioni
    .map(v => ({ v, p: permessoVisione(v, ctx) }))
    .filter(x => x.p === 'vista' || x.p === 'modifica')

  // ogni scrittura passa di qui: un solo posto dove gestire attesa, errore e ricarica
  const esegui = async (chiave, fn, okText) => {
    setBusy(chiave); setMsg(null)
    try {
      await fn()
      await onRefresh?.()
      if (okText) setMsg({ ok: true, text: okText })
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Operazione non riuscita.' })
    } finally { setBusy('') }
  }

  const aggiungiTeam = (e) => {
    e.preventDefault()
    const nome = nuovoTeam.trim()
    if (!nome) return
    esegui('team', async () => { await creaTeam(nome, userId); setNuovoTeam('') }, `Team “${nome}” creato.`)
  }

  // Copia il link dell'invito negli appunti. `document.execCommand` come ripiego:
  // `navigator.clipboard` non esiste fuori dai contesti sicuri e su alcuni browser
  // in-app, e proprio li' il link serve.
  const copiaLink = async (m) => {
    const testo = linkInvito(m.email)
    try { await navigator.clipboard.writeText(testo) }
    catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = testo; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
      } catch { window.prompt('Copia il link dell’invito:', testo); return }
    }
    setCopiato(m.id)
    setTimeout(() => setCopiato(c => (c === m.id ? '' : c)), 2500)
  }

  // Rispedisce l'email a un invito già salvato (l'email precedente non è arrivata,
  // oppure la funzione di invio è stata pubblicata solo adesso).
  const reinvia = (m) => {
    setBusy('re-' + m.id); setMsg(null)
    inviaEmailInvito(m.id).then(({ ok, errore }) => {
      setMsg(ok
        ? { ok: true, text: `Email reinviata a ${m.email}.` }
        : { ok: false, text: `Email non inviata (${errore}). Manda tu il link con “Copia link”.` })
      setBusy('')
    })
  }

  const aggiungiMembro = (e, team) => {
    e.preventDefault()
    const email = (invito[team.id] || '').trim().toLowerCase()
    if (!email || !email.includes('@')) { setMsg({ ok: false, text: 'Serve un indirizzo email valido.' }); return }
    if (membriDi(team.id).some(m => (m.email || '').toLowerCase() === email)) {
      setMsg({ ok: false, text: 'Questa persona è già nel team.' }); return
    }
    // L'invito è salvato comunque: l'email è un servizio in più, non la sostanza.
    // Se non parte lo si dice chiaramente, invece di lasciar credere che sia arrivata.
    setBusy('inv-' + team.id); setMsg(null)
    invitaMembro(team.id, email)
      .then(async ({ emailInviata, errore }) => {
        setInvito(s => ({ ...s, [team.id]: '' }))
        await onRefresh?.()
        setMsg(emailInviata
          ? { ok: true, text: `Invito inviato a ${email}: troverà l’email con il link per entrare.` }
          : { ok: false, text: `${email} è stato invitato, ma l’email non è partita (${errore}). `
              + `Usa “Copia link” qui sotto e mandaglielo tu: funziona uguale.` })
      })
      .catch(err => setMsg({ ok: false, text: err?.message || 'Invito non riuscito.' }))
      .finally(() => setBusy(''))
  }

  return (
    <div className="profile team-page">
      {isDemo && (
        <p className="demo-badge" style={{ display: 'inline-block', marginBottom: 16 }}>
          Modalità DEMO — i team restano su questo dispositivo, nessuno li riceve davvero
        </p>
      )}
      {!isDemo && !disponibile && (
        <div className="err" style={{ marginBottom: 14 }}>
          Le tabelle dei team non esistono ancora sul database. Esegui una volta
          <code> migrazione_team.sql</code> nell’SQL Editor di Supabase, poi ricarica l’app.
        </div>
      )}
      {msg && <div className={msg.ok ? 'ok-msg' : 'err'} style={{ marginBottom: 14 }}>{msg.text}</div>}

      {/* ---------------- 1. I MIEI TEAM ---------------- */}
      <div className="profile-card">
        <h3>I tuoi team</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Un team è un gruppo di persone. I progetti si condividono con il team,
          non uno a uno: aggiungi qualcuno e vede subito tutto ciò che il team può vedere.
        </p>
        <form onSubmit={aggiungiTeam} className="team-inline">
          <input className="input" value={nuovoTeam} placeholder="Nome del team…"
            onChange={e => setNuovoTeam(e.target.value)} />
          <button className="btn" disabled={busy === 'team' || !nuovoTeam.trim()}>
            {busy === 'team' ? '…' : 'Crea team'}
          </button>
        </form>

        {!mieiTeam.length && <p className="hint">Nessun team ancora.</p>}

        {mieiTeam.map(t => {
          const mio = t.owner_id === userId
          const lista = membriDi(t.id)
          return (
            <div key={t.id} className="team-box">
              <header className="team-box-head">
                <b>👥 {t.nome}</b>
                {!mio && <span className="team-tag">ospite</span>}
                <div className="spacer" />
                {mio && (
                  <>
                    <button className="iconbtn mini" title="Rinomina il team"
                      onClick={() => {
                        const nome = window.prompt('Nome del team', t.nome)
                        if (nome && nome.trim() && nome !== t.nome) esegui('t-' + t.id, () => rinominaTeam(t.id, nome.trim()))
                      }}>✎</button>
                    <button className="iconbtn mini danger" title="Elimina il team (le condivisioni fatte con lui decadono)"
                      onClick={() => {
                        if (window.confirm(`Eliminare il team “${t.nome}”? Chi ne faceva parte perderà l’accesso ai progetti condivisi con questo team.`))
                          esegui('t-' + t.id, () => eliminaTeam(t.id))
                      }}>🗑</button>
                  </>
                )}
              </header>

              <ul className="team-membri">
                {lista.map(m => (
                  <li key={m.id} className={'team-membro' + (m.stato === 'invitato' ? ' in-attesa' : '')}>
                    <span className="team-email">{m.email}{m.user_id === userId ? ' (tu)' : ''}</span>
                    <span className="team-tag">{m.stato === 'attivo' ? 'attivo' : 'invito in attesa'}</span>
                    {mio && m.stato !== 'attivo' && (
                      <>
                        <button type="button" className="pillbtn mini" disabled={busy === 're-' + m.id}
                          title="Rispedisci l’email di invito a questa persona"
                          onClick={() => reinvia(m)}>{busy === 're-' + m.id ? '…' : '✉ Reinvia'}</button>
                        <button type="button" className="pillbtn mini"
                          title="Copia il link dell’invito, per mandarlo tu via chat o email"
                          onClick={() => copiaLink(m)}>{copiato === m.id ? '✓ copiato' : '🔗 Copia link'}</button>
                        <a className="pillbtn mini" title="Apri il tuo programma di posta con il messaggio già scritto"
                          href={`mailto:${encodeURIComponent(m.email)}`
                            + `?subject=${encodeURIComponent(`Invito nel team "${t.nome}" su uTree`)}`
                            + `&body=${encodeURIComponent(testoInvito(m.email, t.nome))}`}>✍ Scrivi</a>
                      </>
                    )}
                    {mio && (
                      <>
                        <select className="input mini" value={m.ruolo}
                          title="Un admin può invitare e rimuovere le persone del team"
                          onChange={e => esegui('m-' + m.id, () => cambiaRuolo(m.id, e.target.value))}>
                          <option value="membro">membro</option>
                          <option value="admin">admin</option>
                        </select>
                        <button className="iconbtn mini danger" title="Togli dal team"
                          onClick={() => {
                            if (window.confirm(`Togliere ${m.email} dal team?`)) esegui('m-' + m.id, () => rimuoviMembro(m.id))
                          }}>✕</button>
                      </>
                    )}
                  </li>
                ))}
                {!lista.length && <li className="team-vuoto">Nessuno, per ora.</li>}
              </ul>

              {mio && (
                <form onSubmit={e => aggiungiMembro(e, t)} className="team-inline">
                  <input className="input" type="email" placeholder="email della persona da invitare…"
                    value={invito[t.id] || ''}
                    onChange={e => setInvito(s => ({ ...s, [t.id]: e.target.value }))} />
                  <button className="btn" disabled={busy === 'inv-' + t.id}>
                    {busy === 'inv-' + t.id ? '…' : 'Invita'}
                  </button>
                </form>
              )}
              {mio && (
                <p className="hint" style={{ marginTop: 6 }}>
                  Riceverà un’email con il link per entrare. Deve registrarsi
                  <b> con questo stesso indirizzo</b>, altrimenti l’invito non si aggancia.
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* ---------------- 2. I MIEI PROGETTI ---------------- */}
      <div className="profile-card">
        <h3>I tuoi progetti</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Scegli con quale team condividere ciascun progetto e con quale permesso.
          Il permesso vale per tutto il team; se serve, puoi cambiarlo
          <b> per una singola persona</b>.
        </p>
        {!miei.length && <p className="hint">Nessun progetto: creane uno da Pipe.</p>}
        {miei.map(v => {
          const righe = condivisioni.filter(c => c.visione_id === v.id && !c.membro_id)
          const aperto = apri === v.id
          return (
            <div key={v.id} className="team-box">
              <header className="team-box-head">
                <span className="team-pallino" style={{ background: v.colore || '#2e9e63' }} />
                <b>{v.titolo}</b>
                <span className="team-tag">
                  {righe.length ? `condiviso con ${righe.length} team` : 'privato'}
                </span>
                <div className="spacer" />
                <button className="iconbtn mini" title="Gestisci la condivisione"
                  onClick={() => setApri(a => a === v.id ? null : v.id)}>{aperto ? '▾' : '▸'}</button>
              </header>

              {aperto && (
                <div className="team-share">
                  {!mieiTeam.length && <p className="hint">Crea prima un team qui sopra.</p>}
                  {mieiTeam.filter(t => t.owner_id === userId).map(t => {
                    const riga = righe.find(c => c.team_id === t.id)
                    return (
                      <div key={t.id} className="team-share-row">
                        <span className="team-share-nome">👥 {t.nome}</span>
                        <select className="input mini" value={riga?.permesso || ''}
                          onChange={e => {
                            const val = e.target.value
                            if (!val) { if (riga) esegui('c-' + t.id, () => revocaCondivisione(riga.id)) }
                            else esegui('c-' + t.id, () => condividiConTeam(v, t.id, val, userId, condivisioni))
                          }}>
                          <option value="">Non condiviso</option>
                          {PERMESSI.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>

                        {/* eccezioni per singola persona: compaiono solo se il team ha accesso */}
                        {riga && (
                          <ul className="team-eccezioni">
                            {membriDi(t.id).map(m => {
                              const eff = permessoDelMembro(v.id, m, condivisioni)
                              return (
                                <li key={m.id}>
                                  <span className="team-email">{m.email}</span>
                                  <select className="input mini"
                                    value={eff.eccezione ? eff.permesso : ''}
                                    title="Permesso di questa persona su questo progetto"
                                    onChange={e => esegui('e-' + m.id,
                                      () => impostaEccezione(v, m, e.target.value || null, userId, condivisioni))}>
                                    <option value="">Come il team ({etichettaPermesso(riga.permesso)})</option>
                                    {PERMESSI.map(p => <option key={p.id} value={p.id}>Solo lei/lui: {p.label}</option>)}
                                  </select>
                                </li>
                              )
                            })}
                            {!membriDi(t.id).length && <li className="team-vuoto">Team senza membri.</li>}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ---------------- 3. CONDIVISI CON ME ---------------- */}
      <div className="profile-card">
        <h3>Condivisi con te</h3>
        {!altrui.length && <p className="hint" style={{ marginBottom: 0 }}>Nessun progetto condiviso con te.</p>}
        {altrui.map(({ v, p }) => (
          <div key={v.id} className="team-box">
            <header className="team-box-head">
              <span className="team-pallino" style={{ background: v.colore || '#2e9e63' }} />
              <b>{v.titolo}</b>
              <span className={'team-tag' + (p === 'modifica' ? ' ok' : '')}>
                {p === 'modifica' ? '✎ puoi modificare' : '👁 sola visibilità'}
              </span>
            </header>
          </div>
        ))}
      </div>
    </div>
  )
}
