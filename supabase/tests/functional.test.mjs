import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const db = new PGlite();

const results = [];
let failures = 0;

function check(name, condition, detail = "") {
  const ok = !!condition;
  if (!ok) failures++;
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

async function exec(sql) {
  await db.exec(sql);
}

async function q(sql) {
  const r = await db.query(sql);
  return r.rows;
}

async function expectError(name, sql, codeOrText) {
  try {
    await db.exec(sql);
    check(name, false, "não gerou erro");
  } catch (e) {
    const msg = e.message || "";
    const ok = codeOrText ? msg.includes(codeOrText) || (e.code || "") === codeOrText : true;
    check(name, ok, msg.slice(0, 120));
  }
}

async function asUser(userId, fn) {
  await exec(`SET ROLE authenticated;`);
  await q(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await exec(`RESET ROLE;`);
    await q(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

// ---------------------------------------------------------------- setup
for (const rel of [
  "tests/00_stub_supabase.sql",
  "migrations/0001_schema.sql",
  "migrations/0002_rls.sql",
  "migrations/0003_rpc.sql",
  "migrations/0004_designer.sql",
  "migrations/0005_provincias.sql",
  "migrations/0006_colaboradores.sql",
  "migrations/0007_conteudos.sql",
  "migrations/0008_taxas_pedidos.sql",
  "migrations/0009_reservas_clientes.sql",
  "migrations/0010_taxa_entrega.sql",
  "migrations/0011_chat_equipa.sql",
  "migrations/0012_stock_publico.sql",
  "migrations/0013_perfis_loja.sql",
  "migrations/0014_eliminar_forcado.sql",
  "migrations/0015_promocoes_levantamentos.sql",
  "migrations/0016_eliminar_colaborador.sql",
  "migrations/0017_cliente_da_venda_na_carteira.sql",
  "migrations/0018_tarefas_e_gestor.sql",
]) {
  const sql = fs
    .readFileSync(path.join(root, rel), "utf8")
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g, "");
  await exec(sql);
}

// Emular os GRANTs que o Supabase aplica por omissão
await exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
`);

console.log("\n--- 1. REGISTO DE UTILIZADORES (trigger handle_new_user) ---");

const C1 = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";
const SELLER = "33333333-3333-3333-3333-333333333333";
const MANAGER = "44444444-4444-4444-4444-444444444444";

await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('${C1}', 'c1@inuka.ao', '{"full_name":"Cliente Um","phone":"923000001"}'),
    ('${C2}', 'c2@inuka.ao', '{"full_name":"Cliente Dois","phone":"923000002"}'),
    ('${SELLER}', 's1@inuka.ao', '{"full_name":"Vendedor Um","phone":"923000003"}'),
    ('${MANAGER}', 'm1@inuka.ao', '{"full_name":"Gestor","phone":"923000004"}');
`);

const profs = await q(`SELECT id, role, phone, full_name FROM public.profiles ORDER BY phone`);
check("4 perfis criados automaticamente", profs.length === 4, `${profs.length}`);
check("telefone normalizado para +244", profs[0].phone === "+244923000001", profs[0].phone);
check("papel inicial é customer", profs.every((p) => p.role === "customer"));

// Tentativa de escalada via metadados do registo
await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('55555555-5555-5555-5555-555555555555', 'hack@inuka.ao',
     '{"full_name":"Atacante","phone":"923000005","role":"manager"}');
`);
const hack = await q(`SELECT role FROM public.profiles WHERE phone='+244923000005'`);
check("role nos metadados é ignorado", hack[0].role === "customer", hack[0].role);

console.log("\n--- 2. PROMOÇÃO DE PAPÉIS ---");
await q(`SELECT public.promote_to_manager('+244923000004')`);
await q(`SELECT public.promote_to_seller('+244923000003', 'Luanda')`);
const roles = await q(`SELECT phone, role FROM public.profiles WHERE phone IN ('+244923000003','+244923000004') ORDER BY phone`);
check("vendedor promovido", roles[0].role === "seller", roles[0].role);
check("gestor promovido", roles[1].role === "manager", roles[1].role);

const sellerProfile = await q(`SELECT count(*)::int n FROM public.seller_profiles WHERE id='${SELLER}'`);
check("seller_profiles criado", sellerProfile[0].n === 1);

console.log("\n--- 3. CATÁLOGO ---");
const cat = await q(`
  INSERT INTO public.categories (name, slug) VALUES ('Perfumaria Feminina','perfumaria-feminina')
  RETURNING id
`);
const catId = cat[0].id;

const prod = await q(`
  INSERT INTO public.products (sku, name, category_id, official_price, promotional_price, description)
  VALUES ('INK-001','Essence Gold', '${catId}', 45000, 39900, 'Fragrância premium')
  RETURNING id
`);
const prodId = prod[0].id;

await q(`INSERT INTO public.inventory (product_id, quantity, low_stock_threshold) VALUES ('${prodId}', 10, 3)`);
const stock0 = await q(`SELECT quantity, reserved_quantity FROM public.inventory WHERE product_id='${prodId}'`);
check("stock inicial 10", stock0[0].quantity === 10 && stock0[0].reserved_quantity === 0);

const anonSees = await q(`SELECT count(*)::int n FROM public.products WHERE is_active = true`);
check("produto visível publicamente", anonSees[0].n === 1);

console.log("\n--- 4. ENCOMENDA (cliente) ---");
const order1 = await asUser(C1, async () => {
  const r = await q(`SELECT public.place_order(
    '[{"product_id":"${prodId}","quantity":2}]'::jsonb,
    'pickup', NULL, '+244923000001', 'Teste', 'cli-ref-001') AS res`);
  return r[0].res;
});
check("encomenda criada", order1.order_id && order1.reference?.startsWith("ENC-"), JSON.stringify(order1));
check("total calculado no servidor (2 x 39900)", Number(order1.total) === 79800, String(order1.total));

const stockAfter = await q(`SELECT quantity, reserved_quantity FROM public.inventory WHERE product_id='${prodId}'`);
check("stock reservado 2 (quantidade intacta)", stockAfter[0].quantity === 10 && stockAfter[0].reserved_quantity === 2,
  JSON.stringify(stockAfter[0]));

// Idempotência
const order1b = await asUser(C1, async () => {
  const r = await q(`SELECT public.place_order(
    '[{"product_id":"${prodId}","quantity":2}]'::jsonb,
    'pickup', NULL, NULL, NULL, 'cli-ref-001') AS res`);
  return r[0].res;
});
check("reenvio devolve a mesma encomenda", order1b.order_id === order1.order_id && order1b.duplicated === true);
const stockAfter2 = await q(`SELECT reserved_quantity FROM public.inventory WHERE product_id='${prodId}'`);
check("não duplicou a reserva de stock", stockAfter2[0].reserved_quantity === 2, String(stockAfter2[0].reserved_quantity));

// Stock insuficiente
await expectError("stock insuficiente é rejeitado", `
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', '${C1}', false);
  SELECT public.place_order('[{"product_id":"${prodId}","quantity":99}]'::jsonb, 'pickup', NULL, NULL, NULL, 'cli-ref-002');
`, "Stock insuficiente");
await exec(`RESET ROLE;`);

console.log("\n--- 5. ISOLAMENTO RLS ---");
const c2orders = await asUser(C2, async () => q(`SELECT count(*)::int n FROM public.orders`));
check("cliente 2 não vê encomendas do cliente 1", c2orders[0].n === 0, String(c2orders[0].n));

const c1orders = await asUser(C1, async () => q(`SELECT count(*)::int n FROM public.orders`));
check("cliente 1 vê a sua encomenda", c1orders[0].n === 1, String(c1orders[0].n));

await expectError("cliente não acede a dashboard_stats", `
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', '${C1}', false);
  SELECT public.dashboard_stats();
`, "42501");
await exec(`RESET ROLE;`);

await expectError("cliente não se promove a gestor", `
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', '${C1}', false);
  UPDATE public.profiles SET role = 'manager' WHERE id = '${C1}';
`, "42501");
await exec(`RESET ROLE;`);

const selfEdit = await asUser(C1, async () => {
  await q(`UPDATE public.profiles SET full_name = 'Cliente Um Editado' WHERE id = '${C1}'`);
  const r = await q(`SELECT full_name FROM public.profiles WHERE id = '${C1}'`);
  return r[0].full_name;
});
check("cliente edita o próprio nome", selfEdit === "Cliente Um Editado", selfEdit);

console.log("\n--- 6. VENDAS ---");
const link = await asUser(SELLER, async () => {
  const r = await q(`SELECT public.link_customer_by_phone('923000001') AS res`);
  return r[0].res;
});
check("vendedor associa cliente por telefone", link.linked === true, JSON.stringify(link));

const sale1 = await asUser(SELLER, async () => {
  const r = await q(`SELECT public.register_sale(
    '[{"product_id":"${prodId}","quantity":3}]'::jsonb,
    '${C1}', 'cash', 'paid', 'Venda balcão', 'sale-ref-001') AS res`);
  return r[0].res;
});
check("venda registada", sale1.sale_id && sale1.reference?.startsWith("VND-"), JSON.stringify(sale1));
check("total da venda 3 x 39900", Number(sale1.total) === 119700, String(sale1.total));

const sale1b = await asUser(SELLER, async () => {
  const r = await q(`SELECT public.register_sale(
    '[{"product_id":"${prodId}","quantity":3}]'::jsonb,
    '${C1}', 'cash', 'paid', NULL, 'sale-ref-001') AS res`);
  return r[0].res;
});
check("venda idempotente (mesma referência)", sale1b.sale_id === sale1.sale_id && sale1b.duplicated === true);

const stockAfterSale = await q(`SELECT quantity FROM public.inventory WHERE product_id='${prodId}'`);
check("stock reduzido para 7", stockAfterSale[0].quantity === 7, String(stockAfterSale[0].quantity));

const snap = await q(`SELECT product_snapshot->>'name' AS name, product_snapshot->>'official_price' AS price FROM public.sale_items LIMIT 1`);
check("snapshot do produto guardado na venda", snap[0].name === "Essence Gold", JSON.stringify(snap[0]));

const sellerStats = await asUser(SELLER, async () => {
  const r = await q(`SELECT public.seller_stats() AS res`);
  return r[0].res;
});
check("indicadores do vendedor corretos", Number(sellerStats.total_sales_value) === 119700 && sellerStats.units_sold === 3,
  JSON.stringify(sellerStats));

const otherSellerSees = await asUser(C2, async () => q(`SELECT count(*)::int n FROM public.sales`));
check("cliente não vê vendas", otherSellerSees[0].n === 0);

console.log("\n--- 7. CONCLUIR ENCOMENDA (gestor) ---");
const done = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.update_order_status('${order1.order_id}', 'completed', 'Entregue') AS res`);
  return r[0].res;
});
check("estado alterado para completed", done.status === "completed", JSON.stringify(done));

const stockFinal = await q(`SELECT quantity, reserved_quantity FROM public.inventory WHERE product_id='${prodId}'`);
check("reserva convertida em saída de stock (7 - 2 = 5)", stockFinal[0].quantity === 5 && stockFinal[0].reserved_quantity === 0,
  JSON.stringify(stockFinal[0]));

const history = await q(`SELECT count(*)::int n FROM public.order_status_history WHERE order_id='${order1.order_id}'`);
check("histórico de estados registado", history[0].n >= 1, String(history[0].n));

const notifs = await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id='${C1}'`);
check("cliente notificado", notifs[0].n >= 1, String(notifs[0].n));

console.log("\n--- 8. CHAT ---");
const conv = await asUser(C1, async () => {
  const r = await q(`SELECT public.get_or_create_direct_conversation('${SELLER}') AS id`);
  return r[0].id;
});
const conv2 = await asUser(C1, async () => {
  const r = await q(`SELECT public.get_or_create_direct_conversation('${SELLER}') AS id`);
  return r[0].id;
});
check("conversa direta é reutilizada", conv === conv2, `${conv} / ${conv2}`);

await asUser(C1, async () => {
  await q(`INSERT INTO public.messages (conversation_id, sender_id, content) VALUES ('${conv}','${C1}','Olá, existe stock?')`);
});
const msgs = await asUser(SELLER, async () => q(`SELECT count(*)::int n FROM public.messages WHERE conversation_id='${conv}'`));
check("vendedor recebe a mensagem", msgs[0].n === 1, String(msgs[0].n));

const outsider = await asUser(C2, async () => q(`SELECT count(*)::int n FROM public.messages WHERE conversation_id='${conv}'`));
check("terceiro não vê a conversa", outsider[0].n === 0, String(outsider[0].n));

console.log("\n--- 9. DESCONTOS ---");
const disc = await asUser(C1, async () => {
  const r = await q(`SELECT public.request_discount('${prodId}', 35000, 'Cliente frequente') AS res`);
  return r[0].res;
});
check("pedido de desconto criado", disc.status === "pending", JSON.stringify(disc));

const dec = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.decide_discount('${disc.discount_request_id}', true, 38000) AS res`);
  return r[0].res;
});
check("gestor aprova desconto", dec.status === "approved", JSON.stringify(dec));

// Limite de desconto: recusado já no momento do pedido
await expectError("desconto acima do limite é recusado no pedido", `
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', '${C1}', false);
  SELECT public.request_discount('${prodId}', 20000, 'Pedido agressivo');
`, "limite");
await exec(`RESET ROLE;`);

// Defesa em profundidade: mesmo com um pedido válido, a gerência não pode
// aprovar por um preço final abaixo do limite.
const disc2 = await asUser(C1, async () => {
  const r = await q(`SELECT public.request_discount('${prodId}', 39000, 'Pedido válido') AS res`);
  return r[0].res;
});
check("pedido dentro do limite é criado", disc2.status === "pending", JSON.stringify(disc2));

await expectError("aprovação abaixo do limite é rejeitada", `
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', '${MANAGER}', false);
  SELECT public.decide_discount('${disc2.discount_request_id}', true, 1000);
`, "limite");
await exec(`RESET ROLE;`);

// E o mesmo pedido continua pendente, não foi corrompido
const stillPending = await q(`SELECT status FROM public.discount_requests WHERE id='${disc2.discount_request_id}'`);
check("pedido recusado pelo limite permanece pendente", stillPending[0].status === "pending", stillPending[0].status);

// ---------------------------------------------------------------------------
// REGRESSÃO (2026-10-26): produto em promoção.
// request_discount valida contra o preço ATUAL (promocional); decide_discount
// tem de usar a mesma base. Antes da correção, um desconto de 15% sobre o preço
// promocional (34000 de 40000) representava 24% sobre o preço oficial (45000)
// e era recusado indevidamente.
// ---------------------------------------------------------------------------
const promoProd = await q(`
  INSERT INTO public.products (sku, name, official_price, promotional_price, is_active)
  VALUES ('REG-PROMO-1', 'Produto Promocional', 45000, 40000, true)
  RETURNING id
`);
const promoId = promoProd[0].id;

const discPromo = await asUser(C1, async () => {
  const r = await q(`SELECT public.request_discount('${promoId}', 34000, 'Desconto sobre promoção') AS res`);
  return r[0].res;
});
check("pedido de desconto sobre produto promocional criado", discPromo.status === "pending", JSON.stringify(discPromo));

const decPromo = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.decide_discount('${discPromo.discount_request_id}', true) AS res`);
  return r[0].res;
});
check(
  "desconto de 15% sobre preço promocional é aprovado",
  decPromo.status === "approved",
  JSON.stringify(decPromo),
);

console.log("\n--- 10. DASHBOARD ---");
const dash = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.dashboard_stats() AS res`);
  return r[0].res;
});
check("dashboard devolve vendas", Number(dash.sales_total_value) === 119700, String(dash.sales_total_value));
check("dashboard conta encomendas", dash.orders_count === 1, String(dash.orders_count));
check("dashboard lista stock baixo", Array.isArray(dash.low_stock_products), JSON.stringify(dash.low_stock_products));

console.log("\n--- 11. AUDITORIA ---");
const audit = await q(`SELECT count(*)::int n FROM public.audit_logs`);
check("registos de auditoria criados", audit[0].n > 0, String(audit[0].n));
const auditByCustomer = await asUser(C1, async () => q(`SELECT count(*)::int n FROM public.audit_logs`));
check("cliente não lê auditoria", auditByCustomer[0].n === 0, String(auditByCustomer[0].n));

console.log("\n--- 12. SINCRONIZAÇÃO OFFLINE ---");
const sync = await asUser(SELLER, async () => {
  const r = await q(`SELECT public.sync_push('[
    {"local_id":"aaaaaaaa-0000-0000-0000-000000000001","entity":"sale",
     "payload":{"items":[{"product_id":"${prodId}","quantity":1}],"customer_id":"${C1}","payment_method":"cash","payment_status":"paid"}}
  ]'::jsonb) AS res`);
  return r[0].res;
});
check("sync_push processa operação", sync.count === 1 && sync.results[0].status === "synced", JSON.stringify(sync).slice(0, 160));

const syncAgain = await asUser(SELLER, async () => {
  const r = await q(`SELECT public.sync_push('[
    {"local_id":"aaaaaaaa-0000-0000-0000-000000000001","entity":"sale",
     "payload":{"items":[{"product_id":"${prodId}","quantity":1}],"customer_id":"${C1}","payment_method":"cash","payment_status":"paid"}}
  ]'::jsonb) AS res`);
  return r[0].res;
});
const salesCount = await q(`SELECT count(*)::int n FROM public.sales`);
check("sync repetido não duplica a venda", salesCount[0].n === 2, `vendas=${salesCount[0].n}`);

console.log("\n--- 13. DESIGNER ---");

const PAGE_VAZIA = JSON.stringify([
  { id: "p1", name: "Página 1", background: { type: "solid", color: "#0A0A0A" }, elements: [] },
]);

// 13.1 criar — o estúdio é só da gestão, por isso quem cria é o gestor
const projA = await asUser(MANAGER, async () => {
  const r = await q(
    `SELECT public.design_create('Cartaz de teste', 'square', 1080, 1080, '${PAGE_VAZIA}'::jsonb) AS res`
  );
  return r[0].res;
});
check("design_create cria projeto", !!projA.id, JSON.stringify(projA).slice(0, 80));
check("versão inicial é 1", projA.version === 1, String(projA.version));
check("dono é o criador", projA.owner_id === MANAGER, projA.owner_id);
check("páginas guardadas", Array.isArray(projA.pages) && projA.pages.length === 1);

// 13.2 título vazio cai para o valor por omissão
const projSemTitulo = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_create('   ', 'story', 1080, 1920) AS res`);
  return r[0].res;
});
check("título vazio usa 'Sem título'", projSemTitulo.title === "Sem título", projSemTitulo.title);

// 13.3 isolamento de leitura
const vistosPeloDono = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.design_projects`)
);
check("dono vê os seus 2 projetos", vistosPeloDono[0].n === 2, String(vistosPeloDono[0].n));

const vistosPorC1 = await asUser(C1, async () =>
  q(`SELECT count(*)::int n FROM public.design_projects`)
);
check("cliente não vê projetos da gestão", vistosPorC1[0].n === 0, String(vistosPorC1[0].n));

const vistosPorC2 = await asUser(C2, async () =>
  q(`SELECT count(*)::int n FROM public.design_projects`)
);
check("outro cliente também não vê", vistosPorC2[0].n === 0, String(vistosPorC2[0].n));

// 13.4 escrita direta bloqueada. O gatilho da gestão é BEFORE INSERT e por
// isso responde antes do WITH CHECK do RLS — o insert é recusado na mesma.
await expectError(
  "cliente não insere projeto diretamente",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   INSERT INTO public.design_projects (owner_id, title, width, height)
   VALUES ('${C1}', 'injeção', 1080, 1080);`,
  "SEM_PERMISSAO"
);

// 13.5 o estúdio é só da gestão: um cliente não cria projeto nenhum
await expectError(
  "cliente não cria projeto no estúdio",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   SELECT public.design_create('tentativa', 'square', 1080, 1080);`,
  "SEM_PERMISSAO"
);

// 13.6 outro cliente não guarda o projeto alheio
await expectError(
  "outro cliente não guarda projeto alheio",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C2}', false);
   SELECT public.design_save('${projA.id}', '[]'::jsonb, 'roubado', NULL, 1);`,
  "NAO_ENCONTRADO"
);

// 13.7 guardar incrementa a versão
const guardado = await asUser(MANAGER, async () => {
  const r = await q(
    `SELECT public.design_save('${projA.id}', '${PAGE_VAZIA}'::jsonb, 'Cartaz revisto', NULL, 1) AS res`
  );
  return r[0].res;
});
check("design_save grava sem conflito", guardado.conflict === false, JSON.stringify(guardado).slice(0, 90));
check("versão sobe para 2", guardado.version === 2, String(guardado.version));

// 13.8 versão desatualizada devolve conflito com o estado do servidor
const conflito = await asUser(MANAGER, async () => {
  const r = await q(
    `SELECT public.design_save('${projA.id}', '[]'::jsonb, 'versão velha', NULL, 1) AS res`
  );
  return r[0].res;
});
check("versão antiga gera conflito", conflito.conflict === true, JSON.stringify(conflito).slice(0, 90));
check("conflito devolve a versão atual", conflito.version === 2, String(conflito.version));
check("conflito devolve o documento do servidor", Array.isArray(conflito.pages), typeof conflito.pages);

// 13.9 título vazio não apaga o nome existente
await asUser(MANAGER, async () => {
  await q(`SELECT public.design_save('${projA.id}', '${PAGE_VAZIA}'::jsonb, '', NULL, 2)`);
});
const tituloFinal = await q(`SELECT title FROM public.design_projects WHERE id='${projA.id}'`);
check("guardar sem título mantém o nome", tituloFinal[0].title === "Cartaz revisto", tituloFinal[0].title);

// 13.10 duplicar
const copiaId = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_duplicate('${projA.id}') AS id`);
  return r[0].id;
});
const copia = await q(`SELECT title, pages, version FROM public.design_projects WHERE id='${copiaId}'`);
check("duplicar cria novo projeto", copia.length === 1);
check("cópia leva sufixo no nome", copia[0].title === "Cartaz revisto (cópia)", copia[0].title);
check("cópia começa na versão 1", copia[0].version === 1, String(copia[0].version));

const copiaAlheia = await asUser(C2, async () => {
  try {
    await q(`SELECT public.design_duplicate('${projA.id}')`);
    return "sem-erro";
  } catch (e) {
    return e.message;
  }
});
check("outro cliente não duplica projeto alheio", String(copiaAlheia).includes("NAO_ENCONTRADO"), String(copiaAlheia).slice(0, 60));

// 13.11 renomear
await asUser(MANAGER, async () => q(`SELECT public.design_rename('${projA.id}', 'Nome novo')`));
const renomeado = await q(`SELECT title FROM public.design_projects WHERE id='${projA.id}'`);
check("design_rename altera o nome", renomeado[0].title === "Nome novo", renomeado[0].title);

// 13.12 modelos
await exec(`
  INSERT INTO public.design_templates (title, category, format_key, width, height, pages, is_active, sort_order)
  VALUES ('Modelo ativo', 'promocao', 'square', 1080, 1080, '${PAGE_VAZIA}'::jsonb, true, 1),
         ('Modelo arquivado', 'promocao', 'square', 1080, 1080, '${PAGE_VAZIA}'::jsonb, false, 2);
`);
const modelosCliente = await asUser(C1, async () =>
  q(`SELECT count(*)::int n FROM public.design_templates`)
);
check("cliente vê só modelos ativos", modelosCliente[0].n === 1, String(modelosCliente[0].n));

const modelosGestor = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.design_templates`)
);
check("gestor vê todos os modelos", modelosGestor[0].n === 2, String(modelosGestor[0].n));

await expectError(
  "cliente não cria modelos",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   INSERT INTO public.design_templates (title, width, height) VALUES ('meu modelo', 1080, 1080);`,
  "row-level security"
);

// 13.13 apagar
await asUser(MANAGER, async () => q(`SELECT public.design_delete('${copiaId}')`));
const apagado = await q(`SELECT count(*)::int n FROM public.design_projects WHERE id='${copiaId}'`);
check("design_delete remove o projeto", apagado[0].n === 0, String(apagado[0].n));

await expectError(
  "outro cliente não apaga projeto alheio",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C2}', false);
   SELECT public.design_delete('${projA.id}');`,
  "NAO_ENCONTRADO"
);

// 13.14 limites de tamanho
await expectError(
  "dimensões fora do limite são recusadas",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${MANAGER}', false);
   SELECT public.design_create('gigante', 'square', 99999, 99999);`,
  "DIMENSOES_INVALIDAS"
);

// 13.15 páginas têm de ser array
await expectError(
  "páginas que não são array são recusadas",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${MANAGER}', false);
   SELECT public.design_save('${projA.id}', '{"a":1}'::jsonb, NULL, NULL, NULL);`,
  "PAGINAS_INVALIDAS"
);

// 13.16 publicar projeto como modelo (só gestão)
const projGestor = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_create('Modelo da gestão', 'square', 1080, 1080, '${PAGE_VAZIA}'::jsonb) AS res`);
  return r[0].res;
});
check("gestor cria projeto próprio", !!projGestor.id);

await expectError(
  "cliente não publica modelos",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   SELECT public.design_publish_template('${projA.id}', 'tentativa', 'geral');`,
  "SEM_PERMISSAO"
);

const modeloPublicado = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_publish_template('${projGestor.id}', 'Modelo publicado', 'promocao') AS id`);
  return r[0].id;
});
check("gestor publica o seu projeto como modelo", !!modeloPublicado);

const modelosDepois = await asUser(C1, async () =>
  q(`SELECT count(*)::int n FROM public.design_templates WHERE is_active`)
);
check("modelo publicado fica visível ao cliente", modelosDepois[0].n === 2, String(modelosDepois[0].n));

const copiaDoModelo = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_create('a partir do modelo', 'square', 1080, 1080, '${PAGE_VAZIA}'::jsonb, '${modeloPublicado}') AS res`);
  return r[0].res;
});
check("gestor cria projeto a partir do modelo", copiaDoModelo.template_id === modeloPublicado, String(copiaDoModelo.template_id));

await expectError(
  "cliente não cria projeto a partir de um modelo",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   SELECT public.design_create('a partir do modelo', 'square', 1080, 1080, '${PAGE_VAZIA}'::jsonb, '${modeloPublicado}');`,
  "SEM_PERMISSAO"
);

// 13.17 o primeiro design_save cria um instantâneo automático
const versoesAposGuardar = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.design_versions WHERE project_id = '${projA.id}'`)
);
check("gravar cria instantâneo automático", versoesAposGuardar[0].n === 1, String(versoesAposGuardar[0].n));

// 13.18 gravações seguidas não enchem a tabela (limite de 5 minutos)
await asUser(MANAGER, async () => {
  await q(`SELECT public.design_save('${projA.id}', '${PAGE_VAZIA}'::jsonb, NULL, NULL, NULL)`);
  await q(`SELECT public.design_save('${projA.id}', '${PAGE_VAZIA}'::jsonb, NULL, NULL, NULL)`);
});
const versoesAposTresGuardar = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.design_versions WHERE project_id = '${projA.id}'`)
);
check(
  "instantâneo automático é limitado a um por 5 minutos",
  versoesAposTresGuardar[0].n === 1,
  String(versoesAposTresGuardar[0].n)
);

// 13.19 instantâneo manual com etiqueta
const snapManual = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_snapshot('${projA.id}', 'Antes do cartaz final') AS id`);
  return r[0].id;
});
check("design_snapshot cria versão manual", !!snapManual);

const listaA = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_versions_list('${projA.id}') AS res`);
  return r[0].res;
});
check("histórico lista as versões", Array.isArray(listaA) && listaA.length === 2, String(listaA?.length));
check(
  "histórico traz contagem de páginas e elementos",
  listaA[0].paginas === 1 && listaA[0].elementos === 0,
  JSON.stringify({ p: listaA[0].paginas, e: listaA[0].elementos })
);
check("histórico traz a etiqueta", listaA.some((v) => v.label === "Antes do cartaz final"));

// 13.20 outro cliente não lê o histórico alheio
await expectError(
  "histórico alheio é inacessível",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C2}', false);
   SELECT public.design_versions_list('${projA.id}');`,
  "NAO_ENCONTRADO"
);

// 13.21 escrita direta no histórico bloqueada
await expectError(
  "cliente não forja instantâneos",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   INSERT INTO public.design_versions (project_id, owner_id, version, pages)
   VALUES ('${projA.id}', '${C1}', 1, '[]'::jsonb);`,
  "row-level security"
);

// 13.22 restaurar repõe o documento e sobe a versão
const versaoAntes = await asUser(MANAGER, async () => {
  const r = await q(`SELECT version FROM public.design_projects WHERE id = '${projA.id}'`);
  return r[0].version;
});

const PAGE_NOVA = JSON.stringify([
  { id: "p9", name: "Página nova", background: { type: "solid", color: "#111111" }, elements: [] },
]);
await asUser(MANAGER, async () =>
  q(`SELECT public.design_save('${projA.id}', '${PAGE_NOVA}'::jsonb, NULL, NULL, NULL)`)
);

const restaurado = await asUser(MANAGER, async () => {
  const r = await q(`SELECT public.design_restore_version('${projA.id}', '${snapManual}') AS res`);
  return r[0].res;
});
check("restaurar devolve o documento da versão", restaurado.pages[0].name === "Página 1", restaurado.pages?.[0]?.name);
check(
  "restaurar incrementa a versão",
  restaurado.version === versaoAntes + 2,
  `${restaurado.version} (esperado ${versaoAntes + 2})`
);
check("restaurar indica a origem", restaurado.restaurado_de >= 1, String(restaurado.restaurado_de));

const versaoAntesDeRestaurar = await asUser(MANAGER, async () =>
  q(
    `SELECT count(*)::int n FROM public.design_versions
     WHERE project_id = '${projA.id}' AND label = 'antes de restaurar'`
  )
);
check(
  "restaurar guarda o estado anterior (reversível)",
  versaoAntesDeRestaurar[0].n === 1,
  String(versaoAntesDeRestaurar[0].n)
);

// 13.23 outro cliente não restaura
await expectError(
  "cliente não restaura projeto alheio",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C2}', false);
   SELECT public.design_restore_version('${projA.id}', '${snapManual}');`,
  "VERSAO_NAO_ENCONTRADA"
);

// 13.24 poda do histórico
await asUser(MANAGER, async () => {
  for (let i = 0; i < 6; i++) {
    await q(`SELECT public.design_snapshot('${projA.id}', 'lote ${i}')`);
  }
  await q(`SELECT public.design_versions_prune('${projA.id}', 4)`);
});
const aposPoda = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.design_versions WHERE project_id = '${projA.id}'`)
);
check("poda mantém apenas o limite pedido", aposPoda[0].n === 4, String(aposPoda[0].n));

// 13.25 preferências do utilizador
await asUser(MANAGER, async () =>
  q(
    `INSERT INTO public.designer_preferences (user_id, last_format_key, last_font, snap_enabled, grid_size)
     VALUES ('${MANAGER}', 'story', 'Georgia', false, 16)`
  )
);
const prefsDono = await asUser(MANAGER, async () =>
  q(`SELECT last_format_key, snap_enabled, grid_size FROM public.designer_preferences`)
);
check("preferências ficam guardadas", prefsDono.length === 1 && prefsDono[0].last_format_key === "story", JSON.stringify(prefsDono[0] ?? {}));

await asUser(MANAGER, async () =>
  q(`UPDATE public.designer_preferences SET last_format_key = 'a4' WHERE user_id = '${MANAGER}'`)
);
const prefsAtualizadas = await asUser(MANAGER, async () =>
  q(`SELECT last_format_key FROM public.designer_preferences WHERE user_id = '${MANAGER}'`)
);
check("preferências podem ser atualizadas", prefsAtualizadas[0].last_format_key === "a4", prefsAtualizadas[0].last_format_key);

// 13.26 isolamento e validação das preferências
const prefsVistasPorC2 = await asUser(C2, async () =>
  q(`SELECT count(*)::int n FROM public.designer_preferences`)
);
check("outro utilizador não vê preferências alheias", prefsVistasPorC2[0].n === 0, String(prefsVistasPorC2[0].n));

await expectError(
  "não se escrevem preferências em nome de outro",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C2}', false);
   INSERT INTO public.designer_preferences (user_id) VALUES ('${MANAGER}');`,
  "row-level security"
);

await expectError(
  "tamanho de grelha fora dos limites é recusado",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C2}', false);
   INSERT INTO public.designer_preferences (user_id, grid_size) VALUES ('${C2}', 9999);`,
  "check"
);

console.log("\n--- 14. GESTÃO MULTIPROVINCIAL ---");

// 14.1 províncias semeadas
const provs = await q(`SELECT codigo, nome, is_default FROM public.provincias ORDER BY nome`);
check("18 províncias semeadas", provs.length === 18, String(provs.length));
check("existe uma única província-sede", provs.filter((p) => p.is_default).length === 1,
  JSON.stringify(provs.filter((p) => p.is_default).map((p) => p.codigo)));

const UIG = (await q(`SELECT id FROM public.provincias WHERE codigo = 'UIG'`))[0].id;
const LDA = (await q(`SELECT id FROM public.provincias WHERE codigo = 'LDA'`))[0].id;

// 14.2 o gestor que já existia continua a ver tudo (administração nacional)
const nat = await asUser(MANAGER, async () => q(`SELECT public.is_national() AS n`));
check("gestor existente é administração nacional", nat[0].n === true, JSON.stringify(nat[0]));

// 14.3 referência única para todos
const refs = await q(`SELECT referencia FROM public.profiles`);
check("todos os perfis têm referência",
  refs.length > 0 && refs.every((r) => /^INK-[A-Z]{3}-\d{5}$/.test(r.referencia)),
  JSON.stringify(refs.slice(0, 2).map((r) => r.referencia)));
check("referências são únicas", new Set(refs.map((r) => r.referencia)).size === refs.length);

// 14.4 contas provinciais
const M_UIGE = "66666666-6666-6666-6666-666666666666";
const S_UIGE = "77777777-7777-7777-7777-777777777777";
const C_UIGE = "88888888-8888-8888-8888-888888888888";
const C_LDA = "99999999-9999-9999-9999-999999999999";

await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('${M_UIGE}', 'muige@inuka.ao', '{"full_name":"Gestor Uíge","phone":"923000010"}'),
    ('${S_UIGE}', 'suige@inuka.ao', '{"full_name":"Colaborador Uíge","phone":"923000011"}'),
    ('${C_UIGE}', 'cuige@inuka.ao', '{"full_name":"Cliente Uíge","phone":"923000012","provincia":"Uíge"}'),
    ('${C_LDA}', 'clda@inuka.ao', '{"full_name":"Cliente Luanda","phone":"923000013","provincia_slug":"luanda"}');
`);

await q(`SELECT public.promote_to_manager('+244923000010')`);
await q(`SELECT public.promote_to_seller('+244923000011', 'Uíge', '${UIG}')`);

// O gestor do Uíge não é administração nacional
await exec(`UPDATE public.profiles SET provincia_id = '${UIG}', is_national_admin = false WHERE id = '${M_UIGE}'`);

const mUige = await q(`SELECT provincia_id, is_national_admin FROM public.profiles WHERE id = '${M_UIGE}'`);
check("gestor provincial fica com a sua província",
  mUige[0].provincia_id === UIG && mUige[0].is_national_admin === false,
  JSON.stringify(mUige[0]));

const refCliente = await q(`SELECT provincia_id, referencia FROM public.profiles WHERE id = '${C_UIGE}'`);
check("província do registo vem dos metadados",
  refCliente[0].provincia_id === UIG, String(refCliente[0].provincia_id));
check("referência usa o código da província",
  String(refCliente[0].referencia).startsWith("INK-UIG-"), refCliente[0].referencia);

// 14.5 atribuir província a um cliente (RPC)
const refAntes = await q(`SELECT referencia FROM public.profiles WHERE id = '${C_LDA}'`);
const atrib = await asUser(MANAGER, async () =>
  q(`SELECT public.assign_province('${C_LDA}', '${LDA}') AS r`)
);
check("administração nacional atribui província", atrib[0].r.provincia_id === LDA, JSON.stringify(atrib[0].r));

// A referência nasceu quando o cliente não tinha província (`INK-NAC-00007`).
// Ao atribuir, o prefixo passa a `LDA` mas o número tem de ficar igual: é a
// identidade da pessoa e pode já estar impressa.
const refDepois = await q(`SELECT referencia FROM public.profiles WHERE id = '${C_LDA}'`);
const numeroAntes = String(refAntes[0].referencia).split("-").pop();
const numeroDepois = String(refDepois[0].referencia).split("-").pop();
check("atribuir província troca o prefixo da referência e mantém o número",
  /^INK-LDA-\d{5}$/.test(refDepois[0].referencia) && numeroAntes === numeroDepois,
  `${refAntes[0].referencia} → ${refDepois[0].referencia}`);

// 14.6 catálogo e stock por província
const pNac = (await q(`
  INSERT INTO public.products (sku, name, official_price, is_active)
  VALUES ('INK-NAC','Perfume Nacional', 10000, true) RETURNING id`))[0].id;
const pUige = (await q(`
  INSERT INTO public.products (sku, name, official_price, is_active, provincia_id)
  VALUES ('INK-UIG','Perfume Uíge', 12000, true, '${UIG}') RETURNING id`))[0].id;
const pLda = (await q(`
  INSERT INTO public.products (sku, name, official_price, is_active, provincia_id)
  VALUES ('INK-LDA','Perfume Luanda', 15000, true, '${LDA}') RETURNING id`))[0].id;

await exec(`
  INSERT INTO public.inventory (product_id, provincia_id, quantity) VALUES
    ('${pNac}', NULL, 100),
    ('${pNac}', '${UIG}', 10),
    ('${pUige}', '${UIG}', 5),
    ('${pLda}', '${LDA}', 7);
`);

const vistosUige = await asUser(S_UIGE, async () =>
  q(`SELECT sku FROM public.products WHERE is_active ORDER BY sku`)
);
const skusUige = vistosUige.map((r) => r.sku);
check("colaborador vê produtos da sua província e os nacionais",
  skusUige.includes("INK-UIG") && skusUige.includes("INK-NAC") && !skusUige.includes("INK-LDA"),
  JSON.stringify(skusUige));

const stockUige = await asUser(S_UIGE, async () =>
  q(`SELECT product_id, provincia_id, quantity FROM public.inventory`)
);
check("colaborador não vê stock de outra província",
  stockUige.every((r) => r.provincia_id === UIG || r.provincia_id === null)
  && !stockUige.some((r) => r.provincia_id === LDA),
  JSON.stringify(stockUige.map((r) => [r.provincia_id, r.quantity])));

const stockLda = await asUser(C_LDA, async () =>
  q(`SELECT provincia_id FROM public.inventory`)
);
check("cliente de Luanda vê o stock de Luanda",
  stockLda.some((r) => r.provincia_id === LDA) && !stockLda.some((r) => r.provincia_id === UIG),
  JSON.stringify(stockLda.map((r) => r.provincia_id)));

// 14.7 gestor provincial não edita produto de outra província
const edicaoAlheia = await asUser(M_UIGE, async () =>
  q(`UPDATE public.products SET name = 'Alterado' WHERE id = '${pLda}' RETURNING id`)
);
check("gestor provincial não altera produto de outra província",
  edicaoAlheia.length === 0, `${edicaoAlheia.length} linhas`);

const edicaoPropria = await asUser(M_UIGE, async () =>
  q(`UPDATE public.products SET name = 'Perfume Uíge Premium' WHERE id = '${pUige}' RETURNING id`)
);
check("gestor provincial altera o produto da sua província", edicaoPropria.length === 1);

// 14.8 stock separado por província
const ajuste = await asUser(M_UIGE, async () =>
  q(`SELECT public.set_product_stock('${pNac}', 25, 'Reposição Uíge') AS r`)
);
const linhasNac = await q(`
  SELECT provincia_id, quantity FROM public.inventory WHERE product_id = '${pNac}' ORDER BY quantity DESC`);
check("stock do mesmo produto é controlado por província",
  linhasNac.length === 2 && linhasNac.some((l) => l.provincia_id === UIG && l.quantity === 25)
  && linhasNac.some((l) => l.provincia_id === null && l.quantity === 100),
  JSON.stringify(linhasNac));
check("ajuste de stock devolve a província", ajuste[0].r.provincia_id === UIG, JSON.stringify(ajuste[0].r));

// 14.9 encomenda reserva o stock da província do cliente
const enc = await asUser(C_UIGE, async () =>
  q(`SELECT public.place_order('[{"product_id":"${pNac}","quantity":3}]'::jsonb,
      'pickup', NULL, '+244923000012', 'Teste provincial', 'prov-001') AS r`)
);
const reservaUige = await q(`
  SELECT quantity, reserved_quantity FROM public.inventory
  WHERE product_id = '${pNac}' AND provincia_id = '${UIG}'`);
const reservaSede = await q(`
  SELECT quantity, reserved_quantity FROM public.inventory
  WHERE product_id = '${pNac}' AND provincia_id IS NULL`);
check("encomenda reserva o stock da província do cliente",
  reservaUige[0].reserved_quantity === 3 && reservaSede[0].reserved_quantity === 0,
  JSON.stringify([reservaUige[0], reservaSede[0]]));

const encProv = await q(`SELECT provincia_id FROM public.orders WHERE id = '${enc[0].r.order_id}'`);
check("encomenda fica marcada com a província do cliente", encProv[0].provincia_id === UIG,
  String(encProv[0].provincia_id));

// 14.9b cliente sem província compra a partir do armazém-sede
// Quando o inventário legado passou a pertencer à sede como província real,
// deixou de existir a linha `provincia_id IS NULL`. Sem o recurso à província
// `is_default`, uma conta sem província comprava **sem reservar stock nenhum**
// — a encomenda passava e o inventário ficava intacto.
const pSede = (await q(`
  INSERT INTO public.products (sku, name, official_price, is_active)
  VALUES ('INK-SEDE','Perfume só na sede', 9000, true) RETURNING id`))[0].id;

// Uma segunda linha numa província que nenhum outro teste mede, para provar
// que a reserva não escorrega para a delegação errada.
const BEN = (await q(`SELECT id FROM public.provincias WHERE codigo = 'BGL'`))[0].id;

await exec(`
  INSERT INTO public.inventory (product_id, provincia_id, quantity) VALUES
    ('${pSede}', '${LDA}', 40),
    ('${pSede}', '${BEN}', 5);
`);

const C_NAC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES ('${C_NAC}', 'cnac@inuka.ao', '{"full_name":"Cliente Sem Província","phone":"923000014"}');
`);
await exec(`UPDATE public.profiles SET provincia_id = NULL WHERE id = '${C_NAC}'`);

const encSede = await asUser(C_NAC, async () =>
  q(`SELECT public.place_order('[{"product_id":"${pSede}","quantity":4}]'::jsonb,
      'pickup', NULL, '+244923000014', NULL, 'sede-001') AS r`)
);
const reservaNaSede = await q(`
  SELECT provincia_id, reserved_quantity FROM public.inventory
  WHERE product_id = '${pSede}' AND provincia_id = '${LDA}'`);
const reservaForaDaSede = await q(`
  SELECT reserved_quantity FROM public.inventory
  WHERE product_id = '${pSede}' AND provincia_id = '${BEN}'`);

check("cliente sem província reserva stock no armazém-sede",
  reservaNaSede[0].reserved_quantity === 4, JSON.stringify(reservaNaSede[0]));
check("cliente sem província não toca no stock das delegações",
  reservaForaDaSede[0].reserved_quantity === 0, JSON.stringify(reservaForaDaSede[0]));
check("encomenda sem província fica sem província",
  encSede.length === 1, String(encSede[0]?.r?.order_id));

// 14.10 o cliente não consegue forjar a província
const forja = await asUser(C_UIGE, async () =>
  q(`INSERT INTO public.orders (reference, customer_id, provincia_id)
     VALUES ('ENC-FORJADA', '${C_UIGE}', '${LDA}') RETURNING provincia_id`)
);
check("cliente não forja a província da encomenda", forja[0].provincia_id === UIG,
  String(forja[0].provincia_id));

// 14.11 venda regista a província do colaborador
const venda = await asUser(S_UIGE, async () =>
  q(`SELECT public.register_sale('[{"product_id":"${pUige}","quantity":2}]'::jsonb,
      NULL, 'dinheiro', 'paid', 'Venda Uíge', 'venda-prov-001') AS r`)
);
const vendaProv = await q(`SELECT provincia_id FROM public.sales WHERE id = '${venda[0].r.sale_id}'`);
const stockPosVenda = await q(`
  SELECT quantity FROM public.inventory WHERE product_id = '${pUige}' AND provincia_id = '${UIG}'`);
check("venda fica na província do colaborador", vendaProv[0].provincia_id === UIG,
  String(vendaProv[0].provincia_id));
check("venda debita o stock da província", stockPosVenda[0].quantity === 3,
  String(stockPosVenda[0].quantity));

// 14.12 transferência entre províncias
const trf = await asUser(M_UIGE, async () =>
  q(`SELECT public.request_stock_transfer('${pNac}', '${UIG}', '${LDA}', 5, 'Reforço de Luanda') AS r`)
);
check("colaborador pede transferência entre províncias", trf[0].r.status === "pending",
  JSON.stringify(trf[0].r));

await expectError(
  "gestor provincial não aprova transferências",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${M_UIGE}', false);
   SELECT public.decide_stock_transfer('${trf[0].r.transfer_id}', true);`,
  "administração nacional"
);

const aprov = await asUser(MANAGER, async () =>
  q(`SELECT public.decide_stock_transfer('${trf[0].r.transfer_id}', true) AS r`)
);
const origemDepois = await q(`
  SELECT quantity FROM public.inventory WHERE product_id = '${pNac}' AND provincia_id = '${UIG}'`);
const destinoDepois = await q(`
  SELECT quantity FROM public.inventory WHERE product_id = '${pNac}' AND provincia_id = '${LDA}'`);
check("administração nacional aprova a transferência", aprov[0].r.status === "approved",
  JSON.stringify(aprov[0].r));
check("aprovação move as quantidades entre províncias",
  origemDepois[0].quantity === 20 && destinoDepois[0].quantity === 5,
  JSON.stringify([origemDepois[0], destinoDepois[0]]));

// 14.13 ninguém muda a própria província
await expectError(
  "gestor provincial não muda a própria província",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${M_UIGE}', false);
   UPDATE public.profiles SET provincia_id = '${LDA}' WHERE id = '${M_UIGE}';`,
  "administração nacional"
);

await expectError(
  "colaborador não se promove a administração nacional",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   UPDATE public.profiles SET is_national_admin = true WHERE id = '${S_UIGE}';`,
  "administração nacional"
);

// 14.14 indicadores por província
const dashProv = await asUser(M_UIGE, async () =>
  q(`SELECT public.dashboard_stats() AS r`)
);
check("gestor provincial vê indicadores da sua província",
  dashProv[0].r.scope === "provincial" && dashProv[0].r.provincia_id === UIG,
  JSON.stringify({ scope: dashProv[0].r.scope, prov: dashProv[0].r.provincia_id }));

const dashNac = await asUser(MANAGER, async () =>
  q(`SELECT public.dashboard_stats(NULL, NULL, '${UIG}') AS r`)
);
check("administração nacional filtra por província",
  dashNac[0].r.scope === "provincial" && dashNac[0].r.provincia_id === UIG,
  JSON.stringify({ scope: dashNac[0].r.scope }));

await expectError(
  "gestor provincial não compara todas as províncias",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${M_UIGE}', false);
   SELECT public.province_overview();`,
  "administração nacional"
);

const visao = await asUser(MANAGER, async () => q(`SELECT public.province_overview() AS r`));
const linhasVisao = visao[0].r;
const uigeVisao = linhasVisao.find((p) => p.codigo === "UIG");
check("administração nacional compara províncias",
  Array.isArray(linhasVisao) && linhasVisao.length === 18, String(linhasVisao.length));
check("comparação traz stock e vendas por província",
  uigeVisao && uigeVisao.stock_total === 23 && Number(uigeVisao.vendas_valor) === 24000,
  JSON.stringify({ stock: uigeVisao?.stock_total, vendas: uigeVisao?.vendas_valor }));

// =============================================================================
// 15. IDENTIDADE E GESTÃO DE COLABORADORES (migração 0006)
// =============================================================================
console.log("\n--- 15. IDENTIDADE E GESTÃO DE COLABORADORES ---");

// 15.1 referência com sequência própria por província
await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('aaaa1111-1111-4111-8111-111111111111', 'seq1@inuka.ao',
     '{"full_name":"Seq Uíge 1","phone":"923000021","provincia":"Uíge"}'),
    ('aaaa1111-1111-4111-8111-222222222222', 'seq2@inuka.ao',
     '{"full_name":"Seq Uíge 2","phone":"923000022","provincia":"Uíge"}'),
    ('aaaa1111-1111-4111-8111-333333333333', 'seq3@inuka.ao',
     '{"full_name":"Seq Luanda","phone":"923000023","provincia":"Luanda"}');
`);

const seq = await q(`
  SELECT phone, referencia FROM public.profiles
  WHERE phone IN ('+244923000021', '+244923000022', '+244923000023')
  ORDER BY phone`);

const n1 = Number(seq[0].referencia.split("-")[2]);
const n2 = Number(seq[1].referencia.split("-")[2]);
check("referência é gerada no cadastro com o código da província",
  seq[0].referencia.startsWith("INK-UIG-") && seq[2].referencia.startsWith("INK-LDA-"),
  seq.map((r) => r.referencia).join(" · "));
check("a sequência é contínua dentro da província",
  n2 === n1 + 1, `${seq[0].referencia} → ${seq[1].referencia}`);
check("cada província tem a sua própria sequência",
  seq[2].referencia !== `INK-UIG-${String(n2 + 1).padStart(5, "0")}`,
  `${seq[1].referencia} vs ${seq[2].referencia}`);

// 15.2 referência única
const refS = (await q(`SELECT referencia FROM public.profiles WHERE id = '${S_UIGE}'`))[0].referencia;
await expectError(
  "não permite referências duplicadas",
  `UPDATE public.profiles SET referencia = '${refS}' WHERE id = '${C_UIGE}';`,
  "duplicate"
);

// 15.3 a venda gera comissão com a taxa do colaborador
await exec(`UPDATE public.seller_profiles SET commission_rate = 0.05 WHERE id = '${S_UIGE}'`);

const vendaCom = (await q(`
  INSERT INTO public.sales (reference, seller_id, total_amount, provincia_id)
  VALUES ('TST-COMM-1', '${S_UIGE}', 10000, '${UIG}') RETURNING id`))[0].id;

const com1 = await q(`SELECT amount, rate, status FROM public.sale_commissions WHERE sale_id = '${vendaCom}'`);
check("venda gera comissão com a taxa do colaborador",
  com1.length === 1 && Number(com1[0].amount) === 500 && com1[0].status === "pending",
  JSON.stringify(com1[0]));

// 15.4 uma comissão por venda, recalculada e nunca duplicada
await exec(`UPDATE public.sales SET total_amount = 20000 WHERE id = '${vendaCom}'`);
const com2 = await q(`
  SELECT COUNT(*) AS n, SUM(amount) AS total FROM public.sale_commissions WHERE sale_id = '${vendaCom}'`);
check("comissão é única por venda e acompanha o novo valor",
  Number(com2[0].n) === 1 && Number(com2[0].total) === 1000,
  JSON.stringify(com2[0]));

// 15.5 venda cancelada deixa de contar
const antesCancelar = await asUser(S_UIGE, async () => q(`SELECT public.seller_stats() AS r`));
await exec(`UPDATE public.sales SET status = 'cancelled' WHERE id = '${vendaCom}'`);
const comCancelada = await q(`SELECT amount, status FROM public.sale_commissions WHERE sale_id = '${vendaCom}'`);
check("cancelar a venda anula a comissão",
  comCancelada[0].status === "cancelled" && Number(comCancelada[0].amount) === 0,
  JSON.stringify(comCancelada[0]));

const depoisCancelar = await asUser(S_UIGE, async () => q(`SELECT public.seller_stats() AS r`));
check("venda cancelada não entra nos indicadores do colaborador",
  Number(antesCancelar[0].r.total_sales_value) - Number(depoisCancelar[0].r.total_sales_value) === 20000,
  `${antesCancelar[0].r.total_sales_value} → ${depoisCancelar[0].r.total_sales_value}`);

// 15.6 painel individual
const painel = await asUser(S_UIGE, async () => q(`SELECT public.colaborador_painel() AS r`));
check("painel traz a identidade e a referência do próprio",
  painel[0].r.identidade.referencia === refS && painel[0].r.identidade.provincia_nome === "Uíge",
  JSON.stringify({ ref: painel[0].r.identidade.referencia }));
check("painel traz os seis meses de séries",
  painel[0].r.series.meses.length === 6 && painel[0].r.series.vendas.length === 6,
  String(painel[0].r.series.meses.length));
check("painel traz os cartões de desempenho",
  typeof painel[0].r.cartoes.vendas_valor === "number"
    && typeof painel[0].r.cartoes.comissao_total === "number",
  JSON.stringify(painel[0].r.cartoes));

// 15.7 isolamento entre contas
await expectError(
  "cliente não abre a ficha de um colaborador",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C_UIGE}', false);
   SELECT public.colaborador_ficha('${S_UIGE}');`,
  "Sem permissão"
);
await expectError(
  "cliente não abre o painel de um colaborador",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C_UIGE}', false);
   SELECT public.colaborador_painel('${S_UIGE}');`,
  "Sem permissão"
);

// 15.8 o BI não sai para quem não tem permissão
const biCliente = await asUser(C_UIGE, async () =>
  q(`SELECT bi_number FROM public.seller_profiles WHERE id = '${S_UIGE}'`)
);
check("BI não é visível a um cliente", biCliente.length === 0, String(biCliente.length));

const biGestor = await asUser(M_UIGE, async () =>
  q(`SELECT public.colaborador_ficha('${S_UIGE}') AS r`)
);
check("gestor da província vê a ficha completa",
  biGestor[0].r.full_name === "Colaborador Uíge" && biGestor[0].r.referencia === refS,
  JSON.stringify({ nome: biGestor[0].r.full_name }));

// 15.9 o próprio actualiza contactos; o BI é da gestão
await asUser(S_UIGE, async () =>
  q(`SELECT public.atualizar_perfil_colaborador('${S_UIGE}', '{"whatsapp":"+244923000011"}'::jsonb)`)
);
const wpp = await q(`SELECT whatsapp FROM public.seller_profiles WHERE id = '${S_UIGE}'`);
check("colaborador actualiza o próprio WhatsApp",
  wpp[0].whatsapp === "+244923000011", String(wpp[0].whatsapp));

await expectError(
  "colaborador não altera o próprio BI",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   SELECT public.atualizar_perfil_colaborador('${S_UIGE}', '{"bi_number":"000000000LA000"}'::jsonb);`,
  "Só a gestão"
);
await expectError(
  "colaborador não altera a própria comissão",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   SELECT public.atualizar_perfil_colaborador('${S_UIGE}', '{"commission_rate":0.5}'::jsonb);`,
  "Só a gestão"
);

await asUser(M_UIGE, async () =>
  q(`SELECT public.atualizar_perfil_colaborador('${S_UIGE}',
       '{"bi_number":"004567890LA041","job_title":"Consultor de vendas","category":"Sénior","municipio":"Uíge"}'::jsonb)`)
);
const fichaG = await asUser(M_UIGE, async () =>
  q(`SELECT public.colaborador_ficha('${S_UIGE}') AS r`)
);
check("gestor guarda BI, função, categoria e município",
  fichaG[0].r.bi_number === "004567890LA041"
    && fichaG[0].r.job_title === "Consultor de vendas"
    && fichaG[0].r.municipio === "Uíge",
  JSON.stringify({ bi: fichaG[0].r.bi_number, funcao: fichaG[0].r.job_title }));

// 15.10 pesquisa do gestor
const porRef = await asUser(MANAGER, async () =>
  q(`SELECT public.pesquisar_colaboradores('${refS}') AS r`)
);
check("pesquisa por referência encontra o colaborador",
  porRef[0].r.length === 1 && porRef[0].r[0].id === S_UIGE,
  JSON.stringify(porRef[0].r.map((x) => x.referencia)));

// A tabela da pesquisa mostra a fotografia de cada pessoa; o campo tem de vir
// no resultado, senão o gestor vê sempre as iniciais.
check("pesquisa devolve o campo da fotografia",
  "avatar_url" in porRef[0].r[0],
  JSON.stringify(Object.keys(porRef[0].r[0]).filter((k) => k.startsWith("avatar"))));

const porBi = await asUser(MANAGER, async () =>
  q(`SELECT public.pesquisar_colaboradores('004567890LA041') AS r`)
);
check("pesquisa por BI encontra o colaborador",
  porBi[0].r.length === 1 && porBi[0].r[0].id === S_UIGE, String(porBi[0].r.length));

const porNome = await asUser(MANAGER, async () =>
  q(`SELECT public.pesquisar_colaboradores('Colaborador Uíge') AS r`)
);
check("pesquisa por nome encontra o colaborador",
  porNome[0].r.some((x) => x.id === S_UIGE), String(porNome[0].r.length));

const porTelefone = await asUser(MANAGER, async () =>
  q(`SELECT public.pesquisar_colaboradores('923000011') AS r`)
);
check("pesquisa por telefone encontra o colaborador",
  porTelefone[0].r.some((x) => x.id === S_UIGE), String(porTelefone[0].r.length));

const porProvincia = await asUser(MANAGER, async () =>
  q(`SELECT public.pesquisar_colaboradores(NULL, '${UIG}') AS r`)
);
check("filtro por província só devolve colaboradores dessa província",
  porProvincia[0].r.length > 0 && porProvincia[0].r.every((x) => x.provincia_id === UIG),
  String(porProvincia[0].r.length));

await expectError(
  "colaborador não pesquisa a rede de colaboradores",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   SELECT public.pesquisar_colaboradores('INK');`,
  "Apenas a gestão"
);

// 15.11 metas e cumprimento
await asUser(M_UIGE, async () =>
  q(`SELECT public.definir_meta(
       '${S_UIGE}', NULL,
       date_trunc('month', now())::date,
       (date_trunc('month', now()) + interval '1 month - 1 day')::date,
       100000, 5)`)
);
const meta = await asUser(S_UIGE, async () => q(`SELECT public.colaborador_painel() AS r`));
const vendasUige = Number(meta[0].r.cartoes.vendas_valor);
check("meta individual aparece no painel do colaborador",
  Number(meta[0].r.cartoes.meta_valor) === 100000 && meta[0].r.cartoes.meta_origem === "individual",
  JSON.stringify({ meta: meta[0].r.cartoes.meta_valor, origem: meta[0].r.cartoes.meta_origem }));
check("cumprimento da meta é calculado sobre as vendas válidas",
  Number(meta[0].r.cartoes.meta_pct) === Math.round((vendasUige / 100000) * 100 * 100) / 100,
  `${vendasUige} / 100000 = ${meta[0].r.cartoes.meta_pct}%`);

await expectError(
  "gestor de outra província não define metas no Uíge",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${MANAGER}', false);
   UPDATE public.profiles SET provincia_id = '${LDA}' WHERE id = '${MANAGER}';
   SELECT public.definir_meta(NULL, '${UIG}', NULL, NULL, 1, 1);`,
  "província que gere"
);

// 15.12 pagamento de comissões
// Venda confirmada e paga: desde a 0015 só estas é que podem ser pagas.
const vendaPaga = (await q(`
  INSERT INTO public.sales (reference, seller_id, total_amount, provincia_id, payment_status, status)
  VALUES ('TST-COMM-2', '${S_UIGE}', 8000, '${UIG}', 'paid', 'completed') RETURNING id`))[0].id;

// O valor a pagar lê-se da base em vez de ser fixado no teste: desde a
// migração 0008 quem não tem taxa pessoal herda a da empresa, e uma venda
// anterior a este bloco já gerou comissão a essa taxa. A 0015 restringe o
// pagamento a vendas concluídas e pagas — a consulta segue a mesma regra.
const aPagar = await q(`
  SELECT COALESCE(SUM(c.amount), 0) AS total, COUNT(*)::int AS n
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = '${S_UIGE}' AND c.status = 'pending' AND c.amount > 0
    AND s.status = 'completed' AND s.payment_status = 'paid'`);
const valorPendente = Number(aPagar[0].total);

const pag = await asUser(M_UIGE, async () =>
  q(`SELECT public.pagar_comissoes('${S_UIGE}', 'transferencia', 'Fecho do mês') AS r`)
);
check("gestor paga as comissões pendentes",
  Number(pag[0].r.amount) === valorPendente
    && Number(pag[0].r.comissoes) === Number(aPagar[0].n),
  JSON.stringify({ r: pag[0].r, esperado: { total: valorPendente, n: aPagar[0].n } }));

const pendentes = await q(`
  SELECT COUNT(*) AS n FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = '${S_UIGE}' AND c.status = 'pending' AND c.amount > 0
    AND s.status = 'completed' AND s.payment_status = 'paid'`);
check("depois de pagar não fica comissão pendente", Number(pendentes[0].n) === 0, String(pendentes[0].n));

const recibo = await q(`
  SELECT amount FROM public.commission_payouts WHERE seller_id = '${S_UIGE}'`);
check("o pagamento fica registado no histórico",
  Number(recibo[0]?.amount) === valorPendente, JSON.stringify(recibo[0]));

const pagamentoVisivel = await asUser(S_UIGE, async () =>
  q(`SELECT public.colaborador_painel() AS r`)
);
check("o colaborador vê o pagamento no seu histórico",
  pagamentoVisivel[0].r.historico.pagamentos.length === 1
    && Number(pagamentoVisivel[0].r.cartoes.comissao_paga) === valorPendente,
  JSON.stringify(pagamentoVisivel[0].r.cartoes.comissao_paga));

await expectError(
  "colaborador não paga as próprias comissões",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   SELECT public.pagar_comissoes('${S_UIGE}');`,
  "Apenas a gestão"
);

// 15.13 visão geral da rede
await exec(`UPDATE public.profiles SET provincia_id = '${UIG}', is_national_admin = true WHERE id = '${MANAGER}'`);
const ov = await asUser(MANAGER, async () => q(`SELECT public.colaboradores_overview() AS r`));
check("visão geral conta colaboradores activos e inactivos",
  ov[0].r.totais.colaboradores >= 1
    && Number(ov[0].r.totais.colaboradores_ativos) >= 1,
  JSON.stringify(ov[0].r.totais.colaboradores));
check("visão geral separa as províncias",
  ov[0].r.provincias.length === 18
    && ov[0].r.provincias.some((p) => p.codigo === "UIG" && Number(p.vendas_valor) > 0),
  String(ov[0].r.provincias.length));
check("visão geral traz o ranking de colaboradores",
  Array.isArray(ov[0].r.ranking) && ov[0].r.ranking.length >= 1
    && ov[0].r.ranking[0].referencia !== null,
  JSON.stringify(ov[0].r.ranking[0]?.nome));

// 15.14 histórico de alterações
const historico = await q(`
  SELECT COUNT(*) AS n FROM public.audit_logs
  WHERE entity = 'seller_profiles' AND entity_id = '${S_UIGE}'`);
check("alterações de comissão/função ficam no histórico", Number(historico[0].n) >= 1,
  String(historico[0].n));

console.log("\n--- 16. CONTEÚDOS PUBLICADOS E FORMAÇÃO ---");

// 16.1 comunicado publicado pelo gestor
const com = await asUser(MANAGER, async () =>
  q(`INSERT INTO public.content_items (kind, title, body, status)
     VALUES ('comunicado', 'Reunião geral de sexta', 'Todos os colaboradores às 9h.', 'publicado')
     RETURNING id, status, published_at`)
);
check("gestor publica comunicado e o servidor carimba a data",
  com[0].status === "publicado" && com[0].published_at !== null,
  String(com[0].published_at));
const comunicadoId = com[0].id;

// 16.2 o colaborador vê no feed
const feedColab = await asUser(S_UIGE, async () =>
  q(`SELECT public.conteudo_feed('comunicado') AS r`)
);
check("comunicado aparece no feed do colaborador",
  feedColab[0].r.length === 1 && feedColab[0].r[0].title === "Reunião geral de sexta",
  String(feedColab[0].r.length));

// 16.3 o cliente vê o comunicado: é notícia da empresa no feed dele (0013)
const feedCliente = await asUser(C1, async () =>
  q(`SELECT public.conteudo_feed('comunicado') AS r`)
);
check("comunicado chega ao cliente no feed de notícias",
  feedCliente[0].r.length === 1 && feedCliente[0].r[0].title === "Reunião geral de sexta",
  String(feedCliente[0].r.length));

const linhaCliente = await asUser(C1, async () =>
  q(`SELECT count(*)::int n FROM public.content_items WHERE kind = 'comunicado'`)
);
check("cliente lê o comunicado publicado na tabela", Number(linhaCliente[0].n) === 1,
  String(linhaCliente[0].n));

// 16.4 rascunho nunca sai
await asUser(MANAGER, async () =>
  q(`INSERT INTO public.content_items (kind, title, status)
     VALUES ('comunicado', 'Rascunho interno', 'rascunho')`)
);
const feedAinda = await asUser(S_UIGE, async () =>
  q(`SELECT public.conteudo_feed('comunicado') AS r`)
);
check("rascunho não aparece ao colaborador", feedAinda[0].r.length === 1,
  String(feedAinda[0].r.length));

const tudo = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.content_items WHERE kind = 'comunicado'`)
);
check("gestor vê publicados e rascunhos", Number(tudo[0].n) === 2, String(tudo[0].n));

// 16.5 promoção: janela de datas e província
await asUser(MANAGER, async () =>
  q(`INSERT INTO public.content_items (kind, title, status, starts_at, ends_at)
     VALUES ('promocao', 'Promoção nacional válida', 'publicado', now() - interval '1 hour', now() + interval '1 day')`)
);
await asUser(MANAGER, async () =>
  q(`INSERT INTO public.content_items (kind, title, status, starts_at, ends_at)
     VALUES ('promocao', 'Promoção já terminada', 'publicado', now() - interval '3 day', now() - interval '1 day')`)
);
await asUser(MANAGER, async () =>
  q(`INSERT INTO public.content_items (kind, title, status, provincia_id, starts_at, ends_at)
     VALUES ('promocao', 'Promoção só do Uíge', 'publicado', '${UIG}', now() - interval '1 hour', now() + interval '1 day')`)
);

await exec(`SET ROLE anon;`);
const feedAnon = await q(`SELECT public.conteudo_feed('promocao') AS r`);
await exec(`RESET ROLE;`);
check("visitante vê a promoção nacional dentro das datas",
  feedAnon[0].r.length === 1 && feedAnon[0].r[0].title === "Promoção nacional válida",
  JSON.stringify(feedAnon[0].r.map((x) => x.title)));

const feedClientePromo = await asUser(C1, async () =>
  q(`SELECT public.conteudo_feed('promocao') AS r`)
);
check("cliente vê a promoção da sua província e a nacional",
  feedClientePromo[0].r.length >= 2
    && feedClientePromo[0].r.some((x) => x.title === "Promoção nacional válida"),
  JSON.stringify(feedClientePromo[0].r.map((x) => x.title)));

// Quem tem sessão vê também as terminadas (marcadas na interface); o visitante
// sem sessão não as vê de todo.
check("cliente vê a campanha terminada para a reconhecer como encerrada",
  feedClientePromo[0].r.some((x) => x.title === "Promoção já terminada"),
  JSON.stringify(feedClientePromo[0].r.map((x) => x.title)));

check("visitante não vê a campanha terminada",
  feedAnon[0].r.every((x) => x.title !== "Promoção já terminada"),
  JSON.stringify(feedAnon[0].r.map((x) => x.title)));

// 16.6 reação: uma por utilizador
await asUser(S_UIGE, async () =>
  q(`INSERT INTO public.content_reactions (item_id, reaction) VALUES ('${comunicadoId}', 'adoro')`)
);
await expectError(
  "não é possível reagir duas vezes ao mesmo conteúdo",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   INSERT INTO public.content_reactions (item_id, reaction) VALUES ('${comunicadoId}', 'gosto');`,
  "duplicate key"
);

const feedReacao = await asUser(S_UIGE, async () =>
  q(`SELECT public.conteudo_feed('comunicado') AS r`)
);
check("feed devolve contagem e a minha reação",
  Number(feedReacao[0].r[0].reacoes) === 1 && feedReacao[0].r[0].minha_reacao === "adoro",
  JSON.stringify({ n: feedReacao[0].r[0].reacoes, minha: feedReacao[0].r[0].minha_reacao }));

// 16.7 comentários respeitam a permissão do conteúdo
await asUser(S_UIGE, async () =>
  q(`INSERT INTO public.content_comments (item_id, body) VALUES ('${comunicadoId}', 'Vou estar presente.')`)
);
const comentarios = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.content_comments WHERE item_id = '${comunicadoId}'`)
);
check("comentário do colaborador fica registado", Number(comentarios[0].n) === 1,
  String(comentarios[0].n));

await asUser(MANAGER, async () =>
  q(`UPDATE public.content_items SET allow_comments = false WHERE id = '${comunicadoId}'`)
);
await expectError(
  "comentários fechados recusam novos comentários",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   INSERT INTO public.content_comments (item_id, body) VALUES ('${comunicadoId}', 'Mais um.');`,
  "row-level security"
);

// 16.8 um projeto do designer só tem uma publicação
const projetoDesign = await asUser(MANAGER, async () =>
  q(`SELECT public.design_create('Cartaz de teste', 'square', 1080, 1080, '[]'::jsonb, NULL) AS p`)
);
const projetoId = projetoDesign[0].p.id;
await asUser(MANAGER, async () =>
  q(`INSERT INTO public.content_items (kind, title, project_id) VALUES ('comunicado', 'Do projeto', '${projetoId}')`)
);
await expectError(
  "o mesmo projeto não gera duas publicações",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${MANAGER}', false);
   INSERT INTO public.content_items (kind, title, project_id) VALUES ('comunicado', 'Duplicado', '${projetoId}');`,
  "duplicate key"
);

// 16.9 formação: curso, aulas e progresso
const curso = await asUser(MANAGER, async () =>
  q(`INSERT INTO public.training_courses (title, description, status)
     VALUES ('Atendimento de excelência', 'Como receber um cliente INUKA.', 'publicado')
     RETURNING id, published_at`)
);
const cursoId = curso[0].id;
check("curso publicado fica com data", curso[0].published_at !== null, String(curso[0].published_at));

const aulas = await asUser(MANAGER, async () =>
  q(`INSERT INTO public.training_lessons (course_id, title, body, sort_order)
     VALUES ('${cursoId}', 'Aula 1 — A primeira impressão', 'Conteúdo.', 1),
            ('${cursoId}', 'Aula 2 — O fecho', 'Conteúdo.', 2)
     RETURNING id, sort_order`)
);
check("curso tem duas aulas ordenadas", aulas.length === 2 && aulas[0].sort_order === 1,
  String(aulas.length));

const listaCursos = await asUser(S_UIGE, async () =>
  q(`SELECT public.formacao_cursos() AS r`)
);check("colaborador vê o curso publicado",
  listaCursos[0].r.length === 1 && Number(listaCursos[0].r[0].aulas) === 2,
  JSON.stringify(listaCursos[0].r[0]?.title));

// Cada curso ganha um registo de conteúdo — é isso que permite comentar a
// formação sem uma segunda tabela de comentários.
const cursoContent = await q(`SELECT content_id FROM public.training_courses WHERE id = '${cursoId}'`);
check("curso tem registo de conteúdo associado", cursoContent[0].content_id !== null,
  String(cursoContent[0].content_id));

await asUser(S_UIGE, async () =>
  q(`INSERT INTO public.content_comments (item_id, body)
     VALUES ('${cursoContent[0].content_id}', 'Muito útil para o balcão.')`)
);
const comentCurso = await asUser(S_UIGE, async () =>
  q(`SELECT count(*)::int n FROM public.content_comments WHERE item_id = '${cursoContent[0].content_id}'`)
);
check("colaborador comenta a formação", Number(comentCurso[0].n) === 1,
  String(comentCurso[0].n));

await expectError(
  "cliente não comenta a formação",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   INSERT INTO public.content_comments (item_id, body)
   VALUES ('${cursoContent[0].content_id}', 'Intrometido.');`,
  "row-level security"
);

const p1 = await asUser(S_UIGE, async () =>
  q(`SELECT public.formacao_concluir_aula('${aulas[0].id}') AS r`)
);
check("concluir uma aula dá 50%", Number(p1[0].r.percentagem) === 50 && p1[0].r.curso_concluido === false,
  JSON.stringify(p1[0].r));

const p2 = await asUser(S_UIGE, async () =>
  q(`SELECT public.formacao_concluir_aula('${aulas[1].id}') AS r`)
);
check("concluir a última aula fecha o curso",
  Number(p2[0].r.percentagem) === 100 && p2[0].r.curso_concluido === true,
  JSON.stringify(p2[0].r));

const clienteCursos = await asUser(C1, async () =>
  q(`SELECT public.formacao_cursos() AS r`)
);
check("cliente não vê a formação interna", clienteCursos[0].r.length === 0,
  String(clienteCursos[0].r.length));

await expectError(
  "cliente não abre o curso pelo id",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${C1}', false);
   SELECT public.formacao_curso('${cursoId}');`,
  "SEM_PERMISSAO"
);

await expectError(
  "colaborador não lê as estatísticas de formação",
  `SET ROLE authenticated;
   SELECT set_config('request.jwt.claim.sub', '${S_UIGE}', false);
   SELECT public.formacao_estatisticas();`,
  "SEM_PERMISSAO"
);

const stats = await asUser(MANAGER, async () =>
  q(`SELECT public.formacao_estatisticas() AS r`)
);
check("estatísticas contam inscritos e concluídos",
  Number(stats[0].r[0].inscritos) === 1 && Number(stats[0].r[0].concluidos) === 1,
  JSON.stringify({ i: stats[0].r[0].inscritos, c: stats[0].r[0].concluidos }));

// 16.10 duplicar conteúdo nasce como rascunho
const copiaConteudo = await asUser(MANAGER, async () =>
  q(`SELECT public.content_duplicate('${comunicadoId}') AS id`)
);
const copiaLinha = await asUser(MANAGER, async () =>
  q(`SELECT status, published_at, allow_comments FROM public.content_items WHERE id = '${copiaConteudo[0].id}'`)
);
check("cópia de conteúdo nasce em rascunho",
  copiaLinha[0].status === "rascunho" && copiaLinha[0].published_at === null,
  copiaLinha[0].status);


console.log("\n--- 17. TAXA DE COMISSÃO, PEDIDOS E REVENDEDORES ---");

// 17.1 a taxa da empresa é 10% por omissão
const s17Global = await q(`SELECT public.taxa_comissao_global() AS t`);
check("taxa de comissão da empresa começa em 10%",
  Math.abs(Number(s17Global[0].t) - 0.1) < 1e-9, String(s17Global[0].t));

// 17.2 quem não tem taxa pessoal herda a da empresa
await exec(`UPDATE public.seller_profiles SET commission_rate = NULL WHERE id = '${S_UIGE}'`);
const s17Herda = await asUser(S_UIGE, async () => q(`SELECT public.taxa_comissao() AS r`));
check("colaborador sem taxa pessoal herda a da empresa",
  Math.abs(Number(s17Herda[0].r.efetiva) - 0.1) < 1e-9 && s17Herda[0].r.origem === "empresa",
  JSON.stringify(s17Herda[0].r));

const s17Venda1 = (await q(`
  INSERT INTO public.sales (reference, seller_id, total_amount, provincia_id)
  VALUES ('TST-HERDA-1', '${S_UIGE}', 10000, '${UIG}') RETURNING id`))[0].id;
const s17Com1 = await q(`
  SELECT amount, rate FROM public.sale_commissions WHERE sale_id = '${s17Venda1}'`);
check("venda de quem herda a taxa paga 10%",
  Number(s17Com1[0].amount) === 1000, JSON.stringify(s17Com1[0]));

// 17.3 a gestão muda a taxa e a alteração chega ao colaborador
await asUser(MANAGER, async () => q(`SELECT public.definir_taxa_comissao(0.12, false) AS r`));
const s17TaxaNova = await asUser(S_UIGE, async () => q(`SELECT public.taxa_comissao() AS r`));
check("mudar a taxa da empresa chega ao colaborador",
  Math.abs(Number(s17TaxaNova[0].r.efetiva) - 0.12) < 1e-9, JSON.stringify(s17TaxaNova[0].r));

const s17Venda2 = (await q(`
  INSERT INTO public.sales (reference, seller_id, total_amount, provincia_id)
  VALUES ('TST-HERDA-2', '${S_UIGE}', 10000, '${UIG}') RETURNING id`))[0].id;
const s17Com2 = await q(`
  SELECT amount FROM public.sale_commissions WHERE sale_id = '${s17Venda2}'`);
check("a venda seguinte já usa a taxa nova",
  Number(s17Com2[0].amount) === 1200, String(s17Com2[0].amount));

// 17.4 só a gestão muda a taxa
await expectError("cliente não altera a taxa da empresa",
  `SELECT public.definir_taxa_comissao(0.5, false);`, "gestão");

// 17.5 uma taxa pessoal sobrepõe-se à da empresa
await asUser(MANAGER, async () => q(`SELECT public.definir_taxa_colaborador('${S_UIGE}', 0.2) AS r`));
const s17Pessoal = await asUser(S_UIGE, async () => q(`SELECT public.taxa_comissao() AS r`));
check("taxa pessoal sobrepõe-se à da empresa",
  Math.abs(Number(s17Pessoal[0].r.efetiva) - 0.2) < 1e-9 && s17Pessoal[0].r.origem === "pessoal",
  JSON.stringify(s17Pessoal[0].r));

// 17.6 voltar a herdar, e recalcular as comissões por pagar
await asUser(MANAGER, async () => q(`SELECT public.definir_taxa_colaborador('${S_UIGE}', NULL) AS r`));
const s17Volta = await asUser(S_UIGE, async () => q(`SELECT public.taxa_comissao() AS r`));
check("devolver a taxa a NULL volta a herdar a da empresa",
  s17Volta[0].r.origem === "empresa", JSON.stringify(s17Volta[0].r));

const s17Recalc = await asUser(MANAGER, async () =>
  q(`SELECT public.definir_taxa_comissao(0.15, true) AS r`));
const s17Pendentes = await q(`
  SELECT SUM(amount) AS t FROM public.sale_commissions
  WHERE sale_id IN ('${s17Venda1}', '${s17Venda2}') AND status = 'pending'`);
check("recalcular pendentes actualiza as comissões por pagar",
  Number(s17Pendentes[0].t) === 3000, JSON.stringify({ total: s17Pendentes[0].t, r: s17Recalc[0].r }));

// 17.7 o cliente confirma que recebeu
const s17EncEntrega = (await q(`
  INSERT INTO public.orders (reference, customer_id, total_amount, status, provincia_id, delivery_method)
  VALUES ('TST-ENTREGA-1', '${C_UIGE}', 5000, 'in_delivery', '${UIG}', 'delivery')
  RETURNING id`))[0].id;

const s17Confirma = await asUser(C_UIGE, async () =>
  q(`SELECT public.update_order_status('${s17EncEntrega}', 'completed', 'Recebida') AS r`));
const s17Estado = await q(`SELECT status FROM public.orders WHERE id = '${s17EncEntrega}'`);
check("cliente confirma a entrega e a encomenda conclui",
  s17Estado[0].status === "completed" && s17Confirma[0].r.pelo_cliente === true,
  JSON.stringify({ estado: s17Estado[0].status, r: s17Confirma[0].r }));

const s17Hist = await q(`
  SELECT status, previous_status FROM public.order_status_history
  WHERE order_id = '${s17EncEntrega}' ORDER BY created_at DESC LIMIT 1`);
check("a confirmação fica no histórico com o estado anterior",
  s17Hist[0].status === "completed" && s17Hist[0].previous_status === "in_delivery",
  JSON.stringify(s17Hist[0]));

// 17.8 o cliente não conduz a encomenda — só confirma
const s17EncConfirmada = (await q(`
  INSERT INTO public.orders (reference, customer_id, total_amount, status, provincia_id)
  VALUES ('TST-ENTREGA-2', '${C_UIGE}', 3000, 'confirmed', '${UIG}') RETURNING id`))[0].id;

let recusouPreparar = false;
await asUser(C_UIGE, async () => {
  try {
    await q(`SELECT public.update_order_status('${s17EncConfirmada}', 'preparing', NULL)`);
  } catch (e) {
    recusouPreparar = /42501|apenas pode cancelar/i.test(e.message);
  }
});
check("cliente não põe a encomenda em preparação", recusouPreparar);

let recusouCedo = false;
await asUser(C_UIGE, async () => {
  try {
    await q(`SELECT public.update_order_status('${s17EncConfirmada}', 'completed', NULL)`);
  } catch (e) {
    recusouCedo = /42501|Ainda não pode confirmar/i.test(e.message);
  }
});
check("cliente não confirma uma entrega que ainda não saiu", recusouCedo);

// 17.9 candidaturas a revendedor
// Sem RETURNING: o `anon` não tem política de SELECT nesta tabela, e o
// RETURNING passaria por ela. É o mesmo cuidado que o formulário tem — insere
// e não lê nada de volta.
await exec(`SET ROLE anon;`);
await q(`
  INSERT INTO public.reseller_applications (full_name, phone, message)
  VALUES ('Candidato Anónimo', '+244923000099', 'Vendo em Viana')`);
await exec(`RESET ROLE;`);
const s17CandAnon = await q(`SELECT count(*)::int n FROM public.reseller_applications`);
check("visitante pode candidatar-se a revendedor", s17CandAnon[0].n === 1,
  String(s17CandAnon[0].n));

const s17CandLeitura = await asUser(C_UIGE, async () =>
  q(`SELECT count(*)::int n FROM public.reseller_applications`));
check("cliente não lê as candidaturas dos outros", s17CandLeitura[0].n === 0,
  String(s17CandLeitura[0].n));

const s17CandGestor = await asUser(MANAGER, async () =>
  q(`SELECT count(*)::int n FROM public.reseller_applications`));
check("gestão vê as candidaturas", s17CandGestor[0].n === 1, String(s17CandGestor[0].n));

// Um superutilizador ignora RLS, por isso esta tentativa tem de correr como
// `anon` — é o papel de quem preenche o formulário.
let recusouAprovada = false;
await exec(`SET ROLE anon;`);
try {
  await q(`INSERT INTO public.reseller_applications (full_name, phone, status)
           VALUES ('Esperto', '+244923000098', 'aprovado')`);
} catch (e) {
  recusouAprovada = /row-level security|42501/i.test(e.message);
}
await exec(`RESET ROLE;`);
check("candidatura não entra já aprovada", recusouAprovada);

// 17.10 falar com a equipa abre conversa PRIVADA com a gestão
await exec(`DELETE FROM public.seller_customers WHERE customer_id = '${C_UIGE}'`);
await exec(`
  INSERT INTO public.seller_customers (seller_id, customer_id, is_active)
  VALUES ('${S_UIGE}', '${C_UIGE}', true)`);

const s17Conv = await asUser(C_UIGE, async () =>
  q(`SELECT public.abrir_conversa_equipa() AS id`));

const s17Tipo = await q(
  `SELECT type FROM public.conversations WHERE id = '${s17Conv[0].id}'`);
check("falar com a equipa abre conversa directa", s17Tipo[0].type === "direct",
  String(s17Tipo[0].type));

const s17Membros = await q(`
  SELECT user_id FROM public.conversation_members
  WHERE conversation_id = '${s17Conv[0].id}'`);
check("a conversa é só do cliente com o gestor", s17Membros.length === 2,
  `${s17Membros.length} membros`);

const s17TemColab = s17Membros.some((m) => m.user_id === S_UIGE);
check("o colaborador do cliente não entra na conversa", !s17TemColab);

// O outro lado tem de ser gestão — e da mesma província, quando existe.
const s17Outro = s17Membros.find((m) => m.user_id !== C_UIGE);
const s17OutroPerfil = await q(
  `SELECT role, provincia_id FROM public.profiles WHERE id = '${s17Outro.user_id}'`);
check("o outro lado da conversa é a gestão",
  s17OutroPerfil[0].role === "manager", JSON.stringify(s17OutroPerfil[0]));

const s17ProvCliente = await q(
  `SELECT provincia_id FROM public.profiles WHERE id = '${C_UIGE}'`);
check("a gestão escolhida é da província do cliente",
  s17OutroPerfil[0].provincia_id === s17ProvCliente[0].provincia_id);

const s17Conv2 = await asUser(C_UIGE, async () =>
  q(`SELECT public.abrir_conversa_equipa() AS id`));
check("abrir a conversa duas vezes não cria uma segunda",
  s17Conv2[0].id === s17Conv[0].id, `${s17Conv[0].id} / ${s17Conv2[0].id}`);

// 17.11 grupos são só da equipa
let grupoComClienteRecusado = false;
try {
  await asUser(M_UIGE, async () =>
    q(`SELECT public.criar_grupo_equipa('Com clientes', ARRAY['${C_UIGE}']::uuid[])`));
} catch (e) {
  grupoComClienteRecusado = /só para membros da empresa/i.test(e.message);
}
check("a gestão não põe um cliente num grupo", grupoComClienteRecusado);

const s17Grupo = await asUser(M_UIGE, async () =>
  q(`SELECT public.criar_grupo_equipa('Equipa Uíge', ARRAY['${S_UIGE}']::uuid[]) AS id`));
const s17GrupoMembros = await q(`
  SELECT user_id FROM public.conversation_members
  WHERE conversation_id = '${s17Grupo[0].id}'`);
check("a gestão cria grupo só com colaboradores", s17GrupoMembros.length === 2,
  `${s17GrupoMembros.length} membros`);

const s17GrupoTipo = await q(
  `SELECT type, title FROM public.conversations WHERE id = '${s17Grupo[0].id}'`);
check("o grupo fica marcado como grupo",
  s17GrupoTipo[0].type === "group" && s17GrupoTipo[0].title === "Equipa Uíge",
  JSON.stringify(s17GrupoTipo[0]));

let colabNaoCriaGrupo = false;
try {
  await asUser(S_UIGE, async () =>
    q(`SELECT public.criar_grupo_equipa('Do colaborador', '{}'::uuid[])`));
} catch (e) {
  colabNaoCriaGrupo = /só a gestão cria grupos/i.test(e.message);
}
check("o colaborador não cria grupos", colabNaoCriaGrupo);

let clienteNaoEntraNoGrupo = false;
try {
  await asUser(M_UIGE, async () =>
    q(`SELECT public.adicionar_membro_grupo('${s17Grupo[0].id}', '${C_UIGE}')`));
} catch (e) {
  clienteNaoEntraNoGrupo = /só para membros da empresa/i.test(e.message);
}
check("a gestão não acrescenta um cliente ao grupo", clienteNaoEntraNoGrupo);

// O gatilho é a última barreira: mesmo um INSERT directo é recusado.
let gatilhoRecusa = false;
try {
  await exec(`
    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES ('${s17Grupo[0].id}', '${C_UIGE}')`);
} catch (e) {
  gatilhoRecusa = /só para membros da empresa/i.test(e.message);
}
check("o gatilho recusa um cliente num grupo", gatilhoRecusa);

await asUser(M_UIGE, async () =>
  q(`SELECT public.remover_membro_grupo('${s17Grupo[0].id}', '${S_UIGE}')`));
const s17DepoisRemover = await q(`
  SELECT user_id FROM public.conversation_members
  WHERE conversation_id = '${s17Grupo[0].id}'`);
check("a gestão remove um membro do grupo", s17DepoisRemover.length === 1,
  `${s17DepoisRemover.length} membros`);

// 17.12 disponibilidade pública (migração 0012)
// A montra é servida a visitantes sem conta; o inventário só é legível com
// sessão. Sem esta função, «Esgotado» nunca aparecia a quem não tem conta.
const pStock = (await q(`
  INSERT INTO public.products (name, official_price)
  VALUES ('[TESTE] Stock público', 1000) RETURNING id`))[0].id;
const pSemStock = (await q(`
  INSERT INTO public.products (name, official_price)
  VALUES ('[TESTE] Sem inventário', 1000) RETURNING id`))[0].id;
await q(`
  INSERT INTO public.inventory (product_id, quantity, reserved_quantity)
  VALUES ('${pStock}', 5, 2)`);

// `anon` é o papel de quem chega ao site sem sessão.
async function comoAnon(fn) {
  await exec(`SET ROLE anon;`);
  try {
    return await fn();
  } finally {
    await exec(`RESET ROLE;`);
  }
}

const stockPub = await comoAnon(async () =>
  q(`SELECT product_id, disponivel FROM public.stock_produtos(
       ARRAY['${pStock}','${pSemStock}']::uuid[])`));

const linhaStock = stockPub.find((l) => l.product_id === pStock);
check("visitante vê as unidades disponíveis",
  Number(linhaStock?.disponivel) === 3, JSON.stringify(linhaStock));

const linhaVazia = stockPub.find((l) => l.product_id === pSemStock);
check("produto sem inventário devolve NULL (não zero)",
  linhaVazia?.disponivel === null, JSON.stringify(linhaVazia));

// Esgotado é zero, e zero tem de chegar como zero — não como «sem controlo».
await q(`UPDATE public.inventory SET quantity = 2 WHERE product_id = '${pStock}'`);
const esgotadoPub = await comoAnon(async () =>
  q(`SELECT disponivel FROM public.stock_produtos(ARRAY['${pStock}']::uuid[])`));
check("stock todo reservado aparece como zero",
  Number(esgotadoPub[0].disponivel) === 0, JSON.stringify(esgotadoPub[0]));

// O chamador manda a lista de ids da página; uma página vazia não pode dar erro.
const vazio = await comoAnon(async () =>
  q(`SELECT disponivel FROM public.stock_produtos('{}'::uuid[])`));
check("lista vazia devolve zero linhas", vazio.length === 0, `${vazio.length} linhas`);

// A função é estreita: devolve o número, não a tabela do inventário. A RLS
// não levanta erro — filtra as linhas —, por isso o que se verifica é que o
// visitante não vê nenhuma.
const anonVeInventario = await comoAnon(async () =>
  q(`SELECT * FROM public.inventory`));
check("o visitante continua sem ler a tabela de inventário",
  anonVeInventario.length === 0, `${anonVeInventario.length} linhas`);

console.log("\n--- 18. RESERVA DE CLIENTES (SEM CRIAR CONTAS) ---");

// 18.1 reservar não toca em auth.users
const telReserva = "+244927000001";
const reserva = (await q(`
  INSERT INTO public.reserved_customers (seller_id, created_by, full_name, phone, neighborhood, provincia_id)
  VALUES ('${S_UIGE}', '${S_UIGE}', 'Stelvio Teste', '${telReserva}', 'Kilomosso', '${UIG}')
  RETURNING id, status`))[0];

check("reserva fica por activar", reserva.status === "reservado", JSON.stringify(reserva));

const semConta = await q(`SELECT count(*)::int n FROM public.profiles WHERE phone = '${telReserva}'`);
check("reservar NÃO cria conta", semConta[0].n === 0, `${semConta[0].n} perfis`);

// 18.2 venda a um telefone sem conta
const pRes = (await q(`
  INSERT INTO public.products (sku, name, official_price, is_active, provincia_id)
  VALUES ('INK-RES','Óleo de reserva', 5000, true, '${UIG}') RETURNING id`))[0].id;
await exec(`INSERT INTO public.inventory (product_id, provincia_id, quantity)
  VALUES ('${pRes}', '${UIG}', 10)`);

const telVenda = "+244927000002";
const vendaTelefone = await asUser(S_UIGE, async () =>
  q(`SELECT public.register_sale_by_phone('[{"product_id":"${pRes}","quantity":2}]'::jsonb,
      '${telVenda}', 'cash', 'paid', 'Venda sem conta', 'venda-tel-001') AS r`));
const rTelefone = vendaTelefone[0].r;

check("venda registada para telefone sem conta",
  Number(rTelefone.total) === 10000 && rTelefone.customer_phone === telVenda,
  JSON.stringify(rTelefone));

const linhaVenda = await q(`
  SELECT customer_id, customer_phone FROM public.sales WHERE id = '${rTelefone.sale_id}'`);
check("a venda fica sem dono mas com o telefone",
  linhaVenda[0].customer_id === null && linhaVenda[0].customer_phone === telVenda,
  JSON.stringify(linhaVenda[0]));

const reservaAuto = await q(`
  SELECT seller_id, status FROM public.reserved_customers WHERE phone = '${telVenda}'`);
check("vender a um desconhecido reserva-o para o colaborador",
  reservaAuto.length === 1 && reservaAuto[0].seller_id === S_UIGE,
  JSON.stringify(reservaAuto));

// 18.3 a mesma venda, mas a um número que já tem conta
//     A venda é o cadastro: o cliente entra na carteira sem passo nenhum.
const telefoneComConta = (await q(`
  SELECT phone FROM public.profiles WHERE id = '${C_UIGE}'`))[0].phone;
const vendaComConta = (await asUser(S_UIGE, async () =>
  q(`SELECT public.register_sale_by_phone(
      '[{"product_id":"${pRes}","quantity":1}]'::jsonb, '${telefoneComConta}', 'cash', 'paid', NULL, 'venda-tel-002') AS r`)))[0].r;

check("venda a um número com conta é aceite e marca o cliente como conquistado",
  vendaComConta.conquistado === true && vendaComConta.customer_id === C_UIGE,
  JSON.stringify(vendaComConta));

const vendaComDono = await q(`
  SELECT customer_id, customer_phone FROM public.sales WHERE id = '${vendaComConta.sale_id}'`);
check("a venda fica com o dono e com o telefone",
  vendaComDono[0].customer_id === C_UIGE && vendaComDono[0].customer_phone === telefoneComConta,
  JSON.stringify(vendaComDono[0]));

const carteiraConta = await q(`
  SELECT seller_id FROM public.seller_customers
  WHERE customer_id = '${C_UIGE}' AND is_active = true`);
check("o cliente entra sozinho na carteira de quem vendeu",
  carteiraConta.length === 1 && carteiraConta[0].seller_id === S_UIGE,
  JSON.stringify(carteiraConta));

// 18.3.1 um cliente já conquistado por outro colaborador não se rouba
const donoDeOutro = (await asUser(M_UIGE, async () =>
  q(`SELECT public.garantir_cliente_na_carteira('${C_UIGE}', '${M_UIGE}') AS r`)))[0].r;
check("um cliente só pertence a um colaborador",
  donoDeOutro.ok === false && donoDeOutro.reason === "outro_colaborador" &&
    donoDeOutro.dono === S_UIGE,
  JSON.stringify(donoDeOutro));

// 18.3.2 a mesma regra usada pela carteira não duplica nem reescreve
const carteiraOutraVez = (await asUser(S_UIGE, async () =>
  q(`SELECT public.garantir_cliente_na_carteira('${C_UIGE}') AS r`)))[0].r;
const vinculosConta = await q(`
  SELECT count(*)::int n FROM public.seller_customers WHERE customer_id = '${C_UIGE}'`);
check("voltar a garantir o mesmo cliente não cria um segundo vínculo",
  carteiraOutraVez.ok === true && carteiraOutraVez.novo === false && vinculosConta[0].n === 1,
  JSON.stringify(carteiraOutraVez));

// `novo` tem de distinguir o primeiro vínculo de um reencontro: é o que a
// interface usa para dizer «entrou nos seus clientes» só quando é verdade.
const primeiraVez = (await asUser(S_UIGE, async () =>
  q(`SELECT public.garantir_cliente_na_carteira('${C_LDA}') AS r`)))[0].r;
check("um cliente que ainda não era do colaborador vem marcado como novo",
  primeiraVez.ok === true && primeiraVez.novo === true,
  JSON.stringify(primeiraVez));

// 18.3.3 o nome escrito no formulário fica na reserva, na mesma chamada
const telComNome = "+244927000009";
const vendaComNome = (await asUser(S_UIGE, async () =>
  q(`SELECT public.register_sale_by_phone('[{"product_id":"${pRes}","quantity":1}]'::jsonb,
      '${telComNome}', 'cash', 'paid', NULL, 'venda-tel-004', 'Joana Kiala') AS r`)))[0].r;
const reservaComNome = await q(`
  SELECT full_name, status FROM public.reserved_customers WHERE phone = '${telComNome}'`);
check("a reserva nasce já com o nome escrito na venda",
  vendaComNome.reservado === true &&
    reservaComNome[0]?.full_name === "Joana Kiala" &&
    reservaComNome[0].status === "reservado",
  JSON.stringify(reservaComNome));

// 18.4 uma compra feita antes do registo
const vendaReserva = (await asUser(S_UIGE, async () =>
  q(`SELECT public.register_sale_by_phone('[{"product_id":"${pRes}","quantity":1}]'::jsonb,
      '${telReserva}', 'cash', 'paid', 'Compra antes do registo', 'venda-tel-003') AS r`)))[0].r;

// 18.5 o cliente regista-se com o número reservado
const novoCliente = (await q(`
  INSERT INTO auth.users (email, phone, raw_user_meta_data)
  VALUES ('u244927000001@inuka.ao', '${telReserva}',
          '{"full_name":"Stelvio Registado","phone":"${telReserva}"}'::jsonb)
  RETURNING id`))[0].id;

const perfilNovo = await q(`
  SELECT phone, role FROM public.profiles WHERE id = '${novoCliente}'`);
check("o registo cria o perfil do próprio",
  perfilNovo[0]?.phone === telReserva && perfilNovo[0].role === "customer",
  JSON.stringify(perfilNovo));

const ligacao = (await q(`
  SELECT public.ligar_reserva_ao_cliente('${novoCliente}') AS r`))[0].r;
check("a reserva é ligada no registo",
  ligacao.reservas_ligadas === 1 && ligacao.vendas_atribuidas === 1,
  JSON.stringify(ligacao));

const carteiraNova = await q(`
  SELECT seller_id FROM public.seller_customers
  WHERE customer_id = '${novoCliente}' AND is_active = true`);
check("o cliente entra na carteira de quem reservou",
  carteiraNova.length === 1 && carteiraNova[0].seller_id === S_UIGE,
  JSON.stringify(carteiraNova));

const estadoReserva = await q(`
  SELECT status, customer_id FROM public.reserved_customers WHERE id = '${reserva.id}'`);
check("a reserva fica fechada como ligada",
  estadoReserva[0].status === "ligado" && estadoReserva[0].customer_id === novoCliente,
  JSON.stringify(estadoReserva[0]));

const vendaHerdada = await q(`
  SELECT customer_id FROM public.sales WHERE id = '${vendaReserva.sale_id}'`);
check("a compra feita antes do registo passa a ser do cliente",
  vendaHerdada[0].customer_id === novoCliente, JSON.stringify(vendaHerdada[0]));

// 18.6 o cliente vê o que comprou, com quem vendeu
const comprasProprias = (await asUser(novoCliente, async () =>
  q(`SELECT public.minhas_compras() AS r`)))[0].r;
const compraHerdada = comprasProprias.find((c) => c.id === vendaReserva.sale_id);
check("o cliente vê a compra herdada com produto, quantidade e preço",
  compraHerdada &&
    compraHerdada.items.length === 1 &&
    compraHerdada.items[0].quantity === 1 &&
    Number(compraHerdada.items[0].unit_price) === 5000 &&
    compraHerdada.seller_name === "Colaborador Uíge",
  JSON.stringify(compraHerdada?.items));

const comprasAlheias = (await asUser(C_UIGE, async () =>
  q(`SELECT public.minhas_compras() AS r`)))[0].r;
check("cada cliente só vê as compras dele",
  !comprasAlheias.some((c) => c.id === vendaReserva.sale_id),
  `${comprasAlheias.length} compras`);

// 18.7 correr a ligação outra vez não duplica nada
const ligacaoRepetida = (await q(`
  SELECT public.ligar_reserva_ao_cliente('${novoCliente}') AS r`))[0].r;
const vinculosDepois = await q(`
  SELECT count(*)::int n FROM public.seller_customers WHERE customer_id = '${novoCliente}'`);
check("ligar duas vezes não duplica o vínculo",
  ligacaoRepetida.reservas_ligadas === 0 && vinculosDepois[0].n === 1,
  JSON.stringify({ r: ligacaoRepetida, vinculos: vinculosDepois[0].n }));

// 18.8 cliente que já pertence a outro colaborador
const telConflito = "+244927000003";
const clienteConflito = (await q(`
  INSERT INTO auth.users (email, phone, raw_user_meta_data)
  VALUES ('u244927000003@inuka.ao', '${telConflito}',
          '{"full_name":"Conflito Teste","phone":"${telConflito}"}'::jsonb)
  RETURNING id`))[0].id;
await q(`INSERT INTO public.seller_customers (seller_id, customer_id, is_active)
  VALUES ('${SELLER}', '${clienteConflito}', true)`);
await q(`INSERT INTO public.reserved_customers (seller_id, full_name, phone)
  VALUES ('${S_UIGE}', 'Conflito Teste', '${telConflito}')`);

const ligacaoConflito = (await q(`
  SELECT public.ligar_reserva_ao_cliente('${clienteConflito}') AS r`))[0].r;
const estadoConflito = await q(`
  SELECT status FROM public.reserved_customers WHERE phone = '${telConflito}'`);
check("cliente já noutra carteira fecha a reserva como conflito",
  ligacaoConflito.reservas_em_conflito === 1 && estadoConflito[0].status === "conflito",
  JSON.stringify({ r: ligacaoConflito, estado: estadoConflito[0] }));

// 18.9 ninguém liga reservas de outra pessoa
const tentativaAlheia = await asUser(C_UIGE, async () => {
  try {
    await q(`SELECT public.ligar_reserva_ao_cliente('${novoCliente}')`);
    return null;
  } catch (e) {
    return e.message;
  }
});
check("um cliente não liga reservas de outra conta",
  /Sem permissão/i.test(tentativaAlheia ?? ""), tentativaAlheia ?? "não deu erro");

// 18.10 a reserva é privada de quem a fez
const reservasDoDono = await asUser(S_UIGE, async () =>
  q(`SELECT count(*)::int n FROM public.reserved_customers WHERE phone = '${telVenda}'`));
check("o colaborador vê as suas reservas",
  reservasDoDono[0].n === 1, `${reservasDoDono[0].n} linhas`);

const reservasDeOutro = await asUser(SELLER, async () =>
  q(`SELECT count(*)::int n FROM public.reserved_customers WHERE phone = '${telVenda}'`));
check("outro colaborador não vê a reserva alheia",
  reservasDeOutro[0].n === 0, `${reservasDeOutro[0].n} linhas`);


console.log("\n--- 19. PERFIS: VENDEDOR DE LOJA, ELIMINAÇÃO E FEED ---");

// 19.1 conta de vendedor de loja
const LOJA = "bbbb1111-1111-4111-8111-111111111111";
await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('${LOJA}', 'loja@inuka.ao', '{"full_name":"Vendedor de Loja","phone":"923000777"}');
  UPDATE public.profiles
  SET role = 'store_seller', provincia_id = '${UIG}'
  WHERE id = '${LOJA}';
`);

const papeisLoja = await asUser(LOJA, async () =>
  q(`SELECT public.is_store_seller() AS loja,
            public.can_manage_stock() AS stock,
            public.can_sell_at_store() AS balcao,
            public.is_seller() AS comissao,
            public.is_manager() AS gestao`));
check("vendedor de loja tem stock e balcão, não é colaborador de comissão",
  papeisLoja[0].loja && papeisLoja[0].stock && papeisLoja[0].balcao
  && !papeisLoja[0].comissao && !papeisLoja[0].gestao,
  JSON.stringify(papeisLoja[0]));

// 19.2 produto próprio para a loja
const prodLoja = await q(`
  INSERT INTO public.products (name, sku, official_price, promotional_price, provincia_id)
  VALUES ('Perfume da Loja', 'LOJA-13', 10000, 8000, '${UIG}')
  RETURNING id`);
const ID_LOJA = prodLoja[0].id;

const stockLoja = await asUser(LOJA, async () =>
  q(`SELECT public.set_product_stock('${ID_LOJA}', 10, 'Carga inicial') AS r`));
check("vendedor de loja carrega stock na sua província",
  Number(stockLoja[0].r.quantity) === 10, JSON.stringify(stockLoja[0].r));

const stockFora = await asUser(LOJA, async () => {
  try {
    await q(`SELECT public.set_product_stock('${ID_LOJA}', 5, 'Fora', '${LDA}')`);
    return null;
  } catch (e) { return e.message; }
});
check("vendedor de loja não mexe no stock de outra província",
  /sua província/i.test(stockFora ?? ""), stockFora ?? "não deu erro");

const stockCliente = await asUser(C1, async () => {
  try {
    await q(`SELECT public.set_product_stock('${ID_LOJA}', 99)`);
    return null;
  } catch (e) { return e.message; }
});
check("cliente não altera stock", /Apenas a loja/i.test(stockCliente ?? ""),
  stockCliente ?? "não deu erro");

// 19.3 venda ao balcão: preço vem da base, stock sai na hora
const vendaLoja = await asUser(LOJA, async () =>
  q(`SELECT public.registar_venda_loja(
       '[{"product_id":"${ID_LOJA}","quantity":2,"unit_price":1}]'::jsonb,
       'dinheiro', NULL, 'Venda de teste', 'loja-ref-1') AS r`));
check("venda ao balcão usa o preço promocional da base (2 × 8 000)",
  Number(vendaLoja[0].r.total) === 16000, JSON.stringify(vendaLoja[0].r));

const stockDepois = await asUser(LOJA, async () =>
  q(`SELECT quantity FROM public.inventory
     WHERE product_id = '${ID_LOJA}' AND provincia_id = '${UIG}'`));
check("venda ao balcão desconta o stock", Number(stockDepois[0].quantity) === 8,
  String(stockDepois[0].quantity));

const itemVenda = await asUser(LOJA, async () =>
  q(`SELECT product_snapshot, unit_price FROM public.sale_items
     WHERE product_id = '${ID_LOJA}'`));
check("item da venda guarda o nome do produto",
  itemVenda[0]?.product_snapshot?.name === "Perfume da Loja",
  JSON.stringify(itemVenda[0]?.product_snapshot));
check("item da venda guarda o preço da base, não o do browser",
  Number(itemVenda[0]?.unit_price) === 8000, String(itemVenda[0]?.unit_price));

const comissaoLoja = await q(`
  SELECT amount FROM public.sale_commissions
  WHERE sale_id = '${vendaLoja[0].r.sale_id}'`);
check("venda ao balcão não gera comissão", Number(comissaoLoja[0]?.amount ?? 0) === 0,
  JSON.stringify(comissaoLoja));

const duplicada = await asUser(LOJA, async () =>
  q(`SELECT public.registar_venda_loja(
       '[{"product_id":"${ID_LOJA}","quantity":1}]'::jsonb,
       'dinheiro', NULL, NULL, 'loja-ref-1') AS r`));
check("repetir a mesma venda não cobra duas vezes",
  duplicada[0].r.duplicated === true && duplicada[0].r.sale_id === vendaLoja[0].r.sale_id,
  JSON.stringify(duplicada[0].r));

const semStock = await asUser(LOJA, async () => {
  try {
    await q(`SELECT public.registar_venda_loja(
      '[{"product_id":"${ID_LOJA}","quantity":99}]'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("venda acima do stock é recusada com o nome do produto",
  /Stock insuficiente/i.test(semStock ?? "") && /Perfume da Loja/.test(semStock ?? ""),
  semStock ?? "não deu erro");

const vendaCliente = await asUser(C1, async () => {
  try {
    await q(`SELECT public.registar_venda_loja(
      '[{"product_id":"${ID_LOJA}","quantity":1}]'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("cliente não vende ao balcão", /Apenas a loja/i.test(vendaCliente ?? ""),
  vendaCliente ?? "não deu erro");

// 19.4 o colaborador de comissão continua a registar as vendas dele
const vendaColab = await asUser(SELLER, async () => {
  try {
    await q(`SELECT public.registar_venda_loja(
      '[{"product_id":"${ID_LOJA}","quantity":1}]'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("colaborador de comissão não usa o balcão da loja",
  /Apenas a loja/i.test(vendaColab ?? ""), vendaColab ?? "não deu erro");

// 19.5 eliminar produto com histórico
const encomendaLoja = await q(`
  INSERT INTO public.orders (reference, customer_id, total_amount)
  VALUES ('ENC-LOJA-13', '${C1}', 10000) RETURNING id`);
await exec(`
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
  VALUES ('${encomendaLoja[0].id}', '${ID_LOJA}', 1, 10000, 10000);
`);

const impacto = await asUser(MANAGER, async () =>
  q(`SELECT public.impacto_eliminar_produto('${ID_LOJA}') AS r`));
check("o impacto mostra a encomenda e a venda antes de eliminar",
  Number(impacto[0].r.order_items) === 1 && Number(impacto[0].r.sale_items) === 1,
  JSON.stringify(impacto[0].r));

const lojaElimina = await asUser(LOJA, async () => {
  try {
    await q(`SELECT public.eliminar_produto('${ID_LOJA}')`);
    return null;
  } catch (e) { return e.message; }
});
check("vendedor de loja não elimina produtos", /Apenas a gerência/i.test(lojaElimina ?? ""),
  lojaElimina ?? "não deu erro");

const eliminado = await asUser(MANAGER, async () =>
  q(`SELECT public.eliminar_produto('${ID_LOJA}') AS r`));
check("a gestão elimina um produto que já está numa encomenda",
  eliminado[0].r.name === "Perfume da Loja", JSON.stringify(eliminado[0].r));

const produtoSumiu = await q(`SELECT count(*)::int n FROM public.products WHERE id = '${ID_LOJA}'`);
check("o produto desapareceu do catálogo", produtoSumiu[0].n === 0, String(produtoSumiu[0].n));

const itemPreservado = await q(`
  SELECT product_id, product_name FROM public.order_items
  WHERE order_id = '${encomendaLoja[0].id}'`);
check("a encomenda fica sem produto mas mantém o nome",
  itemPreservado[0].product_id === null && itemPreservado[0].product_name === "Perfume da Loja",
  JSON.stringify(itemPreservado[0]));

const vendaPreservada = await q(`
  SELECT product_id, product_snapshot FROM public.sale_items
  WHERE sale_id = '${vendaLoja[0].r.sale_id}'`);
check("a venda fica sem produto mas mantém o instantâneo",
  vendaPreservada[0].product_id === null
  && vendaPreservada[0].product_snapshot?.name === "Perfume da Loja",
  JSON.stringify(vendaPreservada[0]));

// 19.5b eliminação forçada — para produtos fictícios, o histórico sai com ele
const ficticio = await q(`
  INSERT INTO public.products (name, sku, official_price, is_active)
  VALUES ('[TESTE] Fictício', 'FICT-14', 5000, true) RETURNING id`);
const ID_FICT = ficticio[0].id;

const real = await q(`
  INSERT INTO public.products (name, sku, official_price, is_active)
  VALUES ('[TESTE] Real', 'REAL-14', 7000, true) RETURNING id`);
const ID_REAL = real[0].id;

// (a) uma encomenda só com o produto fictício — desaparece por inteiro
const encSoFict = await q(`
  INSERT INTO public.orders (reference, customer_id, total_amount)
  VALUES ('ENC-FICT-14', '${C1}', 5000) RETURNING id`);
await exec(`
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
  VALUES ('${encSoFict[0].id}', '${ID_FICT}', 1, 5000, 5000);
`);

// (b) uma encomenda mista — sobrevive, mas o total é recalculado
const encMista = await q(`
  INSERT INTO public.orders (reference, customer_id, total_amount)
  VALUES ('ENC-MISTA-14', '${C1}', 12000) RETURNING id`);
await exec(`
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
  VALUES ('${encMista[0].id}', '${ID_FICT}', 1, 5000, 5000),
         ('${encMista[0].id}', '${ID_REAL}', 1, 7000, 7000);
`);

// (c) uma venda só com o fictício e (d) uma reserva só com o fictício
const vendaFict = await q(`
  INSERT INTO public.sales (reference, seller_id, total_amount, payment_status)
  VALUES ('VEN-FICT-14', '${LOJA}', 5000, 'paid') RETURNING id`);
await exec(`
  INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total_price)
  VALUES ('${vendaFict[0].id}', '${ID_FICT}', 1, 5000, 5000);
`);
const reservaFict = await q(`
  INSERT INTO public.reservations (customer_id, status)
  VALUES ('${C1}', 'active') RETURNING id`);
await exec(`
  INSERT INTO public.reservation_items (reservation_id, product_id, quantity, unit_price)
  VALUES ('${reservaFict[0].id}', '${ID_FICT}', 1, 5000);
`);

const impactoForcado = await asUser(MANAGER, async () =>
  q(`SELECT public.impacto_eliminar_produto('${ID_FICT}') AS r`));
check("o impacto diz quantos registos ficariam vazios",
  Number(impactoForcado[0].r.orders_emptied) === 1
  && Number(impactoForcado[0].r.sales_emptied) === 1
  && Number(impactoForcado[0].r.reservations_emptied) === 1,
  JSON.stringify(impactoForcado[0].r));

const forcado = await asUser(MANAGER, async () =>
  q(`SELECT public.eliminar_produto('${ID_FICT}', true) AS r`));
check("a eliminação forçada apaga o produto e o histórico",
  forcado[0].r.forcado === true
  && Number(forcado[0].r.apagados.encomendas) === 1
  && Number(forcado[0].r.apagados.vendas) === 1
  && Number(forcado[0].r.apagados.reservas) === 1,
  JSON.stringify(forcado[0].r.apagados));

const linhasFict = await q(`
  SELECT
    (SELECT count(*)::int FROM public.order_items      WHERE product_id = '${ID_FICT}') AS encomendas,
    (SELECT count(*)::int FROM public.sale_items       WHERE product_id = '${ID_FICT}') AS vendas,
    (SELECT count(*)::int FROM public.reservation_items WHERE product_id = '${ID_FICT}') AS reservas`);
check("nenhuma linha do produto fictício ficou no histórico",
  linhasFict[0].encomendas === 0 && linhasFict[0].vendas === 0 && linhasFict[0].reservas === 0,
  JSON.stringify(linhasFict[0]));

const encApagada = await q(`
  SELECT count(*)::int n FROM public.orders WHERE id = '${encSoFict[0].id}'`);
check("a encomenda que só tinha o fictício foi apagada", encApagada[0].n === 0,
  String(encApagada[0].n));

const encMistaDepois = await q(`
  SELECT o.total_amount, count(oi.id)::int AS itens
  FROM public.orders o
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.id = '${encMista[0].id}'
  GROUP BY o.total_amount`);
check("a encomenda mista sobrevive com o total recalculado",
  encMistaDepois[0]?.itens === 1 && Number(encMistaDepois[0]?.total_amount) === 7000,
  JSON.stringify(encMistaDepois[0]));

const vendaApagada = await q(`
  SELECT count(*)::int n FROM public.sales WHERE id = '${vendaFict[0].id}'`);
check("a venda que só tinha o fictício foi apagada", vendaApagada[0].n === 0,
  String(vendaApagada[0].n));

const reservaApagada = await q(`
  SELECT count(*)::int n FROM public.reservations WHERE id = '${reservaFict[0].id}'`);
check("a reserva que só tinha o fictício foi apagada", reservaApagada[0].n === 0,
  String(reservaApagada[0].n));

// O produto real da encomenda mista continua no sítio.
const realIntacto = await q(`
  SELECT count(*)::int n FROM public.products WHERE id = '${ID_REAL}'`);
check("o outro produto da encomenda mista não foi tocado", realIntacto[0].n === 1,
  String(realIntacto[0].n));

// 19.5c o modo normal continua a existir (forçar é opt-in)
const ficticio2 = await q(`
  INSERT INTO public.products (name, sku, official_price, is_active)
  VALUES ('[TESTE] Fictício 2', 'FICT-15', 3000, true) RETURNING id`);
const enc2 = await q(`
  INSERT INTO public.orders (reference, customer_id, total_amount)
  VALUES ('ENC-FICT-15', '${C1}', 3000) RETURNING id`);
await exec(`
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
  VALUES ('${enc2[0].id}', '${ficticio2[0].id}', 1, 3000, 3000);
`);
const semForcar = await asUser(MANAGER, async () =>
  q(`SELECT public.eliminar_produto('${ficticio2[0].id}') AS r`));
const enc2Depois = await q(`
  SELECT product_id, product_name FROM public.order_items WHERE order_id = '${enc2[0].id}'`);
check("sem forçar, a encomenda fica com o nome do produto",
  semForcar[0].r.forcado === false
  && enc2Depois[0]?.product_id === null
  && enc2Depois[0]?.product_name === "[TESTE] Fictício 2",
  JSON.stringify(enc2Depois[0]));

// 19.6 feed: formação continua fora do feed do cliente
await exec(`
  INSERT INTO public.content_items (kind, title, status, published_at)
  VALUES ('formacao', 'Aula interna', 'publicado', now());
`);
const feedFormacao = await asUser(C1, async () =>
  q(`SELECT public.conteudo_feed('formacao') AS r`));
check("formação continua fora do feed do cliente",
  feedFormacao[0].r.length === 0, String(feedFormacao[0].r.length));

const feedGeral = await asUser(C1, async () =>
  q(`SELECT public.conteudo_feed(NULL, 30) AS r`));
check("o feed do cliente traz comunicados e testemunhos",
  feedGeral[0].r.some((c) => c.kind === "comunicado"),
  feedGeral[0].r.map((c) => c.kind).join(","));

// 19.7 o cliente reage ao comunicado que agora vê
const reacao = await asUser(C1, async () => {
  try {
    await q(`INSERT INTO public.content_reactions (item_id, user_id, reaction)
             SELECT id, '${C1}', 'gosto' FROM public.content_items
             WHERE kind = 'comunicado' AND status = 'publicado' LIMIT 1`);
    return null;
  } catch (e) { return e.message; }
});
check("cliente reage ao comunicado", reacao === null, reacao ?? "");


// 19.8 a loja prepara encomendas da sua província — e só dessas
const prodLoja2 = await q(`
  INSERT INTO public.products (name, sku, official_price, provincia_id)
  VALUES ('Sabonete da Loja', 'LOJA-14', 3000, '${UIG}')
  RETURNING id`);

const encUige = await q(`
  INSERT INTO public.orders (reference, customer_id, provincia_id, total_amount)
  VALUES ('ENC-UIGE-13', '${C1}', '${UIG}', 3000) RETURNING id`);
await exec(`
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
  VALUES ('${encUige[0].id}', '${prodLoja2[0].id}', 1, 3000, 3000);
`);

const prep = await asUser(LOJA, async () =>
  q(`SELECT public.update_order_status('${encUige[0].id}', 'preparing') AS r`));
check("vendedor de loja prepara encomenda da sua província",
  prep[0].r.changed === true && prep[0].r.status === "preparing", JSON.stringify(prep[0].r));

const encLda = await q(`
  INSERT INTO public.orders (reference, customer_id, provincia_id, total_amount)
  VALUES ('ENC-LDA-13', '${C2}', '${LDA}', 3000) RETURNING id`);

const foraDaProvincia = await asUser(LOJA, async () => {
  try {
    await q(`SELECT public.update_order_status('${encLda[0].id}', 'preparing')`);
    return null;
  } catch (e) { return e.message; }
});
check("vendedor de loja não mexe em encomenda de outra província",
  /outra província/i.test(foraDaProvincia ?? ""), foraDaProvincia ?? "não deu erro");

console.log("\n--- 15. PROMOÇÕES COM ÂMBITO DE PROVÍNCIA ---");

// Produto próprio para não depender do que os testes anteriores mexeram.
const catPromo = await q(`
  INSERT INTO public.categories (name, slug) VALUES ('Promoções','promocoes-teste') RETURNING id`);
const prodPromo = await q(`
  INSERT INTO public.products (sku, name, category_id, official_price, promotional_price)
  VALUES ('PROMO-001','Perfume Promo', '${catPromo[0].id}', 50000, 40000) RETURNING id`);
const PROMO_PROD = prodPromo[0].id;

const prodOutro = await q(`
  INSERT INTO public.products (sku, name, category_id, official_price)
  VALUES ('PROMO-002','Outro Produto', '${catPromo[0].id}', 30000) RETURNING id`);
const OUTRO_PROD = prodOutro[0].id;

// Só no Uíge, 20 %, para este produto.
const promoUige = await asUser(MANAGER, async () =>
  q(`SELECT public.criar_promocao(
       'Black Friday Uíge', 'percentagem', 20,
       now() - interval '1 hour', now() + interval '1 day',
       ARRAY['${UIG}']::uuid[], ARRAY['${PROMO_PROD}']::uuid[]
     ) AS r`));
const PROMO_UIGE = promoUige[0].r.id;
check("gestão cria promoção para uma província", !!PROMO_UIGE, JSON.stringify(promoUige[0].r));

const precoUige = await q(`SELECT public.preco_efetivo('${PROMO_PROD}','${UIG}') AS p`);
const precoLda = await q(`SELECT public.preco_efetivo('${PROMO_PROD}','${LDA}') AS p`);
// base = promotional_price 40 000 → 20 % → 32 000
check("promoção aplica-se na província escolhida", Number(precoUige[0].p) === 32000, String(precoUige[0].p));
check("promoção não se aplica fora da província", Number(precoLda[0].p) === 40000, String(precoLda[0].p));

const outroUige = await q(`SELECT public.preco_efetivo('${OUTRO_PROD}','${UIG}') AS p`);
check("promoção de produto específico não apanha os outros",
  Number(outroUige[0].p) === 30000, String(outroUige[0].p));

const vigentesUige = await q(`SELECT * FROM public.promocoes_vigentes('${UIG}')`);
const vigentesLda = await q(`SELECT * FROM public.promocoes_vigentes('${LDA}')`);
check("cliente do Uíge vê a promoção", vigentesUige.some((p) => p.id === PROMO_UIGE),
  `${vigentesUige.length} vigentes`);
check("cliente de Luanda não vê a promoção do Uíge",
  !vigentesLda.some((p) => p.id === PROMO_UIGE), `${vigentesLda.length} vigentes`);

// Em bloco: a montra pede os preços todos de uma vez e tem de receber
// exactamente os mesmos números que `preco_efetivo` dá produto a produto.
const emBlocoUige = await q(
  `SELECT * FROM public.precos_efetivos(
     ARRAY['${PROMO_PROD}','${OUTRO_PROD}']::uuid[], '${UIG}')`
);
const blocoUige = Object.fromEntries(emBlocoUige.map((l) => [l.product_id, l]));
check("preços em bloco batem com o preço unitário",
  Number(blocoUige[PROMO_PROD]?.preco_final) === 32000 &&
    Number(blocoUige[OUTRO_PROD]?.preco_final) === 30000,
  JSON.stringify(emBlocoUige));
check("preço em bloco diz qual foi a campanha",
  blocoUige[PROMO_PROD]?.promocao_id === PROMO_UIGE &&
    blocoUige[PROMO_PROD]?.promocao_nome === "Black Friday Uíge",
  JSON.stringify(blocoUige[PROMO_PROD]));

const emBlocoLda = await q(
  `SELECT * FROM public.precos_efetivos(ARRAY['${PROMO_PROD}']::uuid[], '${LDA}')`
);
check("em bloco, a promoção de outra província não aparece",
  Number(emBlocoLda[0]?.preco_final) === 40000 && emBlocoLda[0]?.promocao_id === null,
  JSON.stringify(emBlocoLda[0]));

const emBlocoVazio = await q(`SELECT * FROM public.precos_efetivos(ARRAY[]::uuid[], NULL)`);
check("lista de produtos vazia não rebenta", emBlocoVazio.length === 0, String(emBlocoVazio.length));

// Promoção nacional, para todo o catálogo: apanha os dois produtos.
const promoNac = await asUser(MANAGER, async () =>
  q(`SELECT public.criar_promocao('Nacional 10', 'percentagem', 10, now() - interval '1 hour')
     AS r`));
const PROMO_NAC = promoNac[0].r.id;
const outroLda = await q(`SELECT public.preco_efetivo('${OUTRO_PROD}','${LDA}') AS p`);
check("promoção nacional vale em qualquer província", Number(outroLda[0].p) === 27000, String(outroLda[0].p));

// Promoção fora do prazo não conta.
const promoVelha = await asUser(MANAGER, async () =>
  q(`SELECT public.criar_promocao('Expirada', 'preco', 1000,
       now() - interval '10 days', now() - interval '1 day',
       ARRAY['${UIG}']::uuid[], ARRAY['${OUTRO_PROD}']::uuid[]) AS r`));
const outroUige2 = await q(`SELECT public.preco_efetivo('${OUTRO_PROD}','${UIG}') AS p`);
check("promoção fora do prazo não se aplica",
  Number(outroUige2[0].p) === 27000, String(outroUige2[0].p));

// Uma promoção nunca sobe o preço.
const promoCara = await asUser(MANAGER, async () =>
  q(`SELECT public.criar_promocao('Preço alto', 'preco', 99000,
       now() - interval '1 hour', NULL,
       ARRAY['${UIG}']::uuid[], ARRAY['${OUTRO_PROD}']::uuid[]) AS r`));
const promoCaraJson = await q(`SELECT public.promocao_do_produto('${OUTRO_PROD}','${UIG}') AS j`);
check("promoção mais cara do que o preço é ignorada",
  promoCaraJson[0].j?.promocao_id !== promoCara[0].r.id && Number(promoCaraJson[0].j?.preco_final) === 27000,
  JSON.stringify(promoCaraJson[0].j));

await asUser(MANAGER, async () => {
  await q(`SELECT public.eliminar_promocao('${promoCara[0].r.id}')`);
  await q(`SELECT public.eliminar_promocao('${promoVelha[0].r.id}')`);
});

const semGestao = await asUser(C1, async () => {
  try {
    await q(`SELECT public.criar_promocao('Pirata','percentagem',50)`);
    return null;
  } catch (e) { return e.message; }
});
check("cliente não cria promoções", /gestão/i.test(semGestao ?? ""), semGestao ?? "não deu erro");

console.log("\n--- 16. ENTREGA: GRÁTIS NO UÍGE, POR DEFINIR NO RESTO ---");

const taxaUige = await q(`SELECT public.taxa_entrega('${UIG}') AS t`);
const taxaLda = await q(`SELECT public.taxa_entrega('${LDA}') AS t`);
check("entrega gratuita no Uíge", Number(taxaUige[0].t) === 0, String(taxaUige[0].t));
check("nas outras províncias a taxa está por definir", taxaLda[0].t === null, String(taxaLda[0].t));

// Cliente do Uíge encomenda: leva o preço da promoção e entrega grátis.
// A referência vai junto com a província: o gatilho `fill_referencia` reescreve
// o prefixo e, sem um número livre, colidia com outro perfil do Uíge.
await q(`UPDATE public.profiles
         SET provincia_id = '${UIG}', referencia = 'INK-NAC-09001'
         WHERE id = '${C1}'`);
await q(`INSERT INTO public.inventory (product_id, quantity) VALUES ('${PROMO_PROD}', 50)`);

const encUige2 = await asUser(C1, async () =>
  q(`SELECT public.place_order(
       '[{"product_id":"${PROMO_PROD}","quantity":2}]'::jsonb,
       'delivery', 'Rua 1, Uíge', '923000001', NULL, 'ref-uige-promo') AS r`));
const encUigeR = encUige2[0].r;
// 2 × 32 000 = 64 000, entrega 0
check("encomenda do Uíge usa o preço da promoção", Number(encUigeR.total) === 64000, String(encUigeR.total));
check("encomenda do Uíge não paga entrega", Number(encUigeR.delivery_fee) === 0 && encUigeR.delivery_fee_pendente === false,
  JSON.stringify({ taxa: encUigeR.delivery_fee, pendente: encUigeR.delivery_fee_pendente }));

await q(`UPDATE public.profiles
         SET provincia_id = '${LDA}', referencia = 'INK-NAC-09002'
         WHERE id = '${C2}'`);
const encLda2 = await asUser(C2, async () =>
  q(`SELECT public.place_order(
       '[{"product_id":"${PROMO_PROD}","quantity":1}]'::jsonb,
       'delivery', 'Rua 2, Luanda', '923000002', NULL, 'ref-lda-taxa') AS r`));
const encLdaR = encLda2[0].r;
check("encomenda de Luanda fica com a taxa por definir",
  encLdaR.delivery_fee_pendente === true && Number(encLdaR.delivery_fee) === 0,
  JSON.stringify({ taxa: encLdaR.delivery_fee, pendente: encLdaR.delivery_fee_pendente }));
// 1 × 40 000 − 10 % da campanha nacional = 36 000, e 0 de entrega (por definir).
check("encomenda de Luanda não apanha a promoção do Uíge", Number(encLdaR.total) === 36000, String(encLdaR.total));

console.log("\n--- 17. COMISSÕES E LEVANTAMENTOS ---");

const VEND = "77777777-7777-4777-8777-777777777777";
// O contador do Uíge já foi usado pelos testes anteriores. Sobe-se ANTES de
// criar o perfil: a referência é atribuída no INSERT em `profiles`.
await q(`INSERT INTO public.referencia_contadores (codigo, ultimo) VALUES ('UIG', 500)
         ON CONFLICT (codigo) DO UPDATE
         SET ultimo = GREATEST(public.referencia_contadores.ultimo, 500)`);
await exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES ('${VEND}', 'vend@inuka.ao', '{"full_name":"Vendedor Comissao","phone":"923000077"}');
`);
await q(`SELECT public.promote_to_seller('+244923000077', 'Uíge')`);
await q(`UPDATE public.profiles SET provincia_id = '${UIG}' WHERE id = '${VEND}'`);
// Taxa explícita de 10 % — o exemplo do requisito (20 000 Kz → 2 000 Kz).
await q(`UPDATE public.seller_profiles SET commission_rate = 0.10 WHERE id = '${VEND}'`);

const r0 = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
const resumo0 = r0[0].r;
check("colaborador novo não pode levantar", resumo0.habilitado === false, JSON.stringify(resumo0));
check("faltam 5 vendas para habilitar", Number(resumo0.vendas_faltam) === 5, String(resumo0.vendas_faltam));

// Quatro vendas pagas: ainda bloqueado.
for (let i = 1; i <= 4; i++) {
  await q(`INSERT INTO public.sales (reference, seller_id, total_amount, payment_status, status, provincia_id)
           VALUES ('VND-${i}', '${VEND}', 20000, 'paid', 'completed', '${UIG}')`);
}
const r4 = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
check("com 4 vendas ainda está bloqueado", r4[0].r.habilitado === false, String(r4[0].r.vendas_pagas));
check("falta 1 venda", Number(r4[0].r.vendas_faltam) === 1, String(r4[0].r.vendas_faltam));

const bloqueado = await asUser(VEND, async () => {
  try {
    await q(`SELECT public.solicitar_levantamento(1000, 'xpress', '{"telefone":"923000077"}'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("pedido antes das 5 vendas é recusado", /faltam/i.test(bloqueado ?? ""), bloqueado ?? "não deu erro");

// Uma venda por pagar: entra nas pendentes, não nas ganhas.
await q(`INSERT INTO public.sales (reference, seller_id, total_amount, payment_status, status, provincia_id)
         VALUES ('VND-NAO-PAGA', '${VEND}', 50000, 'pending', 'completed', '${UIG}')`);
const rPend = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
check("venda por pagar não conta para o saldo", Number(rPend[0].r.comissoes_ganhas) === 8000,
  String(rPend[0].r.comissoes_ganhas));
check("venda por pagar aparece como comissão pendente", Number(rPend[0].r.comissoes_pendentes) === 5000,
  String(rPend[0].r.comissoes_pendentes));

// Quinta venda paga: habilita.
await q(`INSERT INTO public.sales (reference, seller_id, total_amount, payment_status, status, provincia_id)
         VALUES ('VND-5', '${VEND}', 20000, 'paid', 'completed', '${UIG}')`);
const r5 = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
check("com 5 vendas pagas fica habilitado", r5[0].r.habilitado === true, JSON.stringify({
  vendas: r5[0].r.vendas_pagas, minimo: r5[0].r.vendas_minimas }));
check("saldo disponível é 10 000 (5 × 2 000)", Number(r5[0].r.disponivel) === 10000, String(r5[0].r.disponivel));

// Venda cancelada não conta.
await q(`INSERT INTO public.sales (reference, seller_id, total_amount, payment_status, status, provincia_id)
         VALUES ('VND-CANC', '${VEND}', 30000, 'paid', 'cancelled', '${UIG}')`);
const rCanc = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
check("venda cancelada não gera comissão", Number(rCanc[0].r.comissoes_ganhas) === 10000,
  String(rCanc[0].r.comissoes_ganhas));

// Comissão duplicada: uma linha por venda, garantido pela UNIQUE.
await expectError("não se cria comissão duplicada para a mesma venda",
  `INSERT INTO public.sale_commissions (sale_id, seller_id, amount)
   SELECT sale_id, seller_id, amount FROM public.sale_commissions WHERE seller_id = '${VEND}' LIMIT 1`,
  "duplicate key");

// Pedido acima do saldo.
const acima = await asUser(VEND, async () => {
  try {
    await q(`SELECT public.solicitar_levantamento(99999, 'xpress', '{"telefone":"923000077"}'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("não se levanta mais do que o saldo", /superior ao dispon/i.test(acima ?? ""), acima ?? "não deu erro");

// Pedido válido.
const pedido = await asUser(VEND, async () =>
  q(`SELECT public.solicitar_levantamento(4000, 'xpress',
       '{"telefone":"923000077","conta":"XPRESS-777"}'::jsonb) AS r`));
const pedidoR = pedido[0].r;
check("colaborador pede levantamento", Number(pedidoR.valor) === 4000 && pedidoR.estado === "pendente",
  JSON.stringify(pedidoR));
check("valor pedido fica reservado", Number(pedidoR.resumo.reservado) === 4000,
  String(pedidoR.resumo.reservado));
check("disponível desce para 6 000", Number(pedidoR.resumo.disponivel) === 6000,
  String(pedidoR.resumo.disponivel));

// Dois pedidos ao mesmo tempo não reservam o mesmo saldo.
const segundo = await asUser(VEND, async () => {
  try {
    await q(`SELECT public.solicitar_levantamento(4000, 'xpress', '{"telefone":"923000077"}'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("não se abrem dois levantamentos ao mesmo tempo", /em curso/i.test(segundo ?? ""), segundo ?? "não deu erro");

// Os dados de recebimento ficaram guardados.
const dadosGuardados = await asUser(VEND, async () => q(`SELECT public.dados_recebimento() AS d`));
check("dados XPRESS guardados no perfil",
  dadosGuardados[0].d?.xpress?.conta === "XPRESS-777", JSON.stringify(dadosGuardados[0].d));

// O colaborador vê o seu histórico.
const meus = await asUser(VEND, async () => q(`SELECT * FROM public.meus_levantamentos()`));
check("colaborador vê o seu pedido", meus.length === 1 && meus[0].estado === "pendente", `${meus.length}`);

// Ninguém mais vê.
const outros = await asUser(SELLER, async () => q(`SELECT count(*)::int n FROM public.levantamentos`));
check("outro colaborador não vê os levantamentos alheios", outros[0].n === 0, String(outros[0].n));

// O colaborador não decide o seu próprio pedido.
const autoAprova = await asUser(VEND, async () => {
  try {
    await q(`SELECT public.decidir_levantamento('${pedidoR.id}', 'aprovado')`);
    return null;
  } catch (e) { return e.message; }
});
check("colaborador não aprova o próprio levantamento", /gestão/i.test(autoAprova ?? ""), autoAprova ?? "não deu erro");

// Gestão aprova → processa → paga.
const aprova = await asUser(MANAGER, async () =>
  q(`SELECT public.decidir_levantamento('${pedidoR.id}', 'aprovado') AS r`));
check("gestão aprova o pedido", aprova[0].r.estado === "aprovado", JSON.stringify(aprova[0].r.estado));
const aindaReservado = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
check("aprovado ainda não paga nada",
  Number(aindaReservado[0].r.total_pago) === 0 && Number(aindaReservado[0].r.reservado) === 4000,
  JSON.stringify({ pago: aindaReservado[0].r.total_pago, reservado: aindaReservado[0].r.reservado }));

const processa = await asUser(MANAGER, async () =>
  q(`SELECT public.decidir_levantamento('${pedidoR.id}', 'em_processamento') AS r`));
check("gestão marca como em processamento", processa[0].r.estado === "em_processamento", processa[0].r.estado);

const paga = await asUser(MANAGER, async () =>
  q(`SELECT public.decidir_levantamento('${pedidoR.id}', 'pago', 'Transferido') AS r`));
check("gestão marca como pago", paga[0].r.estado === "pago", paga[0].r.estado);

const depois = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
const depoisR = depois[0].r;
check("pagamento entra no total pago", Number(depoisR.total_pago) === 4000, String(depoisR.total_pago));
check("valor pago deixa de estar reservado", Number(depoisR.reservado) === 0, String(depoisR.reservado));
check("disponível volta a 6 000", Number(depoisR.disponivel) === 6000, String(depoisR.disponivel));

const payout = await q(`SELECT amount, method FROM public.commission_payouts WHERE seller_id = '${VEND}'`);
check("pagamento registado no histórico financeiro",
  payout.length === 1 && Number(payout[0].amount) === 4000 && payout[0].method === "xpress",
  JSON.stringify(payout));

const auditado = await q(`SELECT count(*)::int n FROM public.audit_logs
  WHERE entity = 'levantamentos' AND entity_id = '${pedidoR.id}'`);
check("todas as decisões ficam auditadas", auditado[0].n >= 3, String(auditado[0].n));

// Um pedido pago é final.
const repetir = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.decidir_levantamento('${pedidoR.id}', 'pago')`);
    return null;
  } catch (e) { return e.message; }
});
check("um pedido pago não se paga duas vezes", /não é possível/i.test(repetir ?? ""), repetir ?? "não deu erro");

// Rejeição devolve o valor ao saldo.
const pedido2 = await asUser(VEND, async () =>
  q(`SELECT public.solicitar_levantamento(3000, 'xpress') AS r`));
check("segundo pedido recupera os dados XPRESS guardados",
  pedido2[0].r.estado === "pendente" && Number(pedido2[0].r.resumo.reservado) === 3000,
  JSON.stringify(pedido2[0].r.resumo));

// Transferência bancária sem dados guardados tem de ser recusada.
const semBanco = await asUser(VEND, async () => {
  try {
    await q(`SELECT public.solicitar_levantamento(1000, 'transferencia')`);
    return null;
  } catch (e) { return e.message; }
});
check("transferência sem coordenadas bancárias é recusada",
  /dados de recebimento|em curso/i.test(semBanco ?? ""), semBanco ?? "não deu erro");

// Guardar coordenadas bancárias e reutilizá-las.
await asUser(VEND, async () => q(`SELECT public.guardar_dados_recebimento('transferencia',
  '{"titular":"Vendedor Comissao","banco":"BAI","conta":"0040 0000 1234","iban":"AO06 0040 0000 1234 5678 9"}'::jsonb)`));

const rejeita = await asUser(MANAGER, async () =>
  q(`SELECT public.decidir_levantamento('${pedido2[0].r.id}', 'rejeitado', 'Dados incompletos') AS r`));
check("gestão rejeita o pedido", rejeita[0].r.estado === "rejeitado", rejeita[0].r.estado);

const aposRejeicao = await asUser(VEND, async () => q(`SELECT public.levantamento_resumo() AS r`));
check("rejeição devolve o valor ao saldo",
  Number(aposRejeicao[0].r.reservado) === 0 && Number(aposRejeicao[0].r.disponivel) === 6000,
  JSON.stringify({ reservado: aposRejeicao[0].r.reservado, disponivel: aposRejeicao[0].r.disponivel }));

const pedidoSemMotivo = await asUser(VEND, async () =>
  q(`SELECT public.solicitar_levantamento(1000, 'transferencia') AS r`));

const rejeitadoSemMotivo = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.decidir_levantamento('${pedidoSemMotivo[0].r.id}', 'rejeitado')`);
    return null;
  } catch (e) { return e.message; }
});
check("rejeição exige motivo", /motivo/i.test(rejeitadoSemMotivo ?? ""), rejeitadoSemMotivo ?? "não deu erro");

// A gestão vê os pedidos com identificação do colaborador.
const equipa = await asUser(MANAGER, async () => q(`SELECT public.levantamentos_equipa() AS r`));
const listaEquipa = equipa[0].r;
const doVendedor = listaEquipa.find((l) => l.seller_id === VEND);
check("gestão vê o pedido com nome e referência do colaborador",
  !!doVendedor && !!doVendedor.seller_nome && !!doVendedor.dados,
  JSON.stringify(doVendedor ? { nome: doVendedor.seller_nome, metodo: doVendedor.metodo } : null));

// Histórico de comissões por venda.
// 5 vendas pagas + 1 por pagar + 1 cancelada = 7 linhas, uma por venda.
const comissoes = await asUser(VEND, async () => q(`SELECT * FROM public.minhas_comissoes()`));
check("venda sem linhas de detalhe conta como uma só", comissoes.length === 7, `${comissoes.length}`);
check("comissão de 10 % sobre 20 000 = 2 000",
  comissoes.filter((c) => Number(c.comissao) === 2000).length === 5,
  JSON.stringify(comissoes.map((c) => Number(c.comissao))));
check("venda cancelada aparece como cancelada",
  comissoes.some((c) => c.estado === "cancelada"),
  JSON.stringify(comissoes.map((c) => c.estado)));

// 17.1 VENDA = PRODUTO — a contagem é por unidade de produto, não por registo.
const VEND2 = "88888888-8888-4888-8888-888888888888";
await q(`INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ('${VEND2}', 'vend2@inuka.ao', '{"full_name":"Vendedor Duplo","phone":"923000099"}')`);
await q(`SELECT public.promote_to_seller('+244923000099', 'Uíge')`);
await q(`UPDATE public.profiles SET provincia_id = '${UIG}' WHERE id = '${VEND2}'`);
await q(`UPDATE public.seller_profiles SET commission_rate = 0.10 WHERE id = '${VEND2}'`);

const pA = await q(`INSERT INTO public.products (name, sku, official_price, is_active)
  VALUES ('[TESTE] Perfume A', 'PERF-A', 10000, true) RETURNING id`);
const pB = await q(`INSERT INTO public.products (name, sku, official_price, is_active)
  VALUES ('[TESTE] Creme B', 'CREM-B', 8000, true) RETURNING id`);

// Uma operação com dois produtos diferentes → duas vendas.
const vendaDupla = await q(`INSERT INTO public.sales
  (reference, seller_id, total_amount, payment_status, status, provincia_id)
  VALUES ('VND-DUPLA', '${VEND2}', 18000, 'paid', 'completed', '${UIG}') RETURNING id`);
await exec(`INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total_price)
  VALUES ('${vendaDupla[0].id}', '${pA[0].id}', 1, 10000, 10000),
         ('${vendaDupla[0].id}', '${pB[0].id}', 1,  8000,  8000)`);

// Uma operação com duas unidades do mesmo produto → também duas vendas.
const vendaQtd = await q(`INSERT INTO public.sales
  (reference, seller_id, total_amount, payment_status, status, provincia_id)
  VALUES ('VND-QTD', '${VEND2}', 20000, 'paid', 'completed', '${UIG}') RETURNING id`);
await exec(`INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total_price)
  VALUES ('${vendaQtd[0].id}', '${pA[0].id}', 2, 10000, 20000)`);

const duplo = await asUser(VEND2, async () => q(`SELECT public.levantamento_resumo() AS r`));
const duploR = duplo[0].r;
check("duas operações com quatro produtos contam como 4 vendas",
  Number(duploR.vendas_pagas) === 4, String(duploR.vendas_pagas));
check("o número de operações registadas continua visível",
  Number(duploR.vendas_registadas) === 2, String(duploR.vendas_registadas));
check("com 4 vendas de produto ainda falta 1", Number(duploR.vendas_faltam) === 1,
  String(duploR.vendas_faltam));

const linhasDuplo = await asUser(VEND2, async () => q(`SELECT * FROM public.minhas_comissoes()`));
check("o histórico mostra uma linha por produto", linhasDuplo.length === 3,
  JSON.stringify(linhasDuplo.map((l) => l.produto)));
check("cada produto rende 10 % do seu próprio valor",
  linhasDuplo.some((l) => l.produto === "[TESTE] Perfume A" && Number(l.comissao) === 1000)
  && linhasDuplo.some((l) => l.produto === "[TESTE] Creme B" && Number(l.comissao) === 800)
  && linhasDuplo.some((l) => l.produto === "[TESTE] Perfume A" && Number(l.comissao) === 2000),
  JSON.stringify(linhasDuplo.map((l) => [l.produto, Number(l.comissao)])));
check("a soma das linhas é a comissão da venda (1 800)",
  linhasDuplo.filter((l) => l.referencia === "VND-DUPLA")
    .reduce((s, l) => s + Number(l.comissao), 0) === 1800,
  JSON.stringify(linhasDuplo.map((l) => [l.referencia, Number(l.comissao)])));
check("a quantidade comprada aparece na linha",
  linhasDuplo.some((l) => l.referencia === "VND-QTD" && Number(l.quantidade) === 2),
  JSON.stringify(linhasDuplo.map((l) => [l.referencia, l.quantidade])));

// Vendedor de loja não recebe comissão (taxa 0) e não levanta.
const resumoLoja = await asUser(LOJA, async () => {
  try {
    await q(`SELECT public.solicitar_levantamento(100, 'xpress', '{"telefone":"923000088"}'::jsonb)`);
    return null;
  } catch (e) { return e.message; }
});
check("vendedor de loja não pode levantar comissões", /colaboradores/i.test(resumoLoja ?? ""),
  resumoLoja ?? "não deu erro");

// ===========================================================================
console.log("\n--- 18. ELIMINAR COLABORADOR E AS SUAS VENDAS ---");

// O colaborador VEND2 tem 2 registos de venda, 4 produtos e 2 comissões —
// é o caso que o requisito descreve.
const impactoElim = await asUser(MANAGER, async () =>
  q(`SELECT public.impacto_eliminar_colaborador('${VEND2}') AS r`));
const impElim = impactoElim[0].r;
check("gestão vê o que vai desaparecer",
  Number(impElim.vendas) === 2 && Number(impElim.unidades) === 4 && Number(impElim.comissoes) === 2,
  JSON.stringify({ vendas: impElim.vendas, unidades: impElim.unidades, comissoes: impElim.comissoes }));
check("o volume e as comissões batem com as vendas",
  Number(impElim.volume) === 38000 && Number(impElim.comissoes_valor) === 3800,
  JSON.stringify({ volume: impElim.volume, comissoes: impElim.comissoes_valor }));

// O próprio colaborador não vê nem apaga.
const veProprio = await asUser(VEND2, async () => {
  try {
    await q(`SELECT public.impacto_eliminar_colaborador('${VEND2}')`);
    return null;
  } catch (e) { return e.message; }
});
check("colaborador não vê o impacto da eliminação", /gestão/i.test(veProprio ?? ""),
  veProprio ?? "não deu erro");

// Um gestor não se apaga a si próprio.
const autoApagar = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.eliminar_colaborador('${MANAGER}', 'teste')`);
    return null;
  } catch (e) { return e.message; }
});
check("gestão não apaga a própria conta", /própria conta/i.test(autoApagar ?? ""),
  autoApagar ?? "não deu erro");

// Nem outro gestor.
const MGR_LDA = "99999999-9999-4999-8999-999999999999";
await q(`INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ('${MGR_LDA}', 'mlda@inuka.ao', '{"full_name":"Gestor Luanda","phone":"923000111"}')`);
await q(`UPDATE public.profiles SET role = 'manager', provincia_id = '${LDA}' WHERE id = '${MGR_LDA}'`);

const outroGestor = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.eliminar_colaborador('${MGR_LDA}', 'teste')`);
    return null;
  } catch (e) { return e.message; }
});
check("um gestor não apaga outro gestor por aqui", /mude primeiro o papel/i.test(outroGestor ?? ""),
  outroGestor ?? "não deu erro");

// Gestor provincial só dentro da sua província.
const foraDaProvinciaElim = await asUser(MGR_LDA, async () => {
  try {
    await q(`SELECT public.eliminar_colaborador('${VEND2}', 'teste')`);
    return null;
  } catch (e) { return e.message; }
});
check("gestor provincial não apaga colaborador de outra província",
  /outra província/i.test(foraDaProvinciaElim ?? ""), foraDaProvinciaElim ?? "não deu erro");

// A eliminação a sério.
const resultadoElim = await asUser(MANAGER, async () =>
  q(`SELECT public.eliminar_colaborador('${VEND2}', 'Pediu demissão') AS r`));
check("gestão elimina o colaborador", Number(resultadoElim[0].r.vendas) === 2,
  JSON.stringify(resultadoElim[0].r));

const restosElim = await q(`
  SELECT
    (SELECT count(*)::int FROM public.profiles        WHERE id = '${VEND2}')  AS perfil,
    (SELECT count(*)::int FROM public.sales           WHERE seller_id = '${VEND2}') AS vendas,
    (SELECT count(*)::int FROM public.sale_items si
       JOIN public.sales s ON s.id = si.sale_id
      WHERE s.seller_id = '${VEND2}') AS items,
    (SELECT count(*)::int FROM public.sale_commissions WHERE seller_id = '${VEND2}') AS comissoes,
    (SELECT count(*)::int FROM public.seller_profiles  WHERE id = '${VEND2}') AS perfil_vendedor,
    (SELECT count(*)::int FROM public.user_roles       WHERE user_id = '${VEND2}') AS papeis,
    (SELECT count(*)::int FROM auth.users              WHERE id = '${VEND2}') AS conta`);
const restosR = restosElim[0];
check("o perfil, as vendas, as comissões e a conta desapareceram",
  restosR.perfil === 0 && restosR.vendas === 0 && restosR.items === 0 && restosR.comissoes === 0
  && restosR.perfil_vendedor === 0 && restosR.papeis === 0 && restosR.conta === 0,
  JSON.stringify(restosR));

const auditadoDelete = await q(`SELECT action, new_data FROM public.audit_logs
  WHERE entity = 'colaboradores' AND entity_id = '${VEND2}'`);
check("a eliminação fica auditada com o motivo",
  auditadoDelete.length === 1 && auditadoDelete[0].new_data?.motivo === "Pediu demissão",
  JSON.stringify(auditadoDelete));

// As vendas de outro colaborador não foram tocadas.
const sobrevivente = await q(`SELECT count(*)::int n FROM public.sales WHERE seller_id = '${VEND}'`);
check("as vendas dos outros colaboradores ficam intactas", sobrevivente[0].n === 7,
  String(sobrevivente[0].n));

// Eliminar de novo não rebenta o ecrã: a função diz que já não existe.
const repetidoElim = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.eliminar_colaborador('${VEND2}', 'repetidoElim')`);
    return null;
  } catch (e) { return e.message; }
});
check("eliminar duas vezes diz que já não existe", /não encontrado/i.test(repetidoElim ?? ""),
  repetidoElim ?? "não deu erro");

// ===========================================================================
console.log("\n--- 19. TAREFAS, GESTOR RESPONSÁVEL E CORRECÇÃO DE VENDAS ---");
// ===========================================================================

// --- 19.1 Tarefas ---------------------------------------------------------
const OUTRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
await q(`INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ('${OUTRO}', 'outro@inuka.ao', '{"full_name":"Outro Colaborador","phone":"923000099"}')`);
await q(`UPDATE public.profiles SET role = 'seller', provincia_id = '${UIG}' WHERE id = '${OUTRO}'`);

const tarefaCriada = await asUser(MANAGER, async () =>
  q(`INSERT INTO public.colaborador_tarefas (seller_id, titulo, descricao, prazo, prioridade, criado_por)
     VALUES ('${VEND}', 'Entregar o BI atualizado', 'Falta a cópia do BI.', current_date + 3, 'alta', '${MANAGER}')
     RETURNING id, estado, concluida_em`));
const TAREFA = tarefaCriada[0].id;
check("gestão cria uma tarefa para o colaborador",
  tarefaCriada[0].estado === "pendente" && tarefaCriada[0].concluida_em === null,
  JSON.stringify(tarefaCriada[0]));

const minhasTarefas = await asUser(VEND, async () =>
  q(`SELECT id, titulo, estado FROM public.colaborador_tarefas WHERE seller_id = '${VEND}'`));
check("o colaborador vê a tarefa no perfil dele", minhasTarefas.length === 1
  && minhasTarefas[0].id === TAREFA, JSON.stringify(minhasTarefas));

const tarefasDeOutro = await asUser(OUTRO, async () =>
  q(`SELECT count(*)::int n FROM public.colaborador_tarefas`));
check("outro colaborador não vê a tarefa", tarefasDeOutro[0].n === 0, String(tarefasDeOutro[0].n));

const concluida = await asUser(VEND, async () =>
  q(`UPDATE public.colaborador_tarefas SET estado = 'concluida' WHERE id = '${TAREFA}'
     RETURNING estado, concluida_em`));
check("o colaborador marca a tarefa como concluída",
  concluida[0].estado === "concluida" && concluida[0].concluida_em !== null,
  JSON.stringify(concluida[0]));

const reescreverTitulo = await asUser(VEND, async () => {
  try {
    await q(`UPDATE public.colaborador_tarefas SET titulo = 'outra coisa' WHERE id = '${TAREFA}'`);
    return null;
  } catch (e) { return e.message; }
});
check("o colaborador não reescreve o que a gestão escreveu",
  /só pode marcar/i.test(reescreverTitulo ?? ""), reescreverTitulo ?? "não deu erro");

const apagarTarefaColab = await asUser(VEND, async () =>
  q(`DELETE FROM public.colaborador_tarefas WHERE id = '${TAREFA}' RETURNING id`));
check("o colaborador não apaga a tarefa", apagarTarefaColab.length === 0, "apagou");

const criarParaOutraProvincia = await asUser(MGR_LDA, async () => {
  try {
    await q(`INSERT INTO public.colaborador_tarefas (seller_id, titulo, criado_por)
             VALUES ('${VEND}', 'Tarefa de Luanda', '${MGR_LDA}')`);
    return null;
  } catch (e) { return e.message; }
});
check("gestor de outra província não cria tarefas",
  criarParaOutraProvincia !== null, "criou");

// --- 19.2 Gestor responsável ---------------------------------------------
const candidatos = await asUser(MANAGER, async () =>
  q(`SELECT id, nome, nacional FROM public.gestores_para_colaborador('${VEND}')`));
const idsCand = candidatos.map((c) => c.id);
check("a lista traz o gestor nacional", idsCand.includes(MANAGER), JSON.stringify(idsCand));
check("a lista traz o gestor da mesma província", idsCand.includes(M_UIGE), JSON.stringify(idsCand));
check("a lista não traz gestor de outra província", !idsCand.includes(MGR_LDA), JSON.stringify(idsCand));

const semPermissaoLista = await asUser(VEND, async () => {
  try {
    await q(`SELECT public.gestores_para_colaborador('${VEND}')`);
    return null;
  } catch (e) { return e.message; }
});
check("colaborador não vê a lista de gestores",
  /sem permissão/i.test(semPermissaoLista ?? ""), semPermissaoLista ?? "não deu erro");

const definir = await asUser(MANAGER, async () =>
  q(`SELECT public.definir_gestor_colaborador('${VEND}', '${M_UIGE}') AS r`));
check("gestão define o gestor responsável",
  definir[0].r.gestor_id === M_UIGE, JSON.stringify(definir[0].r));

const fichaComGestor = await q(`SELECT manager_id FROM public.seller_profiles WHERE id = '${VEND}'`);
check("o gestor fica gravado na ficha", fichaComGestor[0].manager_id === M_UIGE,
  String(fichaComGestor[0].manager_id));

const gestorDeOutraProvincia = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.definir_gestor_colaborador('${VEND}', '${MGR_LDA}')`);
    return null;
  } catch (e) { return e.message; }
});
check("não se atribui um gestor de outra província",
  /outra província/i.test(gestorDeOutraProvincia ?? ""), gestorDeOutraProvincia ?? "não deu erro");

const gestorQueNaoE = await asUser(MANAGER, async () => {
  try {
    await q(`SELECT public.definir_gestor_colaborador('${VEND}', '${OUTRO}')`);
    return null;
  } catch (e) { return e.message; }
});
check("só uma conta de gestão pode ser gestora",
  /não é gestor/i.test(gestorQueNaoE ?? ""), gestorQueNaoE ?? "não deu erro");

const gestorSemPermissao = await asUser(MGR_LDA, async () => {
  try {
    await q(`SELECT public.definir_gestor_colaborador('${VEND}', '${MGR_LDA}')`);
    return null;
  } catch (e) { return e.message; }
});
check("gestor de outra província não muda o gestor",
  /outra província/i.test(gestorSemPermissao ?? ""), gestorSemPermissao ?? "não deu erro");

const limparGestor = await asUser(MANAGER, async () =>
  q(`SELECT public.definir_gestor_colaborador('${VEND}', NULL) AS r`));
check("dá para voltar a «sem gestor»", limparGestor[0].r.gestor_id === null,
  JSON.stringify(limparGestor[0].r));

// --- 19.3 Corrigir vendas ------------------------------------------------
// Uma venda com linhas: o total e a comissão vêm delas.
const PROD = (await q(`SELECT id FROM public.products ORDER BY created_at LIMIT 1`))[0].id;
const VENDA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
await q(`INSERT INTO public.sales (id, reference, seller_id, total_amount, payment_status, status, provincia_id)
         VALUES ('${VENDA_ID}', 'VND-CORRIGIR', '${VEND}', 0, 'paid', 'completed', '${UIG}')`);
await q(`INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total_price)
         VALUES ('${VENDA_ID}', '${PROD}', 2, 10000, 20000)`);

const antesCorrecao = await q(`SELECT s.total_amount, c.amount
  FROM public.sales s JOIN public.sale_commissions c ON c.sale_id = s.id
  WHERE s.id = '${VENDA_ID}'`);
check("a venda nasce com o total das linhas e 10 % de comissão",
  Number(antesCorrecao[0].total_amount) === 20000 && Number(antesCorrecao[0].amount) === 2000,
  JSON.stringify(antesCorrecao[0]));

const corrigida = await asUser(MANAGER, async () =>
  q(`UPDATE public.sale_items SET quantity = 3, total_price = 3 * unit_price
     WHERE sale_id = '${VENDA_ID}' RETURNING quantity`));
check("a gestão corrige a quantidade de uma linha", Number(corrigida[0].quantity) === 3,
  String(corrigida[0].quantity));

const depoisCorrecao = await q(`SELECT s.total_amount, c.amount
  FROM public.sales s JOIN public.sale_commissions c ON c.sale_id = s.id
  WHERE s.id = '${VENDA_ID}'`);
check("o total acompanha a correcção", Number(depoisCorrecao[0].total_amount) === 30000,
  String(depoisCorrecao[0].total_amount));
check("a comissão acompanha a correcção", Number(depoisCorrecao[0].amount) === 3000,
  String(depoisCorrecao[0].amount));

const semPermissaoVenda = await asUser(OUTRO, async () =>
  q(`UPDATE public.sale_items SET quantity = 9 WHERE sale_id = '${VENDA_ID}' RETURNING id`));
check("outro colaborador não corrige vendas alheias", semPermissaoVenda.length === 0, "corrigiu");

// Comissão paga: a venda deixa de se poder mexer.
await q(`UPDATE public.sale_commissions SET status = 'paid', paid_at = now()
         WHERE sale_id = '${VENDA_ID}'`);

const mexerVendaPaga = await asUser(MANAGER, async () => {
  try {
    await q(`UPDATE public.sale_items SET quantity = 5, total_price = 5 * unit_price
             WHERE sale_id = '${VENDA_ID}'`);
    return null;
  } catch (e) { return e.message; }
});
check("venda com comissão paga não se corrige",
  /comissão paga/i.test(mexerVendaPaga ?? ""), mexerVendaPaga ?? "não deu erro");

// A anulação continua possível antes do pagamento.
await q(`UPDATE public.sale_commissions SET status = 'pending', paid_at = NULL
         WHERE sale_id = '${VENDA_ID}'`);
await asUser(MANAGER, async () =>
  q(`UPDATE public.sales SET status = 'cancelled' WHERE id = '${VENDA_ID}'`));
const anulada = await q(`SELECT s.status, c.status AS comissao
  FROM public.sales s JOIN public.sale_commissions c ON c.sale_id = s.id
  WHERE s.id = '${VENDA_ID}'`);
check("anular a venda anula a comissão",
  anulada[0].status === "cancelled" && anulada[0].comissao === "cancelled",
  JSON.stringify(anulada[0]));

console.log("\n================ RESUMO ================");
console.log(`Total: ${results.length}  |  Passou: ${results.length - failures}  |  Falhou: ${failures}`);

if (failures > 0) {
  console.log("\nFalhas:");
  results.filter((r) => !r.ok).forEach((r) => console.log(` - ${r.name} :: ${r.detail}`));
}

await db.close();
process.exit(failures ? 1 : 0);
