/**
 * Testes ao vivo do ESTÚDIO DE DESIGN — contra o Supabase real.
 *
 * Uso:
 *   node supabase/tests/designer.test.mjs
 *
 * Cobre: criação, gravação com concorrência otimista, conflito, histórico
 * (automático e manual), restauro, preferências, upload para o bucket privado
 * e isolamento entre clientes.
 *
 * Requer `supabase/PATCH_APLICAR_TUDO.sql` aplicado (ou SETUP_COMPLETO.sql).
 * Se as tabelas não existirem, termina com código 2 e diz o que fazer — não
 * finge que passou.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv() {
  const text = readFileSync(resolve(ROOT, "apps/web/.env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !ANON || !SR) {
  console.error("Credenciais em falta em apps/web/.env.local");
  process.exit(1);
}

let total = 0;
let passed = 0;
const falhas = [];

function ok(label, detail = "") {
  total++;
  passed++;
  console.log(`PASS  ${label}${detail ? `  -> ${detail}` : ""}`);
}

function fail(label, detail = "") {
  total++;
  falhas.push({ label, detail });
  console.log(`FAIL  ${label}${detail ? `  -> ${detail}` : ""}`);
}

function check(label, cond, detail = "") {
  cond ? ok(label, detail) : fail(label, detail);
}

const GESTOR = { telefone: "+244900000001", senha: "InukaGestor2026!" };
const OUTRO = { telefone: "+244924000009", senha: "InukaTeste2026!" };

function emailDe(telefone) {
  return `u${telefone.replace(/\D/g, "")}@inuka.ao`;
}

async function entrar(cred) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailDe(cred.telefone), password: cred.senha }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Login falhou para ${cred.telefone}: ${j.error_description ?? j.msg ?? "?"}`);
  return { token: j.access_token, uid: j.user.id };
}

async function rpc(token, nome, args) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  let json = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    /* texto simples */
  }
  return { status: r.status, json, txt };
}

async function rest(token, caminho, init = {}) {
  const r = await fetch(`${BASE}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const txt = await r.text();
  let json = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    /* ignora */
  }
  return { status: r.status, json, txt };
}

const PAGINA = [
  {
    id: "p1",
    name: "Página 1",
    background: { type: "solid", color: "#0A0A0A" },
    elements: [],
  },
];

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// ---------------------------------------------------------------------------
// 0. A base de dados tem o esquema do designer?
// ---------------------------------------------------------------------------
async function main() {
const sonda = await fetch(`${BASE}/rest/v1/design_projects?select=id&limit=1`, {
  headers: { apikey: SR, Authorization: `Bearer ${SR}` },
});

if (sonda.status === 404) {
  console.error("\n=============================================================");
  console.error(" A BASE DE DADOS AINDA NÃO TEM O ESQUEMA DO DESIGNER");
  console.error("=============================================================");
  console.error(" Abra o Supabase -> SQL Editor e cole o ficheiro:");
  console.error("   supabase/PATCH_APLICAR_TUDO.sql");
  console.error(" Depois volte a correr: node supabase/tests/designer.test.mjs");
  console.error("=============================================================\n");
  process.exitCode = 2;
  return;
}

// ---------------------------------------------------------------------------
// Preparação
// ---------------------------------------------------------------------------
const gestor = await entrar(GESTOR);

// Utilizador secundário para provar o isolamento (criado e apagado aqui).
const emailOutro = emailDe(OUTRO.telefone);
await fetch(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: emailOutro, password: OUTRO.senha, email_confirm: true }),
});
const outro = await entrar(OUTRO);

let projetoId = null;
let assetId = null;
const assetsCriados = [];

try {
  // -------------------------------------------------------------------------
  console.log("\n--- CRIAÇÃO ---");
  const criado = await rpc(gestor.token, "design_create", {
    p_title: "Teste automático",
    p_format_key: "square",
    p_width: 1080,
    p_height: 1080,
    p_pages: PAGINA,
  });
  projetoId = criado.json?.id;
  check("design_create cria projeto real", !!projetoId, `HTTP ${criado.status}`);
  check("versão inicial é 1", criado.json?.version === 1, String(criado.json?.version));
  check("dono é o autor autenticado", criado.json?.owner_id === gestor.uid);

  const lido = await rest(gestor.token, `design_projects?select=id,pages&id=eq.${projetoId}`);
  check("projeto é legível por REST (RLS do dono)", lido.json?.length === 1, `HTTP ${lido.status}`);

  // -------------------------------------------------------------------------
  console.log("\n--- GRAVAÇÃO E CONCORRÊNCIA ---");
  const g1 = await rpc(gestor.token, "design_save", {
    p_id: projetoId,
    p_pages: PAGINA,
    p_title: "Teste automático v2",
    p_thumbnail: null,
    p_expected_version: 1,
  });
  check("design_save grava e incrementa a versão", g1.json?.version === 2, JSON.stringify(g1.json));

  const g2 = await rpc(gestor.token, "design_save", {
    p_id: projetoId,
    p_pages: PAGINA,
    p_title: null,
    p_thumbnail: null,
    p_expected_version: 1,
  });
  check("versão desatualizada devolve conflito", g2.json?.conflict === true, JSON.stringify(g2.json).slice(0, 90));
  check(
    "conflito devolve o documento do servidor",
    Array.isArray(g2.json?.pages) && g2.json.pages.length === 1
  );

  // -------------------------------------------------------------------------
  console.log("\n--- HISTÓRICO ---");
  const lista1 = await rpc(gestor.token, "design_versions_list", { p_id: projetoId });
  check(
    "gravar criou um instantâneo automático",
    Array.isArray(lista1.json) && lista1.json.length >= 1,
    `${lista1.json?.length ?? 0} versões`
  );

  const snap = await rpc(gestor.token, "design_snapshot", {
    p_id: projetoId,
    p_label: "versão de teste",
  });
  check("design_snapshot cria versão manual", !!snap.json, `HTTP ${snap.status}`);

  const lista2 = await rpc(gestor.token, "design_versions_list", { p_id: projetoId });
  check(
    "histórico devolve a etiqueta",
    (lista2.json ?? []).some((v) => v.label === "versão de teste"),
    `${lista2.json?.length ?? 0} versões`
  );
  check(
    "histórico traz contagens",
    typeof lista2.json?.[0]?.paginas === "number" && typeof lista2.json?.[0]?.elementos === "number"
  );

  const restaurado = await rpc(gestor.token, "design_restore_version", {
    p_id: projetoId,
    p_version_id: snap.json,
  });
  check("restauro devolve o documento", Array.isArray(restaurado.json?.pages), JSON.stringify(restaurado.json).slice(0, 80));
  check("restauro incrementa a versão", restaurado.json?.version === 3, String(restaurado.json?.version));

  // -------------------------------------------------------------------------
  console.log("\n--- PREFERÊNCIAS ---");
  const prefs = await rest(gestor.token, "designer_preferences", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: gestor.uid, last_format_key: "story", snap_enabled: false }),
  });
  check("preferências gravam (upsert)", prefs.status < 300, `HTTP ${prefs.status}`);

  const prefsLidas = await rest(
    gestor.token,
    `designer_preferences?select=last_format_key,snap_enabled&user_id=eq.${gestor.uid}`
  );
  check(
    "preferências são lidas de volta",
    prefsLidas.json?.[0]?.last_format_key === "story",
    JSON.stringify(prefsLidas.json?.[0] ?? {})
  );

  // -------------------------------------------------------------------------
  console.log("\n--- UPLOAD PRIVADO ---");
  const caminho = `${gestor.uid}/${randomUUID()}.png`;
  const up = await fetch(`${BASE}/storage/v1/object/design-assets/${caminho}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${gestor.token}`, "Content-Type": "image/png" },
    body: PNG_1X1,
  });
  check("upload para design-assets funciona", up.status < 300, `HTTP ${up.status}`);

  const meta = await rest(gestor.token, "design_assets", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: gestor.uid,
      name: "teste.png",
      storage_path: caminho,
      mime_type: "image/png",
      size_bytes: PNG_1X1.length,
      width: 1,
      height: 1,
    }),
  });
  check("metadados do ficheiro gravam", meta.status < 300, `HTTP ${meta.status}`);
  assetsCriados.push(caminho);
  assetId = meta.json?.[0]?.id ?? null;

  const assinado = await fetch(`${BASE}/storage/v1/object/sign/design-assets/${caminho}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${gestor.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  check("dono obtém URL assinado", assinado.status < 300, `HTTP ${assinado.status}`);

  const alheio = await fetch(`${BASE}/storage/v1/object/sign/design-assets/${caminho}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${outro.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  check("outro cliente não assina ficheiro alheio", alheio.status >= 400, `HTTP ${alheio.status}`);

  const ficheiroAlheio = await fetch(`${BASE}/storage/v1/object/design-assets/${caminho}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${outro.token}` },
  });
  check("outro cliente não descarrega o ficheiro", ficheiroAlheio.status >= 400, `HTTP ${ficheiroAlheio.status}`);

  // -------------------------------------------------------------------------
  console.log("\n--- ISOLAMENTO ---");
  const verAlheio = await rest(outro.token, `design_projects?select=id&id=eq.${projetoId}`);
  check(
    "outro cliente não vê o projeto",
    Array.isArray(verAlheio.json) && verAlheio.json.length === 0,
    JSON.stringify(verAlheio.json).slice(0, 60)
  );

  const versoesAlheias = await rpc(outro.token, "design_versions_list", { p_id: projetoId });
  check("outro cliente não lê o histórico", versoesAlheias.status >= 400, `HTTP ${versoesAlheias.status}`);

  const restaurarAlheio = await rpc(outro.token, "design_restore_version", {
    p_id: projetoId,
    p_version_id: snap.json,
  });
  check("outro cliente não restaura", restaurarAlheio.status >= 400, `HTTP ${restaurarAlheio.status}`);

  const apagarAlheio = await rpc(outro.token, "design_delete", { p_id: projetoId });
  check("outro cliente não apaga", apagarAlheio.status >= 400, `HTTP ${apagarAlheio.status}`);

  const semSessao = await fetch(`${BASE}/rest/v1/design_projects?select=id`, {
    headers: { apikey: ANON },
  });
  const semSessaoJson = await semSessao.json().catch(() => null);
  check(
    "sem sessão não se lê nada",
    semSessao.status >= 400 || (Array.isArray(semSessaoJson) && semSessaoJson.length === 0),
    `HTTP ${semSessao.status}`
  );

  // -------------------------------------------------------------------------
  console.log("\n--- LIMPEZA E INTEGRIDADE ---");
  const duplicado = await rpc(gestor.token, "design_duplicate", { p_id: projetoId });
  check("duplicar devolve novo id", typeof duplicado.json === "string", String(duplicado.json));

  const apagado = await rpc(gestor.token, "design_delete", { p_id: duplicado.json });
  check("apagar funciona", apagado.status < 300, `HTTP ${apagado.status}`);

  const aindaExiste = await rest(gestor.token, `design_projects?select=id&id=eq.${duplicado.json}`);
  check("projeto apagado desaparece", (aindaExiste.json ?? []).length === 0);

  const versoesOrfas = await rest(
    gestor.token,
    `design_versions?select=id&project_id=eq.${duplicado.json}`
  );
  check(
    "apagar o projeto leva o histórico (CASCADE)",
    (versoesOrfas.json ?? []).length === 0,
    `${versoesOrfas.json?.length ?? 0} versões órfãs`
  );
} catch (e) {
  fail("exceção inesperada", e instanceof Error ? e.message : String(e));
} finally {
  // -------------------------------------------------------------------------
  // Limpeza
  for (const caminho of assetsCriados) {
    await fetch(`${BASE}/storage/v1/object/design-assets/${caminho}`, {
      method: "DELETE",
      headers: { apikey: ANON, Authorization: `Bearer ${gestor.token}` },
    }).catch(() => undefined);
  }

  if (projetoId) {
    await rpc(gestor.token, "design_delete", { p_id: projetoId }).catch(() => undefined);
  }

  await rest(gestor.token, `design_assets?id=eq.${assetId}`, {
    method: "DELETE",
  }).catch(() => undefined);

  await fetch(`${BASE}/rest/v1/designer_preferences?user_id=eq.${gestor.uid}`, {
    method: "DELETE",
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  }).catch(() => undefined);

  await fetch(`${BASE}/auth/v1/admin/users/${outro.uid}`, {
    method: "DELETE",
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  }).catch(() => undefined);
}

console.log("\n================ RESUMO ================");
console.log(`Total: ${total}  |  Passou: ${passed}  |  Falhou: ${total - passed}`);
if (falhas.length) {
  console.log("\nFalhas:");
  falhas.forEach((f) => console.log(` - ${f.label} :: ${f.detail}`));
}
process.exitCode = falhas.length ? 1 : 0;
}

await main();
