// ============================================================
// uTree — agente notizie delle knowledge base.
//
// Gira qui (e non nel browser) perché la chiave di Gemini deve restare
// segreta. Lo chiamano il pulsante "Cerca ora" della scheda Knowledge e il
// giro settimanale sul PC (scripts/agente-notizie.mjs). Un tema per chiamata,
// così ogni chiamata resta sotto il limite di tempo delle Edge Function.
//
//   { azione: "basi" }                         → knowledge base con Temi e Da valutare
//   { azione: "avvia", visioneId }             → integra le approvate (+ link automatici), ritorna i temi
//   { azione: "tema", visioneId, tema }        → cerca con Gemini e aggiunge a "📥 Da valutare"
//   { azione: "suggerisci", visioneId }        → propone fino a 3 temi nuovi (Gemini)
//   { azione: "prepara", visioneId }           → contesto per il modello LOCALE sul PC (niente Gemini)
//   { azione: "proponi", visioneId, righe }    → aggiunge righe di proposta già pronte (dal PC)
//   { azione: "riepilogo", testo }             → email di riepilogo a chi chiama (Maileroo)
//
// Privacy: si legge solo dentro la knowledge base scelta; con "Privacy: alta" (default)
// a Gemini arrivano solo i nomi dei temi. "prepara" manda il testo solo a chi chiama
// (il suo PC), che lo passa a un modello locale. Niente contenuti nei log.
//
// Autorizzazione: il JWT di chi chiama, niente service_role: decidono le RLS.
//
// Deploy:
//   supabase functions deploy agente-notizie
//   supabase secrets set GEMINI_API_KEY=...        (chiave gratuita da aistudio.google.com/apikey)
//   (facoltativi) GEMINI_MODEL; per il riepilogo email MAILEROO_API_KEY + UTREE_MITTENTE (già usati dagli inviti)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  IS_KB, aMarkdown, collegaTitoli, elencoTemi, gemini, giaVisti, oggiIso, parseProposte, privacyAlta,
  promptTemi, ricercaTema, righeInBlocchi, righeIntegrazione, righeTemi, togliIntegrate,
} from '../_shared/agente.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Vista = { id: string; titolo: string; blocchi: { text?: string; indent?: number }[]; visione_id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth: { persistSession: false },
  })
  const { data: ud } = await sb.auth.getUser()
  if (!ud?.user) return json({ error: 'Non autenticato' }, 401)

  try {
    const { azione, tema, visioneId, righe, testo } = await req.json()
    const oggi = oggiIso()

    // riepilogo email: non tocca le knowledge base; va solo all'indirizzo di chi chiama
    if (azione === 'riepilogo') {
      const chiave = Deno.env.get('MAILEROO_API_KEY'), da = Deno.env.get('UTREE_MITTENTE')
      if (!chiave || !da) return json({ error: 'MAILEROO_API_KEY o UTREE_MITTENTE non configurati' }, 503)
      const m = da.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/)
      const r = await fetch('https://smtp.maileroo.com/api/v2/emails', {
        method: 'POST',
        headers: { 'X-API-Key': chiave, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: m ? { address: m[2], display_name: m[1] || 'uTree' } : { address: da.trim(), display_name: 'uTree' },
          to: [{ address: ud.user.email }],
          subject: `uTree · novità delle knowledge base (${oggi})`,
          plain: String(testo || '').slice(0, 20000),
        }),
      })
      return r.ok ? json({ ok: true }) : json({ error: `Maileroo ${r.status}` }, 502)
    }

    // le knowledge base: visioni con "knowledge", "banca dati" o "KB" nel nome
    const { data: visioni, error: ev } = await sb.from('visioni').select('id,titolo')
    if (ev) throw ev
    const basi = (visioni || []).filter((v) => IS_KB.test(v.titolo || ''))
    const { data: tutte, error: ek } = await sb.from('viste').select('id,titolo,blocchi,visione_id').in('visione_id', basi.map((b) => b.id))
    if (ek) throw ek
    const agenteDi = (id: string) => {
      const kb = ((tutte || []) as Vista[]).filter((v) => v.visione_id === id)
      return { kb, inbox: kb.find((v) => (v.titolo || '').includes('Da valutare')), temi: kb.find((v) => (v.titolo || '').includes('Temi da seguire')) }
    }

    if (azione === 'basi') {
      return json({ basi: basi.filter((b) => { const a = agenteDi(b.id); return a.inbox && a.temi }).map((b) => ({ id: b.id, titolo: b.titolo })) })
    }

    const scelta = visioneId ? basi.find((b) => b.id === visioneId) : basi.find((b) => { const a = agenteDi(b.id); return a.inbox && a.temi })
    if (!scelta) return json({ error: 'Knowledge base non trovata' }, 404)
    const { kb, inbox, temi } = agenteDi(scelta.id)
    if (!inbox || !temi) return json({ error: `In "${scelta.titolo}" servono le viste "📥 Da valutare" e "🛰 Temi da seguire"` }, 400)
    const privata = privacyAlta(temi.blocchi)
    const elenco: string[] = elencoTemi(temi.blocchi || [])
    const titoliKb = kb.filter((v) => v !== inbox && v !== temi).map((v) => v.titolo)

    // vista per titolo, SOLO dentro questa knowledge base: niente fuori finisce a Gemini
    const vistaDi = (titolo: string) => kb.find((v) => (v.titolo || '').trim().toLowerCase() === titolo.trim().toLowerCase()) || null
    const salva = async (id: string, blocchi: unknown[]) => {
      const { error } = await sb.from('viste').update({ blocchi }).eq('id', id)
      if (error) throw error
    }
    // aggiunge righe di proposta in fondo a "Da valutare", sotto "# Ricerca del <oggi>"
    const accoda = async (nuove: string[]) => {
      if (!nuove.length) return
      const { data: fresca } = await sb.from('viste').select('blocchi').eq('id', inbox.id).single()   // può essere cambiata
      const blocchi = fresca?.blocchi || []
      const titolo = `# Ricerca del ${oggi}`
      await salva(inbox.id, [...blocchi, ...righeInBlocchi(blocchi.some((b: { text?: string }) => b.text === titolo) ? nuove : [titolo, ...nuove])])
    }
    const llm = (prompt: string) => {
      const key = Deno.env.get('GEMINI_API_KEY')
      if (!key) throw new Error('Manca il segreto GEMINI_API_KEY nella Edge Function')
      return gemini(prompt, key, Deno.env.get('GEMINI_MODEL'))
    }

    if (azione === 'avvia') {
      const blocchi = inbox.blocchi || []
      const fatte = parseProposte(blocchi).filter((p) => p.approvata)
      for (const p of fatte) {
        let dest = p.tipo === 'tema' ? temi : vistaDi(p.vista)
        if (!dest) {
          // vista che non c'è ancora: nasce in questa knowledge base
          const { data, error } = await sb.from('viste').insert({
            visione_id: scelta.id, titolo: p.vista, blocchi: [], is_template: false,
            livello: 0, parent_id: null, pos_x: 0, pos_y: 0, ordine: kb.length, stage: 'note',
          }).select('id,titolo,blocchi,visione_id').single()
          if (error) throw error
          dest = data as Vista
          kb.push(dest)
        }
        // link automatici: nelle righe nuove, i nomi delle altre viste della base diventano ((Vista|parola))
        const usati = new Set<string>()
        const nuove = righeIntegrazione(p, oggi).map((r: string) => p.tipo === 'tema' ? r : collegaTitoli(r, titoliKb, dest!.titolo, usati))
        dest.blocchi = [...(dest.blocchi || []), ...righeInBlocchi(nuove)]
        await salva(dest.id, dest.blocchi)
      }
      if (fatte.length) await salva(inbox.id, togliIntegrate(blocchi, fatte, oggi))
      const temiOra = fatte.some((p) => p.tipo === 'tema') ? elencoTemi(temi.blocchi || []) : elenco
      return json({ temi: temiOra, integrate: fatte.length, privata })
    }

    // contesto per il modello locale: va solo a chi chiama (il suo PC), mai a terzi
    if (azione === 'prepara') {
      return json({
        temi: elenco, privata, titoli: titoliKb, visti: giaVisti(inbox.blocchi || []),
        viste: Object.fromEntries(elenco.map((t) => { const v = vistaDi(t); return [t, { dest: v?.titolo || t, testo: aMarkdown(v?.blocchi || []).slice(0, 8000) }] })),
      })
    }

    if (azione === 'proponi') {
      const pulite = (Array.isArray(righe) ? righe : []).filter((r: unknown) => typeof r === 'string').slice(0, 60)
      await accoda(pulite)
      return json({ aggiunte: pulite.length })
    }

    if (azione === 'tema' && typeof tema === 'string' && tema.trim()) {
      const vista = vistaDi(tema)
      const r = await ricercaTema({
        tema, oggi, llm,
        // privacy alta (default): a Gemini va solo il nome del tema, mai il testo della vista
        giaSai: privata ? '' : aMarkdown(vista?.blocchi || []).slice(0, 8000),
        visti: giaVisti(inbox.blocchi || []),
        dest: vista?.titolo || tema,
      })
      await accoda(r.righe)
      return json({ tema, novita: r.novita, candidati: r.candidati })
    }

    if (azione === 'suggerisci') {
      // privacy alta: solo i nomi dei temi; normale: anche i titoli delle viste
      const j = await llm(promptTemi(elenco, privata ? [] : titoliKb))
      const nuove = righeTemi(j, elenco, giaVisti(inbox.blocchi || []))
      await accoda(nuove)
      return json({ temi: nuove.length / 2 })
    }

    return json({ error: 'azione sconosciuta' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
