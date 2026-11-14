import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, hasSupabase } from '../lib/supabase.js'
import { IS_KB, campo, elencoTemi, parseProposte, privacyAlta } from '../../supabase/functions/_shared/agente.js'

// ============================================================
// KNOWLEDGE — le knowledge base. Sono le visioni con "knowledge",
// "banca dati" o "KB" nel nome; se ne sceglie una dai chip in alto.
// Per la base scelta: la casella dell'agente notizie (📥 Da valutare,
// 🛰 Temi da seguire, 🔎 Cerca ora), le sue viste in albero e la
// ricerca dentro il testo delle righe.
// ============================================================
const SEL_KEY = 'utree-kb-sel'
const ICONA = { novita: '💡', metodo: '🔧', tema: '🛰' }
const pulito = (t) => (t || '').replace(/\*\*|`/g, '').replace(/\(\(([^()|]+)\|([^()]+)\)\)/g, '$2').replace(/\{[a-z]+:([^}]*)\}/g, '$1')
const leggiSel = () => { try { return localStorage.getItem(SEL_KEY) } catch { return null } }
const scriviSel = (id) => { try { localStorage.setItem(SEL_KEY, id) } catch { /* solo comodità */ } }

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

export default function Knowledge({ viste = [], visioni = [], onOpen, onAggiorna, onNuovaBase, onNuovaVista, onSalvaVista }) {
  const [query, setQuery] = useState('')
  const [giro, setGiro] = useState(null)   // { msg, attivo } durante e dopo "Cerca ora"
  const [selId, setSelId] = useState(leggiSel)
  const q = query.trim().toLowerCase()

  const basi = visioni.filter(v => IS_KB.test(v.titolo || ''))
  const base = basi.find(b => b.id === selId) || basi[0]
  const scegli = (id) => { setSelId(id); scriviSel(id); setQuery('') }
  // appena nasce una base nuova (＋ Nuova) la si apre
  const visti = useRef(null)
  useEffect(() => {
    const ids = basi.map(b => b.id)
    const nuova = visti.current && ids.find(id => !visti.current.includes(id))
    if (nuova) scegli(nuova)
    visti.current = ids
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basi.map(b => b.id).join()])

  const { inbox, temi, righe } = useMemo(() => {
    const kb = viste.filter(v => v.visione_id === base?.id && !v.is_template)
    const inbox = kb.find(v => (v.titolo || '').includes('Da valutare'))
    const temi = kb.find(v => (v.titolo || '').includes('Temi da seguire'))
    // albero (genitore → figli), senza le due viste dell'agente
    const resto = kb.filter(v => v !== inbox && v !== temi)
    const presenti = new Set(resto.map(v => v.id))
    const figli = {}
    const radici = []
    for (const v of resto) {
      if (v.parent_id && presenti.has(v.parent_id)) (figli[v.parent_id] ||= []).push(v)
      else radici.push(v)
    }
    const ord = (a, b) => (a.ordine || 0) - (b.ordine || 0)
    const appiattisci = (lista, depth) => lista.sort(ord).flatMap(v => [{ v, depth }, ...appiattisci(figli[v.id] || [], depth + 1)])
    return { inbox, temi, righe: appiattisci(radici, 0) }
  }, [viste, base?.id])

  const proposte = parseProposte(inbox?.blocchi || [])
  const nuove = proposte.filter(p => !p.approvata).length
  const approvate = proposte.length - nuove

  // ✓ / ✕ con un tocco: ✓ spunta la proposta (entra alla prossima ricerca), ✕ la toglie con le sue righe
  const decidi = (p, ok) => {
    const b = inbox.blocchi
    const blocchi = ok
      ? b.map((x, i) => i === p.da ? { ...x, check: true, done: !p.approvata } : x)
      : b.filter((_, i) => i < p.da || i >= p.a)
    onSalvaVista?.({ ...inbox, blocchi })
  }
  const nTemi = temi ? elencoTemi(temi.blocchi || []).length : 0
  const privata = privacyAlta(temi?.blocchi)

  // stesso giro della pianificazione del lunedì: integra le approvate, poi un tema per chiamata
  const cercaOra = async () => {
    const visioneId = base.id
    setGiro({ msg: 'Integro le proposte approvate…', attivo: true })
    try {
      const { temi, integrate } = await agente({ azione: 'avvia', visioneId })
      let trovate = 0, errori = 0
      for (let i = 0; i < temi.length; i++) {
        setGiro({ msg: `${temi[i]} · ${i + 1}/${temi.length}`, attivo: true })
        try { trovate += (await agente({ azione: 'tema', visioneId, tema: temi[i] })).novita } catch { errori++ }
      }
      setGiro({ msg: `${trovate} novità trovate${integrate ? ` · ${integrate} integrate` : ''}${errori ? ` · ${errori} temi non riusciti` : ''}` })
    } catch (e) {
      setGiro({ msg: 'Errore: ' + e.message })
    }
    onAggiorna?.()
  }

  // ricerca: le righe che contengono il testo, nella base scelta
  const trovate = useMemo(() => {
    if (!q) return []
    return righe.flatMap(({ v }) => {
      const inTitolo = (v.titolo || '').toLowerCase().includes(q)
      const hit = (v.blocchi || []).filter(b => pulito(b.text).toLowerCase().includes(q)).slice(0, 3)
      return inTitolo || hit.length ? [{ v, hit }] : []
    })
  }, [q, righe])

  return (
    <div className="kb-wrap">
      <div className="kb-basi" role="tablist">
        {basi.map(b => (
          <button key={b.id} role="tab" aria-selected={b.id === base?.id}
            className={'chip' + (b.id === base?.id ? ' active' : '')} onClick={() => scegli(b.id)}>
            📚 {b.titolo.replace(/^knowledge\s*[·:\-–]\s*/i, '')}
          </button>
        ))}
        <button className="chip" title="Crea una nuova knowledge base (con Temi e Da valutare già pronti)" onClick={onNuovaBase}>＋ Nuova</button>
      </div>

      {base && inbox && proposte.length > 0 && !q && (
        <div className="kb-list kb-proposte">
          {proposte.map(p => {
            const sotto = p.tipo === 'novita' ? campo(p.figli, 'Cosa aggiunge') : campo(p.figli, 'Perché') || campo(p.figli, 'Modifica proposta')
            const fonte = campo(p.figli, 'Fonte')
            const url = (fonte.match(/https?:\/\/\S+/) || [])[0]
            const aff = (fonte.match(/affidabilità: ([^,]+)/) || [])[1]
            return (
              <div key={p.da + p.titolo} className={'kb-prop' + (p.approvata ? ' ok' : '')}>
                <div className="kb-prop-txt">
                  <b>{ICONA[p.tipo]} {p.titolo}</b>
                  {sotto && <span className="kb-snip">{pulito(sotto)}</span>}
                  <span className="kb-n">→ {p.vista}{url && <> · <a href={url} target="_blank" rel="noopener noreferrer">fonte</a></>}{aff ? ` · ${aff}` : ''}</span>
                </div>
                <button className={'iconbtn kb-si' + (p.approvata ? ' on' : '')} disabled={!onSalvaVista}
                  title={p.approvata ? 'Approvata: entra alla prossima ricerca (tocca per annullare)' : 'Approva: entra alla prossima ricerca'}
                  onClick={() => decidi(p, true)}>✓</button>
                <button className="iconbtn kb-no" title="Scarta" disabled={!onSalvaVista} onClick={() => decidi(p, false)}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {!base && <p className="kb-vuoto">Nessuna knowledge base: crea la prima con ＋ Nuova.</p>}

      {base && (
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
                <span>{nTemi} temi · privacy {privata ? 'alta 🔒' : 'normale'}</span>
              </span>
            </button>
          )}
          {inbox && temi && (
            <button className="kb-card" onClick={cercaOra} disabled={!hasSupabase || giro?.attivo || !nTemi}
              title={hasSupabase ? "Lancia adesso la ricerca dell'agente sui temi di questa base" : 'Disponibile solo con il cloud'}>
              <span className={'kb-card-ico' + (giro?.attivo ? ' kb-gira' : '')}>🔎</span>
              <span className="kb-card-txt"><b>{giro?.attivo ? 'Ricerca in corso…' : 'Cerca ora'}</b>
                <span>{giro?.msg || (nTemi ? 'Ogni lunedì parte da sola' : 'Aggiungi prima un tema')}</span>
              </span>
            </button>
          )}
          {/* Giro con il modello locale: un link "utree-agente:" che Windows passa a
              avvia-agente-locale.bat (abilitato una volta con registra-pulsante-agente.bat).
              Solo su computer: dal telefono non c'è un PC da accendere. */}
          {inbox && temi && (
            <a className="kb-card kb-solo-pc" href="utree-agente:avvia"
              title="Accende Ollama su questo PC e cerca le novità di tutte le knowledge base, senza mandare testo a Google. Se non succede niente, lancia una volta registra-pulsante-agente.bat">
              <span className="kb-card-ico">🖥</span>
              <span className="kb-card-txt"><b>Giro locale</b>
                <span>Ollama su questo PC · niente a Google</span>
              </span>
            </a>
          )}
        </div>
      )}

      {base && (
        <p className="kb-avviso">
          {privata
            ? <>🔒 <b>Privacy alta</b>: quando l'agente cerca, a <b>Google Gemini</b> (piano gratuito) arrivano solo i <b>nomi dei temi</b> e i titoli delle proposte, mai il testo delle tue viste. Condividerla in team chiede due conferme.</>
            : <>⚠️ <b>Privacy normale</b>: quando l'agente cerca, il <b>testo delle viste</b> dei Temi da seguire arriva a <b>Google Gemini</b> (piano gratuito), che può usarlo per migliorare i suoi servizi. Per tenerlo in uTree scrivi "Privacy: alta" in Temi da seguire.</>}
        </p>
      )}

      {base && (
        <div className="pipe-search">
          <span className="pipe-search-ico">🔍</span>
          <input className="pipe-search-input" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={`Cerca in ${base.titolo}…`} />
          {query && <button className="pipe-search-clear" title="Pulisci" onClick={() => setQuery('')}>✕</button>}
        </div>
      )}

      {base && (q ? (
        <div className="kb-list">
          {!trovate.length && <p className="kb-vuoto">Niente per "{query}".</p>}
          {trovate.map(({ v, hit }) => (
            <button key={v.id} className="kb-row kb-hit" onClick={() => onOpen(v, query)}>
              <b>{v.titolo || 'Senza titolo'}</b>
              {hit.map(b => <span key={b.id} className="kb-snip">{pulito(b.text)}</span>)}
            </button>
          ))}
        </div>
      ) : (
        <div className="kb-list">
          {!righe.length && <p className="kb-vuoto">Ancora nessuna vista in questa base.</p>}
          {righe.map(({ v, depth }) => (
            <button key={v.id} className="kb-row" style={{ paddingLeft: 12 + depth * 20 }} onClick={() => onOpen(v)}>
              <span>{v.titolo || 'Senza titolo'}</span>
              <span className="kb-n">{(v.blocchi || []).filter(b => b.text?.trim()).length}</span>
            </button>
          ))}
          <button className="kb-row kb-add" onClick={() => onNuovaVista?.(base.id)}>＋ Nuova vista in questa base</button>
        </div>
      ))}
    </div>
  )
}
