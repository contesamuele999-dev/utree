// ============================================================
// uTree — agente notizie della knowledge base.
//
// Gira qui (e non nel browser) perché la chiave di Gemini deve restare
// segreta. Lo chiamano il pulsante "Cerca ora" della scheda Knowledge e la
// pianificazione settimanale (scripts/agente-notizie.mjs). Un tema per
// chiamata, così ogni chiamata resta ben sotto il limite di tempo delle
// Edge Function e il pulsante può mostrare l'avanzamento.
//
//   { azione: "basi" }                    → le knowledge base con Temi e Da valutare
//   { azione: "avvia", visioneId }        → integra le proposte approvate, ritorna i temi
//   { azione: "tema", visioneId, tema }   → cerca le novità del tema e le aggiunge a "📥 Da valutare"
//
// Privacy: si legge solo dentro la knowledge base scelta; con "Privacy: alta" (default)
// a Gemini arriva solo il nome del tema. Niente contenuti nei log.
//
// Autorizzazione: il JWT di chi chiama, niente service_role: le RLS decidono
// cosa si legge e si scrive, come nell'app.
//
// Deploy (una volta sola):
//   supabase functions deploy agente-notizie
//   supabase secrets set GEMINI_API_KEY=...        (chiave gratuita da aistudio.google.com/apikey)
//   supabase secrets set GEMINI_MODEL=...          (facoltativo, default gemini-flash-lite-latest)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  IS_KB, aMarkdown, elencoTemi, giaVisti, oggiIso, parseProposte, privacyAlta, ricercaTema,
  righeInBlocchi, righeIntegrazione, togliIntegrate,
} from '../_shared/agente.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: 'Manca il segreto GEMINI_API_KEY nella Edge Function' }, 500)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth: { persistSession: false },
  })
  const { data: ud } = await sb.auth.getUser()
  if (!ud?.user) return json({ error: 'Non autenticato' }, 401)

  try {
    const { azione, tema, visioneId } = await req.json()
    const oggi = oggiIso()

    // le knowledge base: visioni con "knowledge", "banca dati" o "KB" nel nome
    const { data: visioni, error: ev } = await sb.from('visioni').select('id,titolo')
    if (ev) throw ev
    const basi = (visioni || []).filter((v) => IS_KB.test(v.titolo || ''))
    const { data: tutte, error: ek } = await sb.from('viste').select('id,titolo,blocchi,visione_id').in('visione_id', basi.map((b) => b.id))
    if (ek) throw ek
    const dellaBase = (id: string) => (tutte || []).filter((v) => v.visione_id === id)
    const agenteDi = (id: string) => {
      const kb = dellaBase(id)
      return { kb, inbox: kb.find((v) => (v.titolo || '').includes('Da valutare')), temi: kb.find((v) => (v.titolo || '').includes('Temi da seguire')) }
    }

    // elenco delle basi su cui l'agente può lavorare (per il giro settimanale)
    if (azione === 'basi') {
      return json({ basi: basi.filter((b) => { const a = agenteDi(b.id); return a.inbox && a.temi }).map((b) => ({ id: b.id, titolo: b.titolo })) })
    }

    const scelta = visioneId ? basi.find((b) => b.id === visioneId) : basi.find((b) => { const a = agenteDi(b.id); return a.inbox && a.temi })
    if (!scelta) return json({ error: 'Knowledge base non trovata' }, 404)
    const { kb, inbox, temi } = agenteDi(scelta.id)
    if (!inbox || !temi) return json({ error: `In "${scelta.titolo}" servono le viste "📥 Da valutare" e "🛰 Temi da seguire"` }, 400)

    // vista per titolo, SOLO dentro questa knowledge base: niente fuori finisce a Gemini
    const vistaDi = (titolo: string) => {
      const t = titolo.trim().toLowerCase()
      return kb.find((v) => (v.titolo || '').trim().toLowerCase() === t) || null
    }
    const salva = async (id: string, blocchi: unknown[]) => {
      const { error } = await sb.from('viste').update({ blocchi }).eq('id', id)
      if (error) throw error
    }

    if (azione === 'avvia') {
      const blocchi = inbox.blocchi || []
      const fatte = parseProposte(blocchi).filter((p) => p.approvata)
      for (const p of fatte) {
        let dest = vistaDi(p.vista)
        if (!dest) {
          // tema libero senza vista: nasce nella knowledge base di "Da valutare"
          const { count } = await sb.from('viste').select('id', { count: 'exact', head: true }).eq('visione_id', inbox.visione_id)
          const { data, error } = await sb.from('viste').insert({
            visione_id: inbox.visione_id, titolo: p.vista, blocchi: [], is_template: false,
            livello: 0, parent_id: null, pos_x: 0, pos_y: 0, ordine: count || 0, stage: 'note',
          }).select('id,titolo,blocchi,visione_id').single()
          if (error) throw error
          dest = data
          kb!.push(data)
        }
        dest.blocchi = [...(dest.blocchi || []), ...righeInBlocchi(righeIntegrazione(p, oggi))]
        await salva(dest.id, dest.blocchi)
      }
      if (fatte.length) await salva(inbox.id, togliIntegrate(blocchi, fatte, oggi))
      return json({ temi: elencoTemi(temi.blocchi || []), integrate: fatte.length })
    }

    if (azione === 'tema' && typeof tema === 'string' && tema.trim()) {
      const vista = vistaDi(tema)
      const r = await ricercaTema({
        tema, oggi,
        // privacy alta (default): a Gemini va solo il nome del tema, mai il testo della vista
        giaSai: privacyAlta(temi.blocchi) ? '' : aMarkdown(vista?.blocchi || []).slice(0, 8000),
        visti: giaVisti(inbox.blocchi || []),
        dest: vista?.titolo || tema,
        key, modello: Deno.env.get('GEMINI_MODEL'),
      })
      if (r.righe.length) {
        // rilegge "Da valutare": nel frattempo può essere cambiata
        const { data: fresca } = await sb.from('viste').select('blocchi').eq('id', inbox.id).single()
        const blocchi = fresca?.blocchi || []
        const titolo = `# Ricerca del ${oggi}`
        const nuove = blocchi.some((b: { text?: string }) => b.text === titolo) ? r.righe : [titolo, ...r.righe]
        await salva(inbox.id, [...blocchi, ...righeInBlocchi(nuove)])
      }
      return json({ tema, novita: r.novita, candidati: r.candidati })
    }

    return json({ error: 'azione sconosciuta' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
