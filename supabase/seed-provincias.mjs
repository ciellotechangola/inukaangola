#!/usr/bin/env node
// =============================================================================
// INUKA ANGOLA — SEMENTE DA GESTÃO MULTIPROVINCIAL
// =============================================================================
// Torna a gestão multiprovincial visível com as contas de demonstração:
//
//   1. Atribui província às contas reais (a sede é Luanda, a delegação de
//      demonstração é o Uíge).
//   2. Cria stock em duas províncias para os mesmos produtos — é isso que
//      prova que as quantidades são controladas separadamente.
//   3. Regista os movimentos de entrada correspondentes.
//   4. Cria vendas no Uíge, para a comparação nacional ter números.
//   5. Liga o cliente ao colaborador (`seller_customers`).
//
// É idempotente: correr duas vezes não duplica nada.
//
//   node supabase/seed-provincias.mjs
//   node supabase/seed-provincias.mjs --limpar   # repõe tudo em "sem província"
//
// Requer `SUPABASE_SERVICE_ROLE_KEY` em `apps/web/.env.local` (é o que os
// restantes scripts do projeto usam). Nada aqui passa pelo cliente web.
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- credenciais -------------------------------------------------------------
function lerEnv() {
  const env = {};
  for (const linha of readFileSync(join(RAIZ, "apps/web/.env.local"), "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = lerEnv();
const URL_SB = env.NEXT_PUBLIC_SUPABASE_URL;
const CHAVE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_SB || !CHAVE) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em apps/web/.env.local");
  process.exit(1);
}

const CABECALHOS = {
  apikey: CHAVE,
  Authorization: `Bearer ${CHAVE}`,
  "Content-Type": "application/json",
};

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`${URL_SB}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: { ...CABECALHOS, ...(opcoes.headers ?? {}) },
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`${opcoes.method ?? "GET"} ${caminho} → ${resposta.status} ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

const get = (caminho) => api(caminho);
const post = (tabela, corpo) =>
  api(tabela, { method: "POST", body: JSON.stringify(corpo), headers: { Prefer: "return=representation" } });
const patch = (caminho, corpo) =>
  api(caminho, { method: "PATCH", body: JSON.stringify(corpo), headers: { Prefer: "return=representation" } });

// --- 1. províncias -----------------------------------------------------------
const provincias = await get("provincias?select=id,codigo,nome,is_default");
if (!provincias.length) {
  console.error("A tabela `provincias` está vazia. Cole primeiro `supabase/PATCH_PROVINCIAS.sql`.");
  process.exit(1);
}

const porCodigo = Object.fromEntries(provincias.map((p) => [p.codigo, p]));
const SEDE = provincias.find((p) => p.is_default) ?? porCodigo.LDA;
const DEMO = porCodigo.UIG ?? provincias.find((p) => p.codigo !== SEDE.codigo);

if (!SEDE || !DEMO) {
  console.error("Não encontrei a província-sede nem a província de demonstração.");
  process.exit(1);
}

// --- 2. perfis ---------------------------------------------------------------
const perfis = await get("profiles?select=id,full_name,role,phone,provincia_id,is_national_admin");
const porTelefone = Object.fromEntries(perfis.map((p) => [p.phone, p]));

// Contas de demonstração do README. Se alguma não existir, é ignorada com aviso.
const ATRIBUICOES = [
  { telefone: "+244923111444", provincia: DEMO, nacional: false, nota: "colaborador do Uíge" },
  { telefone: "+244923111222", provincia: DEMO, nacional: false, nota: "cliente do Uíge" },
  { telefone: "+244923456789", provincia: SEDE, nacional: false, nota: "cliente de Luanda" },
  { telefone: "+244923111333", provincia: SEDE, nacional: true, nota: "gestor de Luanda (vê tudo)" },
  { telefone: "+244900000001", provincia: null, nacional: true, nota: "administração nacional" },
];

const limpar = process.argv.includes("--limpar");

console.log(`\nSede: ${SEDE.nome} · Delegação de demonstração: ${DEMO.nome}\n`);

for (const a of ATRIBUICOES) {
  const perfil = porTelefone[a.telefone];
  if (!perfil) {
    console.log(`· ${a.telefone} — conta inexistente, ignorada`);
    continue;
  }

  const provincia_id = limpar ? null : a.provincia?.id ?? null;
  const is_national_admin = limpar ? perfil.role === "manager" : a.nacional;

  if (perfil.provincia_id === provincia_id && perfil.is_national_admin === is_national_admin) {
    console.log(`· ${perfil.full_name} (${perfil.role}) — já estava em ${a.provincia?.nome ?? "nacional"}`);
    continue;
  }

  await patch(`profiles?id=eq.${perfil.id}`, { provincia_id, is_national_admin });
  console.log(`· ${perfil.full_name} (${perfil.role}) → ${a.provincia?.nome ?? "nacional"}  [${a.nota}]`);
}

if (limpar) {
  console.log("\nProvíncias repostas em “sem província”. Nada mais foi alterado.\n");
  process.exit(0);
}

// --- 2b. prefixo da referência -------------------------------------------------
// A referência é `INK-<código da província>-<número>`. Quem foi atribuído depois
// da migração ficou com `INK-NAC-...` (a referência nasceu sem província). O
// trigger `fill_referencia` trata disto em SQL; aqui repetimos a regra para o
// caso de a base ainda não ter o patch mais recente.
const perfisAtuais = await get("profiles?select=id,full_name,referencia,provincia_id");
const codigoPorId = Object.fromEntries(provincias.map((p) => [p.id, p.codigo]));

for (const p of perfisAtuais) {
  if (!p.referencia) continue;
  const esperado = `INK-${codigoPorId[p.provincia_id] ?? "NAC"}-`;
  if (p.referencia.startsWith(esperado)) continue;
  const corrigida = p.referencia.replace(/^INK-[A-Z]{3}-/, esperado);
  await patch(`profiles?id=eq.${p.id}`, { referencia: corrigida });
  console.log(`· referência de ${p.full_name}: ${p.referencia} → ${corrigida}`);
}

// O colaborador tem ficha própria: a província tem de estar lá também.
const colaborador = porTelefone["+244923111444"];
if (colaborador) {
  const fichas = await get(`seller_profiles?select=id,region,provincia_id&id=eq.${colaborador.id}`);
  if (!fichas.length) {
    await post("seller_profiles", {
      id: colaborador.id,
      region: DEMO.nome,
      provincia_id: DEMO.id,
    });
    console.log(`· ficha de colaborador criada (${DEMO.nome})`);
  } else if (fichas[0].provincia_id !== DEMO.id) {
    await patch(`seller_profiles?id=eq.${colaborador.id}`, {
      provincia_id: DEMO.id,
      region: fichas[0].region ?? DEMO.nome,
    });
    console.log(`· ficha de colaborador → ${DEMO.nome}`);
  }
}

// --- 3. vínculo cliente ↔ colaborador ---------------------------------------
const cliente = porTelefone["+244923111222"];
if (cliente && colaborador) {
  const vinculos = await get(
    `seller_customers?select=id,is_active&seller_id=eq.${colaborador.id}&customer_id=eq.${cliente.id}`
  );
  if (!vinculos.length) {
    await post("seller_customers", {
      seller_id: colaborador.id,
      customer_id: cliente.id,
      is_active: true,
    });
    console.log(`· ${cliente.full_name} ligado a ${colaborador.full_name}`);
  } else if (!vinculos[0].is_active) {
    await patch(`seller_customers?id=eq.${vinculos[0].id}`, { is_active: true });
    console.log(`· vínculo reactivado`);
  }
}

// --- 4. stock por província --------------------------------------------------
const produtos = await get("products?select=id,name,official_price,promotional_price&order=name");
const inventario = await get("inventory?select=id,product_id,provincia_id,quantity,low_stock_threshold");

// Quantidades distintas por província — de propósito, para se ver que são
// contas separadas. Inclui um produto a zero no Uíge (alerta de stock baixo).
const QTD_UIGE = [12, 7, 3, 0, 25, 9, 4, 18, 6, 2];

let movimentos = 0;

for (const [i, produto] of produtos.entries()) {
  const linhaSede = inventario.find((r) => r.product_id === produto.id && r.provincia_id === null);

  // A linha antiga (sem província) passa a ser a linha da sede, sem perder
  // a quantidade que já tinha. Só se ainda não houver uma linha de Luanda.
  if (linhaSede && !inventario.some((r) => r.product_id === produto.id && r.provincia_id === SEDE.id)) {
    await patch(`inventory?id=eq.${linhaSede.id}`, { provincia_id: SEDE.id });
    await post("inventory_movements", {
      product_id: produto.id,
      provincia_id: SEDE.id,
      type: "correction",
      quantity: linhaSede.quantity,
      previous_quantity: linhaSede.quantity,
      new_quantity: linhaSede.quantity,
      reference: "SEMENTE-PROVINCIAS",
      notes: `Armazém-sede atribuído a ${SEDE.nome}`,
    });
    movimentos += 1;
    console.log(`· ${produto.name} — armazém-sede → ${SEDE.nome} (${linhaSede.quantity} un.)`);
  }

  const linhaUige = inventario.find((r) => r.product_id === produto.id && r.provincia_id === DEMO.id);
  if (!linhaUige) {
    const quantidade = QTD_UIGE[i % QTD_UIGE.length];
    await post("inventory", {
      product_id: produto.id,
      provincia_id: DEMO.id,
      quantity: quantidade,
      low_stock_threshold: 5,
      warehouse_location: `Delegação de ${DEMO.nome}`,
    });
    await post("inventory_movements", {
      product_id: produto.id,
      provincia_id: DEMO.id,
      type: "in",
      quantity: quantidade,
      previous_quantity: 0,
      new_quantity: quantidade,
      reference: "SEMENTE-PROVINCIAS",
      notes: `Entrada inicial na delegação de ${DEMO.nome}`,
      created_by: colaborador?.id ?? null,
    });
    movimentos += 1;
    console.log(`· ${produto.name} — ${quantidade} un. em ${DEMO.nome}`);
  }
}

if (movimentos === 0) console.log("· stock por província já estava semeado");

// --- 5. vendas no Uíge -------------------------------------------------------
if (colaborador && produtos.length) {
  const existentes = await get(`sales?select=reference&reference=like.VND-${DEMO.codigo}-*`);

  if (!existentes.length) {
    const preco = (p) => Number(p.promotional_price ?? p.official_price ?? 0);
    const PLANO = [
      { ref: `VND-${DEMO.codigo}-0001`, itens: [[0, 2], [1, 1]] },
      { ref: `VND-${DEMO.codigo}-0002`, itens: [[2, 1]] },
      { ref: `VND-${DEMO.codigo}-0003`, itens: [[4, 3], [5, 2]] },
    ];

    for (const [n, venda] of PLANO.entries()) {
      const itens = venda.itens
        .filter(([idx]) => produtos[idx])
        .map(([idx, qtd]) => ({
          produto: produtos[idx],
          quantidade: qtd,
          preco: preco(produtos[idx]),
        }));
      const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);

      const [criada] = await post("sales", {
        reference: venda.ref,
        seller_id: colaborador.id,
        customer_id: cliente?.id ?? null,
        provincia_id: DEMO.id,
        total_amount: total,
        payment_status: n === 2 ? "pending" : "paid",
        payment_method: n === 0 ? "dinheiro" : "transferencia",
        created_at: new Date(Date.now() - (n + 1) * 86400000).toISOString(),
      });

      await post(
        "sale_items",
        itens.map((i) => ({
          sale_id: criada.id,
          product_id: i.produto.id,
          quantity: i.quantidade,
          unit_price: i.preco,
          total_price: i.preco * i.quantidade,
          product_snapshot: { name: i.produto.name, sku: null },
        }))
      );

      console.log(`· venda ${venda.ref} — ${total.toFixed(2)} AOA`);
    }
  } else {
    console.log(`· vendas de ${DEMO.nome} já existiam (${existentes.length})`);
  }
}

// --- 6. taxa de comissão e comissões pendentes -------------------------------
// A taxa nasce a 0%, que não é uma decisão de negócio: é configuração em falta.
// Por isso, na primeira vez que se define, as comissões ainda por pagar são
// recalculadas. As já pagas e as anuladas nunca são tocadas.
if (colaborador) {
  const [ficha] = await get(`seller_profiles?select=commission_rate&id=eq.${colaborador.id}`);

  if (ficha && Number(ficha.commission_rate) === 0) {
    const TAXA = 0.05;
    await patch(`seller_profiles?id=eq.${colaborador.id}`, { commission_rate: TAXA });
    console.log(`· taxa de comissão de ${colaborador.full_name} definida em ${TAXA * 100}%`);

    try {
      const pendentes = await get(
        `sale_commissions?select=id,base_amount&seller_id=eq.${colaborador.id}&status=eq.pending`
      );
      for (const c of pendentes) {
        await patch(`sale_commissions?id=eq.${c.id}`, {
          rate: TAXA,
          amount: Math.round(Number(c.base_amount) * TAXA * 100) / 100,
        });
      }
      if (pendentes.length) {
        console.log(`· ${pendentes.length} comissões pendentes recalculadas a ${TAXA * 100}%`);
      }
    } catch {
      // A tabela ainda não existe: falta colar o PATCH_COLABORADORES.sql.
      console.log("· comissões por recalcular — falta aplicar PATCH_COLABORADORES.sql");
    }
  }
}

console.log("\nPronto. Entre com uma conta de cada província para ver o isolamento.\n");
