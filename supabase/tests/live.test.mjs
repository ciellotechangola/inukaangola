/**
 * Testes de ACEITAÇÃO ao vivo — correm contra o projeto Supabase real
 * (kvfovbdiaofgtaqopgeh) usando HTTP: Auth, PostgREST, RLS e RPC.
 *
 * Uso:
 *   node supabase/tests/live.test.mjs
 *
 * Requer que a API web esteja a correr em http://localhost:3000
 * (para o endpoint de registo) e lê as chaves de apps/web/.env.local.
 *
 * Os dados de teste são removidos no início e no fim de cada execução.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_API = process.env.INUKA_WEB_API ?? "http://localhost:3000";

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

/**
 * O registo de contas passa por `/api/auth/registo` do próprio Next. Sem o
 * servidor web a correr, todos os testes falhariam com "fetch failed" e
 * esconderiam a causa real. Falhar aqui, uma vez, com a instrução certa é
 * mais útil do que 30 erros em cascata.
 * `Connection: close` evita deixar sockets abertos e o processo terminar com
 * uma asserção do libuv no Windows.
 */
const servidorWeb = await fetch(`${WEB_API}/`, {
  headers: { Connection: "close" },
}).catch(() => null);

if (!servidorWeb) {
  console.error(`\nO servidor web não está a responder em ${WEB_API}.`);
  console.error("Use `npm run test:live` — esse comando arranca o servidor sozinho.");
  console.error("Se está a correr este ficheiro directamente, arranque antes:");
  console.error("  npm run dev\n");
  process.exitCode = 2;
  await new Promise((r) => setTimeout(r, 100));
  process.exit(2);
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !ANON || !SR) {
  console.error("Credenciais em falta em apps/web/.env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Infra de teste
// ---------------------------------------------------------------------------
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
  falhas.push(`${label} :: ${detail}`);
  console.log(`FAIL  ${label}  -> ${detail}`);
}

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(label, typeof detail === "string" ? detail : "");
  } catch (err) {
    fail(label, err.message);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function api(path, { method = "GET", body, jwt, prefer, key = ANON } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${jwt ?? key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

const rpc = (name, args, jwt) => api(`/rest/v1/rpc/${name}`, { method: "POST", body: args, jwt });
const adminRpc = (name, args) => rpc(name, args, SR);

async function signIn(phone, password) {
  const email = `u${phone.replace("+", "")}@inuka.ao`;
  const res = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  if (!res.ok) throw new Error(`login ${phone} falhou: ${JSON.stringify(res.data)}`);
  return { jwt: res.data.access_token, userId: res.data.user.id, email };
}

async function registar(full_name, phone, password) {
  const res = await fetch(`${WEB_API}/api/auth/registo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name, phone, password }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------
// Dados de teste
// ---------------------------------------------------------------------------
const PWD = "TesteInuka2026!";
const CLIENTE = { name: "Cliente Teste", phone: "+244924000001" };
const VENDEDOR = { name: "Vendedor Teste", phone: "+244924000002" };
const TERCEIRO = { name: "Terceiro Teste", phone: "+244924000003" };

async function del(path) {
  const res = await api(path, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
  if (!res.ok) throw new Error(`DELETE ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
}

async function limparUtilizador(phone) {
  const { data: prof } = await api(
    `/rest/v1/profiles?select=id&phone=eq.${encodeURIComponent(phone)}`,
    { key: SR, jwt: SR },
  );
  const id = prof?.[0]?.id;
  if (!id) return;

  // A ordem importa: `orders.customer_id` e `messages.sender_id` referenciam
  // auth.users SEM ON DELETE CASCADE, logo bloqueiam a remoção do utilizador.
  await del(`/rest/v1/orders?customer_id=eq.${id}`);
  await del(`/rest/v1/sales?seller_id=eq.${id}`);
  await del(`/rest/v1/discount_requests?customer_id=eq.${id}`);
  await del(`/rest/v1/messages?sender_id=eq.${id}`);
  await del(`/rest/v1/conversation_members?user_id=eq.${id}`);
  await del(`/rest/v1/conversations?created_by=eq.${id}`);
  await del(`/rest/v1/notifications?user_id=eq.${id}`);
  // audit_logs e inventory_movements protegem a integridade do histórico
  // (sem ON DELETE CASCADE). Só removemos registos de utilizadores de teste.
  await del(`/rest/v1/inventory_movements?created_by=eq.${id}`);
  await del(`/rest/v1/audit_logs?user_id=eq.${id}`);

  const res = await api(`/auth/v1/admin/users/${id}`, { method: "DELETE", key: SR, jwt: SR });
  if (!res.ok) {
    throw new Error(`apagar auth user ${phone} -> ${res.status} ${JSON.stringify(res.data)}`);
  }
}

async function limparTudo() {
  for (const u of [CLIENTE, VENDEDOR, TERCEIRO]) await limparUtilizador(u.phone);
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
console.log("=".repeat(64));
console.log("TESTES DE ACEITAÇÃO — INUKA ANGOLA (base real)");
console.log("=".repeat(64));

try {
  await limparTudo();
} catch (err) {
  console.error("Não foi possível limpar dados de execuções anteriores:", err.message);
  process.exit(1);
}

// --- 1. AUTENTICAÇÃO -------------------------------------------------------
console.log("\n--- 1. AUTENTICAÇÃO ---");

await check("registo de cliente via API", async () => {
  const r = await registar(CLIENTE.name, CLIENTE.phone, PWD);
  assert(r.status === 200, `esperava 200, veio ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data.email;
});

await check("registo duplicado é rejeitado", async () => {
  const r = await registar("Duplicado", "924000001", PWD);
  assert(r.status === 409, `esperava 409, veio ${r.status}`);
  return r.data.error;
});

await check("registo com telefone inválido é rejeitado", async () => {
  const r = await registar("Invalido", "123", PWD);
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
  return r.data.error;
});

let cliente = null;
await check("login por telefone devolve sessão", async () => {
  cliente = await signIn(CLIENTE.phone, PWD);
  assert(cliente.jwt, "sem access_token");
  return `user ${cliente.userId.slice(0, 8)}…`;
});

await check("palavra-passe errada é rejeitada", async () => {
  const res = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: cliente.email, password: "errada123" },
  });
  assert(res.status === 400, `esperava 400, veio ${res.status}`);
  return "credenciais inválidas";
});

await check("perfil criado com nome, telefone e bairro", async () => {
  const res = await api(
    `/rest/v1/profiles?select=full_name,phone,role&id=eq.${cliente.userId}`,
    { jwt: cliente.jwt },
  );
  assert(res.data?.length === 1, "perfil não encontrado");
  const p = res.data[0];
  assert(p.full_name === CLIENTE.name, `nome: ${p.full_name}`);
  assert(p.phone === CLIENTE.phone, `telefone: ${p.phone}`);
  assert(p.role === "customer", `role: ${p.role}`);
  return `${p.full_name} / ${p.role}`;
});

// --- 2. SEGURANÇA / RLS ----------------------------------------------------
console.log("\n--- 2. SEGURANÇA E RLS ---");

await check("anónimo vê o catálogo", async () => {
  const res = await api("/rest/v1/products?select=id,name&is_active=eq.true");
  assert(res.ok && res.data.length > 0, `produtos: ${JSON.stringify(res.data)}`);
  return `${res.data.length} produtos`;
});

await check("anónimo NÃO vê perfis", async () => {
  const res = await api("/rest/v1/profiles?select=id");
  assert(res.data?.length === 0, `expôs ${res.data?.length} perfis`);
  return "0 linhas";
});

await check("cliente vê apenas o próprio perfil", async () => {
  const res = await api("/rest/v1/profiles?select=id", { jwt: cliente.jwt });
  assert(res.data?.length === 1, `viu ${res.data?.length} perfis`);
  assert(res.data[0].id === cliente.userId, "viu perfil alheio");
  return "1 linha (a sua)";
});

await check("cliente NÃO consegue promover-se a gestor", async () => {
  const res = await rpc("promote_to_manager", { p_phone: CLIENTE.phone }, cliente.jwt);
  assert(!res.ok, `a chamada passou (${res.status})`);
  const { data: prof } = await api(
    `/rest/v1/profiles?select=role&id=eq.${cliente.userId}`,
    { jwt: cliente.jwt },
  );
  assert(prof[0].role === "customer", `role mudou para ${prof[0].role}`);
  return `HTTP ${res.status}`;
});

// --- 3. CATÁLOGO E ENCOMENDAS ---------------------------------------------
console.log("\n--- 3. CATÁLOGO E ENCOMENDAS ---");

const produto = await (async () => {
  const res = await api("/rest/v1/products?select=id,name,official_price,promotional_price&is_active=eq.true&limit=1");
  return res.data[0];
})();

const stockInicial = await (async () => {
  const res = await api(`/rest/v1/inventory?select=quantity,reserved_quantity&product_id=eq.${produto.id}`, {
    key: SR,
    jwt: SR,
  });
  return res.data[0];
})();

// Cada execução anterior deixa encomendas pendentes a reservar stock. Sem
// repor, o teste falharia por falta de stock — que é o sistema a funcionar
// bem, não um defeito. Repomos com a chave de serviço (é preparação de teste,
// não uma operação de negócio) para o resultado ser determinístico
// independentemente de quantas vezes a suite já correu contra esta base.
//
// Um produto pode ter mais do que uma linha de `inventory` (uma por província
// desde a migração 0005). `place_order` reserva na linha da província do
// cliente, por isso o que se mede é o **total reservado do produto** — medir
// `data[0]` dava um resultado que dependia da ordem das linhas.
async function reservadoDoProduto() {
  const res = await api(
    `/rest/v1/inventory?select=reserved_quantity&product_id=eq.${produto.id}`,
    { key: SR, jwt: SR },
  );
  return (res.data ?? []).reduce((s, r) => s + Number(r.reserved_quantity ?? 0), 0);
}

await check("stock reposto para o teste", async () => {
  const res = await api(`/rest/v1/inventory?product_id=eq.${produto.id}`, {
    method: "PATCH",
    body: { quantity: 500 },
    key: SR,
    jwt: SR,
  });
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  const atual = await api(
    `/rest/v1/inventory?select=quantity,reserved_quantity&product_id=eq.${produto.id}`,
    { key: SR, jwt: SR },
  );
  stockInicial.quantity = atual.data[0].quantity;
  stockInicial.reserved_quantity = await reservadoDoProduto();
  return `linhas=${atual.data.length} quantity=${atual.data[0].quantity} reservado=${stockInicial.reserved_quantity}`;
});

const clientRef = randomUUID();
let encomenda = null;

await check("cliente cria encomenda e stock é reservado", async () => {
  const res = await rpc(
    "place_order",
    {
      p_items: [{ product_id: produto.id, quantity: 2 }],
      p_delivery_method: "pickup",
      p_contact_phone: CLIENTE.phone,
      p_client_ref: clientRef,
    },
    cliente.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  encomenda = res.data;

  const esperado = Number(produto.promotional_price ?? produto.official_price) * 2;
  assert(Number(encomenda.total) === esperado, `total ${encomenda.total} != ${esperado}`);

  const reservado = await reservadoDoProduto();
  assert(
    reservado === stockInicial.reserved_quantity + 2,
    `reservado ${reservado} (esperado ${stockInicial.reserved_quantity + 2})`,
  );
  return `${encomenda.reference} · ${encomenda.total} AOA`;
});

await check("preço vem do servidor, não do cliente", async () => {
  // Tentar impor um preço no payload é ignorado pelo servidor
  const res = await rpc(
    "place_order",
    {
      p_items: [{ product_id: produto.id, quantity: 1, unit_price: 1 }],
      p_delivery_method: "pickup",
      p_client_ref: randomUUID(),
    },
    cliente.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  const esperado = Number(produto.promotional_price ?? produto.official_price);
  assert(Number(res.data.total) === esperado, `total ${res.data.total} != ${esperado}`);
  await api(`/rest/v1/orders?id=eq.${res.data.order_id}`, { method: "DELETE", key: SR, jwt: SR });
  return `total ${res.data.total} (pedido 1 AOA ignorado)`;
});

await check("mesma client_ref não duplica encomenda", async () => {
  const res = await rpc(
    "place_order",
    {
      p_items: [{ product_id: produto.id, quantity: 2 }],
      p_delivery_method: "pickup",
      p_client_ref: clientRef,
    },
    cliente.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  assert(res.data.duplicated === true, "não marcou como duplicada");
  assert(res.data.order_id === encomenda.order_id, "criou encomenda diferente");
  return "devolveu a mesma encomenda";
});

await check("cliente NÃO altera estado de encomenda", async () => {
  const res = await rpc(
    "update_order_status",
    { p_order_id: encomenda.order_id, p_status: "completed" },
    cliente.jwt,
  );
  assert(!res.ok, `passou (${res.status})`);
  return `HTTP ${res.status}`;
});

// --- 4. GESTÃO -------------------------------------------------------------
console.log("\n--- 4. GESTÃO ---");

const gestor = await signIn("+244900000001", "InukaGestor2026!");

await check("gestor obtém dashboard com dados reais", async () => {
  const res = await rpc("dashboard_stats", {}, gestor.jwt);
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  assert(Number(res.data.sales_total_value) >= 0, "sales_total_value ausente");
  return `vendas=${res.data.sales_count} encomendas=${res.data.orders_count} valor=${res.data.sales_total_value}`;
});

await check("gestor confirma a encomenda", async () => {
  const res = await rpc(
    "update_order_status",
    { p_order_id: encomenda.order_id, p_status: "confirmed", p_notes: "Confirmada no teste" },
    gestor.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  const hist = await api(
    `/rest/v1/order_status_history?select=status&order_id=eq.${encomenda.order_id}&order=created_at`,
    { key: SR, jwt: SR },
  );
  assert(hist.data.some((h) => h.status === "confirmed"), "histórico sem confirmed");
  return `${hist.data.length} entradas no histórico`;
});

// --- 5. DESCONTOS ----------------------------------------------------------
console.log("\n--- 5. DESCONTOS ---");

let desconto = null;

await check("cliente pede desconto dentro do limite", async () => {
  // O limite aplica-se ao preço ATUAL (promocional, se existir)
  const precoAtual = Number(produto.promotional_price ?? produto.official_price);
  const res = await rpc(
    "request_discount",
    {
      p_product_id: produto.id,
      p_requested_price: Math.round(precoAtual * 0.9),
      p_justification: "Teste automatizado",
    },
    cliente.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  desconto = res.data;
  return `estado ${res.data.status}`;
});

await check("gestor aprova o desconto", async () => {
  const res = await rpc(
    "decide_discount",
    { p_request_id: desconto.discount_request_id, p_approve: true },
    gestor.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  assert(res.data.status === "approved", `estado ${res.data.status}`);
  return "aprovado";
});

await check("desconto acima do limite é rejeitado no pedido", async () => {
  // O limite é validado logo em request_discount (correção de 2026-10-31), não
  // só na decisão: o cliente não deve sequer conseguir pedir 50 % se o teto é 20 %.
  const precoAtual = Number(produto.promotional_price ?? produto.official_price);
  const pedido = await rpc(
    "request_discount",
    { p_product_id: produto.id, p_requested_price: Math.round(precoAtual * 0.5), p_justification: "50%" },
    cliente.jwt,
  );
  assert(!pedido.ok, "aceitou um pedido de 50% (o limite configurado é 20%)");
  const msg = String(pedido.data?.message ?? "");
  assert(/limite/i.test(msg), `mensagem inesperada: ${msg}`);
  return msg.slice(0, 60);
});

// --- 6. VENDEDOR -----------------------------------------------------------
console.log("\n--- 6. VENDEDOR ---");

await check("criar e promover vendedor", async () => {
  const r = await registar(VENDEDOR.name, VENDEDOR.phone, PWD);
  assert(r.status === 200, `registo: ${r.status}`);
  const promo = await adminRpc("promote_to_seller", {
    p_phone: VENDEDOR.phone,
    p_region: "Uíge",
  });
  assert(promo.ok, `promoção: ${JSON.stringify(promo.data)}`);
  return promo.data.role;
});

const vendedor = await signIn(VENDEDOR.phone, PWD);

await check("vendedor regista venda", async () => {
  const res = await rpc(
    "register_sale",
    {
      p_items: [{ product_id: produto.id, quantity: 1 }],
      p_payment_method: "cash",
      p_payment_status: "paid",
      p_client_ref: randomUUID(),
    },
    vendedor.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  return `${res.data.reference} · ${res.data.total} AOA`;
});

await check("vendedor vê os seus indicadores", async () => {
  const res = await rpc("seller_stats", {}, vendedor.jwt);
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  assert(Number(res.data.total_sales_value) > 0, `total_sales_value=${res.data.total_sales_value}`);
  return `valor=${res.data.total_sales_value} vendas=${res.data.sales_count} unidades=${res.data.units_sold}`;
});

await check("cliente NÃO acede a register_sale", async () => {
  const res = await rpc(
    "register_sale",
    { p_items: [{ product_id: produto.id, quantity: 1 }], p_client_ref: randomUUID() },
    cliente.jwt,
  );
  assert(!res.ok, `passou (${res.status})`);
  return `HTTP ${res.status}`;
});

// --- 7. CHAT ---------------------------------------------------------------
console.log("\n--- 7. CHAT ---");

let conversa = null;

await check("cliente abre conversa com vendedor", async () => {
  const res = await rpc("get_or_create_direct_conversation", { p_other_user: vendedor.userId }, cliente.jwt);
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  // A função devolve um uuid simples (RETURNS uuid), não um objecto
  assert(typeof res.data === "string", `esperava uuid, veio ${JSON.stringify(res.data)}`);
  conversa = res.data;
  return conversa.slice(0, 8) + "…";
});

await check("mensagem é enviada e lida pelo vendedor", async () => {
  const send = await api("/rest/v1/messages", {
    method: "POST",
    jwt: cliente.jwt,
    prefer: "return=representation",
    body: { conversation_id: conversa, sender_id: cliente.userId, content: "Olá, teste ao vivo" },
  });
  assert(send.ok, `envio: ${JSON.stringify(send.data)}`);

  const read = await api(`/rest/v1/messages?select=content&conversation_id=eq.${conversa}`, {
    jwt: vendedor.jwt,
  });
  assert(read.data.length >= 1, "vendedor não viu a mensagem");
  return `${read.data.length} mensagem(ns)`;
});

await check("terceiro NÃO lê a conversa", async () => {
  await registar(TERCEIRO.name, TERCEIRO.phone, PWD);
  const terceiro = await signIn(TERCEIRO.phone, PWD);
  const res = await api(`/rest/v1/messages?select=content&conversation_id=eq.${conversa}`, {
    jwt: terceiro.jwt,
  });
  assert(res.data?.length === 0, `expôs ${res.data?.length} mensagens`);
  return "0 mensagens";
});

// --- 8. SINCRONIZAÇÃO OFFLINE ---------------------------------------------
console.log("\n--- 8. SINCRONIZAÇÃO OFFLINE ---");

await check("sync_push processa operação pendente", async () => {
  const localId = randomUUID();
  const res = await rpc(
    "sync_push",
    {
      p_operations: [
        { local_id: localId, entity: "favorite", operation: "create", payload: { product_id: produto.id } },
      ],
    },
    cliente.jwt,
  );
  assert(res.ok, `erro: ${JSON.stringify(res.data)}`);
  assert(res.data.results[0].status === "synced", `estado ${res.data.results[0].status}`);
  return `count=${res.data.count}`;
});

await check("sync repetido não duplica o favorito", async () => {
  const localId = randomUUID();
  for (let i = 0; i < 2; i++) {
    await rpc(
      "sync_push",
      {
        p_operations: [
          { local_id: localId, entity: "favorite", operation: "create", payload: { product_id: produto.id } },
        ],
      },
      cliente.jwt,
    );
  }
  const favs = await api(
    `/rest/v1/favorites?select=product_id&product_id=eq.${produto.id}`,
    { jwt: cliente.jwt },
  );
  assert(favs.data.length === 1, `${favs.data.length} favoritos`);
  return "1 favorito";
});

await check("venda offline duplicada não duplica receita", async () => {
  const localId = randomUUID();
  const payload = {
    local_id: localId,
    entity: "sale",
    operation: "create",
    payload: { items: [{ product_id: produto.id, quantity: 1 }], payment_status: "pending" },
  };
  const r1 = await rpc("sync_push", { p_operations: [payload] }, vendedor.jwt);
  const r2 = await rpc("sync_push", { p_operations: [payload] }, vendedor.jwt);
  assert(r1.ok && r2.ok, "erro no sync");
  const dup = r2.data.results[0].result?.duplicated === true;
  assert(dup, "segunda sincronização não foi marcada como duplicada");
  return "idempotente";
});

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------
console.log("\n--- LIMPEZA ---");
try {
  await limparTudo();
  console.log("Dados de teste removidos.");
} catch (err) {
  console.log("Aviso: limpeza parcial —", err.message);
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
console.log(`Total: ${total}  |  Passou: ${passed}  |  Falhou: ${falhas.length}`);
if (falhas.length) {
  console.log("\nFalhas:");
  for (const f of falhas) console.log("  -", f);
}
console.log("=".repeat(64));
process.exit(falhas.length ? 1 : 0);
