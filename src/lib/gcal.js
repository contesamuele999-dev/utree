// ============================================================
// Integrazione Google Calendar — lato client (Google Identity Services)
// ------------------------------------------------------------
// Ogni utente collega il PROPRIO account Google direttamente dal browser:
// nessun backend, adatto all'hosting statico (GitHub Pages).
//
// Flusso:
//   connect()  -> mostra il consenso Google e memorizza l'intento "collegato"
//   getToken() -> access token valido (rinnovato in silenzio quando scade)
//   upsertEvent()/deleteEvent() -> gestiscono l'evento "tutto il giorno"
//                                  corrispondente alla scadenza di una riga.
//
// L'access token vive ~1 ora e resta solo in memoria; l'intento di
// collegamento è ricordato in localStorage (per utente) così al reload
// il token viene richiesto in silenzio senza ripetere il consenso.
// ============================================================

import { store } from './store.js'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GSI_SRC = 'https://accounts.google.com/gsi/client'
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const KEY = 'utree-gcal'   // localStorage: id dell'utente collegato ('' se nessuno)

// True se l'app è configurata con un Client ID Google.
export const hasGoogleCalendar = Boolean(CLIENT_ID)

// Collegato? Se `userId` è passato controlla che sia proprio quell'utente.
export function isConnected(userId) {
  try {
    const v = localStorage.getItem(KEY)
    return userId ? v === userId : Boolean(v)
  } catch { return false }
}
function setConnectedFlag(userId, on) {
  try {
    if (on) localStorage.setItem(KEY, userId || 'demo')
    else localStorage.removeItem(KEY)
  } catch { /* ignore */ }
}

// ---- Caricamento una tantum dello script GIS ----
let gsiPromise = null
function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gsiPromise) return gsiPromise
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GSI_SRC; s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => { gsiPromise = null; reject(new Error('Impossibile caricare Google Identity Services')) }
    document.head.appendChild(s)
  })
  return gsiPromise
}

// ---- Token client riusabile + cache del token in memoria ----
let tokenClient = null
let cached = { token: null, expiry: 0 }

async function ensureClient() {
  if (!CLIENT_ID) throw new Error('Google Calendar non configurato (manca VITE_GOOGLE_CLIENT_ID)')
  await loadGsi()
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {},   // impostata di volta in volta in requestToken()
    })
  }
  return tokenClient
}

// Richiede un access token. prompt '' = silenzioso (se già concesso),
// 'consent' = mostra la finestra di consenso Google.
function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    ensureClient().then(client => {
      client.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error))
        cached = { token: resp.access_token, expiry: Date.now() + ((resp.expires_in || 3600) - 60) * 1000 }
        resolve(cached.token)
      }
      try { client.requestAccessToken({ prompt }) }
      catch (e) { reject(e) }
    }).catch(reject)
  })
}

// Access token valido: dalla cache o rinnovato in silenzio.
async function getToken() {
  if (cached.token && Date.now() < cached.expiry) return cached.token
  return requestToken('')
}

// Collega l'account (richiede interazione utente): mostra il consenso.
export async function connect(userId) {
  const token = await requestToken('consent')
  setConnectedFlag(userId, true)
  return token
}

// Scollega: revoca il token e dimentica l'intento.
export async function disconnect(userId) {
  try {
    if (cached.token && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(cached.token, () => {})
    }
  } catch { /* ignore */ }
  cached = { token: null, expiry: 0 }
  setConnectedFlag(userId, false)
}

// ---- Costruzione dell'evento ----
// Titolo pulito dalla riga (via markdown/link) limitato a una lunghezza ragionevole.
function plainTitle(text) {
  return (text || '')
    .replace(/\(\(([^)]+)\)\)/g, '$1')     // ((link)) -> link
    .replace(/\[\[([^\]]+)\]\]/g, '$1')     // [[vista]] -> vista
    .replace(/[#*`>_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'uTree — scadenza'
}

// Evento "tutto il giorno" sulla data di scadenza (end = giorno dopo, come da spec Google).
function eventBody(block, vistaTitle) {
  const day = block.due                       // 'YYYY-MM-DD'
  const end = new Date(day + 'T00:00:00')
  end.setDate(end.getDate() + 1)
  const endStr = end.toISOString().slice(0, 10)
  return {
    summary: plainTitle(block.text),
    description: 'Scadenza da uTree' + (vistaTitle ? ' · ' + vistaTitle : ''),
    colorId: '10',            // "Basil" — sfumatura di verde (coerente col tema uTree)
    transparency: 'transparent',  // "Disponibile" (non "Occupato"): non blocca Calendly & co.
    start: { date: day },
    end: { date: endStr },
    source: { title: 'uTree', url: window.location.origin },
    extendedProperties: { private: { utreeBlock: String(block.id) } },
  }
}

// Crea o aggiorna l'evento della riga. Ritorna l'eventId (da salvare in block.gcal).
export async function upsertEvent(block, vistaTitle) {
  const token = await getToken()
  const body = eventBody(block, vistaTitle)
  const existing = block.gcal
  const url = existing ? API + '/' + encodeURIComponent(existing) : API
  const method = existing ? 'PATCH' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // Evento rimosso lato Google: ricrea da zero.
  if ((res.status === 404 || res.status === 410) && existing) {
    return upsertEvent({ ...block, gcal: null }, vistaTitle)
  }
  if (!res.ok) throw new Error('Google Calendar ha risposto ' + res.status)
  const data = await res.json()
  return data.id
}

// Backfill: al collegamento, segna su Calendar tutte le righe con scadenza
// già esistenti e non ancora sincronizzate (blocco con `due` ma senza `gcal`).
// Salva l'eventId nel blocco e aggiorna la vista. Ritorna il numero di eventi creati.
// Best-effort: un errore su una riga non blocca le altre.
export async function syncAllPending() {
  if (!hasGoogleCalendar || !isConnected()) return 0
  const viste = await store.list('viste')
  let created = 0
  for (const v of viste) {
    const blocchi = Array.isArray(v.blocchi) ? v.blocchi : []
    let changed = false
    const next = []
    for (const b of blocchi) {
      if (b?.due && !b.gcal) {
        try {
          const id = await upsertEvent(b, v.titolo)
          next.push({ ...b, gcal: id })
          created++; changed = true
          continue
        } catch { /* riga saltata: si ritenterà al prossimo cambio scadenza */ }
      }
      next.push(b)
    }
    if (changed) {
      try { await store.update('viste', v.id, { blocchi: next }) } catch { /* ignore */ }
    }
  }
  return created
}

// Elimina l'evento (ignora "già assente").
export async function deleteEvent(eventId) {
  if (!eventId) return
  const token = await getToken()
  const res = await fetch(API + '/' + encodeURIComponent(eventId), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error('Google Calendar ha risposto ' + res.status)
  }
}
