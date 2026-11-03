import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import ConfirmarEntrega from "./ConfirmarEntrega";
import SeguirEncomendas from "./SeguirEncomendas";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmada",
  preparing: "Em preparação",
  ready_pickup: "Pronta para levantamento",
  in_delivery: "Em entrega",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-950/60 text-yellow-200",
  confirmed: "bg-blue-950/60 text-blue-200",
  preparing: "bg-indigo-950/60 text-indigo-200",
  ready_pickup: "bg-cyan-950/60 text-cyan-200",
  in_delivery: "bg-purple-950/60 text-purple-200",
  completed: "bg-green-950/60 text-green-200",
  cancelled: "bg-red-950/60 text-red-200",
};

interface Passo {
  id: string;
  status: string;
  created_at: string;
  notes: string | null;
}

export default async function MyOrdersPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/cliente/encomendas");

  const supabase = await createClientServer();
  const { data: orders } = await supabase
    .from("orders")
    .select("*, items:order_items(*, product:products(name, sku))")
    .eq("customer_id", profile.id)
    .order("created_at", { ascending: false });

  // O percurso da encomenda. A política de leitura de `order_status_history`
  // já deixa o comprador ver o histórico das suas — não é preciso RPC.
  const ids = (orders ?? []).map((o: { id: string }) => o.id);
  const { data: historico } = ids.length
    ? await supabase
        .from("order_status_history")
        .select("id, order_id, status, created_at, notes")
        .in("order_id", ids)
        .order("created_at", { ascending: true })
    : { data: [] as (Passo & { order_id: string })[] };

  const porEncomenda = new Map<string, Passo[]>();
  for (const linha of (historico ?? []) as (Passo & { order_id: string })[]) {
    const lista = porEncomenda.get(linha.order_id) ?? [];
    lista.push({ id: linha.id, status: linha.status, created_at: linha.created_at, notes: linha.notes });
    porEncomenda.set(linha.order_id, lista);
  }

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/cliente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
          ← Área de cliente
        </Link>
        <h1 className="mb-8 text-3xl font-light text-[#F5F5F5]">As minhas encomendas</h1>

        <SeguirEncomendas clienteId={profile.id} />

        {!orders || orders.length === 0 ? (
          <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
            <p className="text-[#A3A3A3]">Ainda não tem encomendas.</p>
            <Link
              href="/catalogo"
              className="mt-6 inline-flex rounded-lg bg-[#C9A962] px-6 py-2.5 font-medium text-[#0A0A0A]"
            >
              Ver catálogo
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const hist = porEncomenda.get(order.id) ?? [];
              const emCurso = order.status !== "completed" && order.status !== "cancelled";
              return (
              <div key={order.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium tracking-wide text-[#F5F5F5]">{order.reference}</p>
                    <p className="text-xs text-[#525252]">
                      {new Date(order.created_at).toLocaleString("pt-PT")}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${
                      STATUS_STYLE[order.status] ?? "bg-[#262626] text-[#A3A3A3]"
                    }`}
                  >
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </div>

                <ul className="mb-3 space-y-1 text-sm text-[#A3A3A3]">
                  {order.items?.map((item: { id: string; quantity: number; unit_price: number; product?: { name: string } }) => (
                    <li key={item.id} className="flex justify-between">
                      <span>
                        {item.quantity} × {item.product?.name ?? "Produto"}
                      </span>
                      <span>{formatCurrency(Number(item.unit_price) * item.quantity)}</span>
                    </li>
                  ))}
                </ul>

                {hist.length > 0 && (
                  <details open={emCurso} className="mb-3">
                    <summary className="cursor-pointer text-xs uppercase tracking-wider text-[#6F6F6F] hover:text-[#C9A962]">
                      Histórico ({hist.length})
                    </summary>
                    <ol className="mt-3 space-y-2 border-l border-[#262626] pl-4">
                      {hist.map((passo) => (
                        <li key={passo.id} className="relative text-xs">
                          <span
                            className={`absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full ${
                              passo.status === order.status ? "bg-[#C9A962]" : "bg-[#404040]"
                            }`}
                          />
                          <span className="text-[#F5F5F5]">
                            {STATUS_LABEL[passo.status] ?? passo.status}
                          </span>
                          <span className="text-[#525252]">
                            {" "}
                            · {new Date(passo.created_at).toLocaleString("pt-PT")}
                          </span>
                          {passo.notes && <p className="text-[#6F6F6F]">{passo.notes}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                <div className="flex items-center justify-between border-t border-[#262626] pt-3">
                  <span className="text-sm text-[#A3A3A3]">
                    {order.delivery_method === "delivery" ? "Entrega" : "Levantamento"}
                  </span>
                  <span className="font-medium text-[#C9A962]">
                    {formatCurrency(Number(order.total_amount))}
                  </span>
                </div>

                {(order.status === "in_delivery" || order.status === "ready_pickup") && (
                  <ConfirmarEntrega orderId={order.id} />
                )}
              </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
