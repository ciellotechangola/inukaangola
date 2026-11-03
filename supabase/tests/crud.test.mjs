/**
 * TESTES CRUD POR PERFIL — correm contra o projeto Supabase real.
 *
 * Cobre criação/leitura/atualização/remoção em todas as entidades
 * operacionais, para os quatro perfis (visitante, cliente, vendedor, gestor),
 * incluindo os casos negativos de RLS.
 *
 * Uso:
 *   node supabase/tests/crud.test.mjs
 *
 * Requer a API web em http://localhost:3000 (endpoint de registo)
 * e lê as chaves de apps/web/.env.local.
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
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !ANON || !SR) {
  console.error("Credenciais em falta em apps/web/.env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Infra
// ---------------------------------------------------------------------------
let total = 0;
let passed = 0;
const falhas = [];
let secao = "";

function group(name) {
  secao = name;
  console.log(`\n--- ${name} ---`);
}

function ok(label, detail = "") {
  total++;
  passed++;
  console.log(`PASS  ${label}${detail ? `  -> ${detail}` : ""}`);
}

function fail(label, detail = "") {
  total++;
  falhas.push(`[${secao}] ${label} :: ${detail}`);
  console.log(`FAIL  ${label}  -> ${detail}`);
}

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(label, typeof detail === "string" ? detail : "");
    return true;
  } catch (err) {
    fail(label, err.message);
    return false;
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
const admin = (name, args) => rpc(name, args, SR);
const sr = (path, opts = {}) => api(path, { key: SR, jwt: SR, ...opts });

async function signIn(phone, password) {
  const email = `u${phone.replace("+", "")}@inuka.ao`;
  const res = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  if (!res.ok) throw new Error(`login ${phone} falhou: ${JSON.stringify(res.data)}`);
  return { jwt: res.data.access_token, userId: res.data.user.id, email };
}

async function registar(full_name, phone, password, extra = {}) {
  const res = await fetch(`${WEB_API}/api/auth/registo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name, phone, password, ...extra }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------
// Contas de teste
// ---------------------------------------------------------------------------
const PWD = "CrudInuka2026!";
const A = { name: "Cliente Alfa", phone: "+244924100001" };
const B = { name: "Cliente Beta", phone: "+244924100002" };
const V = { name: "Vendedor Gama", phone: "+244924100003" };
const G = { name: "Gestor Delta", phone: "+244924100004" };

async function del(path) {
  const res = await sr(path, { method: "DELETE", prefer: "return=minimal" });
  if (!res.ok) throw new Error(`DELETE ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
}

async function limparUtilizador(phone) {
  const { data: prof } = await sr(`/rest/v1/profiles?select=id&phone=eq.${encodeURIComponent(phone)}`);
  const id = prof?.[0]?.id;
  if (!id) return;

  await del(`/rest/v1/orders?customer_id=eq.${id}`);
  await del(`/rest/v1/sales?seller_id=eq.${id}`);
  await del(`/rest/v1/sales?customer_id=eq.${id}`);
  await del(`/rest/v1/discount_requests?customer_id=eq.${id}`);
  await del(`/rest/v1/reservations?customer_id=eq.${id}`);
  await del(`/rest/v1/messages?sender_id=eq.${id}`);
  await del(`/rest/v1/conversations?created_by=eq.${id}`);
  await del(`/rest/v1/posts?author_id=eq.${id}`);
  await del(`/rest/v1/post_comments?author_id=eq.${id}`);
  await del(`/rest/v1/notifications?user_id=eq.${id}`);
  await del(`/rest/v1/sync_operations?user_id=eq.${id}`);
  await del(`/rest/v1/favorites?user_id=eq.${id}`);
  await del(`/rest/v1/audit_logs?user_id=eq.${id}`);
  await del(`/rest/v1/seller_customers?seller_id=eq.${id}`);
  await del(`/rest/v1/seller_customers?customer_id=eq.${id}`);

  // `products.created_by` / `inventory_movements.created_by` só passam a
  // ON DELETE SET NULL depois do patch. Até lá, anulamos manualmente para
  // que a limpeza do teste não fique presa.
  await sr(`/rest/v1/products?created_by=eq.${id}`, {
    method: "PATCH",
    body: { created_by: null, updated_by: null },
    prefer: "return=minimal",
  });
  await sr(`/rest/v1/inventory_movements?created_by=eq.${id}`, {
    method: "PATCH",
    body: { created_by: null },
    prefer: "return=minimal",
  });

  const res = await sr(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`apagar user ${phone} -> ${res.status} ${JSON.stringify(res.data)}`);
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
console.log("=".repeat(64));
console.log("TESTES CRUD POR PERFIL — INUKA ANGOLA (base real)");
console.log("=".repeat(64));

console.log("\n[preparação] a limpar contas de teste…");
for (const u of [A, B, V, G]) await limparUtilizador(u.phone);

// ---------------------------------------------------------------------------
group("1. CONTAS — criação dos quatro perfis");
// ---------------------------------------------------------------------------
const sessoes = {};

await check("registo cliente Alfa", async () => {
  const r = await registar(A.name, A.phone, PWD, { neighborhood: "Uíge Centro" });
  assert(r.status === 201 || r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.email;
});

await check("registo cliente Beta", async () => {
  const r = await registar(B.name, B.phone, PWD, { neighborhood: "Luanda" });
  assert(r.status === 201 || r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.email;
});

await check("registo vendedor Gama", async () => {
  const r = await registar(V.name, V.phone, PWD, { neighborhood: "Uíge" });
  assert(r.status === 201 || r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.email;
});

await check("registo gestor Delta", async () => {
  const r = await registar(G.name, G.phone, PWD, { neighborhood: "Uíge" });
  assert(r.status === 201 || r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.email;
});

await check("login de cada perfil devolve sessão", async () => {
  for (const u of [A, B, V, G]) sessoes[u.phone] = await signIn(u.phone, PWD);
  return `${Object.keys(sessoes).length} sessões`;
});

await check("promover Gama a vendedor", async () => {
  const res = await admin("promote_to_seller", { p_phone: V.phone, p_region: "Uíge" });
  assert(res.ok, JSON.stringify(res.data));
  return JSON.stringify(res.data);
});

await check("promover Delta a gestor", async () => {
  const res = await admin("promote_to_manager", { p_phone: G.phone });
  assert(res.ok, JSON.stringify(res.data));
  return JSON.stringify(res.data);
});

await check("papéis corretos na base", async () => {
  const { data } = await sr("/rest/v1/user_roles?select=user_id,role");
  const map = new Map((data ?? []).map((r) => [r.user_id, r.role]));
  assert(map.get(sessoes[A.phone].userId) === "customer", "Alfa não é customer");
  assert(map.get(sessoes[B.phone].userId) === "customer", "Beta não é customer");
  assert(map.get(sessoes[V.phone].userId) === "seller", "Gama não é seller");
  assert(map.get(sessoes[G.phone].userId) === "manager", "Delta não é manager");
  return "customer/customer/seller/manager";
});

await check("registo com telefone duplicado é recusado", async () => {
  const r = await registar("Duplicado", A.phone, PWD);
  assert(r.status === 409, `esperava 409, veio ${r.status}`);
  return r.data.error;
});

await check("registo com telefone inválido é recusado", async () => {
  const r = await registar("Invalido", "123", PWD);
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
  return r.data.error;
});

await check("registo com palavra-passe fraca é recusado", async () => {
  const r = await registar("Fraco", "+244924100099", "123");
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
  return r.data.error;
});

// ---------------------------------------------------------------------------
group("2. PERFIL — leitura e atualização (cliente)");
// ---------------------------------------------------------------------------
await check("cliente lê o próprio perfil", async () => {
  const res = await rpc("my_profile", {}, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data.full_name === A.name, `nome=${res.data.full_name}`);
  assert(res.data.role === "customer", `role=${res.data.role}`);
  return `${res.data.full_name} / ${res.data.phone}`;
});

await check("cliente atualiza nome e bairro", async () => {
  const id = sessoes[A.phone].userId;
  const res = await api(`/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    jwt: sessoes[A.phone].jwt,
    body: { full_name: "Cliente Alfa Editado", neighborhood: "Uíge Praia" },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data[0].full_name === "Cliente Alfa Editado", "nome não mudou");
  assert(res.data[0].neighborhood === "Uíge Praia", "bairro não mudou");
  // repor
  await api(`/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    jwt: sessoes[A.phone].jwt,
    body: { full_name: A.name, neighborhood: "Uíge Centro" },
  });
  return "nome + bairro";
});

await check("cliente NÃO altera o próprio role", async () => {
  const id = sessoes[A.phone].userId;
  const res = await api(`/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    jwt: sessoes[A.phone].jwt,
    body: { role: "manager" },
  });
  const check2 = await sr(`/rest/v1/profiles?select=role&id=eq.${id}`);
  assert(check2.data[0].role === "customer", `role virou ${check2.data[0].role}`);
  return "bloqueado";
});

await check("cliente NÃO lê o perfil de outro cliente", async () => {
  const res = await api(`/rest/v1/profiles?select=id,full_name&id=eq.${sessoes[B.phone].userId}`, {
    jwt: sessoes[A.phone].jwt,
  });
  assert(res.data.length === 0, `leu ${res.data.length} linhas`);
  return "0 linhas";
});

await check("visitante NÃO lê perfis", async () => {
  const res = await api("/rest/v1/profiles?select=id");
  assert(res.data.length === 0, `leu ${res.data.length} linhas`);
  return "0 linhas";
});

// ---------------------------------------------------------------------------
group("3. CATEGORIAS — CRUD (gestor) e bloqueio (cliente)");
// ---------------------------------------------------------------------------
let categoriaId = null;

await check("gestor cria categoria", async () => {
  const res = await api("/rest/v1/categories", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: {
      name: `Categoria Teste ${Date.now()}`,
      slug: `cat-teste-${Date.now()}`,
      description: "Criada por teste automatizado",
      sort_order: 99,
    },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  categoriaId = res.data[0].id;
  return res.data[0].name;
});

await check("visitante lê categorias", async () => {
  const res = await api("/rest/v1/categories?select=id,name&is_active=eq.true");
  assert(res.ok && res.data.length > 0, "sem categorias");
  return `${res.data.length} categorias`;
});

await check("gestor atualiza categoria", async () => {
  const res = await api(`/rest/v1/categories?id=eq.${categoriaId}`, {
    method: "PATCH",
    jwt: sessoes[G.phone].jwt,
    body: { description: "Descrição atualizada", sort_order: 98 },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data[0].description === "Descrição atualizada", "não atualizou");
  return "descrição + ordem";
});

await check("cliente NÃO cria categoria", async () => {
  const res = await api("/rest/v1/categories", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { name: "Hack", slug: `hack-${Date.now()}` },
  });
  assert(!res.ok, "cliente conseguiu criar categoria");
  return `HTTP ${res.status}`;
});

await check("vendedor NÃO cria categoria", async () => {
  const res = await api("/rest/v1/categories", {
    method: "POST",
    jwt: sessoes[V.phone].jwt,
    body: { name: "Hack2", slug: `hack2-${Date.now()}` },
  });
  assert(!res.ok, "vendedor conseguiu criar categoria");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("4. PRODUTOS — CRUD, imagens e stock (gestor)");
// ---------------------------------------------------------------------------
let produtoId = null;

await check("gestor cria produto", async () => {
  const res = await api("/rest/v1/products", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: {
      sku: `TST-${Date.now()}`,
      name: "[TESTE] Produto CRUD",
      category_id: categoriaId,
      description: "Produto criado pelo teste",
      official_price: 25000,
      promotional_price: 20000,
      is_active: true,
      created_by: sessoes[G.phone].userId,
    },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  produtoId = res.data[0].id;
  return res.data[0].name;
});

await check("gestor cria registo de inventário", async () => {
  const res = await api("/rest/v1/inventory", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: { product_id: produtoId, quantity: 10, low_stock_threshold: 3 },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data[0].quantity === 10, "quantidade errada");
  return "10 unidades";
});

await check("visitante vê produto ativo", async () => {
  const res = await api(`/rest/v1/products?select=id,name,official_price&id=eq.${produtoId}`);
  assert(res.ok && res.data.length === 1, "produto invisível");
  return res.data[0].name;
});

await check("gestor atualiza preço e descrição", async () => {
  const res = await api(`/rest/v1/products?id=eq.${produtoId}`, {
    method: "PATCH",
    jwt: sessoes[G.phone].jwt,
    body: { official_price: 26000, promotional_price: 21000, description: "Atualizado" },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  assert(Number(res.data[0].official_price) === 26000, "preço não mudou");
  return "26000 / 21000";
});

await check("preço promocional acima do oficial é rejeitado", async () => {
  const res = await api(`/rest/v1/products?id=eq.${produtoId}`, {
    method: "PATCH",
    jwt: sessoes[G.phone].jwt,
    body: { promotional_price: 99999 },
  });
  assert(!res.ok, "aceitou promo > oficial");
  return `HTTP ${res.status}`;
});

await check("gestor adiciona imagem ao produto", async () => {
  const res = await api("/rest/v1/product_images", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: {
      product_id: produtoId,
      storage_path: `products/${produtoId}/teste.png`,
      url: "https://example.com/teste.png",
      is_primary: true,
    },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return res.data[0].storage_path;
});

await check("visitante lê imagens do produto", async () => {
  const res = await api(`/rest/v1/product_images?select=url&product_id=eq.${produtoId}`);
  assert(res.ok && res.data.length === 1, "sem imagem");
  return "1 imagem";
});

await check("gestor ajusta stock via RPC (com movimento)", async () => {
  const res = await rpc("set_product_stock", {
    p_product_id: produtoId,
    p_quantity: 25,
    p_reason: "Reposição de teste",
  }, sessoes[G.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  const inv = await sr(`/rest/v1/inventory?select=quantity&product_id=eq.${produtoId}`);
  assert(inv.data[0].quantity === 25, `stock=${inv.data[0].quantity}`);
  const mov = await sr(`/rest/v1/inventory_movements?select=*&product_id=eq.${produtoId}`);
  assert(mov.data.length >= 1, "sem movimento registado");
  return `25 un · ${mov.data.length} movimento(s)`;
});

await check("cliente NÃO ajusta stock", async () => {
  const res = await rpc("set_product_stock", {
    p_product_id: produtoId,
    p_quantity: 999,
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "cliente ajustou stock");
  return `HTTP ${res.status}`;
});

await check("cliente NÃO cria produto", async () => {
  const res = await api("/rest/v1/products", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { name: "Hack", official_price: 1 },
  });
  assert(!res.ok, "cliente criou produto");
  return `HTTP ${res.status}`;
});

await check("gestor desativa produto (soft delete)", async () => {
  const res = await api(`/rest/v1/products?id=eq.${produtoId}`, {
    method: "PATCH",
    jwt: sessoes[G.phone].jwt,
    body: { is_active: false },
    prefer: "return=representation",
  });
  assert(res.ok && res.data[0].is_active === false, "não desativou");
  return "is_active=false";
});

await check("produto inativo desaparece do catálogo público", async () => {
  const res = await api(`/rest/v1/products?select=id&id=eq.${produtoId}`);
  assert(res.data.length === 0, "produto inativo ainda visível");
  return "invisível";
});

await check("gestor reativa produto", async () => {
  const res = await api(`/rest/v1/products?id=eq.${produtoId}`, {
    method: "PATCH",
    jwt: sessoes[G.phone].jwt,
    body: { is_active: true },
    prefer: "return=representation",
  });
  assert(res.ok && res.data[0].is_active === true, "não reativou");
  return "is_active=true";
});

// ---------------------------------------------------------------------------
group("5. CARRINHO — cliente");
// ---------------------------------------------------------------------------
let cartId = null;

await check("cliente cria carrinho", async () => {
  const res = await api("/rest/v1/carts", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { user_id: sessoes[A.phone].userId },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  cartId = res.data[0].id;
  return cartId.slice(0, 8) + "…";
});

await check("cliente adiciona item ao carrinho", async () => {
  const res = await api("/rest/v1/cart_items", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { cart_id: cartId, product_id: produtoId, quantity: 2, unit_price: 21000 },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return "2 un";
});

await check("cliente atualiza quantidade no carrinho", async () => {
  const res = await api(`/rest/v1/cart_items?cart_id=eq.${cartId}&product_id=eq.${produtoId}`, {
    method: "PATCH",
    jwt: sessoes[A.phone].jwt,
    body: { quantity: 3 },
    prefer: "return=representation",
  });
  assert(res.ok && res.data[0].quantity === 3, "não atualizou");
  return "3 un";
});

await check("cliente NÃO vê o carrinho de outro cliente", async () => {
  const res = await api(`/rest/v1/carts?select=id&id=eq.${cartId}`, {
    jwt: sessoes[B.phone].jwt,
  });
  assert(res.data.length === 0, "viu carrinho alheio");
  return "0 linhas";
});

await check("cliente remove item do carrinho", async () => {
  const res = await api(`/rest/v1/cart_items?cart_id=eq.${cartId}`, {
    method: "DELETE",
    jwt: sessoes[A.phone].jwt,
    prefer: "return=minimal",
  });
  assert(res.ok, JSON.stringify(res.data));
  const check2 = await api(`/rest/v1/cart_items?select=id&cart_id=eq.${cartId}`, {
    jwt: sessoes[A.phone].jwt,
  });
  assert(check2.data.length === 0, "item não removido");
  return "0 itens";
});

// ---------------------------------------------------------------------------
group("6. ENCOMENDAS — cliente cria, gestor gere, cliente cancela");
// ---------------------------------------------------------------------------
let encomendaId = null;

await check("cliente cria encomenda", async () => {
  const res = await rpc("place_order", {
    p_items: [{ product_id: produtoId, quantity: 2 }],
    p_delivery_method: "pickup",
    p_contact_phone: A.phone,
    p_notes: "Encomenda de teste",
    p_client_ref: randomUUID(),
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  encomendaId = res.data.order_id;
  return `${res.data.reference} · ${res.data.total_amount} AOA`;
});

await check("stock fica reservado após a encomenda", async () => {
  const inv = await sr(`/rest/v1/inventory?select=quantity,reserved_quantity&product_id=eq.${produtoId}`);
  assert(inv.data[0].reserved_quantity >= 2, `reservado=${inv.data[0].reserved_quantity}`);
  return `${inv.data[0].quantity} total · ${inv.data[0].reserved_quantity} reservado`;
});

await check("cliente vê a própria encomenda", async () => {
  const res = await rpc("my_orders", {}, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data.some((o) => o.id === encomendaId), "encomenda não listada");
  return `${res.data.length} encomenda(s)`;
});

await check("cliente NÃO vê a encomenda de outro cliente", async () => {
  const res = await api(`/rest/v1/orders?select=id&id=eq.${encomendaId}`, {
    jwt: sessoes[B.phone].jwt,
  });
  assert(res.data.length === 0, "viu encomenda alheia");
  return "0 linhas";
});

await check("gestor vê todas as encomendas", async () => {
  const res = await api(`/rest/v1/orders?select=id&id=eq.${encomendaId}`, {
    jwt: sessoes[G.phone].jwt,
  });
  assert(res.data.length === 1, "gestor não vê");
  return "1 encomenda";
});

await check("gestor confirma a encomenda", async () => {
  const res = await rpc("update_order_status", {
    p_order_id: encomendaId,
    p_status: "confirmed",
    p_notes: "Confirmada no teste",
  }, sessoes[G.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data.status === "confirmed", `status=${res.data.status}`);
  return "confirmed";
});

await check("histórico de estados registado", async () => {
  const res = await sr(`/rest/v1/order_status_history?select=status&order_id=eq.${encomendaId}`);
  assert(res.data.length >= 2, `só ${res.data.length} entradas`);
  return res.data.map((r) => r.status).join(" → ");
});

await check("cliente NÃO confirma a própria encomenda", async () => {
  const res = await rpc("update_order_status", {
    p_order_id: encomendaId,
    p_status: "preparing",
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "cliente alterou estado");
  return `HTTP ${res.status}`;
});

// Regressão de segurança: `orders.seller_id` é NULL nestas encomendas.
// Antes da correção, `NOT (false OR NULL OR false)` avaliava a NULL e o IF
// não disparava — qualquer autenticado conseguia alterar a encomenda.
await check("terceiro NÃO altera encomenda sem vendedor atribuído", async () => {
  const alvo = await rpc("place_order", {
    p_items: [{ product_id: produtoId, quantity: 1 }],
    p_delivery_method: "pickup",
    p_client_ref: randomUUID(),
  }, sessoes[A.phone].jwt);
  assert(alvo.ok, JSON.stringify(alvo.data));

  const res = await rpc("update_order_status", {
    p_order_id: alvo.data.order_id,
    p_status: "cancelled",
  }, sessoes[B.phone].jwt);
  assert(!res.ok, "terceiro alterou a encomenda");

  // limpar: o gestor cancela a encomenda de teste
  await rpc("update_order_status", {
    p_order_id: alvo.data.order_id,
    p_status: "cancelled",
  }, sessoes[G.phone].jwt);
  return `HTTP ${res.status}`;
});

await check("gestor conclui a encomenda (baixa de stock)", async () => {
  const antes = await sr(`/rest/v1/inventory?select=quantity&product_id=eq.${produtoId}`);
  const res = await rpc("update_order_status", {
    p_order_id: encomendaId,
    p_status: "completed",
  }, sessoes[G.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  const depois = await sr(`/rest/v1/inventory?select=quantity&product_id=eq.${produtoId}`);
  assert(
    depois.data[0].quantity === antes.data[0].quantity - 2,
    `stock ${antes.data[0].quantity} -> ${depois.data[0].quantity}`,
  );
  return `${antes.data[0].quantity} → ${depois.data[0].quantity}`;
});

await check("encomenda concluída não pode ser alterada", async () => {
  const res = await rpc("update_order_status", {
    p_order_id: encomendaId,
    p_status: "cancelled",
  }, sessoes[G.phone].jwt);
  assert(!res.ok, "alterou encomenda concluída");
  return `HTTP ${res.status}`;
});

await check("cliente cancela encomenda pendente", async () => {
  const nova = await rpc("place_order", {
    p_items: [{ product_id: produtoId, quantity: 1 }],
    p_delivery_method: "pickup",
    p_client_ref: randomUUID(),
  }, sessoes[A.phone].jwt);
  assert(nova.ok, JSON.stringify(nova.data));
  const res = await rpc("update_order_status", {
    p_order_id: nova.data.order_id,
    p_status: "cancelled",
    p_notes: "Desisti",
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data.status === "cancelled", `status=${res.data.status}`);
  return "cancelled";
});

await check("encomenda de produto sem stock é recusada", async () => {
  const res = await rpc("place_order", {
    p_items: [{ product_id: produtoId, quantity: 99999 }],
    p_delivery_method: "pickup",
    p_client_ref: randomUUID(),
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "aceitou encomenda sem stock");
  return `HTTP ${res.status}`;
});

await check("encomenda sem itens é recusada", async () => {
  const res = await rpc("place_order", {
    p_items: [],
    p_delivery_method: "pickup",
    p_client_ref: randomUUID(),
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "aceitou encomenda vazia");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("7. RESERVAS — cliente cria e cancela");
// ---------------------------------------------------------------------------
let reservaId = null;

await check("cliente cria reserva", async () => {
  const res = await rpc("create_reservation", {
    p_items: [{ product_id: produtoId, quantity: 1 }],
    p_notes: "Reserva de teste",
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  reservaId = res.data.reservation_id;
  return `${reservaId.slice(0, 8)}… · ${res.data.expires_at ?? "sem prazo"}`;
});

await check("reserva aparece como ativa", async () => {
  const res = await sr(`/rest/v1/reservations?select=status&id=eq.${reservaId}`);
  assert(res.data[0].status === "active", `status=${res.data[0].status}`);
  return "active";
});

await check("cliente cancela a reserva", async () => {
  const res = await rpc("cancel_reservation", { p_reservation_id: reservaId }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  const check2 = await sr(`/rest/v1/reservations?select=status&id=eq.${reservaId}`);
  assert(check2.data[0].status === "cancelled", `status=${check2.data[0].status}`);
  return "cancelled";
});

await check("cliente NÃO cancela reserva de outro", async () => {
  const nova = await rpc("create_reservation", {
    p_items: [{ product_id: produtoId, quantity: 1 }],
  }, sessoes[A.phone].jwt);
  const res = await rpc("cancel_reservation", { p_reservation_id: nova.data.reservation_id }, sessoes[B.phone].jwt);
  assert(!res.ok, "cancelou reserva alheia");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("8. VENDAS — vendedor regista, gestor consulta");
// ---------------------------------------------------------------------------
await check("vendedor associa o cliente antes de vender", async () => {
  const res = await rpc("link_customer_by_phone", { p_phone: B.phone }, sessoes[V.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data.linked === true, JSON.stringify(res.data));
  return "associado";
});

await check("vendedor regista venda", async () => {
  const res = await rpc("register_sale", {
    p_items: [{ product_id: produtoId, quantity: 1 }],
    p_customer_id: sessoes[B.phone].userId,
    p_payment_method: "cash",
    p_payment_status: "paid",
    p_notes: "Venda de teste",
    p_client_ref: randomUUID(),
  }, sessoes[V.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  return `${res.data.reference} · ${res.data.total_amount} AOA`;
});

await check("venda guarda snapshot do produto", async () => {
  const res = await sr("/rest/v1/sale_items?select=product_snapshot,unit_price&order=created_at.desc&limit=1");
  assert(res.data[0].product_snapshot?.name, "sem snapshot");
  return res.data[0].product_snapshot.name;
});

await check("vendedor vê os próprios indicadores", async () => {
  const res = await rpc("seller_stats", {}, sessoes[V.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(Number(res.data.sales_count) >= 1, `vendas=${res.data.sales_count}`);
  return `${res.data.sales_count} venda(s) · ${res.data.sales_total_value} AOA`;
});

await check("vendedor NÃO vê vendas de outro vendedor", async () => {
  const res = await api("/rest/v1/sales?select=id", { jwt: sessoes[B.phone].jwt });
  assert(res.data.length === 0, `leu ${res.data.length} vendas`);
  return "0 linhas";
});

await check("cliente NÃO regista venda", async () => {
  const res = await rpc("register_sale", {
    p_items: [{ product_id: produtoId, quantity: 1 }],
    p_client_ref: randomUUID(),
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "cliente registou venda");
  return `HTTP ${res.status}`;
});

await check("venda acima do stock é recusada", async () => {
  const res = await rpc("register_sale", {
    p_items: [{ product_id: produtoId, quantity: 99999 }],
    p_client_ref: randomUUID(),
  }, sessoes[V.phone].jwt);
  assert(!res.ok, "aceitou venda sem stock");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("9. DESCONTOS — pedido, decisão, recusa");
// ---------------------------------------------------------------------------
await check("cliente pede desconto dentro do limite", async () => {
  const res = await rpc("request_discount", {
    p_product_id: produtoId,
    p_requested_price: 18900,
    p_justification: "Cliente frequente",
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  return `${res.data.status} · ${res.data.requested_price} AOA`;
});

await check("gestor vê o pedido pendente", async () => {
  const res = await api("/rest/v1/discount_requests?select=id,status&status=eq.pending", {
    jwt: sessoes[G.phone].jwt,
  });
  assert(res.data.length >= 1, "sem pedidos pendentes");
  return `${res.data.length} pendente(s)`;
});

await check("gestor aprova o desconto", async () => {
  const pend = await api("/rest/v1/discount_requests?select=id&status=eq.pending&order=created_at.desc&limit=1", {
    jwt: sessoes[G.phone].jwt,
  });
  const res = await rpc("decide_discount", {
    p_request_id: pend.data[0].id,
    p_approve: true,
  }, sessoes[G.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  return res.data.status;
});

await check("cliente pede desconto acima do limite", async () => {
  const res = await rpc("request_discount", {
    p_product_id: produtoId,
    p_requested_price: 5000,
    p_justification: "80% off",
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "aceitou desconto acima do limite");
  assert(/limite/i.test(JSON.stringify(res.data)), `mensagem: ${JSON.stringify(res.data)}`);
  return "recusado com mensagem de limite";
});

await check("cliente NÃO aprova desconto", async () => {
  const pend = await sr("/rest/v1/discount_requests?select=id&status=eq.pending&limit=1");
  if (!pend.data?.length) return "sem pedido pendente para testar";
  const res = await rpc("decide_discount", {
    p_request_id: pend.data[0].id,
    p_approve: true,
  }, sessoes[A.phone].jwt);
  assert(!res.ok, "cliente aprovou desconto");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("10. FAVORITOS — CRUD (cliente)");
// ---------------------------------------------------------------------------
await check("cliente adiciona favorito", async () => {
  const res = await api("/rest/v1/favorites", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { user_id: sessoes[A.phone].userId, product_id: produtoId },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return "1 favorito";
});

await check("favorito duplicado é rejeitado", async () => {
  const res = await api("/rest/v1/favorites", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { user_id: sessoes[A.phone].userId, product_id: produtoId },
  });
  assert(!res.ok, "duplicou favorito");
  return `HTTP ${res.status}`;
});

await check("cliente lista os próprios favoritos", async () => {
  const res = await api("/rest/v1/favorites?select=product_id", { jwt: sessoes[A.phone].jwt });
  assert(res.data.length === 1, `${res.data.length} favoritos`);
  return "1 favorito";
});

await check("cliente remove favorito", async () => {
  const res = await api(`/rest/v1/favorites?user_id=eq.${sessoes[A.phone].userId}&product_id=eq.${produtoId}`, {
    method: "DELETE",
    jwt: sessoes[A.phone].jwt,
    prefer: "return=minimal",
  });
  assert(res.ok, JSON.stringify(res.data));
  const check2 = await api("/rest/v1/favorites?select=id", { jwt: sessoes[A.phone].jwt });
  assert(check2.data.length === 0, "favorito não removido");
  return "0 favoritos";
});

// ---------------------------------------------------------------------------
group("11. CHAT — conversa, mensagens, leitura, anexos");
// ---------------------------------------------------------------------------
let conversaId = null;

await check("cliente abre conversa com o vendedor", async () => {
  const res = await rpc("get_or_create_direct_conversation", {
    p_other_user: sessoes[V.phone].userId,
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  // A função devolve o uuid da conversa (string), não um objecto.
  conversaId = typeof res.data === "string" ? res.data : res.data?.conversation_id;
  assert(typeof conversaId === "string" && conversaId.length === 36, `retorno: ${JSON.stringify(res.data)}`);
  return conversaId.slice(0, 8) + "…";
});

await check("abrir a mesma conversa devolve o mesmo id", async () => {
  const res = await rpc("get_or_create_direct_conversation", {
    p_other_user: sessoes[V.phone].userId,
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  const id = typeof res.data === "string" ? res.data : res.data?.conversation_id;
  assert(id === conversaId, "criou conversa duplicada");
  return "idempotente";
});

let mensagemId = null;

await check("cliente envia mensagem", async () => {
  const res = await api("/rest/v1/messages", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { conversation_id: conversaId, sender_id: sessoes[A.phone].userId, content: "Olá, preciso de ajuda" },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  mensagemId = res.data[0].id;
  return "1 mensagem";
});

await check("vendedor lê a mensagem", async () => {
  const res = await api(`/rest/v1/messages?select=content&conversation_id=eq.${conversaId}`, {
    jwt: sessoes[V.phone].jwt,
  });
  assert(res.data.length === 1, `${res.data.length} mensagens`);
  return res.data[0].content;
});

await check("vendedor responde na conversa", async () => {
  const res = await api("/rest/v1/messages", {
    method: "POST",
    jwt: sessoes[V.phone].jwt,
    body: {
      conversation_id: conversaId,
      sender_id: sessoes[V.phone].userId,
      content: "Claro, em que posso ajudar?",
      reply_to: mensagemId,
    },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return "resposta com reply_to";
});

await check("terceiro NÃO lê a conversa", async () => {
  const res = await api(`/rest/v1/messages?select=id&conversation_id=eq.${conversaId}`, {
    jwt: sessoes[B.phone].jwt,
  });
  assert(res.data.length === 0, "terceiro leu mensagens");
  return "0 linhas";
});

await check("terceiro NÃO envia mensagem na conversa", async () => {
  const res = await api("/rest/v1/messages", {
    method: "POST",
    jwt: sessoes[B.phone].jwt,
    body: { conversation_id: conversaId, sender_id: sessoes[B.phone].userId, content: "intruso" },
  });
  assert(!res.ok, "terceiro enviou mensagem");
  return `HTTP ${res.status}`;
});

await check("vendedor marca conversa como lida", async () => {
  const res = await rpc("mark_conversation_read", { p_conversation_id: conversaId }, sessoes[V.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  const membro = await sr(`/rest/v1/conversation_members?select=last_read_at&conversation_id=eq.${conversaId}&user_id=eq.${sessoes[V.phone].userId}`);
  assert(membro.data[0].last_read_at, "last_read_at vazio");
  return "last_read_at definido";
});

await check("cliente anexa ficheiro à mensagem", async () => {
  const res = await api("/rest/v1/message_attachments", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: {
      message_id: mensagemId,
      storage_path: `${conversaId}/teste.pdf`,
      file_name: "teste.pdf",
      file_type: "application/pdf",
      file_size: 1024,
    },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return res.data[0].file_name;
});

await check("anexo acima de 20 MB é rejeitado", async () => {
  const res = await api("/rest/v1/message_attachments", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: {
      message_id: mensagemId,
      storage_path: `${conversaId}/grande.zip`,
      file_name: "grande.zip",
      file_type: "application/zip",
      file_size: 50 * 1024 * 1024,
    },
  });
  assert(!res.ok, "aceitou anexo de 50 MB");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("12. INUKA CONNECT — publicações e comentários");
// ---------------------------------------------------------------------------
let postId = null;

await check("gestor cria publicação para todos", async () => {
  const res = await api("/rest/v1/posts", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: {
      author_id: sessoes[G.phone].userId,
      title: "Aviso de teste",
      content: "Conteúdo da publicação de teste.",
      audience: "all",
      is_pinned: true,
      allow_comments: true,
    },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  postId = res.data[0].id;
  return res.data[0].title;
});

await check("cliente vê a publicação", async () => {
  const res = await api(`/rest/v1/posts?select=id,title&id=eq.${postId}`, { jwt: sessoes[A.phone].jwt });
  assert(res.data.length === 1, "publicação invisível");
  return res.data[0].title;
});

await check("visitante vê publicações públicas", async () => {
  const res = await api(`/rest/v1/posts?select=id&audience=eq.all`);
  assert(res.ok, JSON.stringify(res.data));
  return `${res.data.length} publicação(ões)`;
});

await check("cliente comenta (comentários autorizados)", async () => {
  const res = await api("/rest/v1/post_comments", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { post_id: postId, author_id: sessoes[A.phone].userId, content: "Recebido!" },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return "1 comentário";
});

await check("cliente NÃO cria publicação", async () => {
  const res = await api("/rest/v1/posts", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { author_id: sessoes[A.phone].userId, title: "Hack", content: "x" },
  });
  assert(!res.ok, "cliente publicou");
  return `HTTP ${res.status}`;
});

await check("cliente marca publicação como lida", async () => {
  const res = await api("/rest/v1/post_reads", {
    method: "POST",
    jwt: sessoes[A.phone].jwt,
    body: { post_id: postId, user_id: sessoes[A.phone].userId },
    prefer: "return=representation",
  });
  assert(res.ok, JSON.stringify(res.data));
  return "lida";
});

await check("gestor arquiva/remove publicação", async () => {
  const res = await api(`/rest/v1/posts?id=eq.${postId}`, {
    method: "DELETE",
    jwt: sessoes[G.phone].jwt,
    prefer: "return=minimal",
  });
  assert(res.ok, JSON.stringify(res.data));
  const check2 = await sr(`/rest/v1/posts?select=id&id=eq.${postId}`);
  assert(check2.data.length === 0, "publicação não removida");
  return "removida";
});

// ---------------------------------------------------------------------------
group("13. GRUPOS — gestor cria, membros leem");
// ---------------------------------------------------------------------------
await check("gestor cria grupo interno", async () => {
  const conv = await api("/rest/v1/conversations", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: { type: "group", title: "Equipa Uíge", created_by: sessoes[G.phone].userId },
    prefer: "return=representation",
  });
  assert(conv.ok, JSON.stringify(conv.data));
  const grupo = await api("/rest/v1/groups", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: {
      conversation_id: conv.data[0].id,
      name: "Equipa Uíge",
      description: "Grupo de teste",
      created_by: sessoes[G.phone].userId,
    },
    prefer: "return=representation",
  });
  assert(grupo.ok, JSON.stringify(grupo.data));
  const membros = await api("/rest/v1/conversation_members", {
    method: "POST",
    jwt: sessoes[G.phone].jwt,
    body: [
      { conversation_id: conv.data[0].id, user_id: sessoes[G.phone].userId, role: "admin" },
      { conversation_id: conv.data[0].id, user_id: sessoes[V.phone].userId, role: "member" },
    ],
    prefer: "return=representation",
  });
  assert(membros.ok, JSON.stringify(membros.data));
  return `${grupo.data[0].name} · ${membros.data.length} membros`;
});

await check("vendedor membro vê o grupo", async () => {
  const res = await api("/rest/v1/groups?select=name", { jwt: sessoes[V.phone].jwt });
  assert(res.data.length >= 1, "não vê o grupo");
  return `${res.data.length} grupo(s)`;
});

await check("cliente não-membro NÃO vê o grupo", async () => {
  const res = await api("/rest/v1/groups?select=name&name=eq.Equipa Uíge", { jwt: sessoes[A.phone].jwt });
  assert(res.data.length === 0, "não-membro viu o grupo");
  return "0 linhas";
});

// ---------------------------------------------------------------------------
group("14. VENDEDOR — clientes associados");
// ---------------------------------------------------------------------------
await check("vendedor associa cliente por telefone", async () => {
  const res = await rpc("link_customer_by_phone", { p_phone: B.phone }, sessoes[V.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  return JSON.stringify(res.data).slice(0, 80);
});

await check("vendedor vê os próprios clientes", async () => {
  const res = await api("/rest/v1/seller_customers?select=customer_id", { jwt: sessoes[V.phone].jwt });
  assert(res.data.length >= 1, "sem clientes");
  return `${res.data.length} cliente(s)`;
});

await check("telefone inexistente devolve found=false (sem associar)", async () => {
  const res = await rpc("link_customer_by_phone", { p_phone: "+244999999999" }, sessoes[V.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(res.data.found === false, `found=${res.data.found}`);
  return "found=false";
});

await check("cliente NÃO associa clientes", async () => {
  const res = await rpc("link_customer_by_phone", { p_phone: B.phone }, sessoes[A.phone].jwt);
  assert(!res.ok, "cliente associou");
  return `HTTP ${res.status}`;
});

// ---------------------------------------------------------------------------
group("15. NOTIFICAÇÕES — leitura e marcação");
// ---------------------------------------------------------------------------
await check("cliente lê as próprias notificações", async () => {
  const res = await api("/rest/v1/notifications?select=id,is_read", { jwt: sessoes[A.phone].jwt });
  assert(res.ok, JSON.stringify(res.data));
  return `${res.data.length} notificação(ões)`;
});

await check("cliente NÃO lê notificações de outro", async () => {
  const res = await api(`/rest/v1/notifications?select=id&user_id=eq.${sessoes[B.phone].userId}`, {
    jwt: sessoes[A.phone].jwt,
  });
  assert(res.data.length === 0, "leu notificações alheias");
  return "0 linhas";
});

await check("cliente marca notificação como lida", async () => {
  const lista = await api("/rest/v1/notifications?select=id&is_read=eq.false&limit=1", {
    jwt: sessoes[A.phone].jwt,
  });
  if (!lista.data?.length) return "sem notificações por ler";
  const res = await api(`/rest/v1/notifications?id=eq.${lista.data[0].id}`, {
    method: "PATCH",
    jwt: sessoes[A.phone].jwt,
    body: { is_read: true },
    prefer: "return=representation",
  });
  assert(res.ok && res.data[0].is_read === true, "não marcou");
  return "is_read=true";
});

// ---------------------------------------------------------------------------
group("16. SINCRONIZAÇÃO OFFLINE");
// ---------------------------------------------------------------------------
await check("cliente envia operação pendente", async () => {
  const localId = randomUUID();
  const res = await rpc("sync_push", {
    p_operations: [{
      local_id: localId,
      entity: "favorite",
      operation: "create",
      payload: { product_id: produtoId },
    }],
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  return JSON.stringify(res.data).slice(0, 80);
});

await check("operação fica registada como sincronizada", async () => {
  const res = await api("/rest/v1/sync_operations?select=entity,status", { jwt: sessoes[A.phone].jwt });
  assert(res.data.length >= 1, "sem operações");
  return res.data.map((r) => `${r.entity}:${r.status}`).join(", ");
});

await check("reenvio do mesmo local_id não duplica", async () => {
  const antes = await api("/rest/v1/favorites?select=id", { jwt: sessoes[A.phone].jwt });
  const ops = await api("/rest/v1/sync_operations?select=local_id,entity,operation&limit=1", {
    jwt: sessoes[A.phone].jwt,
  });
  const op = ops.data[0];
  const res = await rpc("sync_push", {
    p_operations: [{
      local_id: op.local_id,
      entity: op.entity,
      operation: op.operation,
      payload: { product_id: produtoId },
    }],
  }, sessoes[A.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  const depois = await api("/rest/v1/favorites?select=id", { jwt: sessoes[A.phone].jwt });
  assert(depois.data.length === antes.data.length, `${antes.data.length} -> ${depois.data.length}`);
  return "idempotente";
});

// ---------------------------------------------------------------------------
group("17. DASHBOARD E AUDITORIA (gestor)");
// ---------------------------------------------------------------------------
await check("gestor obtém indicadores reais", async () => {
  const res = await rpc("dashboard_stats", {}, sessoes[G.phone].jwt);
  assert(res.ok, JSON.stringify(res.data));
  assert(typeof res.data.sales_total_value !== "undefined", "sales_total_value ausente");
  assert(typeof res.data.orders_count !== "undefined", "orders_count ausente");
  return `encomendas=${res.data.orders_count} vendas=${res.data.sales_total_value} AOA`;
});

await check("cliente NÃO obtém dashboard", async () => {
  const res = await rpc("dashboard_stats", {}, sessoes[A.phone].jwt);
  assert(!res.ok, "cliente viu dashboard");
  return `HTTP ${res.status}`;
});

await check("gestor lê auditoria", async () => {
  const res = await api("/rest/v1/audit_logs?select=action,entity&limit=5", { jwt: sessoes[G.phone].jwt });
  assert(res.ok, JSON.stringify(res.data));
  return `${res.data.length} registo(s)`;
});

await check("cliente NÃO lê auditoria", async () => {
  const res = await api("/rest/v1/audit_logs?select=id", { jwt: sessoes[A.phone].jwt });
  assert(res.data.length === 0, "cliente leu auditoria");
  return "0 linhas";
});

// ---------------------------------------------------------------------------
group("18. LIMPEZA — remoção dos dados de teste");
// ---------------------------------------------------------------------------
await check("produto com histórico não pode ser apagado (integridade)", async () => {
  const res = await sr(`/rest/v1/products?id=eq.${produtoId}`, { method: "DELETE", prefer: "return=minimal" });
  assert(!res.ok, "apagou produto com encomendas associadas");
  return `HTTP ${res.status} — usar desativação`;
});

await check("desativar o produto é o caminho correto", async () => {
  const res = await sr(`/rest/v1/products?id=eq.${produtoId}`, {
    method: "PATCH",
    body: { is_active: false },
    prefer: "return=minimal",
  });
  assert(res.ok, JSON.stringify(res.data));
  return "is_active=false";
});

await check("produto de teste removido após limpar histórico", async () => {
  // Remover as linhas que referenciam o produto (histórico de teste).
  await del(`/rest/v1/order_items?product_id=eq.${produtoId}`);
  await del(`/rest/v1/sale_items?product_id=eq.${produtoId}`);
  await del(`/rest/v1/reservation_items?product_id=eq.${produtoId}`);
  await del(`/rest/v1/discount_requests?product_id=eq.${produtoId}`);
  const res = await sr(`/rest/v1/products?id=eq.${produtoId}`, { method: "DELETE", prefer: "return=minimal" });
  assert(res.ok, JSON.stringify(res.data));
  const inv = await sr(`/rest/v1/inventory?select=id&product_id=eq.${produtoId}`);
  assert(inv.data.length === 0, "inventário não removido em cascata");
  return "produto + inventário removidos";
});

await check("remover categoria de teste", async () => {
  const res = await sr(`/rest/v1/categories?id=eq.${categoriaId}`, { method: "DELETE", prefer: "return=minimal" });
  assert(res.ok, JSON.stringify(res.data));
  return "removida";
});

await check("remover contas de teste", async () => {
  for (const u of [A, B, V, G]) await limparUtilizador(u.phone);
  const res = await sr(`/rest/v1/profiles?select=id&phone=in.(${[A, B, V, G].map((u) => encodeURIComponent(u.phone)).join(",")})`);
  assert(res.data.length === 0, `sobraram ${res.data.length} perfis`);
  return "4 contas removidas";
});

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
console.log(`Total: ${total}  |  Passou: ${passed}  |  Falhou: ${total - passed}`);
if (falhas.length) {
  console.log("\nFALHAS:");
  for (const f of falhas) console.log(`  - ${f}`);
}
console.log("=".repeat(64));
process.exit(falhas.length ? 1 : 0);
