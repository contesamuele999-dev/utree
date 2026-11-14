// Prepara un'immagine scelta dall'utente: la ridimensiona (lato massimo) e la
// ricomprime in JPEG, così sia l'upload sul cloud sia il fallback base64 restano leggeri.
// Ritorna { blob, base64, width, height }.
export async function prepareImage(file, max = 1600, quality = 0.85) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
  const img = await new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = dataUrl
  })
  let width = img.naturalWidth || img.width
  let height = img.naturalHeight || img.height
  if (Math.max(width, height) > max) {
    const s = max / Math.max(width, height)
    width = Math.round(width * s)
    height = Math.round(height * s)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)
  const base64 = canvas.toDataURL('image/jpeg', quality)
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
  return { blob, base64, width, height }
}

// Primo file immagine negli appunti di un evento paste (screenshot, immagine copiata), o null.
export function clipboardImage(e) {
  for (const it of e.clipboardData?.items || []) {
    if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile()
  }
  return null
}
