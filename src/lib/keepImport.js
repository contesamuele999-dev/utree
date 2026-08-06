// Import note da Google Takeout (Google Keep).
// L'export di Keep è una cartella "Takeout/Keep/" con un file .json per ogni nota
// (più eventuali .html che ignoriamo). Ogni nota diventa una "vista" figlia di
// un'unica visione "Google Keep", per non mescolarle con l'albero esistente.
import { store } from './store.js'

function uid() { return 'id-' + Math.random().toString(36).slice(2, 10) }

// Converte una nota Keep (già parsata da JSON) nell'array di blocchi dell'editor.
function noteToBlocks(note) {
  const blocks = []
  if (note.listContent && note.listContent.length) {
    for (const item of note.listContent) {
      const mark = item.isChecked ? '- [x] ' : '- [ ] '
      blocks.push({ id: uid(), text: mark + (item.text || ''), indent: 0 })
    }
  } else if (note.textContent) {
    const lines = String(note.textContent).split('\n')
    for (const line of lines) blocks.push({ id: uid(), text: line, indent: 0 })
  }
  if (!blocks.length) blocks.push({ id: uid(), text: '' })
  return blocks
}

function noteTitle(note, fallbackIndex) {
  if (note.title && note.title.trim()) return note.title.trim()
  const firstLine = (note.textContent || '').split('\n').find(l => l.trim())
  if (firstLine) return firstLine.trim().slice(0, 60)
  const firstItem = note.listContent?.find(i => i.text?.trim())?.text
  if (firstItem) return firstItem.trim().slice(0, 60)
  return `Nota Keep ${fallbackIndex + 1}`
}

// files: array/FileList di File (selezionati dalla cartella Takeout/Keep, o l'intera cartella Takeout)
// options.skipTrashed: se true (default) salta le note nel cestino di Keep
// options.skipArchived: se true, salta anche le note archiviate (default false, le importa comunque)
export async function importGoogleKeep(files, { skipTrashed = true, skipArchived = false, onProgress } = {}) {
  const jsonFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.json'))
  if (!jsonFiles.length) throw new Error('Nessun file .json trovato: seleziona la cartella "Takeout/Keep" esportata da Google Takeout.')

  const notes = []
  for (const f of jsonFiles) {
    try {
      const parsed = JSON.parse(await f.text())
      // scarta file che non sono note Keep (es. Archive_browser.html non è json, ma per sicurezza controlliamo la forma)
      if (parsed && (parsed.textContent !== undefined || parsed.listContent !== undefined || parsed.title !== undefined)) {
        notes.push(parsed)
      }
    } catch {
      // file non json valido: ignora
    }
  }
  if (!notes.length) throw new Error('Nessuna nota Keep valida trovata nei file selezionati.')

  const vite = await store.list('vite')
  if (!vite.length) throw new Error('Nessuna "vita" trovata: crea prima una vita/visione in uTree.')
  const visione = await store.insert('visioni', {
    vita_id: vite[0].id,
    titolo: `Google Keep (${new Date().toLocaleDateString('it-IT')})`,
    colore: '#f4b400',
    ordine: 9999,
  })

  let imported = 0, skipped = 0
  let ordine = 0
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    if (skipTrashed && note.isTrashed) { skipped++; continue }
    if (skipArchived && note.isArchived) { skipped++; continue }
    await store.insert('viste', {
      visione_id: visione.id,
      titolo: noteTitle(note, i),
      blocchi: noteToBlocks(note),
      livello: 0,
      parent_id: null,
      pos_x: (ordine % 6) * 220,
      pos_y: Math.floor(ordine / 6) * 220,
      ordine: ordine++,
    })
    imported++
    onProgress?.(imported, notes.length)
  }

  return { imported, skipped, total: notes.length, visioneId: visione.id }
}
