"use client";

import { useCallback, useEffect, useState } from "react";
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
  provincia_id: string | null;
  customer?: { full_name: string; phone: string | null } | null;
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

const FILTROS: { valor: string; etiqueta: string }[] = [
  { valor: "ativas", etiqueta: "Por preparar" },
  { valor: "ready_pickup", etiqueta: "Prontas" },
  { valor: "completed", etiqueta: "Concluídas" },
  { valor: "all", etiqueta: "Todas" },
];

export default function EncomendasLoja({ provinciaId }: { provinciaId: string | null }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [filtro, setFiltro] = useState("ativas");

  const load = useCallback(async () => {
    const supabase = createClientBrowser();

    let consulta = supabase
      .from("orders")
      .select(
        "id, reference, status, total_amount, delivery_method, created_at, customer_id, contact_phone, provincia_id"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (provinciaId) consulta = consulta.eq("provincia_id", provinciaId);

    const { data, error } = await consulta;
    if (error) {
      setErro(error.message);
      setLoading(false);
      return;
    }

    const linhas = (data ?? []) as OrderRow[];
    const ids = [...new Set(linhas.map((o) => o.customer_id).filter(Boolean))];

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

    setErro("");
    setOrders(linhas.map((o) => ({ ...o, customer: clientes.get(o.customer_id) ?? null })));
    setLoading(false);
  }, [provinciaId]);

  useEffect(() => {
    load();
  }, [load]);

  async function mudar(id: string, status: OrderStatus) {
    setErro("");
    setAviso("");
    try {
      await updateOrderStatus(id, status);
      setAviso("Estado actualizado.");
      await load();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível actualizar.");
    }
  }

  const visiveis = orders.filter((o) => {
    if (filtro === "all") return true;
    if (filtro === "ativas") return ["pending", "confirmed", "preparing", "in_delivery"].includes(o.status);
    return o.status === filtro;
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            onClick={() => setFiltro(f.valor)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              filtro === f.valor
                ? "border border-[#5FBF8F] bg-[#5FBF8F]/10 text-[#5FBF8F]"
                : "border border-[#404040] text-[#A3A3A3] hover:border-[#5FBF8F]/50"
            }`}
          >
            {f.etiqueta}
            <span className="ml-2 text-[10px] text-[#6F6F6F]">
              {f.valor === "all"
                ? orders.length
                : orders.filter((o) =>
                    f.valor === "ativas"
                      ? ["pending", "confirmed", "preparing", "in_delivery"].includes(o.status)
                      : o.status === f.valor
                  ).length}
            </span>
          </button>
        ))}
      </div>

      {erro && (
        <p className="mb-3 rounded-lg bg-[#2A1010] px-3 py-2 text-sm text-[#F87171]">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-[#0F2A18] px-3 py-2 text-sm text-[#4ADE80]">{aviso}</p>
      )}

      {loading ? (
        <p className="text-sm text-[#A3A3A3]">A carregar…</p>
      ) : visiveis.length === 0 ? (
        <p className="rounded-xl border border-[#262626] bg-[#141414] p-8 text-center text-sm text-[#6F6F6F]">
          Sem encomendas neste filtro.
        </p>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262626] bg-[#141414] p-4"
            >
              <div className="min-w-[200px] flex-1">
                <p className="font-mono text-xs text-[#C9A962]">{o.reference}</p>
                <p className="text-sm text-[#EDEDED]">
                  {o.customer?.full_name ?? "Cliente"}
                  {o.customer?.phone ? ` · ${o.customer.phone}` : ""}
                </p>
                <p className="text-[11px] text-[#6F6F6F]">
                  {o.delivery_method === "delivery" ? "Entrega em casa" : "Levantamento"} ·{" "}
                  {new Date(o.created_at).toLocaleString("pt-PT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              <span className="text-sm font-medium text-[#C9A962]">
                {formatCurrency(Number(o.total_amount))}
              </span>

              <select
                value={o.status}
                onChange={(e) => mudar(o.id, e.target.value as OrderStatus)}
                className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-1.5 text-sm text-[#F5F5F5] focus:border-[#5FBF8F] focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
