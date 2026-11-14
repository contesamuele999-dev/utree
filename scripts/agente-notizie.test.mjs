import test from "node:test";
import assert from "node:assert/strict";
import { parseProposte, campo, aMarkdown, estraiJson, parseRss, togliIntegrate, righeInBlocchi, elencoTemi, righeProposte } from "../supabase/functions/_shared/agente.js";

const blocchi = [
  { text: "Come funziona: ..." },
  { text: "# Settimana del 2026-11-16" },
  { text: "Novità · Sonno e memoria → vista: Neuroscienze", done: true, check: true },
  { text: "Cosa aggiunge: il sonno REM fissa X", indent: 1 },
  { text: "Fonte: https://nature.com/a (Nature, 2026-11-10) · affidabilità: alta, peer-reviewed", indent: 1 },
  { text: "Metodo · Ripasso serale → vista: Percorso DSA ok" },
  { text: "Modifica proposta: ripasso 10 minuti prima di dormire", indent: 1 },
  { text: "Novità · Cosa scartata → vista: Salute" },
  { text: "Cosa aggiunge: boh", indent: 1 },
];

test("parseProposte: tipi, approvazione, figli e intervalli", () => {
  const p = parseProposte(blocchi);
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => [x.tipo, x.vista, x.approvata, x.da, x.a]), [
    ["novita", "Neuroscienze", true, 2, 5],
    ["metodo", "Percorso DSA", true, 5, 7],
    ["novita", "Salute", false, 7, 9],
  ]);
  assert.equal(campo(p[0].figli, "Cosa aggiunge"), "il sonno REM fissa X");
  assert.equal(campo(p[1].figli, "Modifica proposta"), "ripasso 10 minuti prima di dormire");
});

test("aMarkdown rispetta i rientri", () => {
  assert.equal(aMarkdown([{ text: "a" }, { text: "b", indent: 1 }]), "a\n  b");
});

test("estraiJson regge i ```json e il testo intorno", () => {
  assert.deepEqual(estraiJson('Ecco:\n```json\n{"novita":[]}\n```'), { novita: [] });
  assert.equal(estraiJson("niente"), null);
});

test("parseRss legge titolo, link, fonte, data e decodifica &amp;", () => {
  const xml = `<rss><channel><item><title><![CDATA[Studio &amp; sonno]]></title><link>https://news.google.com/x?a=1&amp;b=2</link><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate><source url="https://ansa.it">ANSA</source></item></channel></rss>`;
  assert.deepEqual(parseRss(xml), [{ titolo: "Studio & sonno", url: "https://news.google.com/x?a=1&b=2", fonte: "ANSA", data: "2026-11-10" }]);
});

test("togliIntegrate toglie le approvate e le registra sotto # Integrate", () => {
  const p = parseProposte(blocchi).filter((x) => x.approvata);
  const r = togliIntegrate(blocchi, p, "2026-11-16");
  assert.deepEqual(r.map((b) => b.text), [
    "Come funziona: ...", "# Settimana del 2026-11-16", "Novità · Cosa scartata → vista: Salute", "Cosa aggiunge: boh",
    "# Integrate", "2026-11-16 · Sonno e memoria → Neuroscienze", "2026-11-16 · Ripasso serale → Percorso DSA",
  ]);
  assert.equal(r[2], blocchi[7]);   // i blocchi rimasti sono gli stessi oggetti (id e spunte intatti)
});

test("righeInBlocchi legge i rientri, elencoTemi prende le righe sotto Temi", () => {
  assert.deepEqual(righeInBlocchi(["a", "  b"]).map((b) => [b.text, b.indent]), [["a", undefined], ["b", 1]]);
  assert.deepEqual(elencoTemi([{ text: "Come funziona" }, { text: "Temi" }, { text: "Respiro", indent: 1 }, { text: " ", indent: 1 }]), ["Respiro"]);
});

test("righeProposte prende url/fonte/data dal candidato e ignora indici inventati", () => {
  const c = [{ url: "https://doi.org/1", fonte: "Nature", data: "2026-11-10" }];
  const { righe, novita } = righeProposte({ novita: [{ i: 0, titolo: "T", cosa_aggiunge: "x", affidabilita: "alta", motivo: "peer" }, { i: 7, titolo: "finta" }], metodi: [] }, c, "Respiro");
  assert.equal(novita, 1);
  assert.equal(righe[0], "Novità · T → vista: Respiro");
  assert.match(righe[2], /https:\/\/doi.org\/1 \(Nature, 2026-11-10\)/);
});

test("un preprint non può avere affidabilità alta", () => {
  const { righe } = righeProposte({ novita: [{ i: 0, titolo: "P", cosa_aggiunge: "x", affidabilita: "alta", motivo: "m" }] }, [{ url: "u", fonte: "preprint", data: "d" }], "Respiro");
  assert.match(righe[2], /affidabilità: media \(preprint\)/);
});

test("privacy alta di default; normale solo se scritto; i temi ignorano la riga privacy", async () => {
  const { privacyAlta, KB_VISTE } = await import("../supabase/functions/_shared/agente.js");
  assert.equal(privacyAlta([]), true);
  assert.equal(privacyAlta([{ text: "Privacy: alta" }]), true);
  assert.equal(privacyAlta([{ text: "Privacy: normale" }]), false);
  const temi = KB_VISTE[0][1].map((t) => ({ text: t.trimStart(), ...(t.startsWith("  ") ? { indent: 1 } : {}) }));
  assert.equal(privacyAlta(temi), true);
  assert.deepEqual(elencoTemi(temi), []);   // la nuova base nasce senza temi (riga vuota ignorata)
});

test("collegaTitoli, esportaMarkdown, percorsoEsporta, righeTemi", async () => {
  const m = await import("../supabase/functions/_shared/agente.js");
  assert.equal(m.collegaTitoli("Il Respiro e **Respiro** e https://x.it/Respiro", ["Respiro"], "Onde"), "Il ((Respiro|Respiro)) e **Respiro** e https://x.it/Respiro");
  assert.equal(m.collegaTitoli("Respiro", ["Respiro"], "Respiro"), "Respiro");   // mai verso sé stessa
  const md = m.esportaMarkdown([
    { id: "a", titolo: "📚 Banca", blocchi: [{ text: "intro" }, { text: "1. punto", indent: 1 }], ordine: 0 },
    { id: "b", titolo: "Respiro", parent_id: "a", blocchi: [{ text: "vedi ((Meditazione|meditare))" }], ordine: 0 },
    { id: "c", titolo: "📥 Da valutare", blocchi: [{ text: "x" }] },
  ]);
  assert.equal(md, "# Banca\n\nintro\n1. punto\n\n## Respiro\n\nvedi meditare\n");
  assert.equal(m.percorsoEsporta([{ text: "Esporta in: C:/x/coach.md" }]), "C:/x/coach.md");
  assert.deepEqual(m.righeTemi({ temi: [{ nome: "Respiro", perche: "x" }, { nome: "Qigong", perche: "vicino" }] }, ["Respiro"], []),
    ["Tema · Qigong → vista: 🛰 Temi da seguire", "  Perché: vicino"]);
});

test("risposte fuori schema (modelli locali): oggetti singoli, campi mancanti, indici doppi", () => {
  const c = [{ url: "u0", fonte: "Nature", data: "d" }, { url: "u1", fonte: "Science", data: "d" }];
  const { righe, novita } = righeProposte({
    novita: [{ i: 0, titolo: "A", cosa_aggiunge: "x" }, { i: "0", titolo: "A bis", cosa_aggiunge: "y" }, { i: 1 }],
    metodi: { cosa: "Ripasso", perche: "p", modifica: "m" },   // oggetto, non lista
  }, c, "Respiro");
  assert.equal(novita, 1);
  assert.equal(righe.filter((r) => r.startsWith("Metodo ·")).length, 1);
  assert.deepEqual(righeProposte({ novita: { i: 1, titolo: "B", cosa_aggiunge: "z" } }, c, "R").novita, 1);
  assert.deepEqual(righeProposte(null, c, "R").righe, []);
});

test("filtraCandidati: niente articoli vecchi, niente fonti già proposte, niente doppioni", async () => {
  const { filtraCandidati, giaVisti } = await import("../supabase/functions/_shared/agente.js");
  const c = [
    { titolo: "nuovo", url: "u1", data: "2026-11-12" },
    { titolo: "vecchio", url: "u2", data: "2017-09-01" },
    { titolo: "già proposto", url: "u3", data: "2026-11-13" },
    { titolo: "doppio", url: "u1", data: "2026-11-12" },
    { titolo: "senza data", url: "u4", data: "" },
  ];
  assert.deepEqual(filtraCandidati(c, "2026-11-14", new Set(["u3"])).map((x) => x.titolo), ["nuovo", "senza data"]);
  const v = giaVisti([{ text: "Novità · T → vista: R" }, { text: "Fonte: https://doi.org/1 (N, d) · affidabilità: alta, x", indent: 1 }]);
  assert.ok(v.includes("https://doi.org/1"));
});
