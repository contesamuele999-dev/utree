// ============================================================
// Store dati Arbora
// Astrazione che funziona sia con Supabase (cloud sync) sia in
// modalità DEMO locale (IndexedDB-like via localStorage) quando
// Supabase non è configurato. Così l'app gira sempre.
// ============================================================
import { supabase, hasSupabase } from './supabase'
import { enqueue, isNetworkError, offlineId } from './offline.js'

const LS_KEY = 'arbora-demo-db'

// ============================================================
// Merge a 3 vie dei blocchi (sync multi-dispositivo)
// Se lo stesso account modifica una vista da più dispositivi, l'ultimo
// salvataggio non deve sovrascrivere le righe cambiate sull'altro dispositivo.
//   base   = blocchi com'erano all'ultimo allineamento col cloud
//   local  = blocchi modificati su QUESTO dispositivo
//   remote = blocchi attualmente nel cloud (forse cambiati altrove)
// Regola: si conservano le modifiche di entrambi. Per ogni riga (per id):
//   - modificata solo di qua o solo di là -> vince la versione modificata
//   - modificata da entrambi diversamente -> vince la locale (chi sta salvando)
//   - cancellata di qua ma modificata di là (o viceversa) -> si tiene (niente perdite)
// I riferimenti #n nelle formule restano coerenti perché si fondono per id
// mantenendo l'ordine del dispositivo che salva.
// ============================================================
export function mergeBlocchi(base, local, remote) {
  base = Array.isArray(base) ? base : []
  local = Array.isArray(local) ? local : []
  remote = Array.isArray(remote) ? remote : []
  const byId = arr => { const m = new Map(); for (const b of arr) if (b && b.id != null) m.set(b.id, b); return m }
  const bMap = byId(base), rMap = byId(remote)
  const sig = b => JSON.stringify({ text: b.text || '', indent: b.indent || 0, due: b.due || null, imgs: b.imgs || [] })
  const changed = (x, y) => !x || !y || sig(x) !== sig(y)

  const result = []
  const used = new Set()
  // 1) ordine LOCALE come riferimento (è il dispositivo che sta salvando)
  for (const lb of local) {
    used.add(lb.id)
    const bb = bMap.get(lb.id), rb = rMap.get(lb.id)
    if (!rb) {
      // assente nel cloud: nuova qui, oppure cancellata dal cloud
      if (bb && !changed(bb, lb)) continue   // cancellata altrove e non toccata qui -> elimina
      result.push(lb)                        // nuova qui, o modificata qui -> tieni
      continue
    }
    const localEdited = changed(bb, lb)
    const remoteEdited = changed(bb, rb)
    if (localEdited) result.push(lb)          // locale modificata -> vince la locale
    else if (remoteEdited) result.push(rb)    // solo remota modificata -> remota
    else result.push(lb)                      // invariata
  }
  // 2) righe presenti nel cloud ma non in locale
  for (const rb of remote) {
    if (used.has(rb.id)) continue
    const bb = bMap.get(rb.id)
    if (!bb) { result.push(rb); continue }    // aggiunta su un altro dispositivo -> includi
    if (changed(bb, rb)) result.push(rb)      // cancellata qui ma modificata altrove -> conserva
    // altrimenti: cancellata qui e intatta altrove -> elimina
  }
  return result
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || seed() }
  catch { return seed() }
}
function saveLocal(db) { localStorage.setItem(LS_KEY, JSON.stringify(db)) }
function uid() { return 'id-' + Math.random().toString(36).slice(2, 10) }

function seed() {
  const vitaId = uid(), visId = uid(), v1 = uid(), v2 = uid(), v3 = uid()
  const db = {
    vite: [{ id: vitaId, titolo: 'La mia impresa', colore: '#1f7a4d', ordine: 0 }],
    visioni: [{ id: visId, vita_id: vitaId, titolo: 'Lancio prodotto', colore: '#2e9e63', ordine: 0 }],
    viste: [
      { id: v1, visione_id: visId, titolo: 'Idea centrale', livello: 0, parent_id: null, pos_x: 0, pos_y: 0,
        blocchi: [
          { id: uid(), text: '# Idea centrale' },
          { id: uid(), text: 'Costruire **Arbora**, l\'app di note ad albero.' },
          { id: uid(), text: 'Vedi i dettagli in [[Strategia]] e [[Roadmap]].' },
        ] },
      { id: v2, visione_id: visId, titolo: 'Strategia', livello: 1, parent_id: v1, pos_x: -180, pos_y: 140,
        blocchi: [{ id: uid(), text: '# Strategia' }, { id: uid(), text: '- Target: imprenditori' }, { id: uid(), text: '- Canale: PWA cross-device' }] },
      { id: v3, visione_id: visId, titolo: 'Roadmap', livello: 1, parent_id: v1, pos_x: 180, pos_y: 140,
        blocchi: [{ id: uid(), text: '# Roadmap' }, { id: uid(), text: '1. MVP editor' }, { id: uid(), text: '2. Mappa 2.5D' }] },
    ],
    links: [
      { id: uid(), da_vista: v1, a_vista: v2, tipo: 'maggiore' },
      { id: uid(), da_vista: v1, a_vista: v3, tipo: 'maggiore' },
    ],
    // sezione Today: vuote all'inizio, lo storico nasce con l'uso
    task: [],
    ricorrenza: [],
    giorno: [],
  }
  saveLocal(db)
  return db
}

// ---------- API unificata ----------
export const store = {
  isCloud: hasSupabase,

  async list(table, filter = {}) {
    if (hasSupabase) {
      let q = supabase.from(table).select('*')
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v)
      // NB: la tabella `links` NON ha la colonna `ordine` -> ordiniamo solo per created_at,
      // altrimenti Supabase risponde "column links.ordine does not exist" e la lettura fallisce.
      const orderCols = table === 'links' ? ['created_at'] : ['ordine', 'created_at']
      for (const c of orderCols) q = q.order(c, { ascending: true })
      const { data, error } = await q
      if (error) throw error
      return data
    }
    const db = loadLocal()
    return (db[table] || []).filter(row => Object.entries(filter).every(([k, v]) => row[k] === v))
  },

  // `opts.noQueue` = chiamata fatta dal replay dell'outbox: non rimettere in coda.
  async insert(table, row, opts = {}) {
    if (hasSupabase) {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase.from(table).insert({ ...row, user_id: user.id }).select().single()
        if (error) throw error
        return data
      } catch (e) {
        if (opts.noQueue || !isNetworkError(e)) throw e
        // offline: riga provvisoria subito utilizzabile dalla UI, scrittura in coda
        const tmp = { id: offlineId(), created_at: new Date().toISOString(), ...row }
        enqueue({ op: 'insert', table, id: tmp.id, payload: row })
        return tmp
      }
    }
    const db = loadLocal()
    const newRow = { id: uid(), created_at: new Date().toISOString(), ...row }
    db[table] = [...(db[table] || []), newRow]
    saveLocal(db)
    return newRow
  },

  async update(table, id, patch, opts = {}) {
    if (hasSupabase) {
      try {
        const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single()
        if (error) throw error
        return data
      } catch (e) {
        if (opts.noQueue || !isNetworkError(e)) throw e
        enqueue({ op: 'update', table, id, payload: patch })
        return { id, ...patch }
      }
    }
    const db = loadLocal()
    db[table] = (db[table] || []).map(r => r.id === id ? { ...r, ...patch } : r)
    saveLocal(db)
    return db[table].find(r => r.id === id)
  },

  // Salva una vista fondendo i blocchi con la versione cloud corrente, così le
  // modifiche fatte in contemporanea su un altro dispositivo non vengono perse.
  // `base` = blocchi com'erano all'ultimo allineamento col cloud (per il merge a 3 vie).
  // Ritorna la riga salvata (con i `blocchi` risultanti dal merge).
  async updateVistaMerged(id, patch, base) {
    if (!hasSupabase) return this.update('viste', id, patch)
    let remote = null
    try {
      const { data } = await supabase.from('viste').select('blocchi').eq('id', id).single()
      remote = data?.blocchi
    } catch { /* se la lettura fallisce, si salva senza merge (best-effort) */ }
    let finalPatch = patch
    if (Array.isArray(remote) && Array.isArray(patch.blocchi)) {
      finalPatch = { ...patch, blocchi: mergeBlocchi(base, patch.blocchi, remote) }
    }
    const { data, error } = await supabase.from('viste').update(finalPatch).eq('id', id).select().single()
    if (error) throw error
    return data
  },

  async remove(table, id, opts = {}) {
    if (hasSupabase) {
      try {
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (error) throw error
        return
      } catch (e) {
        if (opts.noQueue || !isNetworkError(e)) throw e
        enqueue({ op: 'remove', table, id })
        return
      }
    }
    const db = loadLocal()
    db[table] = (db[table] || []).filter(r => r.id !== id)
    saveLocal(db)
  },

  // ---------- Today ----------
  // Inserimento multiplo (istanze delle task ricorrenti generate all'apertura).
  // Su Supabase c'è l'indice unico (ricorrenza_id, giorno): se un altro
  // dispositivo ha già generato lo stesso giorno, il duplicato viene IGNORATO
  // invece di far fallire tutto l'inserimento. In demo l'unicità la garantiamo
  // qui a mano, perché localStorage non ha vincoli.
  async insertMany(table, rows) {
    const list = (rows || []).filter(Boolean)
    if (!list.length) return []
    if (hasSupabase) {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = list.map(r => ({ ...r, user_id: user.id }))
      const q = supabase.from(table).insert(payload, { defaultToNull: false })
      const { data, error } = await q.select()
      if (error) {
        // 23505 = violazione di unicità: qualcun altro ha già generato queste
        // istanze. Non è un errore per noi, l'esito voluto è già in tabella.
        if (error.code === '23505') return []
        throw error
      }
      return data
    }
    const db = loadLocal()
    const esistenti = new Set(
      (db[table] || []).filter(r => r.ricorrenza_id).map(r => `${r.ricorrenza_id}|${r.giorno}`)
    )
    const nuove = []
    for (const r of list) {
      const k = r.ricorrenza_id ? `${r.ricorrenza_id}|${r.giorno}` : null
      if (k && esistenti.has(k)) continue
      if (k) esistenti.add(k)
      nuove.push({ id: uid(), created_at: new Date().toISOString(), ...r })
    }
    db[table] = [...(db[table] || []), ...nuove]
    saveLocal(db)
    return nuove
  },

  // Il rito serale: una riga per data (vincolo unique(user_id, giorno)).
  async upsertGiorno(giornoKey, patch, opts = {}) {
    if (hasSupabase) {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase.from('giorno')
          .upsert({ ...patch, giorno: giornoKey, user_id: user.id }, { onConflict: 'user_id,giorno' })
          .select().single()
        if (error) throw error
        return data
      } catch (e) {
        if (opts.noQueue || !isNetworkError(e)) throw e
        enqueue({ op: 'upsertGiorno', table: 'giorno', id: giornoKey, payload: patch })
        return { id: 'off-giorno-' + giornoKey, giorno: giornoKey, ...patch }
      }
    }
    const db = loadLocal()
    db.giorno = db.giorno || []
    const i = db.giorno.findIndex(g => g.giorno === giornoKey)
    if (i >= 0) db.giorno[i] = { ...db.giorno[i], ...patch }
    else db.giorno.push({ id: uid(), created_at: new Date().toISOString(), giorno: giornoKey, ...patch })
    saveLocal(db)
    return db.giorno.find(g => g.giorno === giornoKey)
  },

  // ---------- Allegati immagine (Supabase Storage) ----------
  // Carica un blob immagine nel bucket 'vista-immagini' sotto la cartella dell'utente
  // e ritorna { url, path }. In modalità demo non viene chiamata (si usa base64).
  async uploadImage(blob, vistaId) {
    if (!hasSupabase) throw new Error('Storage non disponibile in modalità demo')
    const { data: { user } } = await supabase.auth.getUser()
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const path = `${user.id}/${vistaId}/${name}`
    const { error } = await supabase.storage.from('vista-immagini')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) throw error
    const { data } = supabase.storage.from('vista-immagini').getPublicUrl(path)
    return { url: data.publicUrl, path }
  },

  async removeImage(path) {
    if (!hasSupabase || !path) return
    await supabase.storage.from('vista-immagini').remove([path])
  },
}
