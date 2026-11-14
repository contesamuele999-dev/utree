// Mini renderer markdown inline (titoli, grassetto, corsivo, code, wikilink [[...]])
// Volutamente leggero: niente dipendenze, veloce per il flusso creativo.

// ---- Formule tipo Excel: una riga che inizia con "=" viene calcolata ----
// Supporta + - * / ( ) e le potenze con ^, più alcune funzioni (sqrt, round,
// floor, ceil, abs, min, max, pow). La virgola è ammessa solo dentro le funzioni
// (es. =min(3,5)); come separatore decimale usare il punto (es. =1.5*2).
// Riferimenti ad altre righe (stile Excel): #1, #2 ... richiamano il VALORE
// numerico della riga corrispondente (1 = prima riga). La riga referenziata può
// essere un numero puro oppure a sua volta una formula. Es. =#1+#2, =#3*1.22.
// Nessun eval arbitrario: si accettano solo cifre, operatori e i nomi funzione noti.
const FORMULA_FNS = ['sqrt', 'round', 'floor', 'ceil', 'abs', 'min', 'max', 'pow']

// Valore numerico "grezzo" del testo di una riga: numero puro (accetta la virgola
// come separatore decimale) oppure null se non è un numero.
function rawNumber(text) {
  const s = (text || '').trim()
  if (!s) return null
  if (!/^[-+]?[0-9]+([.,][0-9]+)?$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return isFinite(n) ? n : null
}

// Valore numerico della riga `index` (0-based) all'interno di `blocks`: se è una
// formula la calcola (ricorsivamente), altrimenti la interpreta come numero.
// `seen` traccia gli indici in corso di calcolo per bloccare i riferimenti circolari.
function rowValue(blocks, index, seen) {
  if (!blocks || index < 0 || index >= blocks.length) return null
  if (seen.has(index)) return null // riferimento circolare -> non calcolabile
  seen.add(index)
  const t = (blocks[index]?.text || '').trim()
  let v
  if (t.startsWith('=') && t.length > 1) v = evalFormula(t.slice(1), blocks, seen)
  else v = rawNumber(t)
  seen.delete(index)
  return v
}

// Calcola una formula. `blocks` (facoltativo) abilita i riferimenti #n; `seen`
// serve alla ricorsione (guardia anti-ciclo) e di norma non va passato dall'esterno.
export function evalFormula(raw, blocks, seen) {
  let e = (raw || '').trim()
  if (!e) return null
  e = e.replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**')
  // Riferimenti ad altre righe: #1, #2 ... sostituiti col loro valore numerico.
  if (/#\d+/.test(e)) {
    const s = seen || new Set()
    let bad = false
    e = e.replace(/#(\d+)/g, (_, n) => {
      const v = rowValue(blocks, parseInt(n, 10) - 1, s)
      if (v === null || !isFinite(v)) { bad = true; return '0' }
      return '(' + v + ')'
    })
    if (bad) return null // una riga referenziata non è un numero valido
  }
  // togliamo i nomi funzione noti, poi verifichiamo che resti solo aritmetica sicura
  const cleaned = e.replace(new RegExp('\\b(' + FORMULA_FNS.join('|') + ')\\b', 'g'), '')
  if (/[^0-9+\-*/().,%\s]/.test(cleaned)) return null
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...FORMULA_FNS, 'return (' + e + ')')
    const r = fn(Math.sqrt, Math.round, Math.floor, Math.ceil, Math.abs, Math.min, Math.max, Math.pow)
    if (typeof r === 'number' && isFinite(r)) return Math.round(r * 1e10) / 1e10
  } catch { /* espressione non valida */ }
  return null
}

// Colori del testo: {rosso:testo}. Il contenuto può avere altra formattazione dentro.
export const COLORI = ['rosso', 'arancio', 'giallo', 'verde', 'blu', 'viola', 'grigio']
const RE_COLORE = '\\{(?:' + COLORI.join('|') + '):[^{}]+\\}'

export function renderInline(text) {
  // gestisce **bold**, *italic*, `code`, ((collegamento)), [[collegamento]], {colore:testo} e i link web
  const parts = []
  let i = 0
  const regex = new RegExp(RE_COLORE + '|' + /(\*\*[^*]+\*\*|\^\^[^^]+\^\^|\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\]|\(\([^()]+\)\)|https?:\/\/[^\s<]+|www\.[^\s<]+)/.source, 'g')
  let last = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('{')) {
      const k = tok.indexOf(':')
      parts.push(<span key={i++} className={'tc-' + tok.slice(1, k)}>{renderInline(tok.slice(k + 1, -1))}</span>)
    }
    else if (tok.startsWith('**')) parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('^^')) parts.push(<span key={i++} className="smallcaps">{tok.slice(2, -2)}</span>)
    else if (tok.startsWith('*')) parts.push(<em key={i++}>{tok.slice(1, -1)}</em>)
    else if (tok.startsWith('`')) parts.push(<code key={i++}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[[') || tok.startsWith('((')) {
      // ((Vista|parola)): collega a "Vista" ma nel testo mostra "parola"
      const [name, label] = tok.slice(2, -2).split('|').map(s => s.trim())
      parts.push(<span key={i++} className="wikilink" data-link={name}>{label || name}</span>)
    }
    else if (/^https?:\/\//.test(tok) || tok.startsWith('www.')) {
      // stacca l'eventuale punteggiatura finale (così "…(vedi http://x.it)." resta pulito)
      let url = tok, tail = ''
      const punct = url.match(/[.,;:!?)\]]+$/)
      if (punct) { tail = punct[0]; url = url.slice(0, -tail.length) }
      const href = url.startsWith('http') ? url : 'https://' + url
      parts.push(
        <a key={i++} className="weblink" href={href} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}>{url}</a>
      )
      if (tail) parts.push(tail)
    }
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// `blocks` + `index` (facoltativi) abilitano i riferimenti #n dentro le formule.
export function RenderedBlock({ text, onWikilink, blocks, index }) {
  const t = text || ''
  const click = (e) => {
    const link = e.target.getAttribute?.('data-link')
    if (link && onWikilink) { e.stopPropagation(); onWikilink(link) }
  }
  if (t.startsWith('=') && t.length > 1) {
    const res = evalFormula(t.slice(1), blocks, new Set(typeof index === 'number' ? [index] : []))
    if (res !== null) return (
      <div onClick={click} className="formula-block">
        <span className="formula-expr">{t}</span>
        <span className="formula-eq"> = </span>
        <b className="formula-res">{res}</b>
      </div>
    )
    // non calcolabile: mostra il testo così com'è
  }
  if (t.startsWith('### ')) return <h3 onClick={click}>{renderInline(t.slice(4))}</h3>
  if (t.startsWith('## ')) return <h2 onClick={click}>{renderInline(t.slice(3))}</h2>
  if (t.startsWith('# ')) return <h1 onClick={click}>{renderInline(t.slice(2))}</h1>
  if (t.trim() === '---') return <div className="divider-block" />
  if (/^\s*[-*]\s/.test(t)) return <div onClick={click}>• {renderInline(t.replace(/^\s*[-*]\s/, ''))}</div>
  if (/^\s*\d+\.\s/.test(t)) {
    const n = t.match(/^\s*(\d+)\./)[1]
    return <div onClick={click}>{n}. {renderInline(t.replace(/^\s*\d+\.\s/, ''))}</div>
  }
  return <div onClick={click}>{renderInline(t) }</div>
}
