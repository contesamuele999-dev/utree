#!/usr/bin/env node
/**
 * Giro settimanale dell'agente notizie (lo lancia l'Utilità di pianificazione
 * di Windows, "uTree agente notizie"). Per ogni knowledge base:
 *   1. integra le proposte approvate (con link automatici fra le viste);
 *   2. cerca le novità tema per tema e propone temi nuovi;
 *   3. se in "🛰 Temi da seguire" c'è "Esporta in: C:\…\file.md", riscrive quel file
 *      (es. la banca dati dello Spiral Coach), tenendo la versione precedente in .bak;
 * e alla fine manda una mail di riepilogo (se c'è qualcosa di nuovo).
 *
 * Motore:
 *   - Gemini (default): la ricerca la fa la Edge Function `agente-notizie`.
 *   - Modello LOCALE con `--locale` (o AGENTE_MOTORE=locale nel .env): la Edge Function
 *     dà solo il contesto, il ragionamento lo fa Ollama su questo PC e nessun testo
 *     va a Google. Serve Ollama acceso e il modello scaricato (OLLAMA_MODEL, default llama3.1:8b).
 *
 * Configurazione nel .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, UTREE_EMAIL, UTREE_PASSWORD;
 * facoltativi AGENTE_MOTORE, OLLAMA_MODEL, OLLAMA_URL, AGENTE_EMAIL=no (niente riepilogo).
 * Uso:  node scripts/agente-notizie.mjs [--locale] [--senza-email]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  esportaMarkdown, ollama, percorsoEsporta, promptTemi, ricercaTema, righeTemi,
} from "../supabase/functions/_shared/agente.js";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(RADICE, "agente-notizie.log");

for (const f of [".env", ".env.local"]) {
  let t = "";
  try { t = fs.readFileSync(path.join(RADICE, f), "utf8"); } catch { continue; }
  for (const riga of t.split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && !riga.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const URL_SB = (process.env.UTREE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.UTREE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const LOCALE = process.argv.includes("--locale") || process.env.AGENTE_MOTORE === "locale";
const MODELLO = process.env.OLLAMA_MODEL || "llama3.1:8b";
const EMAIL = !process.argv.includes("--senza-email") && process.env.AGENTE_EMAIL !== "no";

async function main() {
  const login = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.UTREE_EMAIL, password: process.env.UTREE_PASSWORD }),
  });
  const s = await login.json();
  if (!login.ok) throw new Error(`login: ${s.error_description || s.msg || login.status}`);
  const auth = { apikey: ANON, Authorization: `Bearer ${s.access_token}` };

  const chiama = async (body) => {
    const r = await fetch(`${URL_SB}/functions/v1/agente-notizie`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const llm = (p) => ollama(p, MODELLO, process.env.OLLAMA_URL);

  const rapporto = [];
  const mail = [];
  const { basi } = await chiama({ azione: "basi" });
  for (const base of basi) {
    const { temi, integrate } = await chiama({ azione: "avvia", visioneId: base.id });
    rapporto.push(`[${base.titolo}${LOCALE ? " · locale" : ""}] integrate ${integrate}`);
    const trovate = [];
    let suggeriti = 0;

    if (LOCALE) {
      const ctx = await chiama({ azione: "prepara", visioneId: base.id });
      for (const tema of temi) {
        try {
          const v = ctx.viste[tema] || { dest: tema, testo: "" };
          const r = await ricercaTema({ tema, giaSai: v.testo, visti: ctx.visti, dest: v.dest, llm });
          if (r.righe.length) await chiama({ azione: "proponi", visioneId: base.id, righe: r.righe });
          if (r.novita) trovate.push(`${tema}: ${r.novita}`);
          rapporto.push(`${tema}: ${r.novita} novità su ${r.candidati} candidati`);
        } catch (e) { rapporto.push(`${tema}: errore ${e.message}`); }
      }
      try {
        const righe = righeTemi(await llm(promptTemi(ctx.temi, ctx.titoli)), ctx.temi, ctx.visti);
        if (righe.length) await chiama({ azione: "proponi", visioneId: base.id, righe });
        suggeriti = righe.length / 2;
      } catch (e) { rapporto.push(`temi suggeriti: errore ${e.message}`); }
    } else {
      for (const tema of temi) {
        try {
          const r = await chiama({ azione: "tema", visioneId: base.id, tema });
          if (r.novita) trovate.push(`${tema}: ${r.novita}`);
          rapporto.push(`${tema}: ${r.novita} novità su ${r.candidati} candidati`);
        } catch (e) { rapporto.push(`${tema}: errore ${e.message}`); }
      }
      try { suggeriti = (await chiama({ azione: "suggerisci", visioneId: base.id })).temi; }
      catch (e) { rapporto.push(`temi suggeriti: errore ${e.message}`); }
    }
    if (suggeriti) rapporto.push(`temi suggeriti: ${suggeriti}`);

    // esportazione Markdown (banca dati del coach), solo se configurata e cambiata
    try {
      const r = await fetch(`${URL_SB}/rest/v1/viste?select=id,titolo,blocchi,parent_id,ordine&visione_id=eq.${base.id}`, { headers: auth });
      const viste = await r.json();
      const dove = percorsoEsporta(viste.find((v) => /Temi da seguire/.test(v.titolo))?.blocchi);
      if (dove) {
        const md = esportaMarkdown(viste);
        const prima = fs.existsSync(dove) ? fs.readFileSync(dove, "utf8") : "";
        if (prima !== md) {
          if (prima) fs.writeFileSync(dove + ".bak", prima);
          fs.writeFileSync(dove, md);
          rapporto.push(`esportato ${path.basename(dove)}`);
        }
      }
    } catch (e) { rapporto.push(`esportazione: errore ${e.message}`); }

    if (integrate || trovate.length || suggeriti) {
      mail.push(`${base.titolo}`, ...(integrate ? [`  ${integrate} proposte integrate`] : []),
        ...(trovate.length ? [`  Novità da valutare — ${trovate.join(", ")}`] : []),
        ...(suggeriti ? [`  ${suggeriti} temi nuovi suggeriti`] : []), "");
    }
  }

  if (EMAIL && mail.length) {
    const app = process.env.UTREE_APP_URL || "";
    try {
      await chiama({ azione: "riepilogo", testo: [...mail, `Le trovi in uTree, scheda Knowledge${app ? `: ${app}` : "."}`].join("\n") });
      rapporto.push("riepilogo inviato");
    } catch (e) { rapporto.push(`riepilogo: errore ${e.message}`); }
  }
  return rapporto.join(" · ") || "nessuna knowledge base con Temi e Da valutare";
}

main()
  .then((r) => { const riga = `${new Date().toISOString()} ${r}`; console.log(riga); fs.appendFileSync(LOG, riga + "\n"); })
  .catch((e) => { fs.appendFileSync(LOG, `${new Date().toISOString()} ERRORE ${e.message}\n`); console.error(e.message); process.exit(1); });
