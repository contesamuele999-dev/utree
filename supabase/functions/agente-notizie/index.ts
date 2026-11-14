// ============================================================
// uTree — agente notizie della knowledge base.
//
// Gira qui (e non nel browser) perché la chiave di Gemini deve restare
// segreta. Lo chiamano il pulsante "Cerca ora" della scheda Knowledge e la
// pianificazione settimanale (scripts/agente-notizie.mjs). Un tema per
// chiamata, così ogni chiamata resta ben sotto il limite di tempo delle
// Edge Function e il pulsante può mostrare l'avanzamento.
//
//   { azione: "avvia" }        → integra le proposte approvate, ritorna i temi
//   { azione: "tema", tema }   → cerca le novità del tema e le aggiunge a "📥 Da valutare"
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
  IS_KB, aMarkdown, elencoTemi, giaVisti, oggiIso, parseProposte, ricercaTema,
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
    const { azione, tema } = await req.json()
    const oggi = oggiIso()

    // le knowledge base: visioni con "knowledge", "banca dati" o "KB" nel nome
    const { data: visioni, error: ev } = await sb.from('visioni').select('id,titolo')
    if (ev) throw ev
    const kbIds = (visioni || []).filter((v) => IS_KB.test(v.titolo || '')).map((v) => v.id)
    const { data: kb, error: ek } = await sb.from('viste').select('id,titolo,blocchi,visione_id').in('visione_id', kbIds)
    if (ek) throw ek
    const inbox = kb?.find((v) => (v.titolo || '').includes('Da valutare'))
    const temi = kb?.find((v) => (v.titolo || '').includes('Temi da seguire'))
    if (!inbox || !temi) return json({ error: 'Servono le viste "📥 Da valutare" e "🛰 Temi da seguire" in una visione Knowledge' }, 400)

    // vista per titolo (prima fra le knowledge base, poi ovunque)
    const vistaDi = async (titolo: string) => {
      const t = titolo.trim().toLowerCase()
      const inKb = kb!.find((v) => (v.titolo || '').trim().toLowerCase() === t)
      if (inKb) return inKb
      const { data } = await sb.from('viste').select('id,titolo,blocchi,visione_id').ilike('titolo', titolo.trim()).limit(1)
      return data?.[0] || null
    }
    const salva = async (id: string, blocchi: unknown[]) => {
      const { error } = await sb.from('viste').update({ blocchi }).eq('id', id)
      if (error) throw error
    }

    if (azione === 'avvia') {
      const blocchi = inbox.blocchi || []
      const fatte = parseProposte(blocchi).filter((p) => p.approvata)
      for (const p of fatte) {
        let dest = await vistaDi(p.vista)
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
      const vista = await vistaDi(tema)
      const r = await ricercaTema({
        tema, oggi,
        giaSai: aMarkdown(vista?.blocchi || []).slice(0, 8000),
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
