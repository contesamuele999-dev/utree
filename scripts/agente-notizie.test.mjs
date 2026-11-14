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
