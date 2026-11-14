// ============================================================
// Agente notizie della knowledge base — logica condivisa.
// Usata dalla Edge Function `agente-notizie` (Deno) e dai test Node
// (scripts/agente-notizie.test.mjs). Niente dipendenze: solo fetch.
//
// Fonti gratuite e vere (Europe PMC, Google News RSS); Gemini (piano
// gratuito, SENZA ricerca Google, che è a pagamento) sceglie e riassume.
// url, fonte e data arrivano sempre dal candidato vero, mai dal modello.
// ============================================================

export const IS_KB = /knowledge|banca dati|\bkb\b/i;
const RE_PROPOSTA = /^(Novità|Metodo)\s*·\s*(.+?)\s*→\s*vista:\s*(.+?)(?:\s+ok)?\s*$/i;
export const bid = () => "b-" + Math.random().toString(36).slice(2, 9);
export const oggiIso = () => new Date().toISOString().slice(0, 10);

// ---------- parti pure ----------

/** Blocchi di "Da valutare" → proposte { tipo, titolo, vista, approvata, figli, da, a } (indici dei blocchi). */
export function parseProposte(blocchi) {
  const out = [];
  for (let i = 0; i < blocchi.length; i++) {
    const b = blocchi[i];
    if (b.indent) continue;
    const m = (b.text || "").match(RE_PROPOSTA);
    if (!m) continue;
    let j = i + 1;
    while (j < blocchi.length && blocchi[j].indent) j++;
    out.push({
      tipo: m[1].toLowerCase() === "novità" ? "novita" : "metodo",
      titolo: m[2], vista: m[3],
      approvata: !!b.done || /\bok\s*$/i.test(b.text),
      figli: blocchi.slice(i + 1, j).map((x) => x.text || ""),
      da: i, a: j,
    });
  }
  return out;
}

/** Valore di una riga figlia "Etichetta: valore". */
export const campo = (figli, etichetta) =>
  (figli.find((f) => f.toLowerCase().startsWith(etichetta.toLowerCase() + ":")) || "").slice(etichetta.length + 1).trim();

/** Blocchi → testo (due spazi = un livello). */
export const aMarkdown = (blocchi) => blocchi.map((b) => "  ".repeat(b.indent || 0) + (b.text || "")).join("\n");

/** Righe "  testo" → blocchi con id nuovo. */
export const righeInBlocchi = (righe) => righe.map((r) => {
  const ind = (r.match(/^( {2})*/)[0].length) / 2;
  return { id: bid(), text: r.trimStart(), ...(ind ? { indent: ind } : {}) };
});

/** JSON dentro una risposta (con o senza ```json). */
export function estraiJson(testo) {
  const s = testo.indexOf("{"), e = testo.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  try { return JSON.parse(testo.slice(s, e + 1)); } catch { return null; }
}

/** <item> di un feed RSS (Google News) → { titolo, url, fonte, data }. */
export function parseRss(xml) {
  const tag = (s, t) => (s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
  const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const d = new Date(tag(it, "pubDate"));
    return { titolo: dec(tag(it, "title")), url: dec(tag(it, "link")), fonte: dec(tag(it, "source")), data: isNaN(d) ? "" : d.toISOString().slice(0, 10) };
  });
}

/**
 * Toglie da "Da valutare" le proposte approvate e registra l'integrazione sotto "# Integrate".
 * Ritorna i nuovi blocchi (gli altri blocchi restano identici, con id e spunte).
 */
export function togliIntegrate(blocchi, fatte, oggi) {
  const via = new Set(fatte.flatMap((p) => Array.from({ length: p.a - p.da }, (_, k) => p.da + k)));
  const resto = blocchi.filter((_, i) => !via.has(i));
  const log = fatte.map((p) => ({ id: bid(), text: `${oggi} · ${p.titolo} → ${p.vista}`, indent: 1 }));
  const h = resto.findIndex((b) => (b.text || "").trim() === "# Integrate");
  if (h < 0) resto.push({ id: bid(), text: "# Integrate" }, ...log);
  else resto.splice(h + 1, 0, ...log);
  return resto;
}

/** Righe da aggiungere alla vista di destinazione per una proposta approvata. */
export const righeIntegrazione = (p, oggi) => p.tipo === "novita"
  ? [`💡 ${p.titolo}: ${campo(p.figli, "Cosa aggiunge")}`, `  ${campo(p.figli, "Fonte")} · integrata ${oggi}`]
  : [`🔧 ${p.titolo} (${oggi})`, `  ${campo(p.figli, "Modifica proposta")}`, `  Perché: ${campo(p.figli, "Perché")}`];

/** Titoli già proposti o integrati (per non riproporli). */
export const giaVisti = (blocchi) => [
  ...parseProposte(blocchi).map((p) => p.titolo),
  ...blocchi.filter((b) => b.indent && /^\d{4}-\d\d-\d\d · /.test(b.text || "")).map((b) => b.text.slice(13)),
];

/**
 * Privacy della knowledge base, scritta nella vista "🛰 Temi da seguire":
 *   "Privacy: alta"    (default, anche se la riga manca) → a Gemini va SOLO il nome del tema
 *   "Privacy: normale" → anche il testo della vista del tema (proposte più mirate)
 */
export const privacyAlta = (blocchi) => !(blocchi || []).some((b) => /^privacy:\s*normale\b/i.test((b.text || "").trim()));

/** Viste con cui nasce una nuova knowledge base. */
export const KB_VISTE = [
  ["🛰 Temi da seguire", [
    `Come funziona: scrivi sotto "Temi" una riga per argomento. Può essere il titolo esatto di una vista di questa knowledge base oppure un tema libero. Ogni lunedì (o con "Cerca ora") l'agente cerca novità e le mette in "📥 Da valutare".`,
    "Privacy: alta",
    "  alta = a Gemini va solo il nome del tema · normale = anche il testo della vista del tema (proposte più mirate, ma il testo esce da uTree)",
    "Temi",
    "  ",
  ]],
  ["📥 Da valutare", [
    `Come funziona: l'agente aggiunge qui le novità. Per ognuna metti la spunta (o scrivi "ok" in fondo alla riga) se va aggiunta; cancellala se non ti interessa. Alla ricerca successiva l'agente integra quelle approvate nella vista giusta.`,
  ]],
];

/** Temi = righe rientrate sotto la riga "Temi". */
export function elencoTemi(blocchi) {
  const i = blocchi.findIndex((b) => (b.text || "").trim().toLowerCase() === "temi");
  return blocchi.slice(i + 1).filter((b) => b.indent && b.text?.trim()).map((b) => b.text.trim());
}

/** Scelte di Gemini + candidati → righe di proposta (url/fonte/data dal candidato). */
export function righeProposte(j, candidati, dest) {
  const novita = (j?.novita || []).filter((n) => candidati[n.i]).slice(0, 3);
  const righe = [];
  for (const n of novita) {
    const c = candidati[n.i];
    // un preprint non è ancora revisionato: mai "alta", qualunque cosa dica il modello
    if (/preprint/i.test(c.fonte) && /alta/i.test(n.affidabilita || "")) n.affidabilita = "media (preprint)";
    righe.push(`Novità · ${n.titolo} → vista: ${dest}`,
      `  Cosa aggiunge: ${n.cosa_aggiunge}`,
      `  Fonte: ${c.url} (${c.fonte}, ${c.data}) · affidabilità: ${n.affidabilita}, ${n.motivo}`);
  }
  for (const m of (novita.length ? j.metodi || [] : [])) {
    righe.push(`Metodo · ${m.cosa} → vista: ${dest}`, `  Perché: ${m.perche}`, `  Modifica proposta: ${m.modifica}`);
  }
  return { righe, novita: novita.length };
}

// ---------- rete ----------

const giorni = (oggi, n) => new Date(Date.parse(oggi) - n * 864e5).toISOString().slice(0, 10);

/** Gemini senza strumenti, risposta JSON. Prova il modello scelto, poi quello di riserva. */
export async function gemini(prompt, key, modello) {
  const modelli = [modello || "gemini-flash-lite-latest", "gemini-flash-latest"];
  let ultimo = "";
  for (const m of modelli) {
    for (let t = 0; t < 2; t++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
          signal: AbortSignal.timeout(40000),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) return estraiJson((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
        ultimo = `Gemini ${m} ${res.status}: ${j.error?.message || ""}`;
        if (res.status !== 429 && res.status !== 503) break;   // errore vero: prova l'altro modello
        await new Promise((r) => setTimeout(r, 8000));         // piano gratuito: sovraccarico, riprova
      } catch (e) {
        ultimo = `Gemini ${m}: ${e.message}`;                    // timeout: passa al modello successivo
        break;
      }
    }
  }
  throw new Error(ultimo);
}

/** Studi e preprint degli ultimi 10 giorni (Europe PMC: PubMed + preprint, gratis, senza chiave). */
export async function cercaStudi(query, oggi) {
  const q = `(${query}) AND FIRST_PDATE:[${giorni(oggi, 10)} TO ${oggi}]`;
  const r = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=15&sort=CITED%20desc&query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  return (j.resultList?.result || []).map((a) => ({
    titolo: a.title,
    url: a.doi ? `https://doi.org/${a.doi}` : `https://europepmc.org/article/${a.source}/${a.id}`,
    fonte: a.source === "PPR" ? "preprint" : a.journalInfo?.journal?.title || a.journalTitle || "",
    data: a.firstPublicationDate || "",
    estratto: (a.abstractText || "").replace(/<[^>]+>/g, "").slice(0, 600),
  }));
}

/** Notizie degli ultimi 10 giorni (Google News RSS, gratis). */
export async function cercaNotizie(query) {
  const r = await fetch(`https://news.google.com/rss/search?hl=it&gl=IT&ceid=IT:it&q=${encodeURIComponent(query + " when:10d")}`, { signal: AbortSignal.timeout(30000) });
  return parseRss(await r.text()).slice(0, 15);
}

export const promptQuery = (tema, giaSai) => `Devo cercare novità sul tema "${tema}" per una knowledge base personale.
Contesto (appunti dell'utente sul tema, può essere vuoto): ${giaSai.slice(0, 1500) || "(niente)"}
Le query devono essere AMPIE (l'argomento generale, non i dettagli degli appunti), altrimenti non trovano niente.
Rispondi SOLO con JSON: {"studi":"query in inglese per Europe PMC: 3-6 sinonimi o frasi tra virgolette uniti da OR, es. \\"slow breathing\\" OR breathwork OR \\"breathing exercise\\"","notizie":"query in italiano per Google News: 1-2 parole generali, es. respirazione"}`;

export function promptTema(tema, oggi, giaSai, visti, candidati) {
  return `Sei il ricercatore personale di Samuele. Oggi è ${oggi}. Tema: "${tema}".

Quello che Samuele ha già scritto su questo tema (non riproporlo):
<<<
${giaSai || "(niente)"}
>>>

Già proposti o integrati nelle settimane scorse (non ripeterli):
${visti.length ? visti.map((t) => "- " + t).join("\n") : "(niente)"}

Candidati trovati negli ultimi 10 giorni (studi da Europe PMC e notizie da Google News):
${candidati.map((c, i) => `[${i}] ${c.titolo} — ${c.fonte}, ${c.data}${c.estratto ? `\n    ${c.estratto}` : ""}`).join("\n")}

Scegli al massimo 3 candidati che aggiungono qualcosa di DAVVERO nuovo e importante rispetto a quanto Samuele sa già. Preferisci studi peer-reviewed; i preprint vanno bene ma con affidabilità al massimo media; scarta clickbait, notizie generiche e ripetizioni. Va benissimo non sceglierne nessuno.
Se una novità scelta cambia o migliora un metodo descritto nel testo di Samuele, proponi anche la modifica.
"cosa_aggiunge" deve dire SOLO quello che risulta dal titolo e dall'estratto del candidato: niente risultati inventati o esagerati (se il titolo dice "non riduce", non scrivere "riduce").
Scrivi in italiano, frasi brevi.

Rispondi SOLO con JSON:
{"novita":[{"i":0,"titolo":"titolo breve in italiano","cosa_aggiunge":"1-2 frasi","affidabilita":"alta|media|bassa","motivo":"3-4 parole"}],
 "metodi":[{"cosa":"","perche":"","modifica":"riga o righe esatte da aggiungere"}]}`;
}

/** Un tema: query → candidati → scelta di Gemini → righe da aggiungere a "Da valutare". */
export async function ricercaTema({ tema, giaSai, visti, dest, key, modello, oggi = oggiIso() }) {
  const q = (await gemini(promptQuery(tema, giaSai), key, modello)) || {};
  const candidati = [
    ...(await cercaStudi(q.studi || tema, oggi).catch(() => [])),
    ...(await cercaNotizie(q.notizie || tema).catch(() => [])),
  ];
  if (!candidati.length) return { righe: [], novita: 0, candidati: 0 };
  const j = await gemini(promptTema(tema, oggi, giaSai, visti, candidati), key, modello);
  return { ...righeProposte(j, candidati, dest), candidati: candidati.length };
}
