#!/usr/bin/env node
/**
 * Giro settimanale dell'agente notizie (lo lancia l'Utilità di pianificazione
 * di Windows, "uTree agente notizie"). Fa esattamente quello che fa il
 * pulsante "Cerca ora" della scheda Knowledge: entra con il tuo account e
 * chiama la Edge Function `agente-notizie`, prima "avvia" (integra le
 * proposte approvate) e poi un tema alla volta. La logica è tutta lì
 * (supabase/functions/agente-notizie + _shared/agente.js).
 *
 * Configurazione nel .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, UTREE_EMAIL, UTREE_PASSWORD.
 * Uso:  node scripts/agente-notizie.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function main() {
  const login = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.UTREE_EMAIL, password: process.env.UTREE_PASSWORD }),
  });
  const s = await login.json();
  if (!login.ok) throw new Error(`login: ${s.error_description || s.msg || login.status}`);

  const chiama = async (body) => {
    const r = await fetch(`${URL_SB}/functions/v1/agente-notizie`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  const { temi, integrate } = await chiama({ azione: "avvia" });
  const rapporto = [`integrate ${integrate}`];
  for (const tema of temi) {
    try {
      const r = await chiama({ azione: "tema", tema });
      rapporto.push(`${tema}: ${r.novita} novità su ${r.candidati} candidati`);
    } catch (e) {
      rapporto.push(`${tema}: errore ${e.message}`);
    }
  }
  return rapporto.join(" · ");
}

main()
  .then((r) => { const riga = `${new Date().toISOString()} ${r}`; console.log(riga); fs.appendFileSync(LOG, riga + "\n"); })
  .catch((e) => { fs.appendFileSync(LOG, `${new Date().toISOString()} ERRORE ${e.message}\n`); console.error(e.message); process.exit(1); });
