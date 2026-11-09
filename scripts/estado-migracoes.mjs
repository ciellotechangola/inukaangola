// Diagnóstico: o que é que a base de dados alojada já tem?
//
//   node scripts/estado-migracoes.mjs
//
// Lê a chave de serviço de apps/web/.env.local e só faz leituras:
//   - tabelas e colunas: um SELECT com limit=1 (PGRST205/PGRST204 = em falta);
//   - funções: a especificação OpenAPI que o PostgREST publica em /rest/v1/.
//     Não se sonda com POST /rpc/x porque o PostgREST responde PGRST202
//     («função não encontrada») sempre que a assinatura não bate certo — o que
//     dá falsos negativos em qualquer função com argumentos obrigatórios.
// Funções de trigger (fill_province, set_updated_at…) não aparecem na
// especificação por não serem chamáveis por RPC: a ausência delas aqui não é
// um problema.
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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const cabecalhos = { apikey: key, Authorization: `Bearer ${key}` };

async function ler(caminho) {
  const r = await fetch(`${url}/rest/v1/${caminho}`, { headers: cabecalhos });
  const corpo = await r.text();
  return { ok: r.ok, status: r.status, corpo };
}

// Tabelas cuja ausência quebra uma funcionalidade já entregue.
const tabelas = [
  "profiles",
  "products",
  "inventory",
  "provincias",
  "sales",
  "sale_items",
  "seller_customers",
  "seller_profiles",
  "reserved_customers",
  "reseller_applications",
  "platform_settings",
  "content_items",
  "design_projects",
  "conversations",
];

// Colunas acrescentadas por migrações tardias.
const colunas = [
  ["sales", "customer_phone"],
  ["platform_settings", "updated_by"],
  ["orders", "delivery_fee"],
  ["order_items", "product_name"],
  ["discount_requests", "product_name"],
];

// Funções chamáveis por RPC.
const funcoes = [
  "ligar_reserva_ao_cliente",
  "register_sale_by_phone",
  "register_sale",
  "minhas_compras",
  "abrir_conversa_equipa",
  "stock_produtos",
  "criar_grupo_equipa",
  "adicionar_membro_grupo",
  "remover_membro_grupo",
  "link_customer_by_phone",
  "taxa_comissao",
  "taxa_comissao_de",
  "definir_taxa_comissao",
  "taxa_entrega",
  "place_order",
  "update_order_status",
  "colaborador_painel",
  "is_store_seller",
  "is_staff",
  "can_manage_stock",
  "can_sell_at_store",
  "registar_venda_loja",
  "impacto_eliminar_produto",
  "eliminar_produto",
  "conteudo_comentarios",
];

let especificacao = null;
try {
  const r = await fetch(`${url}/rest/v1/`, { headers: cabecalhos });
  especificacao = r.ok ? await r.text() : null;
} catch {
  especificacao = null;
}

const linhas = [];

for (const t of tabelas) {
  const r = await ler(`${t}?select=*&limit=1`);
  linhas.push([`tabela ${t}`, r.ok ? "OK" : r.corpo.match(/PGRST\d+/)?.[0] || `HTTP ${r.status}`]);
}

for (const [t, c] of colunas) {
  const r = await ler(`${t}?select=${c}&limit=1`);
  linhas.push([`coluna ${t}.${c}`, r.ok ? "OK" : r.corpo.match(/PGRST\d+/)?.[0] || `HTTP ${r.status}`]);
}

if (especificacao) {
  for (const f of funcoes) {
    const existe = especificacao.includes(`"/rpc/${f}"`);
    linhas.push([`função ${f}()`, existe ? "OK" : "em falta"]);
  }

  // A 0014 acrescentou `p_forcar` a `eliminar_produto`. O nome da função já
  // existia desde a 0013, por isso a presença dele não distingue as versões —
  // o argumento novo sim.
  const forcado = especificacao.includes('"p_forcar"');
  linhas.push(["eliminar_produto(forçar histórico)", forcado ? "OK" : "em falta"]);
} else {
  linhas.push(["funções (OpenAPI)", "não foi possível ler /rest/v1/"]);
}

const largura = Math.max(...linhas.map(([a]) => a.length));
for (const [nome, estado] of linhas) {
  console.log(`${estado === "OK" ? "  " : "!!"} ${nome.padEnd(largura)}  ${estado}`);
}

const faltam = linhas.filter(([, e]) => e !== "OK");
console.log(
  faltam.length === 0
    ? "\nBase alojada em dia."
    : `\n${faltam.length} em falta — ver supabase/PATCH_*.sql.`
);
process.exit(faltam.length === 0 ? 0 : 1);
