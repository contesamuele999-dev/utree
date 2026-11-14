import { useMemo, useState } from 'react'
import { supabase, hasSupabase } from '../lib/supabase.js'
import { IS_KB } from '../../supabase/functions/_shared/agente.js'

// ============================================================
// KNOWLEDGE — le knowledge base. Sono le visioni con "knowledge",
// "banca dati" o "KB" nel nome: in cima la casella dell'agente
// notizie (📥 Da valutare, 🛰 Temi da seguire), sotto le viste di
// ogni base in albero, con ricerca dentro il testo delle righe.
// ============================================================
const PROPOSTA = /^(Novità|Metodo)\s*·/i
const approvata = (b) => !!b.done || /\bok\s*$/i.test(b.text || '')
const pulito = (t) => (t || '').replace(/\*\*|`/g, '').replace(/\{[a-z]+:([^}]*)\}/g, '$1')

// chiama la Edge Function dell'agente; l'errore vero sta nel corpo della risposta
async function agente(body) {
  const { data, error } = await supabase.functions.invoke('agente-notizie', { body })
  if (error) {
    let dettaglio = ''
    try { dettaglio = (await error.context?.json?.())?.error || '' } catch { /* niente corpo */ }
    throw new Error(dettaglio || error.message)
  }
  return data
}

export default function Knowledge({ viste = [], visioni = [], onOpen, onAggiorna }) {
  const [query, setQuery] = useState('')
  const [giro, setGiro] = useState(null)   // { msg, attivo } durante e dopo "Cerca ora"

  // stesso giro della pianificazione del lunedì: integra le approvate, poi un tema per chiamata
  const cercaOra = async () => {
    setGiro({ msg: 'Integro le proposte approvate…', attivo: true })
    try {
      const { temi, integrate } = await agente({ azione: 'avvia' })
      let trovate = 0, errori = 0
      for (let i = 0; i < temi.length; i++) {
        setGiro({ msg: `${temi[i]} · ${i + 1}/${temi.length}`, attivo: true })
        try { trovate += (await agente({ azione: 'tema', tema: temi[i] })).novita } catch { errori++ }
      }
      setGiro({ msg: `${trovate} novità trovate${integrate ? ` · ${integrate} integrate` : ''}${errori ? ` · ${errori} temi non riusciti` : ''}` })
    } catch (e) {
      setGiro({ msg: 'Errore: ' + e.message })
    }
    onAggiorna?.()
  }
  const q = query.trim().toLowerCase()

  const { basi, inbox, temi } = useMemo(() => {
    const kbVisioni = visioni.filter(v => IS_KB.test(v.titolo || ''))
    const ids = new Set(kbVisioni.map(v => v.id))
    const kb = viste.filter(v => ids.has(v.visione_id) && !v.is_template)
    const inbox = kb.find(v => (v.titolo || '').includes('Da valutare'))
    const temi = kb.find(v => (v.titolo || '').includes('Temi da seguire'))
    // albero per visione (genitore → figli), senza le due viste dell'agente
    const resto = kb.filter(v => v !== inbox && v !== temi)
    const presenti = new Set(resto.map(v => v.id))
    const figli = {}
    const radici = {}
    for (const v of resto) {
      if (v.parent_id && presenti.has(v.parent_id)) (figli[v.parent_id] ||= []).push(v)
      else (radici[v.visione_id] ||= []).push(v)
    }
    const ord = (a, b) => (a.ordine || 0) - (b.ordine || 0)
    const appiattisci = (lista, depth) => lista.sort(ord).flatMap(v => [{ v, depth }, ...appiattisci(figli[v.id] || [], depth + 1)])
    const basi = kbVisioni.map(vi => ({ visione: vi, righe: appiattisci(radici[vi.id] || [], 0) }))
    return { basi, inbox, temi }
  }, [viste, visioni])

  const proposte = (inbox?.blocchi || []).filter(b => !b.indent && PROPOSTA.test(b.text || ''))
  const nuove = proposte.filter(b => !approvata(b)).length
  const approvate = proposte.length - nuove

  // ricerca: le righe che contengono il testo, in tutte le viste delle basi
  const trovate = useMemo(() => {
    if (!q) return []
    return basi.flatMap(({ righe }) => righe.flatMap(({ v }) => {
      const inTitolo = (v.titolo || '').toLowerCase().includes(q)
      const hit = (v.blocchi || []).filter(b => pulito(b.text).toLowerCase().includes(q)).slice(0, 3)
      return inTitolo || hit.length ? [{ v, hit }] : []
    }))
  }, [q, basi])

  return (
    <div className="kb-wrap">
      <div className="kb-agente">
        {inbox && (
          <button className="kb-card kb-inbox" onClick={() => onOpen(inbox)}>
            <span className="kb-card-ico">📥</span>
            <span className="kb-card-txt"><b>Da valutare</b>
              <span>{nuove ? `${nuove} novità da valutare` : 'Nessuna novità in attesa'}{approvate ? ` · ${approvate} approvate, entrano alla prossima ricerca` : ''}</span>
            </span>
            {nuove > 0 && <span className="kb-badge">{nuove}</span>}
          </button>
        )}
        {temi && (
          <button className="kb-card" onClick={() => onOpen(temi)}>
            <span className="kb-card-ico">🛰</span>
            <span className="kb-card-txt"><b>Temi da seguire</b>
              <span>{(temi.blocchi || []).filter(b => b.indent && b.text?.trim()).length} temi seguiti dall'agente</span>
            </span>
          </button>
        )}
        {inbox && (
          <button className="kb-card" onClick={cercaOra} disabled={!hasSupabase || giro?.attivo}
            title={hasSupabase ? "Lancia adesso la ricerca dell'agente su tutti i temi" : 'Disponibile solo con il cloud'}>
            <span className={'kb-card-ico' + (giro?.attivo ? ' kb-gira' : '')}>🔎</span>
            <span className="kb-card-txt"><b>{giro?.attivo ? 'Ricerca in corso…' : 'Cerca ora'}</b>
              <span>{giro?.msg || 'Ogni lunedì parte da sola'}</span>
            </span>
          </button>
        )}
      </div>

      <div className="pipe-search">
        <span className="pipe-search-ico">🔍</span>
        <input className="pipe-search-input" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Cerca nelle knowledge base…" />
        {query && <button className="pipe-search-clear" title="Pulisci" onClick={() => setQuery('')}>✕</button>}
      </div>

      {q ? (
        <div className="kb-list">
          {!trovate.length && <p className="kb-vuoto">Niente per "{query}".</p>}
          {trovate.map(({ v, hit }) => (
            <button key={v.id} className="kb-row kb-hit" onClick={() => onOpen(v, query)}>
              <b>{v.titolo || 'Senza titolo'}</b>
              {hit.map(b => <span key={b.id} className="kb-snip">{pulito(b.text)}</span>)}
            </button>
          ))}
        </div>
      ) : basi.map(({ visione, righe }) => (
        <section key={visione.id} className="kb-base">
          <h3 className="kb-base-tit" style={{ '--kb-col': visione.colore || 'var(--green)' }}>{visione.titolo}</h3>
          <div className="kb-list">
            {!righe.length && <p className="kb-vuoto">Ancora nessuna vista.</p>}
            {righe.map(({ v, depth }) => (
              <button key={v.id} className="kb-row" style={{ paddingLeft: 12 + depth * 20 }} onClick={() => onOpen(v)}>
                <span>{v.titolo || 'Senza titolo'}</span>
                <span className="kb-n">{(v.blocchi || []).filter(b => b.text?.trim()).length}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
