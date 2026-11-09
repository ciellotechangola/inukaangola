// Limpeza de produtos fictícios — apaga o produto E o histórico dele.
//
//   node scripts/limpar-produtos-ficticios.mjs
//       → só mostra o que seria apagado. Não toca em nada.
//
//   node scripts/limpar-produtos-ficticios.mjs --confirmar
//       → apaga mesmo (produtos [DEMO] e [TESTE]).
//
// Filtros (podem combinar-se):
//   --sku DEMO-PERF-F-001,DEMO-PERF-F-002
//   --id  <uuid>                 (repetível, ou separado por vírgulas)
//   --nome "perfume"             (contém, sem distinguir maiúsculas)
//   --todos                      (TODOS os produtos — usar com muito cuidado)
//   --orfaos                     (só linhas de histórico cujo produto já não
//                                 existe — sobras de eliminações anteriores)
//
// Sem filtro nenhum, o alvo são os produtos de demonstração e de teste:
// nome a começar por [DEMO] ou [TESTE]. É o que se apaga antes de cadastrar o
// catálogo real.
//
// O que faz, por produto:
//   1. conta o que vai sair (encomendas, vendas, reservas, pedidos de desconto);
//   2. apaga as linhas desse produto nessas tabelas;
//   3. apaga as encomendas/vendas/reservas que ficaram SEM linhas;
//   4. recalcula o total das que sobreviveram;
//   5. apaga o produto (stock, fotos, favoritos e carrinho caem em cascata).
//
// Equivale a `eliminar_produto(id, true)` da migração 0014 — mas funciona já,
// sem esperar pelo patch, porque usa a chave de serviço.
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

if (!URL_BASE || !KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em apps/web/.env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const todos = args.includes("--todos");

function valorDe(nome) {
  const i = args.indexOf(`--${nome}`);
  if (i === -1) return null;
  return args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

const skus = (valorDe("sku") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ids = (valorDe("id") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const nome = valorDe("nome");

async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

/** Escolhe os produtos a limpar. */
async function escolherProdutos() {
  const todosProdutos = await rest(
    "products?select=id,name,sku,is_active&order=name&limit=1000"
  );

  if (ids.length || skus.length || nome) {
    return todosProdutos.filter(
      (p) =>
        ids.includes(p.id) ||
        skus.includes(p.sku ?? "") ||
        (nome && (p.name ?? "").toLowerCase().includes(nome.toLowerCase()))
    );
  }

  if (todos) return todosProdutos;

  // Por omissão: só o que é claramente de demonstração/teste.
  return todosProdutos.filter((p) => /^\[(DEMO|TESTE)\]/i.test(p.name ?? ""));
}

/** Quantas linhas e quantos registos inteiros este produto arrasta. */
async function medir(id) {
  const [encomendas, vendas, reservas, descontos] = await Promise.all([
    rest(`order_items?select=order_id&product_id=eq.${id}&limit=1000`),
    rest(`sale_items?select=sale_id&product_id=eq.${id}&limit=1000`),
    rest(`reservation_items?select=reservation_id&product_id=eq.${id}&limit=1000`),
    rest(`discount_requests?select=id&product_id=eq.${id}&limit=1000`),
  ]);

  const idsEncomendas = [...new Set((encomendas ?? []).map((l) => l.order_id))];
  const idsVendas = [...new Set((vendas ?? []).map((l) => l.sale_id))];
  const idsReservas = [...new Set((reservas ?? []).map((l) => l.reservation_id))];

  // Registos que só têm este produto (desaparecem por inteiro).
  async function soDeste(tabelaFilha, colunaPai, lista) {
    let n = 0;
    for (const pai of lista) {
      const outras = await rest(
        `${tabelaFilha}?select=product_id&${colunaPai}=eq.${pai}&product_id=neq.${id}&limit=1`
      );
      if ((outras ?? []).length === 0) n++;
    }
    return n;
  }

  return {
    linhasEncomenda: (encomendas ?? []).length,
    linhasVenda: (vendas ?? []).length,
    linhasReserva: (reservas ?? []).length,
    descontos: (descontos ?? []).length,
    idsEncomendas,
    idsVendas,
    idsReservas,
    encomendasInteiras: await soDeste("order_items", "order_id", idsEncomendas),
    vendasInteiras: await soDeste("sale_items", "sale_id", idsVendas),
    reservasInteiras: await soDeste("reservation_items", "reservation_id", idsReservas),
  };
}

const produtos = await escolherProdutos();

if (produtos.length === 0 && !args.includes("--orfaos")) {
  console.log("Nenhum produto corresponde ao filtro. Nada a fazer.");
  process.exit(0);
}

console.log(
  `\n${confirmar ? "A APAGAR" : "SIMULAÇÃO (nada é apagado)"} — ${produtos.length} produto(s)\n`
);

const resumo = [];

for (const p of produtos) {
  const m = await medir(p.id);

  const etiqueta = `${p.name}${p.sku ? ` · ${p.sku}` : ""}${p.is_active ? "" : " (inactivo)"}`;
  const detalhe = [
    m.linhasEncomenda ? `${m.linhasEncomenda} linha(s) de encomenda` : "",
    m.linhasVenda ? `${m.linhasVenda} linha(s) de venda` : "",
    m.linhasReserva ? `${m.linhasReserva} linha(s) de reserva` : "",
    m.descontos ? `${m.descontos} pedido(s) de desconto` : "",
    m.encomendasInteiras ? `${m.encomendasInteiras} encomenda(s) inteira(s)` : "",
    m.vendasInteiras ? `${m.vendasInteiras} venda(s) inteira(s)` : "",
    m.reservasInteiras ? `${m.reservasInteiras} reserva(s) inteira(s)` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  console.log(`  • ${etiqueta}`);
  console.log(`      ${detalhe || "sem histórico — só o produto"}`);

  resumo.push({ produto: p, medido: m });

  if (!confirmar) continue;

  // 2. linhas do produto
  for (const [tabela, coluna] of [
    ["order_items", "product_id"],
    ["sale_items", "product_id"],
    ["reservation_items", "product_id"],
    ["discount_requests", "product_id"],
  ]) {
    await rest(`${tabela}?${coluna}=eq.${p.id}`, { method: "DELETE", prefer: "return=minimal" });
  }

  // 3. registos que ficaram vazios
  for (const idEncomenda of m.idsEncomendas) {
    const restam = await rest(`order_items?select=id&order_id=eq.${idEncomenda}&limit=1`);
    if ((restam ?? []).length === 0) {
      await rest(`orders?id=eq.${idEncomenda}`, { method: "DELETE", prefer: "return=minimal" });
    } else {
      const linhas = await rest(`order_items?select=total_price&order_id=eq.${idEncomenda}`);
      const total = (linhas ?? []).reduce((s, l) => s + Number(l.total_price), 0);
      await rest(`orders?id=eq.${idEncomenda}`, {
        method: "PATCH",
        body: { total_amount: total },
        prefer: "return=minimal",
      });
    }
  }

  for (const idVenda of m.idsVendas) {
    const restam = await rest(`sale_items?select=id&sale_id=eq.${idVenda}&limit=1`);
    if ((restam ?? []).length === 0) {
      await rest(`sales?id=eq.${idVenda}`, { method: "DELETE", prefer: "return=minimal" });
    } else {
      const linhas = await rest(`sale_items?select=total_price&sale_id=eq.${idVenda}`);
      const total = (linhas ?? []).reduce((s, l) => s + Number(l.total_price), 0);
      await rest(`sales?id=eq.${idVenda}`, {
        method: "PATCH",
        body: { total_amount: total },
        prefer: "return=minimal",
      });
    }
  }

  for (const idReserva of m.idsReservas) {
    const restam = await rest(
      `reservation_items?select=id&reservation_id=eq.${idReserva}&limit=1`
    );
    if ((restam ?? []).length === 0) {
      await rest(`reservations?id=eq.${idReserva}`, { method: "DELETE", prefer: "return=minimal" });
    }
  }

  // 4. o produto (stock, fotos, favoritos, carrinho caem em cascata)
  await rest(`products?id=eq.${p.id}`, { method: "DELETE", prefer: "return=minimal" });
  console.log("      apagado.");
}

// ---------------------------------------------------------------------------
// Sobras: linhas de histórico cujo produto já não existe
//
// Acontece a quem eliminou produtos com o modo normal (0013): as linhas ficam
// com `product_id = NULL` e continuam a somar nos relatórios. Com `--orfaos`
// estas linhas são tratadas como as outras — o nome guardado ([DEMO]/[TESTE])
// decide se são fictícias.
// ---------------------------------------------------------------------------
let orfaosApagados = 0;

if (args.includes("--orfaos")) {
  const ficticio = (nomeLinha) => todos || /^\[(DEMO|TESTE)\]/i.test(nomeLinha ?? "");

  console.log("\nSobras de produtos já eliminados:");

  // --- encomendas
  const oiOrfas = (await rest("order_items?select=id,order_id,product_name&product_id=is.null&limit=1000")) ?? [];
  const oiAlvo = oiOrfas.filter((l) => ficticio(l.product_name));
  console.log(`  • ${oiAlvo.length} linha(s) de encomenda${oiAlvo.length ? ` — ${[...new Set(oiAlvo.map((l) => l.product_name))].join(", ")}` : ""}`);

  // --- vendas (o nome vive no instantâneo)
  const siOrfas =
    (await rest("sale_items?select=id,sale_id,product_snapshot&product_id=is.null&limit=1000")) ?? [];
  const siAlvo = siOrfas.filter((l) => ficticio(l.product_snapshot?.name));
  console.log(`  • ${siAlvo.length} linha(s) de venda${siAlvo.length ? ` — ${[...new Set(siAlvo.map((l) => l.product_snapshot?.name))].join(", ")}` : ""}`);

  // --- reservas (não têm nome guardado: só contam se --todos)
  const riOrfas = (await rest("reservation_items?select=id,reservation_id&product_id=is.null&limit=1000")) ?? [];
  const riAlvo = todos ? riOrfas : [];
  console.log(`  • ${riAlvo.length} linha(s) de reserva${todos ? "" : " (use --todos para incluir)"}`);

  if (confirmar) {
    const pais = { encomendas: new Set(), vendas: new Set(), reservas: new Set() };

    for (const l of oiAlvo) {
      pais.encomendas.add(l.order_id);
      await rest(`order_items?id=eq.${l.id}`, { method: "DELETE", prefer: "return=minimal" });
      orfaosApagados++;
    }
    for (const l of siAlvo) {
      pais.vendas.add(l.sale_id);
      await rest(`sale_items?id=eq.${l.id}`, { method: "DELETE", prefer: "return=minimal" });
      orfaosApagados++;
    }
    for (const l of riAlvo) {
      pais.reservas.add(l.reservation_id);
      await rest(`reservation_items?id=eq.${l.id}`, { method: "DELETE", prefer: "return=minimal" });
      orfaosApagados++;
    }

    // Registos que ficaram sem linhas, e totais recalculados nos que sobram.
    for (const [tabela, filha, coluna, pai] of [
      ["orders", "order_items", "order_id", "encomendas"],
      ["sales", "sale_items", "sale_id", "vendas"],
    ]) {
      for (const id of pais[pai]) {
        const linhas = await rest(`${filha}?select=total_price&${coluna}=eq.${id}`);
        if ((linhas ?? []).length === 0) {
          await rest(`${tabela}?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
        } else {
          const total = linhas.reduce((s, l) => s + Number(l.total_price), 0);
          await rest(`${tabela}?id=eq.${id}`, {
            method: "PATCH",
            body: { total_amount: total },
            prefer: "return=minimal",
          });
        }
      }
    }

    for (const id of pais.reservas) {
      const restam = await rest(`reservation_items?select=id&reservation_id=eq.${id}&limit=1`);
      if ((restam ?? []).length === 0) {
        await rest(`reservations?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
      }
    }

    console.log(`  → ${orfaosApagados} linha(s) apagada(s).`);
  }
}

const totalLinhas = resumo.reduce(
  (s, r) => s + r.medido.linhasEncomenda + r.medido.linhasVenda + r.medido.linhasReserva,
  0
);

console.log(
  confirmar
    ? `\nConcluído: ${produtos.length} produto(s), ${totalLinhas} linha(s) de histórico` +
        `${orfaosApagados ? ` e ${orfaosApagados} sobra(s)` : ""} apagados.`
    : `\nSimulação: ${produtos.length} produto(s) e ${totalLinhas} linha(s) de histórico.\n` +
      "Para apagar mesmo, repita com --confirmar.\n"
);
