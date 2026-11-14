#!/usr/bin/env node
/**
 * Agente notizie della knowledge base — motore: Google Gemini (piano gratuito)
 * con la ricerca Google integrata.
 *
 * Ogni giro:
 *   1. integra le proposte approvate in "📥 Da valutare" (spunta o "ok" in fondo)
 *      nella vista di destinazione (se non esiste la crea in "Knowledge base");
 *   2. per ogni tema di "🛰 Temi da seguire" chiede a Gemini le novità degli
 *      ultimi giorni, scartando ciò che è già nella vista del tema;
 *   3. scrive le nuove proposte in "📥 Da valutare".
 *
 * Legge e scrive uTree tramite scripts/mcp-server.mjs (stesso login, stesse RLS).
 * Configurazione nel .env: GEMINI_API_KEY (obbligatoria), GEMINI_MODEL (facoltativa).
 * Uso:  node scripts/agente-notizie.mjs          (giro vero)
 *       node scripts/agente-notizie.mjs --prova  (non scrive niente, stampa e basta)
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, "..");
const TEMI = "1181b99f-36b7-4dbf-846c-5a0b99270e86";
const DA_VALUTARE = "5cf7005e-da8a-4fa1-ba54-f95a3b396a15";
const VISIONE_KB = "def6d2e4-a2ff-46ed-8bd4-078ec7cc0225";

// ---------- parti pure (testate in agente-notizie.test.mjs) ----------

const RE_PROPOSTA = /^(Novità|Metodo)\s*·\s*(.+?)\s*→\s*vista:\s*(.+?)(?:\s+ok)?\s*$/i;

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
    const figli = blocchi.slice(i + 1, j).map((x) => x.text || "");
    out.push({
      tipo: m[1].toLowerCase() === "novità" ? "novita" : "metodo",
      titolo: m[2], vista: m[3],
      approvata: !!b.done || /\bok\s*$/i.test(b.text),
      figli, da: i, a: j,
    });
  }
  return out;
}

/** Valore di una riga figlia "Etichetta: valore". */
export const campo = (figli, etichetta) =>
  (figli.find((f) => f.toLowerCase().startsWith(etichetta.toLowerCase() + ":")) || "").slice(etichetta.length + 1).trim();

/** Blocchi → markdown dell'MCP (due spazi = un livello). */
export const aMarkdown = (blocchi) => blocchi.map((b) => "  ".repeat(b.indent || 0) + (b.text || "")).join("\n");

/** JSON dentro la risposta di Gemini (con o senza ```json). */
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

// ---------- configurazione ----------

function leggiEnv(file) {
  let testo;
  try { testo = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const riga of testo.split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && !riga.trim().startsWith("#") && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

// ---------- client MCP verso il server di uTree ----------

export function avviaUtree() {
  const srv = spawn(process.execPath, [path.join(QUI, "mcp-server.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
  const attese = new Map();
  let nid = 0;
  readline.createInterface({ input: srv.stdout }).on("line", (l) => {
    let m;
    try { m = JSON.parse(l); } catch { return; }
    const a = attese.get(m.id);
    if (!a) return;
    attese.delete(m.id);
    m.error ? a.rej(new Error(m.error.message)) : a.res(m.result);
  });
  const rpc = (method, params) => new Promise((res, rej) => {
    const id = ++nid;
    attese.set(id, { res, rej });
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const tool = async (name, args) => {
    const r = await rpc("tools/call", { name, arguments: args });
    const t = r.content?.[0]?.text || "";
    if (r.isError) throw new Error(`${name}: ${t}`);
    return JSON.parse(t);
  };
  return { rpc, tool, chiudi: () => srv.kill() };
}

// ---------- Gemini ----------

// La ricerca Google integrata in Gemini NON è gratuita: le fonti arrivano da API
// gratuite (Europe PMC, Google News RSS) e Gemini (gratis, senza strumenti) sceglie fra quelle.
async function gemini(prompt) {
  const modelli = [process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-flash-lite-latest"];
  let ultimo;
  for (const model of modelli) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let tentativo = 0; tentativo < 3; tentativo++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
        signal: AbortSignal.timeout(90000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) return estraiJson((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
      ultimo = `Gemini ${model} ${res.status}: ${j.error?.message || ""}`;
      // piano gratuito: pochi messaggi al minuto o modello sovraccarico → aspetta e riprova
      if (res.status !== 429 && res.status !== 503) break;
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
  throw new Error(ultimo);
}

const giorni = (oggi, n) => new Date(Date.parse(oggi) - n * 864e5).toISOString().slice(0, 10);

/** Studi e preprint degli ultimi 10 giorni (Europe PMC: PubMed + bioRxiv/medRxiv/…, gratis, senza chiave). */
async function cercaStudi(query, oggi) {
  const q = `(${query}) AND FIRST_PDATE:[${giorni(oggi, 10)} TO ${oggi}]`;
  const r = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=15&sort=CITED%20desc&query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  return (j.resultList?.result || []).map((a) => ({
    titolo: a.title,
    url: a.doi ? `https://doi.org/${a.doi}` : `https://europepmc.org/article/${a.source}/${a.id}`,
    fonte: a.source === "PPR" ? `preprint ${a.bookOrReportDetails?.publisher || ""}`.trim() : a.journalInfo?.journal?.title || a.journalTitle || "",
    data: a.firstPublicationDate || "",
    estratto: (a.abstractText || "").replace(/<[^>]+>/g, "").slice(0, 600),
  }));
}

/** Notizie degli ultimi 10 giorni (Google News RSS, gratis). */
async function cercaNotizie(query) {
  const r = await fetch(`https://news.google.com/rss/search?hl=it&gl=IT&ceid=IT:it&q=${encodeURIComponent(query + " when:10d")}`, { signal: AbortSignal.timeout(60000) });
  return parseRss(await r.text()).slice(0, 15);
}

const promptQuery = (tema, giaSai) => `Devo cercare novità sul tema "${tema}" per una knowledge base personale.
Contesto (appunti dell'utente sul tema, può essere vuoto): ${giaSai.slice(0, 1500) || "(niente)"}
Rispondi SOLO con JSON: {"studi":"query in inglese per Europe PMC, 2-5 parole chiave con OR/AND","notizie":"query in italiano per Google News, 2-4 parole"}`;

function promptTema(tema, oggi, giaSai, giaVisti, candidati) {
  return `Sei il ricercatore personale di Samuele. Oggi è ${oggi}. Tema: "${tema}".

Quello che Samuele ha già scritto su questo tema (non riproporlo):
<<<
${giaSai || "(niente)"}
>>>

Già proposti o integrati nelle settimane scorse (non ripeterli):
${giaVisti.length ? giaVisti.map((t) => "- " + t).join("\n") : "(niente)"}

Candidati trovati negli ultimi 10 giorni (studi da Europe PMC e notizie da Google News):
${candidati.map((c, i) => `[${i}] ${c.titolo} — ${c.fonte}, ${c.data}${c.estratto ? `\n    ${c.estratto}` : ""}`).join("\n")}

Scegli al massimo 3 candidati che aggiungono qualcosa di DAVVERO nuovo e importante rispetto a quanto Samuele sa già. Preferisci studi peer-reviewed; i preprint vanno bene ma con affidabilità al massimo media; scarta clickbait, notizie generiche e ripetizioni. Va benissimo non sceglierne nessuno.
Se una novità scelta cambia o migliora un metodo descritto nel testo di Samuele, proponi anche la modifica.
Scrivi in italiano, frasi brevi.

Rispondi SOLO con JSON:
{"novita":[{"i":0,"titolo":"titolo breve in italiano","cosa_aggiunge":"1-2 frasi","affidabilita":"alta|media|bassa","motivo":"3-4 parole"}],
 "metodi":[{"cosa":"","perche":"","modifica":"riga o righe esatte da aggiungere"}]}`;
}

// ---------- giro ----------

async function main() {
  leggiEnv(path.join(RADICE, ".env"));
  leggiEnv(path.join(RADICE, ".env.local"));
  if (!process.env.GEMINI_API_KEY) throw new Error("Manca GEMINI_API_KEY nel .env (https://aistudio.google.com/apikey)");
  const prova = process.argv.includes("--prova");
  const oggi = new Date().toISOString().slice(0, 10);
  const u = avviaUtree();
  const scrivi = async (args) => (prova ? console.log("[prova] scriverei:", JSON.stringify(args, null, 2)) : u.tool("utree_vista_scrivi", args));
  const leggiTitolo = (titolo) => u.tool("utree_vista_leggi", { titolo }).catch(() => null);
  const rapporto = [];

  try {
    await u.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agente-notizie", version: "1" } });

    // 1) integra le approvate
    const dv = await u.tool("utree_vista_leggi", { id: DA_VALUTARE });
    const proposte = parseProposte(dv.blocchi);
    const fatte = [];
    for (const p of proposte.filter((x) => x.approvata)) {
      let dest = await leggiTitolo(p.vista);
      if (!dest && !prova) dest = (await u.tool("utree_vista_crea", { visioneId: VISIONE_KB, titolo: p.vista, stage: "note" })).creata;
      const testo = p.tipo === "novita"
        ? `💡 ${p.titolo}: ${campo(p.figli, "Cosa aggiunge")}\n  ${campo(p.figli, "Fonte")} · integrata ${oggi}`
        : `🔧 ${p.titolo} (${oggi})\n  ${campo(p.figli, "Modifica proposta")}\n  Perché: ${campo(p.figli, "Perché")}`;
      await scrivi({ id: dest?.id, titolo: dest ? undefined : p.vista, testo, modo: "aggiungi" });
      fatte.push(p);
    }
    if (fatte.length) {
      const via = new Set(fatte.flatMap((p) => Array.from({ length: p.a - p.da }, (_, k) => p.da + k)));
      const resto = dv.blocchi.filter((_, i) => !via.has(i));
      const log = fatte.map((p) => ({ text: `${oggi} · ${p.titolo} → ${p.vista}`, indent: 1 }));
      const h = resto.findIndex((b) => (b.text || "").trim() === "# Integrate");
      if (h < 0) resto.push({ text: "# Integrate" }, ...log);
      else resto.splice(h + 1, 0, ...log);
      await scrivi({ id: DA_VALUTARE, testo: aMarkdown(resto), modo: "sostituisci" });
    }
    rapporto.push(`integrate ${fatte.length}`);

    // 2) cerca le novità per ogni tema
    const temi = await u.tool("utree_vista_leggi", { id: TEMI });
    const iT = temi.blocchi.findIndex((b) => (b.text || "").trim().toLowerCase() === "temi");
    const elenco = temi.blocchi.slice(iT + 1).filter((b) => b.indent && b.text?.trim()).map((b) => b.text.trim());
    const giaVisti = [
      ...proposte.map((p) => p.titolo),
      ...dv.blocchi.filter((b) => b.indent && /^\d{4}-\d\d-\d\d · /.test(b.text || "")).map((b) => b.text.slice(13)),
    ];
    const righe = [`# Settimana del ${oggi}`];
    for (const tema of elenco) {
      try {
        const vista = await leggiTitolo(tema);
        const giaSai = (vista?.testo || "").slice(0, 8000);
        const q = (await gemini(promptQuery(tema, giaSai))) || {};
        const candidati = [
          ...(await cercaStudi(q.studi || tema, oggi).catch(() => [])),
          ...(await cercaNotizie(q.notizie || tema).catch(() => [])),
        ];
        if (!candidati.length) { rapporto.push(`${tema}: nessun candidato`); continue; }
        const j = await gemini(promptTema(tema, oggi, giaSai, giaVisti, candidati));
        if (!j) { rapporto.push(`${tema}: risposta non leggibile`); continue; }
        // url, fonte e data vengono dal candidato vero, mai da Gemini
        const novita = (j.novita || []).filter((n) => candidati[n.i]).slice(0, 3);
        const dest = vista?.titolo || tema;
        for (const n of novita) {
          const c = candidati[n.i];
          righe.push(`Novità · ${n.titolo} → vista: ${dest}`,
            `  Cosa aggiunge: ${n.cosa_aggiunge}`,
            `  Fonte: ${c.url} (${c.fonte}, ${c.data}) · affidabilità: ${n.affidabilita}, ${n.motivo}`);
        }
        for (const m of (novita.length ? j.metodi || [] : [])) {
          righe.push(`Metodo · ${m.cosa} → vista: ${dest}`, `  Perché: ${m.perche}`, `  Modifica proposta: ${m.modifica}`);
        }
        rapporto.push(`${tema}: ${novita.length} novità su ${candidati.length} candidati (query: ${q.studi} | ${q.notizie})`);
      } catch (e) {
        rapporto.push(`${tema}: errore ${e.message}`);
      }
    }
    if (righe.length === 1) righe.push("  Nessuna novità rilevante questa settimana");
    await scrivi({ id: DA_VALUTARE, testo: righe.join("\n"), modo: "aggiungi" });
  } finally {
    u.chiudi();
    const riga = `${new Date().toISOString()} ${rapporto.join(" · ")}`;
    console.log(riga);
    if (!process.argv.includes("--prova")) fs.appendFileSync(path.join(RADICE, "agente-notizie.log"), riga + "\n");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => {
    fs.appendFileSync(path.join(RADICE, "agente-notizie.log"), `${new Date().toISOString()} ERRORE ${e.message}\n`);
    console.error(e.message);
    process.exit(1);
  });
}
