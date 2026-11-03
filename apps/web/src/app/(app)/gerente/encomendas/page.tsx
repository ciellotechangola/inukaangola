"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClientBrowser } from "@/lib/supabase-browser";
import { updateOrderStatus, type OrderStatus } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface OrderRow {
  id: string;
  reference: string;
  status: OrderStatus;
  total_amount: number;
  delivery_method: string;
  created_at: string;
  customer_id: string;
  contact_phone: string | null;
  seller: { full_name: string } | null;
  customer: { full_name: string; phone: string | null } | null;
}

const STATUSES: { value: OrderStatus; label: string }[] = [
  { value: "pending", label: "Pendente" },
  { value: "confirmed", label: "Confirmada" },
  { value: "preparing", label: "Em preparação" },
  { value: "ready_pickup", label: "Pronta para levantamento" },
  { value: "in_delivery", label: "Em entrega" },
  { value: "completed", label: "Concluída" },
  { value: "cancelled", label: "Cancelada" },
];

export default function ManagerOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const supabase = createClientBrowser();

    // `orders.customer_id` aponta para `auth.users`, não para `public.profiles`.
    // Por isso `profiles!orders_customer_id_fkey` não existe e o PostgREST
    // respondia "Could not find a relationship between 'orders' and 'profiles'".
    // O vendedor tem FK real para profiles, esse embed é válido.
    const { data, error: err } = await supabase
      .from("orders")
      .select(
        "id, reference, status, total_amount, delivery_method, created_at, customer_id, contact_phone, seller:profiles!orders_seller_id_fkey(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const linhas = (data ?? []) as unknown as Omit<OrderRow, "customer">[];
    const ids = [...new Set(linhas.map((o) => o.customer_id).filter(Boolean))];

    // Segunda consulta para os nomes dos clientes, juntos pelo id.
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

    setError("");
    setOrders(
      linhas.map((o) => ({ ...o, customer: clientes.get(o.customer_id) ?? null })) as OrderRow[]
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(orderId: string, status: OrderStatus) {
    setError("");
    setNotice("");
    try {
      await updateOrderStatus(orderId, status);
      setNotice("Estado atualizado.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar.");
    }
  }

  const visible = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>
      <h1 className="mb-6 text-3xl font-light text-[#F5F5F5]">Encomendas</h1>

      {error && <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="mb-4 rounded-lg bg-green-950/50 p-3 text-sm text-green-200">{notice}</div>}

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-4 py-1.5 text-sm ${
            filter === "all"
              ? "border border-[#C9A962] bg-[#C9A962]/10 text-[#C9A962]"
              : "border border-[#404040] text-[#A3A3A3]"
          }`}
        >
          Todas
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(s.value)}
            className={`rounded-full px-4 py-1.5 text-sm ${
              filter === s.value
                ? "border border-[#C9A962] bg-[#C9A962]/10 text-[#C9A962]"
                : "border border-[#404040] text-[#A3A3A3]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[#A3A3A3]">A carregar...</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
          <p className="text-[#A3A3A3]">Sem encomendas neste filtro.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((order) => (
            <div
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262626] bg-[#1A1A1A] p-5"
            >
              <div>
                <p className="font-medium text-[#F5F5F5]">{order.reference}</p>
                <p className="text-xs text-[#525252]">
                  {order.customer?.full_name ?? "Cliente"}
                  {order.customer?.phone ? ` · ${order.customer.phone}` : ""} ·{" "}
                  {new Date(order.created_at).toLocaleString("pt-PT")}
                </p>
                <p className="mt-0.5 text-xs text-[#6F6F6F]">
                  {order.delivery_method === "delivery" ? "Entrega" : "Levantamento"}
                  {order.seller?.full_name ? ` · colaborador: ${order.seller.full_name}` : " · sem colaborador"}
                </p>
              </div>

              <span className="text-sm text-[#C9A962]">
                {formatCurrency(Number(order.total_amount))}
              </span>

              <select
                value={order.status}
                onChange={(e) => changeStatus(order.id, e.target.value as OrderStatus)}
                className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-1.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
