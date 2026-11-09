/**
 * Seed do catálogo INUKA Angola.
 *
 * Uso:
 *   node supabase/seed.mjs            # categorias + produtos DEMO
 *   node supabase/seed.mjs --cats     # apenas categorias
 *   node supabase/seed.mjs --limpar   # remove os produtos [DEMO]
 *
 * Lê as credenciais de apps/web/.env.local (SUPABASE_SERVICE_ROLE_KEY).
 * Idempotente: pode correr várias vezes sem duplicar registos.
 *
 * IMPORTANTE — produtos DEMO:
 * Os produtos criados aqui têm o prefixo "[DEMO]" no nome e "DEMO-" no SKU
 * porque os preços oficiais da INUKA NÃO são conhecidos. São placeholders
 * para validar o sistema, não catálogo real. Antes de publicar:
 *   node supabase/seed.mjs --limpar
 * e registe os produtos verdadeiros em /gerente/produtos.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const path = resolve(ROOT, "apps/web/.env.local");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em apps/web/.env.local");
  process.exit(1);
}

async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Categorias — nomes vindos da especificação do projecto
// ---------------------------------------------------------------------------
const CATEGORIAS = [
  ["Perfumaria Feminina", "perfumaria-feminina", "Fragrâncias femininas INUKA", 1],
  ["Perfumaria Masculina", "perfumaria-masculina", "Fragrâncias masculinas INUKA", 2],
  ["Exclusive", "exclusive", "Colecção Exclusive", 3],
  ["Signature", "signature", "Colecção Signature", 4],
  ["Modern Me", "modern-me", "Colecção Modern Me", 5],
  ["Cuidado da Pele", "cuidado-da-pele", "Skin care", 6],
  ["Cuidado do Corpo", "cuidado-do-corpo", "Body care", 7],
  ["Cosméticos", "cosmeticos", "Maquilhagem e cosméticos", 8],
  ["Cabelo", "cabelo", "Tratamento capilar", 9],
  ["Higiene", "higiene", "Higiene pessoal", 10],
  ["Casa e Carro", "casa-e-carro", "Perfumes para casa e automóvel", 11],
];

// ---------------------------------------------------------------------------
// Produtos DEMO — placeholders, NÃO são catálogo oficial
// ---------------------------------------------------------------------------
const PRODUTOS = [
  {
    sku: "DEMO-PERF-F-001",
    name: "[DEMO] Perfume Feminino Floral",
    category: "perfumaria-feminina",
    description:
      "Produto de demonstração. Substituir por um produto real do catálogo INUKA.",
    official_price: 25000,
    promotional_price: 21900,
    is_featured: true,
    is_bestseller: true,
    stock: 25,
  },
  {
    sku: "DEMO-PERF-F-002",
    name: "[DEMO] Perfume Feminino Doce",
    category: "perfumaria-feminina",
    description: "Produto de demonstração.",
    official_price: 32000,
    promotional_price: null,
    is_new: true,
    stock: 12,
  },
  {
    sku: "DEMO-PERF-M-001",
    name: "[DEMO] Perfume Masculino Amadeirado",
    category: "perfumaria-masculina",
    description: "Produto de demonstração.",
    official_price: 28000,
    promotional_price: null,
    is_bestseller: true,
    stock: 18,
  },
  {
    sku: "DEMO-BODY-001",
    name: "[DEMO] Loção Corporal Hidratante",
    category: "cuidado-do-corpo",
    description: "Produto de demonstração.",
    official_price: 9500,
    promotional_price: 7900,
    is_featured: true,
    stock: 40,
  },
  {
    sku: "DEMO-SKIN-001",
    name: "[DEMO] Creme Facial Noturno",
    category: "cuidado-da-pele",
    description: "Produto de demonstração.",
    official_price: 14500,
    promotional_price: null,
    stock: 3, // abaixo do limite → aparece em "stock baixo"
  },
  {
    sku: "DEMO-HAIR-001",
    name: "[DEMO] Champô Nutritivo",
    category: "cabelo",
    description: "Produto de demonstração.",
    official_price: 7500,
    promotional_price: null,
    stock: 30,
  },
];

// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));

async function limparDemo() {
  const demo = await rest("products?select=id&sku=like.DEMO-*");
  if (!demo?.length) {
    console.log("Nenhum produto DEMO para remover.");
    return;
  }
  const ids = demo.map((p) => p.id);
  await rest(`products?id=in.(${ids.join(",")})`, { method: "DELETE" });
  console.log(`Removidos ${ids.length} produtos DEMO (inventário em cascata).`);
}

async function seedCategorias() {
  const rows = CATEGORIAS.map(([name, slug, description, sort_order]) => ({
    name,
    slug,
    description,
    sort_order,
    is_active: true,
  }));

  await rest("categories?on_conflict=slug", {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });

  const all = await rest("categories?select=id,slug");
  console.log(`Categorias: ${all.length} na base (${rows.length} garantidas).`);
  return new Map(all.map((c) => [c.slug, c.id]));
}

async function seedProdutos(catMap) {
  const existentes = await rest("products?select=sku&sku=like.DEMO-*");
  const jaExiste = new Set((existentes ?? []).map((p) => p.sku));

  const novos = PRODUTOS.filter((p) => !jaExiste.has(p.sku)).map((p) => ({
    sku: p.sku,
    name: p.name,
    category_id: catMap.get(p.category) ?? null,
    description: p.description,
    official_price: p.official_price,
    promotional_price: p.promotional_price ?? null,
    is_active: true,
    is_featured: p.is_featured ?? false,
    is_bestseller: p.is_bestseller ?? false,
    is_new: p.is_new ?? false,
  }));

  if (novos.length) {
    await rest("products", {
      method: "POST",
      body: novos,
      prefer: "return=minimal",
    });
  }

  // Os DEMO que já existiam podem ter ficado desactivados (um teste de
  // eliminação desactiva em vez de apagar, por causa das encomendas antigas).
  // O seed garante o estado de demonstração: cinco produtos activos, um por
  // categoria, para o catálogo e o filtro por categoria continuarem a ter
  // matéria. Só toca em `sku like DEMO-*`.
  if (jaExiste.size) {
    await rest("products?sku=like.DEMO-*&is_active=eq.false", {
      method: "PATCH",
      body: { is_active: true },
      prefer: "return=minimal",
    });
  }

  // Inventário para todos os produtos DEMO
  const todos = await rest("products?select=id,sku&sku=like.DEMO-*");
  const inventario = PRODUTOS.map((p) => {
    const row = todos.find((t) => t.sku === p.sku);
    return row
      ? {
          product_id: row.id,
          provincia_id: null,
          quantity: p.stock,
          reserved_quantity: 0,
          low_stock_threshold: 5,
        }
      : null;
  }).filter(Boolean);

  // A 0005 deu ao inventário uma linha por província e o índice único passou a
  // ser (product_id, provincia_id) — o `on_conflict=product_id` deixou de
  // existir e o seed falhava com 42P10. Como `provincia_id` NULL (sede) não é
  // comparável num ON CONFLICT, lê-se primeiro e escreve-se a seguir: PATCH na
  // linha da sede se já existir, INSERT se ainda não houver.
  for (const item of inventario) {
    const existentes = await rest(
      `inventory?select=id&product_id=eq.${item.product_id}&provincia_id=is.null&limit=1`,
    );

    if (existentes?.length) {
      await rest(`inventory?id=eq.${existentes[0].id}`, {
        method: "PATCH",
        body: {
          quantity: item.quantity,
          reserved_quantity: 0,
          low_stock_threshold: item.low_stock_threshold,
        },
        prefer: "return=minimal",
      });
    } else {
      await rest("inventory", { method: "POST", body: item, prefer: "return=minimal" });
    }
  }

  console.log(
    `Produtos DEMO: ${novos.length} criados, ${jaExiste.size} já existiam. Inventário: ${inventario.length}.`,
  );
}

// ---------------------------------------------------------------------------

try {
  if (args.has("--limpar")) {
    await limparDemo();
  } else {
    const catMap = await seedCategorias();
    if (!args.has("--cats")) {
      await seedProdutos(catMap);
    }
  }
  console.log("\nConcluído.");
} catch (err) {
  console.error("\nERRO:", err.message);
  process.exit(1);
}
