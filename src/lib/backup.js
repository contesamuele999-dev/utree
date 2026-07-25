// Import/Export di tutti i dati dell'utente in un singolo file JSON.
import { store } from './store.js'
import { cacheVistaLocal } from './localcache.js'

export async function exportBackup() {
  let data
  try {
    // Le tabelle di Today possono non esistere (migrazione non ancora eseguita):
    // un backup deve riuscire lo stesso, semmai senza quella parte.
    const opz = (p) => p.catch(() => [])
    const [vite, visioni, viste, links, task, ricorrenza, giorno] = await Promise.all([
      store.list('vite'), store.list('visioni'), store.list('viste'), store.list('links'),
      opz(store.list('task')), opz(store.list('ricorrenza')), opz(store.list('giorno')),
    ])
    data = {
      app: 'arbora', version: 2, exportedAt: new Date().toISOString(),
      vite, visioni, viste, links, task, ricorrenza, giorno,
    }
  } catch (e) {
    alert('Impossibile leggere i dati per il backup: ' + (e?.message || e))
    throw e
  }

  const json = JSON.stringify(data, null, 2)
  const filename = `arbora-backup-${new Date().toISOString().slice(0,10)}.json`
  const blob = new Blob([json], { type: 'application/json' })

  // 1) Su mobile / PWA (dove il download via <a> spesso non parte) usa la condivisione file.
  try {
    if (navigator.canShare && typeof File !== 'undefined') {
      const file = new File([blob], filename, { type: 'application/json' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Backup Arbora' })
        return
      }
    }
  } catch (e) {
    // l'utente ha annullato la condivisione: non è un errore da segnalare
    if (e?.name === 'AbortError') return
    // altrimenti proviamo il download classico qui sotto
  }

  // 2) Download classico via link temporaneo.
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return
  } catch (e) {
    // 3) Ultima spiaggia: apri i dati in una nuova scheda così l'utente può salvarli a mano.
    try {
      const w = window.open('', '_blank')
      if (w) { w.document.title = filename; w.document.body.style.whiteSpace = 'pre-wrap'; w.document.body.textContent = json; return }
    } catch {}
    alert('Esportazione non riuscita su questo dispositivo: ' + (e?.message || e))
    throw e
  }
}

export async function importBackup(file) {
  const text = await file.text()
  const data = JSON.parse(text)
  if (data.app !== 'arbora') throw new Error('File non valido (non è un backup Arbora).')

  // mappa vecchi id -> nuovi id, per ricreare i collegamenti
  const map = {}
  for (const v of data.vite || []) {
    const nv = await store.insert('vite', { titolo: v.titolo, colore: v.colore, ordine: v.ordine })
    map[v.id] = nv.id
  }
  for (const v of data.visioni || []) {
    const nv = await store.insert('visioni', { vita_id: map[v.vita_id], titolo: v.titolo, colore: v.colore, ordine: v.ordine })
    map[v.id] = nv.id
  }
  for (const v of data.viste || []) {
    const base = {
      visione_id: map[v.visione_id], titolo: v.titolo, blocchi: v.blocchi || [],
      is_template: v.is_template, livello: v.livello || 0, parent_id: null,
      pos_x: v.pos_x || 0, pos_y: v.pos_y || 0, ordine: v.ordine || 0,
      ...(v.stage ? { stage: v.stage } : {}),
    }
    let nv
    try {
      nv = await store.insert('viste', { ...base, ...(v.cestino ? { cestino: v.cestino } : {}) })
    } catch (e) {
      // colonna cestino non ancora presente su Supabase: reinserisci senza
      nv = await store.insert('viste', base)
    }
    map[v.id] = nv.id
    // rete di sicurezza: cache locale, così la vista importata sopravvive al refresh anche se il cloud non conferma
    cacheVistaLocal(nv.id, { titolo: base.titolo, blocchi: base.blocchi, ...(v.cestino ? { cestino: v.cestino } : {}) })
  }
  // seconda passata: collega parent_id
  for (const v of data.viste || []) {
    if (v.parent_id && map[v.parent_id]) await store.update('viste', map[v.id], { parent_id: map[v.parent_id] })
  }
  for (const l of data.links || []) {
    if (map[l.da_vista] && map[l.a_vista]) {
      try { await store.insert('links', { da_vista: map[l.da_vista], a_vista: map[l.a_vista], tipo: l.tipo || 'maggiore' }) } catch {}
    }
  }

  // ---- Today: regole ricorrenti, task e giornate ----
  // Prima le regole (le task le referenziano), poi le task, poi le giornate.
  // Se le tabelle non esistono ancora si salta senza far fallire l'import:
  // meglio recuperare note e viste che bloccare tutto.
  for (const r of data.ricorrenza || []) {
    try {
      const nr = await store.insert('ricorrenza', {
        text: r.text || '', tipo: r.tipo || 'giornaliera', giorni: r.giorni || null,
        ogni: r.ogni || 1, dal: r.dal, al: r.al || null, attiva: r.attiva !== false,
        vista_id: map[r.vista_id] || null, blocco_id: r.blocco_id || null,
        ordine: r.ordine || 0, ultima_gen: r.ultima_gen || null,
      })
      map[r.id] = nr.id
    } catch { /* tabella assente: si prosegue */ }
  }
  for (const t of data.task || []) {
    try {
      await store.insert('task', {
        giorno: t.giorno, text: t.text || '', done: !!t.done, done_at: t.done_at || null,
        ordine: t.ordine || 0,
        vista_id: map[t.vista_id] || null, blocco_id: t.blocco_id || null,
        origin_giorno: t.origin_giorno || t.giorno, rollover: t.rollover || 0,
        ricorrenza_id: map[t.ricorrenza_id] || null,
      })
    } catch { /* tabella assente: si prosegue */ }
  }
  for (const g of data.giorno || []) {
    try {
      await store.upsertGiorno(g.giorno, {
        vittoria: g.vittoria || null, mood: g.mood || null,
        nota: g.nota || null, chiuso_at: g.chiuso_at || null,
      })
    } catch { /* tabella assente: si prosegue */ }
  }
}
