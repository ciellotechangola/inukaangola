"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClientBrowser } from "@/lib/supabase-browser";
import { decideDiscount } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface DiscountRow {
  id: string;
  status: string;
  official_price: number;
  requested_price: number;
  final_price: number | null;
  justification: string | null;
  created_at: string;
  product: { name: string } | null;
  customer: { full_name: string } | null;
}

const LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Recusado",
  cancelled: "Cancelado",
};

export default function ManagerDiscountsPage() {
  const [rows, setRows] = useState<DiscountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const supabase = createClientBrowser();
    const { data, error: err } = await supabase
      .from("discount_requests")
      .select(
        "id, status, official_price, requested_price, final_price, justification, created_at, product:products(name), customer:profiles!discount_requests_customer_id_fkey(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (err) setError(err.message);
    setRows((data ?? []) as unknown as DiscountRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, approve: boolean, price: number) {
    setError("");
    setNotice("");
    try {
      await decideDiscount(id, approve, approve ? price : undefined);
      setNotice(approve ? "Desconto aprovado." : "Desconto recusado.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível decidir.");
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>
      <h1 className="mb-6 text-3xl font-light text-[#F5F5F5]">Pedidos de desconto</h1>

      {error && <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="mb-4 rounded-lg bg-green-950/50 p-3 text-sm text-green-200">{notice}</div>}

      {loading ? (
        <p className="text-[#A3A3A3]">A carregar...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
          <p className="text-[#A3A3A3]">Sem pedidos de desconto.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-[#F5F5F5]">{row.product?.name ?? "Produto"}</p>
                  <p className="text-xs text-[#525252]">
                    {row.customer?.full_name ?? "Cliente"} ·{" "}
                    {new Date(row.created_at).toLocaleDateString("pt-PT")}
                  </p>
                </div>
                <span className="rounded-full bg-[#262626] px-3 py-1 text-xs text-[#A3A3A3]">
                  {LABEL[row.status] ?? row.status}
                </span>
              </div>

              <p className="mb-3 text-sm text-[#A3A3A3]">
                Oficial {formatCurrency(Number(row.official_price))} → pedido{" "}
                <span className="text-[#C9A962]">{formatCurrency(Number(row.requested_price))}</span>
                {row.final_price ? ` · aprovado ${formatCurrency(Number(row.final_price))}` : ""}
              </p>

              {row.justification && (
                <p className="mb-3 rounded-lg bg-[#0A0A0A] p-3 text-sm text-[#A3A3A3]">
                  “{row.justification}”
                </p>
              )}

              {row.status === "pending" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => decide(row.id, true, Number(row.requested_price))}
                    className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
                  >
                    Aprovar
                  </button>
                  <button
                    onClick={() => decide(row.id, false, 0)}
                    className="rounded-lg border border-[#404040] px-4 py-2 text-sm text-[#F5F5F5] transition hover:border-[#DC2626] hover:text-[#DC2626]"
                  >
                    Recusar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
