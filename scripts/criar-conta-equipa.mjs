/**
 * Cria uma conta de equipa (gestor, colaborador ou loja) na base alojada.
 *
 * O registo do site só cria clientes: `handle_new_user` põe sempre
 * `role = 'customer'`, e o papel é elevado depois. É o que este script faz, na
 * mesma ordem do servidor — criar em `auth.users` com a Admin API (email
 * sintético `u<telefone>@inuka.ao`, já confirmado), completar o perfil e
 * promover. `sync_profile_role` leva o papel novo para `user_roles`.
 *
 * Uso:
 *   node scripts/criar-conta-equipa.mjs \
 *     --nome "Maria Silva" --telefone 923111333 --senha "..." \
 *     --papel gestor --provincia uige
 *
 * `--papel`  gestor | colaborador | loja   (omissão: colaborador)
 * `--provincia` é o slug de `provincias` (ex.: uige, luanda). Obrigatório para
 *   gestor e loja; no colaborador é opcional.
 *
 * Idempotente: se o telefone já tem conta, não cria outra — só acerta o perfil,
 * o papel e (se faltar) a palavra-passe.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const text = readFileSync(resolve(ROOT, "apps/web/.env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function argumentos(argv) {
  const saida = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const chave = a.slice(2);
    const valor = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    saida[chave] = valor;
  }
  return saida;
}

/** +244 9xx xxx xxx — a mesma regra do servidor (`normalizePhone`). */
function telefoneNormalizado(bruto) {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 9) return `+244${digitos}`;
  if (digitos.length === 12 && digitos.startsWith("244")) return `+${digitos}`;
  return null;
}

const PAPEIS = { gestor: "manager", colaborador: "seller", loja: "store_seller" };

const args = argumentos(process.argv.slice(2));
const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

if (!BASE || !SR) {
  console.error("Credenciais em falta em apps/web/.env.local");
  process.exit(1);
}

const nome = String(args.nome ?? "").trim();
const telefone = telefoneNormalizado(args.telefone);
const senha = String(args.senha ?? "");
const papel = PAPEIS[String(args.papel ?? "colaborador").toLowerCase()];
const slug = String(args.provincia ?? "").trim();

if (nome.length < 3) {
  console.error("--nome é obrigatório (mínimo 3 caracteres).");
  process.exit(1);
}
if (!telefone) {
  console.error("--telefone inválido. Use 9xx xxx xxx ou +244 9xx xxx xxx.");
  process.exit(1);
}
if (senha.length < 6) {
  console.error("--senha é obrigatória (mínimo 6 caracteres).");
  process.exit(1);
}
if (!papel) {
  console.error("--papel tem de ser gestor, colaborador ou loja.");
  process.exit(1);
}
if (!slug && papel !== "seller") {
  console.error("--provincia é obrigatório para gestor e loja.");
  process.exit(1);
}

const email = `u${telefone.slice(4)}@inuka.ao`;

const cabecalhos = {
  apikey: SR,
  Authorization: `Bearer ${SR}`,
  "Content-Type": "application/json",
};

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${BASE}${caminho}`, { headers: cabecalhos, ...opcoes });
  const texto = await r.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { ok: r.ok, status: r.status, corpo };
}

// ---------------------------------------------------------------------------
// 1. A conta existe?
// ---------------------------------------------------------------------------
const procura = await pedir(
  `/rest/v1/profiles?select=id,full_name,phone,role,provincia_id&phone=eq.${encodeURIComponent(telefone)}`
);
if (!procura.ok) {
  console.error("Não foi possível consultar o perfil:", JSON.stringify(procura.corpo));
  process.exit(1);
}

let userId = procura.corpo?.[0]?.id ?? null;
let criada = false;

if (!userId) {
  const criado = await pedir("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: nome, phone: telefone },
    }),
  });
  if (!criado.ok) {
    console.error("Falha ao criar a conta:", JSON.stringify(criado.corpo));
    process.exit(1);
  }
  userId = criado.corpo?.id ?? criado.corpo?.user?.id ?? null;
  criada = true;
  if (!userId) {
    console.error("A Admin API não devolveu o id da conta:", JSON.stringify(criado.corpo));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 2. Província (resolvida pelo slug, nunca por uuid)
// ---------------------------------------------------------------------------
let provinciaId = null;
let provinciaNome = null;
if (slug) {
  const prov = await pedir(
    `/rest/v1/provincias?select=id,nome&slug=eq.${encodeURIComponent(slug)}`
  );
  provinciaId = prov.corpo?.[0]?.id ?? null;
  provinciaNome = prov.corpo?.[0]?.nome ?? null;
  if (!provinciaId) {
    console.error(`Província «${slug}» não existe. Verifique o slug em \`provincias\`.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 3. Perfil
// ---------------------------------------------------------------------------
const perfil = {
  full_name: nome,
  phone: telefone,
  role: papel,
  is_active: true,
};
if (provinciaId) perfil.provincia_id = provinciaId;

const actualizado = await pedir(`/rest/v1/profiles?id=eq.${userId}`, {
  method: "PATCH",
  headers: { ...cabecalhos, Prefer: "return=representation" },
  body: JSON.stringify(perfil),
});
if (!actualizado.ok) {
  console.error("Falha ao actualizar o perfil:", JSON.stringify(actualizado.corpo));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Colaborador tem linha em `seller_profiles` (é de lá que sai a comissão)
// ---------------------------------------------------------------------------
if (papel === "seller") {
  const sp = await pedir(`/rest/v1/seller_profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...cabecalhos, Prefer: "return=representation" },
    body: JSON.stringify({ region: provinciaNome ?? null }),
  });
  if (sp.ok && Array.isArray(sp.corpo) && sp.corpo.length === 0) {
    await pedir("/rest/v1/seller_profiles", {
      method: "POST",
      headers: { ...cabecalhos, Prefer: "return=minimal" },
      body: JSON.stringify({ id: userId, region: provinciaNome ?? null }),
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Confirmar
// ---------------------------------------------------------------------------
const final = await pedir(
  `/rest/v1/profiles?select=id,full_name,phone,role,is_active,provincia_id&id=eq.${userId}`
);
const p = final.corpo?.[0] ?? {};
const roles = await pedir(`/rest/v1/user_roles?select=role&user_id=eq.${userId}`);

console.log(
  JSON.stringify(
    {
      criada,
      email,
      telefone,
      nome: p.full_name,
      papel: p.role,
      activo: p.is_active,
      provincia: provinciaNome,
      provincia_id: p.provincia_id,
      user_roles: roles.corpo?.[0]?.role ?? null,
      user_id: userId,
    },
    null,
    2
  )
);
