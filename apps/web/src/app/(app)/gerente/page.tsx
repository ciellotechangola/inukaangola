import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { numero, iniciais, type OverviewColaboradores } from "@/lib/colaborador";
import TabelaResponsiva from "@/components/TabelaResponsiva";

export const dynamic = "force-dynamic";

interface Dashboard {
  scope?: "nacional" | "provincial";
  provincia_id?: string | null;
  sales_total_value: number;
  sales_count: number;
  orders_count: number;
  orders_by_status: Record<string, number>;
  customers_count: number;
  sellers_count: number;
  active_reservations: number;
  pending_discounts: number;
  low_stock_products: {
    name: string;
    quantity: number;
    low_stock_threshold: number;
    provincia?: string | null;
  }[];
  sales_by_seller: { seller: string; sales: number; value: number }[];
  top_products: { name: string; units: number; value: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendentes",
  confirmed: "Confirmadas",
  preparing: "Em preparação",
  ready_pickup: "Prontas",
  in_delivery: "Em entrega",
  completed: "Concluídas",
  cancelled: "Canceladas",
};

export default async function ManagerDashboardPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const [{ data, error }, { data: redeRaw }] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase.rpc("colaboradores_overview"),
  ]);

  const rede = (redeRaw ?? null) as OverviewColaboradores | null;

  const stats = (data ?? {
    sales_total_value: 0,
    sales_count: 0,
    orders_count: 0,
    orders_by_status: {},
    customers_count: 0,
    sellers_count: 0,
    active_reservations: 0,
    pending_discounts: 0,
    low_stock_products: [],
    sales_by_seller: [],
    top_products: [],
  }) as Dashboard;

  const nacional = stats.scope !== "provincial";

  // Nome da província em foco (só quando o âmbito é provincial).
  let nomeProvincia: string | null = null;
  if (!nacional && stats.provincia_id) {
    const { data: prov } = await supabase
      .from("provincias")
      .select("nome, delegacao_nome")
      .eq("id", stats.provincia_id)
      .maybeSingle();
    nomeProvincia = (prov as { nome: string } | null)?.nome ?? null;
  }

  return (
    <>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">Painel de gestão</h1>
        <p className="mb-4 text-[#A3A3A3]">Indicadores calculados a partir dos dados reais.</p>

        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#C9A962]/30 bg-[#C9A962]/5 px-4 py-1.5 text-xs text-[#C9A962]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#C9A962]" />
          {nacional
            ? "A ver: Nacional (todas as províncias)"
            : `A ver: Província do ${nomeProvincia ?? "—"}`}
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">
            Não foi possível carregar os indicadores: {error.message}
          </div>
        )}

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Valor vendido" value={formatCurrency(Number(stats.sales_total_value))} />
          <Stat label="Vendas" value={String(stats.sales_count)} />
          <Stat label="Encomendas" value={String(stats.orders_count)} />
          <Stat label="Clientes" value={String(stats.customers_count)} />
          <Stat label="Colaboradores ativos" value={String(stats.sellers_count)} />
          <Stat label="Reservas ativas" value={String(stats.active_reservations)} />
          <Stat label="Descontos pendentes" value={String(stats.pending_discounts)} />
          <Stat label="Stock baixo" value={String(stats.low_stock_products?.length ?? 0)} />
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Action href="/gerente/produtos" title="Produtos e stock" />
          <Action href="/gerente/promocoes" title="Promoções por província" />
          <Action href="/gerente/levantamentos" title="Levantamentos de comissões" />
          <Action href="/loja" title="Loja (stock e balcão)" />
          <Action href="/gerente/perfis" title="Perfis e permissões" />
          <Action href="/gerente/provincias" title="Províncias e delegações" />
          <Action href="/gerente/categorias" title="Categorias" />
          <Action href="/gerente/encomendas" title="Encomendas" />
          <Action href="/gerente/descontos" title="Descontos" />
          <Action href="/gerente/clientes" title="Clientes" />
          <Action href="/gerente/colaboradores" title="Colaboradores" />
          <Action href="/gerente/revendedores" title="Candidaturas a colaborador" />
          <Action href="/gerente/conversas" title="Mensagens" />
          <Action href="/gerente/relatorios" title="Relatórios" />
          <Action href="/gerente/conteudos" title="Conteúdos publicados" />
          <Action href="/gerente/formacao" title="Formação INUKA" />
          <Action href="/gerente/definicoes" title="Definições e aplicações" />
          <Action href="/designer" title="Estúdio de design" />
        </div>

        {rede && (
          <section className="mb-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xl font-light text-[#F5F5F5]">Rede de colaboradores</h2>
                <p className="text-sm text-[#A3A3A3]">
                  {rede.scope === "nacional" ? "Todas as províncias" : "A sua província"} · mês corrente
                </p>
              </div>
              <Link
                href="/gerente/colaboradores"
                className="rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
              >
                Pesquisar colaboradores →
              </Link>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Colaboradores"
                value={`${rede.totais.colaboradores_ativos} / ${rede.totais.colaboradores}`}
              />
              <Stat label="Inativos" value={String(rede.totais.colaboradores_inativos)} />
              <Stat label="Vendas da rede" value={formatCurrency(numero(rede.totais.vendas_valor))} />
              <Stat label="Comissões geradas" value={formatCurrency(numero(rede.totais.comissao_gerada))} />
              <Stat label="Comissões pagas" value={formatCurrency(numero(rede.totais.comissao_paga))} />
              <Stat
                label="Comissões por pagar"
                value={formatCurrency(numero(rede.totais.comissao_pendente))}
              />
              <Stat
                label="Metas atingidas"
                value={`${rede.totais.metas_atingidas} / ${rede.totais.metas_em_curso}`}
              />
              <Stat label="Clientes" value={String(rede.totais.clientes)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="overflow-hidden rounded-xl border border-[#262626] lg:col-span-2">
                <div className="border-b border-[#1F1F1F] bg-[#141414] px-4 py-3 text-sm font-medium text-[#F5F5F5]">
                  Análise por província
                </div>
                <TabelaResponsiva
                  itens={rede.provincias.filter(
                    (p) => p.colaboradores > 0 || numero(p.vendas_valor) > 0
                  )}
                  chaveDe={(p) => p.id}
                  minimo={560}
                  moldura={false}
                  vazio={
                    <p className="px-4 py-6 text-center text-sm text-[#525252]">
                      Ainda não há colaboradores nem vendas por província.
                    </p>
                  }
                  colunas={[
                    {
                      chave: "provincia",
                      rotulo: "Província",
                      titulo: true,
                      celula: (p) => (
                        <span className="text-[#F5F5F5]">
                          {p.nome}
                          <span className="ml-2 font-mono text-[10px] text-[#525252]">{p.codigo}</span>
                        </span>
                      ),
                    },
                    {
                      chave: "colab",
                      rotulo: "Colab.",
                      alinhar: "direita",
                      celula: (p) => (
                        <span className="text-[#A3A3A3]">
                          {p.colaboradores_ativos}/{p.colaboradores}
                        </span>
                      ),
                    },
                    {
                      chave: "clientes",
                      rotulo: "Clientes",
                      alinhar: "direita",
                      celula: (p) => <span className="text-[#A3A3A3]">{p.clientes}</span>,
                    },
                    {
                      chave: "vendido",
                      rotulo: "Vendido",
                      alinhar: "direita",
                      celula: (p) => (
                        <span className="text-[#C9A962]">{formatCurrency(numero(p.vendas_valor))}</span>
                      ),
                    },
                    {
                      chave: "comissoes",
                      rotulo: "Comissões",
                      alinhar: "direita",
                      celula: (p) => (
                        <span className="text-[#A3A3A3]">{formatCurrency(numero(p.comissao))}</span>
                      ),
                    },
                  ]}
                />
              </div>

              <Panel title="Ranking de colaboradores">
                {rede.ranking.length === 0 ? (
                  <Empty />
                ) : (
                  <ul className="space-y-3 text-sm">
                    {rede.ranking.slice(0, 6).map((r, i) => (
                      <li key={r.id} className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C9A962]/30 bg-[#0A0A0A]">
                            {r.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.avatar_url} alt={r.nome} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[9px] text-[#C9A962]">{iniciais(r.nome)}</span>
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[#F5F5F5]">
                              <span className="mr-2 text-[#525252]">{i + 1}.</span>
                              <Link href={`/gerente/colaboradores/${r.id}`} className="hover:text-[#C9A962]">
                                {r.nome}
                              </Link>
                            </p>
                            <p className="font-mono text-[10px] text-[#525252]">
                              {r.referencia ?? "—"}
                              {r.provincia ? ` · ${r.provincia}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-[#C9A962]">
                          {formatCurrency(numero(r.vendas_valor))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Encomendas por estado">
            {Object.keys(stats.orders_by_status ?? {}).length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2 text-sm">
                {Object.entries(stats.orders_by_status).map(([status, qty]) => (
                  <li key={status} className="flex justify-between">
                    <span className="text-[#A3A3A3]">{STATUS_LABEL[status] ?? status}</span>
                    <span className="text-[#F5F5F5]">{qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Vendas por colaborador">
            {!stats.sales_by_seller || stats.sales_by_seller.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.sales_by_seller.map((s) => (
                  <li key={s.seller} className="flex justify-between">
                    <span className="text-[#A3A3A3]">{s.seller}</span>
                    <span className="text-[#F5F5F5]">{formatCurrency(Number(s.value))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Produtos mais vendidos">
            {!stats.top_products || stats.top_products.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.top_products.map((p) => (
                  <li key={p.name} className="flex justify-between">
                    <span className="text-[#A3A3A3]">{p.name}</span>
                    <span className="text-[#F5F5F5]">{p.units} un.</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Stock baixo">
            {!stats.low_stock_products || stats.low_stock_products.length === 0 ? (
              <Empty text="Sem alertas de stock." />
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.low_stock_products.map((p) => (
                  <li key={`${p.name}-${p.provincia ?? ""}`} className="flex justify-between">
                    <span className="text-[#A3A3A3]">
                      {p.name}
                      {p.provincia && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-[#525252]">
                          {p.provincia}
                        </span>
                      )}
                    </span>
                    <span className="text-[#DC2626]">{p.quantity} un.</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <p className="mb-1 text-xs uppercase tracking-wide text-[#525252]">{label}</p>
      <p className="text-xl font-medium text-[#C9A962]">{value}</p>
    </div>
  );
}

function Action({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5 text-sm font-medium text-[#F5F5F5] transition hover:border-[#C9A962]/40 hover:text-[#C9A962]"
    >
      {title}
    </Link>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <h2 className="mb-4 text-lg font-medium text-[#F5F5F5]">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text = "Sem dados no período." }: { text?: string }) {
  return <p className="text-sm text-[#525252]">{text}</p>;
}
