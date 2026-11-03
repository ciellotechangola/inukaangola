import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ESTADO: Record<string, { rotulo: string; cor: string }> = {
  pending: { rotulo: "Pendente", cor: "bg-yellow-950/60 text-yellow-200" },
  confirmed: { rotulo: "Confirmada", cor: "bg-blue-950/60 text-blue-200" },
  preparing: { rotulo: "Em preparação", cor: "bg-indigo-950/60 text-indigo-200" },
  ready_pickup: { rotulo: "Pronta para levantamento", cor: "bg-cyan-950/60 text-cyan-200" },
  in_delivery: { rotulo: "Em entrega", cor: "bg-purple-950/60 text-purple-200" },
  completed: { rotulo: "Concluída", cor: "bg-green-950/60 text-green-200" },
  cancelled: { rotulo: "Cancelada", cor: "bg-red-950/60 text-red-200" },
};

/**
 * Encomendas do colaborador.
 *
 * Mostra as encomendas em que ele figura como vendedor. Quem muda o estado é a
 * gestão (ou o cliente, no passo final); aqui só se acompanha — é a diferença
 * entre saber o que se passa na carteira e poder mexer no que é da loja.
 */
export default async function EncomendasColaboradorPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  const supabase = await createClientServer();

  // `orders.customer_id` aponta para `auth.users`, não para `profiles`: um
  // embed `profiles!orders_customer_id_fkey` não resolve. Os nomes vão numa
  // segunda consulta.
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, reference, status, total_amount, delivery_method, created_at, customer_id, contact_phone"
    )
    .eq("seller_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const encomendas = (data ?? []) as {
    id: string;
    reference: string;
    status: string;
    total_amount: number;
    delivery_method: string;
    created_at: string;
    customer_id: string;
    contact_phone: string | null;
  }[];

  const ids = [...new Set(encomendas.map((e) => e.customer_id).filter(Boolean))];
  const clientes = new Map<string, { full_name: string; phone: string | null }>();

  if (ids.length > 0) {
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", ids);
    for (const p of perfis ?? []) {
      clientes.set(p.id as string, {
        full_name: p.full_name as string,
        phone: (p.phone as string | null) ?? null,
      });
    }
  }

  const abertas = encomendas.filter((e) => e.status !== "completed" && e.status !== "cancelled");
  const total = encomendas.reduce((s, e) => s + Number(e.total_amount), 0);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/vendedor" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Área de colaborador
      </Link>

      <h1 className="text-3xl font-light text-[#F5F5F5]">Encomendas da minha carteira</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A3A3A3]">
        Encomendas feitas pelos seus clientes. O estado é actualizado pela gestão; o cliente
        confirma a recepção quando a encomenda chega.
      </p>

      {error && (
        <div className="mt-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar as encomendas: {error.message}
        </div>
      )}

      {!error && encomendas.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Indicador rotulo="Em curso" valor={String(abertas.length)} />
          <Indicador rotulo="Total de encomendas" valor={String(encomendas.length)} />
          <Indicador rotulo="Valor acumulado" valor={formatCurrency(total)} />
        </div>
      )}

      {!error && encomendas.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
          <p className="text-sm text-[#A3A3A3]">
            Ainda não há encomendas na sua carteira. Quando um cliente seu comprar na loja, ela
            aparece aqui.
          </p>
          <Link
            href="/vendedor/clientes"
            className="mt-5 inline-flex rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
          >
            Ver a minha carteira
          </Link>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {encomendas.map((e) => {
          const estado = ESTADO[e.status] ?? { rotulo: e.status, cor: "bg-[#262626] text-[#A3A3A3]" };
          const cliente = clientes.get(e.customer_id);

          return (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262626] bg-[#1A1A1A] p-5"
            >
              <div>
                <p className="font-medium tracking-wide text-[#F5F5F5]">{e.reference}</p>
                <p className="text-xs text-[#525252]">
                  {cliente?.full_name ?? "Cliente"}
                  {cliente?.phone ? ` · ${cliente.phone}` : ""} ·{" "}
                  {new Date(e.created_at).toLocaleDateString("pt-PT")}
                </p>
                <p className="mt-0.5 text-[11px] text-[#6F6F6F]">
                  {e.delivery_method === "delivery" ? "Entrega ao domicílio" : "Levantamento"}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-[#C9A962]">
                  {formatCurrency(Number(e.total_amount))}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs ${estado.cor}`}>{estado.rotulo}</span>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function Indicador({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="text-lg font-medium text-[#C9A962]">{valor}</p>
    </div>
  );
}
