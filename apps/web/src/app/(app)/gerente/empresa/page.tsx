import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizarActivo } from "@/lib/activo";
import { despesasPorCategoria, normalizarStockValor } from "@/lib/empresa";
import { normalizarDespesas } from "@/lib/despesas";
import { numero, type OverviewColaboradores } from "@/lib/colaborador";
import VisaoEmpresa, {
  type ProvinciaOpcao,
  type ResumoEmpresa,
} from "@/components/empresa/VisaoEmpresa";

export const dynamic = "force-dynamic";

/**
 * Empresa — saldo contabilístico e visão completa.
 *
 * Duas abas na mesma página porque são a mesma pergunta: «quanto vale a
 * empresa?» (o saldo que a gestão declara) e «como está ela?» (vendas,
 * despesas, stock, equipa). O saldo é escrito pelo gestor; o resto é lido.
 */
export default async function EmpresaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  const sp = await searchParams;
  // `aba=saldo` era o link antigo: continua a abrir o painel financeiro.
  const abaInicial = sp.aba === "empresa" ? "empresa" : "financeiro";

  const supabase = await createClientServer();
  const [
    { data: activoRaw, error: erroActivo },
    { data: painelRaw, error: erroPainel },
    { data: stockRaw },
    { data: statsRaw },
    { data: despesasRaw },
    { data: resumoRaw },
    { data: redeRaw },
    { data: provinciasRaw },
  ] = await Promise.all([
    supabase.rpc("activo_provincia"),
    supabase.rpc("painel_financeiro"),
    supabase.rpc("stock_valor"),
    supabase.rpc("dashboard_stats"),
    supabase.rpc("despesas_equipa"),
    supabase.rpc("despesas_resumo"),
    supabase.rpc("colaboradores_overview"),
    supabase.from("provincias").select("id, nome, is_default").eq("is_active", true).order("nome"),
  ]);

  const activo = normalizarActivo(activoRaw);
  const stock = normalizarStockValor(stockRaw);
  const despesas = normalizarDespesas(despesasRaw);
  const rede = (redeRaw ?? null) as OverviewColaboradores | null;

  const stats = (statsRaw ?? {}) as {
    sales_total_value?: number;
    sales_count?: number;
    orders_count?: number;
    customers_count?: number;
    top_products?: { name: string; units: number; value: number }[];
  };

  const empresa: ResumoEmpresa = {
    vendas_mes: numero(stats.sales_total_value),
    vendas_mes_count: numero(stats.sales_count),
    encomendas: numero(stats.orders_count),
    clientes: numero(stats.customers_count),
    colaboradores_ativos: numero(rede?.totais.colaboradores_ativos),
    colaboradores: numero(rede?.totais.colaboradores),
    comissao_gerada: numero(rede?.totais.comissao_gerada),
    comissao_paga: numero(rede?.totais.comissao_paga),
    comissao_pendente: numero(rede?.totais.comissao_pendente),
    metas_atingidas: numero(rede?.totais.metas_atingidas),
    metas_em_curso: numero(rede?.totais.metas_em_curso),
    top_produtos: Array.isArray(stats.top_products) ? stats.top_products : [],
  };

  const nacional = Boolean(profile.is_national_admin) || !profile.provincia_id;

  const provincias: ProvinciaOpcao[] = ((provinciasRaw ?? []) as ProvinciaOpcao[]).map((p) => ({
    id: p.id,
    nome: p.nome,
    is_default: p.is_default,
  }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      {erroActivo && (
        <div className="mb-6 rounded-lg border border-[#4A3F1F] bg-[#241E0E] p-3 text-sm text-[#C9A962]">
          O activo ainda não está calculado. Cole{" "}
          <code className="font-mono text-xs">supabase/PATCH_SALDO_CONTABILISTICO.sql</code> no SQL
          Editor do Supabase e recarregue a página.
        </div>
      )}

      {erroPainel && (
        <div className="mb-6 rounded-lg border border-[#4A3F1F] bg-[#241E0E] p-3 text-sm text-[#C9A962]">
          O painel financeiro ainda não está disponível. Cole{" "}
          <code className="font-mono text-xs">supabase/PATCH_PAINEL_FINANCEIRO.sql</code> no SQL
          Editor do Supabase e recarregue a página. Os indicadores aparecem a zeros até lá.
        </div>
      )}

      <VisaoEmpresa
        nacional={nacional}
        provinciaNome={activo.provincia}
        activo={activo}
        painel={painelRaw ?? null}
        stock={stock}
        resumo={resumoRaw ?? null}
        categorias={despesasPorCategoria(despesas)}
        provincias={provincias}
        empresa={empresa}
        abaInicial={abaInicial}
      />
    </main>
  );
}
