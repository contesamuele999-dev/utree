// ============================================================
// uTree — invito a un team: L'EMAIL
//
// Perche' esiste questa funzione: invitare qualcuno scriveva soltanto una riga
// in `team_membro`. Nessuno avvisava l'invitato, che quindi non riceveva niente
// e non poteva sapere di essere stato invitato. Da qui la segnalazione
// "le email degli inviti non arrivano": non arrivavano perche' non partivano.
//
// L'email NON puo' partire dal browser: servirebbe la chiave del servizio di
// posta, e una chiave dentro un bundle pubblico e' una chiave regalata. Quindi
// parte da qui, da una Edge Function, dove la chiave sta in un segreto.
//
// Il servizio di posta e' MAILEROO (API v2). Le email di sistema di Supabase
// (conferma registrazione, reset password) NON passano di qui: si configurano
// a parte, con l'SMTP di Maileroo, dal pannello di Supabase. Vedi README.
//
// Autorizzazione: si riusa il JWT di chi chiama. La funzione NON usa la
// service_role key, cosi' le RLS restano l'unico giudice di chi puo' invitare
// in quale team — esattamente come per il resto dell'app.
//
// Deploy (una volta sola):
//   supabase functions deploy invita-team
//   supabase secrets set MAILEROO_API_KEY=...
//   supabase secrets set UTREE_MITTENTE="uTree <invito@tuodominio.it>"
//   supabase secrets set UTREE_APP_URL=https://tuo-utente.github.io/utree/
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAILEROO = 'https://smtp.maileroo.com/api/v2/emails'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Maileroo vuole indirizzo e nome del mittente in due campi distinti. Il segreto
// pero' resta nel formato che si usa ovunque ("Nome <indirizzo>"), che e' quello
// che uno si aspetta di scrivere: la separazione la facciamo qui.
function mittente(raw: string) {
  const m = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/)
  if (m) return { address: m[2].trim(), display_name: m[1].replace(/^"|"$/g, '') || 'uTree' }
  return { address: raw.trim(), display_name: 'uTree' }
}

function corpo(nomeTeam: string, invitante: string, link: string) {
  const t = escapeHtml(nomeTeam)
  const i = escapeHtml(invitante)
  const l = escapeHtml(link)

  const plain = [
    `${invitante} ti ha invitato nel team "${nomeTeam}" su uTree.`,
    '',
    "uTree e' un'app di note ad albero: vite, visioni, viste.",
    'Entrando nel team vedrai i progetti che sono stati condivisi con te.',
    '',
    "Apri questo link e crea l'account con QUESTO indirizzo email:",
    link,
    '',
    'Se non aspettavi questo invito, puoi ignorare il messaggio.',
  ].join('\n')

  const html = `<div style="font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a2620;max-width:520px">
  <h2 style="font-size:19px;margin:0 0 14px">${i} ti ha invitato nel team &ldquo;${t}&rdquo;</h2>
  <p style="margin:0 0 14px;color:#5c7065">
    uTree e&rsquo; un&rsquo;app di note ad albero: vite, visioni, viste.
    Entrando nel team vedrai i progetti che sono stati condivisi con te.
  </p>
  <p style="margin:0 0 22px">
    <a href="${l}" style="display:inline-block;background:#1f7a4d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Entra nel team</a>
  </p>
  <p style="margin:0 0 14px;color:#5c7065;font-size:13px">
    Importante: crea l&rsquo;account con <b>questo stesso indirizzo email</b>, altrimenti
    l&rsquo;invito non si aggancia.
  </p>
  <p style="margin:0;color:#8b9b92;font-size:12px">
    Se non aspettavi questo invito, puoi ignorare il messaggio.
  </p>
</div>`

  return { plain, html }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ errore: 'Metodo non ammesso.' }, 405)

  const CHIAVE = Deno.env.get('MAILEROO_API_KEY')
  const DA = Deno.env.get('UTREE_MITTENTE')
  const BASE = (Deno.env.get('UTREE_APP_URL') || '').trim()
  if (!CHIAVE) return json({ errore: 'MAILEROO_API_KEY non configurata sul progetto Supabase.' }, 503)
  if (!DA) return json({ errore: 'UTREE_MITTENTE non configurata sul progetto Supabase.' }, 503)
  if (!BASE) return json({ errore: 'UTREE_APP_URL non configurata sul progetto Supabase.' }, 503)

  const authorization = req.headers.get('Authorization') || ''
  if (!authorization) return json({ errore: 'Non autenticato.' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )

  const { data: ud } = await supabase.auth.getUser()
  const utente = ud?.user
  if (!utente) return json({ errore: 'Non autenticato.' }, 401)

  let membroId = ''
  try { membroId = (await req.json())?.membroId || '' } catch { /* body assente */ }
  if (!membroId) return json({ errore: 'membroId mancante.' }, 400)

  // La riga dell'invito: la SELECT passa dalle RLS, quindi qui arriva solo
  // quello che chi chiama puo' davvero vedere.
  const { data: membro, error: eM } = await supabase
    .from('team_membro').select('id, team_id, email, stato').eq('id', membroId).single()
  if (eM || !membro) return json({ errore: 'Invito non trovato.' }, 404)

  // ...ma "vedere" non basta: per SPEDIRE bisogna poter amministrare quel team.
  const { data: amministrati } = await supabase.rpc('utree_team_amministrati')
  const ids = (amministrati || []).map((r: unknown) =>
    typeof r === 'string' ? r : (r as { utree_team_amministrati?: string })?.utree_team_amministrati)
  if (!ids.includes(membro.team_id)) return json({ errore: 'Non puoi invitare in questo team.' }, 403)

  const { data: team } = await supabase.from('team').select('nome').eq('id', membro.team_id).single()

  const link = BASE.replace(/\/*$/, '/') + '?invito=' + encodeURIComponent(membro.email)
  const { plain, html } = corpo(team?.nome || 'il team', utente.email || 'Un utente di uTree', link)

  let risposta: Response
  try {
    risposta = await fetch(MAILEROO, {
      method: 'POST',
      headers: { 'X-API-Key': CHIAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: mittente(DA),
        to: [{ address: membro.email }],
        reply_to: { address: utente.email },
        subject: `${utente.email} ti ha invitato nel team "${team?.nome || 'uTree'}"`,
        plain,
        html,
      }),
    })
  } catch (e) {
    console.error('[invita-team] Maileroo irraggiungibile:', e)
    return json({ errore: 'Servizio di posta irraggiungibile.' }, 502)
  }

  // ATTENZIONE: Maileroo risponde 200 anche quando NON ha accettato il messaggio,
  // e mette l'esito vero in `success`. Guardare solo lo stato HTTP significherebbe
  // dire "email inviata" a chi non la ricevera' mai — cioe' ricadere esattamente
  // nel problema che questa funzione esiste per risolvere.
  const grezzo = await risposta.text()
  let esito: { success?: boolean; message?: string } = {}
  try { esito = JSON.parse(grezzo) } catch { /* risposta non JSON */ }

  if (!risposta.ok || esito.success !== true) {
    console.error('[invita-team] invio rifiutato:', risposta.status, grezzo)
    return json({ errore: esito.message || `Maileroo ha rifiutato il messaggio (HTTP ${risposta.status}).` }, 502)
  }

  return json({ ok: true, email: membro.email, link })
})
