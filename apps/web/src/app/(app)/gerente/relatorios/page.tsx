import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Dashboard {
  sales_total_value: number;
  sales_count: number;
  orders_count: number;
  orders_by_status: Record<string, number>;
  customers_count: number;
  sellers_count: number;
  active_reservations: number;
  pending_discounts: number;
  low_stock_products: { name: string; quantity: number; low_stock_threshold: number }[];
  sales_by_seller: { seller: string; sales: number; value: number }[];
  top_products: { name: string; units: number; value: number }[];
}

const VAZIO: Dashboard = {
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
};

const PERIODOS = {
  "7d": { etiqueta: "7 dias", dias: 7 },
  "30d": { etiqueta: "30 dias", dias: 30 },
  "90d": { etiqueta: "90 dias", dias: 90 },
  ano: { etiqueta: "12 meses", dias: 365 },
} as const;

type ChavePeriodo = keyof typeof PERIODOS;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendentes",
  confirmed: "Confirmadas",
  preparing: "Em preparação",
  ready_pickup: "Prontas",
  in_delivery: "Em entrega",
  completed: "Concluídas",
  cancelled: "Canceladas",
};

function variacao(atual: number, anterior: number): { texto: string; positiva: boolean } | null {
  if (!anterior) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  return {
    texto: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
    positiva: pct >= 0,
  };
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const sp = await searchParams;
  const bruto = Array.isArray(sp.periodo) ? sp.periodo[0] : sp.periodo;
  const chave: ChavePeriodo = bruto && bruto in PERIODOS ? (bruto as ChavePeriodo) : "30d";
  const dias = PERIODOS[chave].dias;

  const agora = Date.now();
  const desde = new Date(agora - dias * 86_400_000).toISOString();
  const ate = new Date(agora).toISOString();
  // Período anterior, com a mesma duração, para comparar.
  const desdeAnterior = new Date(agora - dias * 2 * 86_400_000).toISOString();
  const ateAnterior = desde;

  const supabase = await createClientServer();
  const [atualRes, anteriorRes] = await Promise.all([
    supabase.rpc("dashboard_stats", { p_from: desde, p_to: ate }),
    supabase.rpc("dashboard_stats", { p_from: desdeAnterior, p_to: ateAnterior }),
  ]);

  const atual = (atualRes.data ?? VAZIO) as Dashboard;
  const anterior = (anteriorRes.data ?? VAZIO) as Dashboard;

  const ticket = atual.sales_count > 0 ? Number(atual.sales_total_value) / atual.sales_count : 0;
  const ticketAnterior =
    anterior.sales_count > 0 ? Number(anterior.sales_total_value) / anterior.sales_count : 0;

  const cartoes = [
    {
      label: "Valor vendido",
      valor: formatCurrency(Number(atual.sales_total_value)),
      delta: variacao(Number(atual.sales_total_value), Number(anterior.sales_total_value)),
    },
    {
      label: "Vendas",
      valor: String(atual.sales_count),
      delta: variacao(atual.sales_count, anterior.sales_count),
    },
    {
      label: "Ticket médio",
      valor: formatCurrency(ticket),
      delta: variacao(ticket, ticketAnterior),
    },
    {
      label: "Encomendas",
      valor: String(atual.orders_count),
      delta: variacao(atual.orders_count, anterior.orders_count),
    },
  ];

  const totalEncomendas = Object.values(atual.orders_by_status ?? {}).reduce((a, b) => a + b, 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Relatórios</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            Indicadores calculados a partir das vendas e encomendas reais.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(PERIODOS) as ChavePeriodo[]).map((p) => (
            <Link
              key={p}
              href={`/gerente/relatorios?periodo=${p}`}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                chave === p
                  ? "border-[#C9A962] text-[#C9A962]"
                  : "border-[#333] text-[#8A8A8A] hover:border-[#C9A962]/60 hover:text-[#C9A962]"
              }`}
            >
              {PERIODOS[p].etiqueta}
            </Link>
          ))}
        </div>
      </div>

      {atualRes.error && (
        <div className="mb-6 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">
          Não foi possível carregar os indicadores: {atualRes.error.message}
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.map((c) => (
          <div key={c.label} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
            <p className="mb-1 text-xs uppercase tracking-wide text-[#525252]">{c.label}</p>
            <p className="text-xl font-medium text-[#C9A962]">{c.valor}</p>
            {c.delta ? (
              <p className={`mt-1 text-xs ${c.delta.positiva ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                {c.delta.texto} vs. período anterior
              </p>
            ) : (
              <p className="mt-1 text-xs text-[#3F3F3F]">sem base de comparação</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Painel titulo="Vendas por colaborador">
          {atual.sales_by_seller?.length ? (
            <div className="tabela-deslizante">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
                  <th className="pb-2 font-normal">Colaborador</th>
                  <th className="pb-2 text-right font-normal">Vendas</th>
                  <th className="pb-2 text-right font-normal">Valor</th>
                </tr>
              </thead>
              <tbody>
                {atual.sales_by_seller.map((s) => (
                  <tr key={s.seller} className="border-t border-[#1F1F1F]">
                    <td className="py-2 text-[#E5E5E5]">{s.seller}</td>
                    <td className="py-2 text-right text-[#A3A3A3]">{s.sales}</td>
                    <td className="py-2 text-right text-[#C9A962]">
                      {formatCurrency(Number(s.value))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <Vazio />
          )}
        </Painel>

        <Painel titulo="Produtos mais vendidos">
          {atual.top_products?.length ? (
            <div className="tabela-deslizante">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
                  <th className="pb-2 font-normal">Produto</th>
                  <th className="pb-2 text-right font-normal">Unidades</th>
                  <th className="pb-2 text-right font-normal">Valor</th>
                </tr>
              </thead>
              <tbody>
                {atual.top_products.map((p) => (
                  <tr key={p.name} className="border-t border-[#1F1F1F]">
                    <td className="py-2 text-[#E5E5E5]">{p.name}</td>
                    <td className="py-2 text-right text-[#A3A3A3]">{p.units}</td>
                    <td className="py-2 text-right text-[#C9A962]">
                      {formatCurrency(Number(p.value))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <Vazio />
          )}
        </Painel>

        <Painel titulo="Encomendas por estado">
          {totalEncomendas === 0 ? (
            <Vazio />
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(atual.orders_by_status).map(([status, qtd]) => {
                const pct = Math.round((Number(qtd) / totalEncomendas) * 100);
                return (
                  <li key={status}>
                    <div className="mb-1 flex justify-between">
                      <span className="text-[#A3A3A3]">{STATUS_LABEL[status] ?? status}</span>
                      <span className="text-[#F5F5F5]">
                        {qtd} <span className="text-[#525252]">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#262626]">
                      <div className="h-full rounded-full bg-[#C9A962]" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Painel>

        <Painel titulo="Stock baixo">
          {atual.low_stock_products?.length ? (
            <ul className="space-y-2 text-sm">
              {atual.low_stock_products.map((p) => (
                <li key={p.name} className="flex justify-between">
                  <span className="text-[#A3A3A3]">{p.name}</span>
                  <span className="text-[#DC2626]">
                    {p.quantity} un. <span className="text-[#525252]">/ mín. {p.low_stock_threshold}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio texto="Sem alertas de stock." />
          )}
        </Painel>
      </div>

      <p className="mt-8 text-xs text-[#525252]">
        Período: {new Date(desde).toLocaleDateString("pt-PT")} —{" "}
        {new Date(ate).toLocaleDateString("pt-PT")} · comparado com os {dias} dias anteriores.
        Clientes activos: {atual.customers_count} · colaboradores: {atual.sellers_count} · reservas
        activas: {atual.active_reservations} · descontos pendentes: {atual.pending_discounts}.
      </p>
    </main>
  );
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <h2 className="mb-4 text-lg font-medium text-[#F5F5F5]">{titulo}</h2>
      {children}
    </div>
  );
}

function Vazio({ texto = "Sem dados no período." }: { texto?: string }) {
  return <p className="text-sm text-[#525252]">{texto}</p>;
}
