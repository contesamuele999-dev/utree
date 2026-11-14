import test from "node:test";
import assert from "node:assert/strict";
import { parseProposte, campo, aMarkdown, estraiJson, parseRss } from "./agente-notizie.mjs";

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
