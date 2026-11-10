/**
 * Auditoria e correcção dos emails internos de autenticação.
 *
 * O login por telefone não consulta a base: constrói o email a partir do
 * número (`normalizePhone` + `phoneToEmail`), ou seja `+244 927 991 441` →
 * `u244927991441@inuka.ao`. Se a conta tiver sido criada à mão (painel do
 * Supabase, SQL) com o número local — `u927991441@inuka.ao` — a palavra-passe
 * está certa e o login responde sempre «credenciais inválidas», porque o email
 * construído não existe.
 *
 * Este script compara o email real de cada conta com o email que o login vai
 * construir a partir de `profiles.phone` e corrige as que não batem.
 *
 *   node scripts/corrigir-emails-auth.mjs            # só relatório
 *   node scripts/corrigir-emails-auth.mjs --aplicar  # corrige
 */
import fs from "node:fs";
import path from "node:path";

const APLICAR = process.argv.includes("--aplicar");

const env = {};
for (const l of fs.readFileSync("apps/web/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) env[m[1]] = m[2];
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !SR) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const h = { apikey: SR, Authorization: `Bearer ${SR}` };
const json = { ...h, "Content-Type": "application/json" };

/** Cópia de `normalizePhone` (lib/utils.ts) — não importar TS em node. */
function normalizePhone(phone) {
  let cleaned = String(phone ?? "").replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (!/^\d{9,15}$/.test(digits)) return "";
    return "+" + digits;
  }
  if (!/^\d{9,15}$/.test(cleaned)) return "";
  if (cleaned.startsWith("244") && cleaned.length === 12) return "+" + cleaned;
  return "+244" + cleaned;
}

/** Cópia de `phoneToEmail` (lib/phone-email.ts). */
function phoneToEmail(phone) {
  const n = normalizePhone(phone);
  if (!n) return "";
  return `u${n.replace(/^\+/, "")}@inuka.ao`;
}

// --- contas de autenticação -------------------------------------------------
const contas = [];
for (let pagina = 1; pagina <= 50; pagina++) {
  const r = await fetch(`${BASE}/auth/v1/admin/users?page=${pagina}&per_page=200`, { headers: h });
  if (!r.ok) {
    console.error("Falha ao listar contas:", r.status, (await r.text()).slice(0, 200));
    process.exit(1);
  }
  const corpo = await r.json();
  const lote = corpo.users ?? [];
  contas.push(...lote);
  if (lote.length < 200) break;
}
console.log(`Contas de autenticação: ${contas.length}\n`);

// --- perfis (telefone é a fonte de verdade) ---------------------------------
const perfis = [];
for (let de = 0; ; de += 1000) {
  const r = await fetch(
    `${BASE}/rest/v1/profiles?select=id,full_name,phone,role&order=created_at&offset=${de}&limit=1000`,
    { headers: h }
  );
  if (!r.ok) {
    console.error("Falha ao ler perfis:", r.status, (await r.text()).slice(0, 200));
    process.exit(1);
  }
  const lote = await r.json();
  perfis.push(...lote);
  if (lote.length < 1000) break;
}
const porId = new Map(perfis.map((p) => [p.id, p]));
console.log(`Perfis: ${perfis.length}\n`);

const certos = [];
const tortos = [];
const semPerfil = [];

for (const c of contas) {
  const perfil = porId.get(c.id);
  if (!perfil) {
    semPerfil.push(c);
    continue;
  }
  const esperado = phoneToEmail(perfil.phone);
  if (!esperado) {
    tortos.push({ conta: c, perfil, esperado: "", motivo: "telefone ilegível em profiles" });
  } else if ((c.email ?? "").toLowerCase() === esperado.toLowerCase()) {
    certos.push(c);
  } else {
    tortos.push({ conta: c, perfil, esperado, motivo: "email diferente do construído" });
  }
}

console.log(`Certos: ${certos.length}`);
console.log(`A corrigir: ${tortos.length}`);
console.log(`Sem perfil: ${semPerfil.length}\n`);

if (tortos.length) {
  console.log("--- contas com email fora do padrão ---");
  for (const t of tortos) {
    console.log(
      [
        t.perfil.full_name ?? "(sem nome)",
        t.perfil.role,
        t.perfil.phone ?? "(sem telefone)",
        `actual=${t.conta.email || "(vazio)"}`,
        `esperado=${t.esperado || "—"}`,
        t.conta.last_sign_in_at ? `ultimo_login=${t.conta.last_sign_in_at}` : "nunca entrou",
      ].join(" · ")
    );
  }
  console.log("");
}

if (semPerfil.length) {
  console.log("--- contas de autenticação sem perfil (não mexo) ---");
  for (const c of semPerfil) console.log(`${c.email} · ${c.id}`);
  console.log("");
}

if (!APLICAR) {
  console.log("Relatório apenas. Correr com --aplicar para corrigir.");
  process.exit(0);
}

// --- correcção --------------------------------------------------------------
let ok = 0;
const falhas = [];

for (const t of tortos) {
  if (!t.esperado) {
    falhas.push(`${t.perfil.full_name ?? t.conta.id}: telefone inválido, corrija o perfil primeiro`);
    continue;
  }
  const r = await fetch(`${BASE}/auth/v1/admin/users/${t.conta.id}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ email: t.esperado, email_confirm: true }),
  });
  if (r.ok) {
    ok++;
    console.log(`corrigido: ${t.conta.email} -> ${t.esperado} (${t.perfil.full_name})`);
  } else {
    const txt = (await r.text()).slice(0, 200);
    falhas.push(`${t.conta.email} -> ${t.esperado}: ${r.status} ${txt}`);
  }
}

console.log(`\nCorrigidas: ${ok}`);
if (falhas.length) {
  console.log("Falharam:");
  for (const f of falhas) console.log("  - " + f);
  process.exit(1);
}
