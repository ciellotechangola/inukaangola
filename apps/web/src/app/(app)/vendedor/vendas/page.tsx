import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SellerSalesPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  const supabase = await createClientServer();
  const { data: sales } = await supabase
    .from("sales")
    .select("id, reference, total_amount, payment_status, payment_method, created_at, items:sale_items(quantity, unit_price, product_snapshot)")
    .eq("seller_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/vendedor" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
          ← Área do colaborador
        </Link>
        <h1 className="mb-8 text-3xl font-light text-[#F5F5F5]">Histórico de vendas</h1>

        {!sales || sales.length === 0 ? (
          <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
            <p className="text-[#A3A3A3]">Ainda não registou vendas.</p>
            <Link
              href="/vendedor/vendas/registar"
              className="mt-6 inline-flex rounded-lg bg-[#C9A962] px-6 py-2.5 font-medium text-[#0A0A0A]"
            >
              Registar venda
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sales.map((sale) => (
              <div key={sale.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium text-[#F5F5F5]">{sale.reference}</p>
                  <span className="text-[#C9A962]">{formatCurrency(Number(sale.total_amount))}</span>
                </div>
                <p className="mb-2 text-xs text-[#525252]">
                  {new Date(sale.created_at).toLocaleString("pt-PT")} ·{" "}
                  {sale.payment_method ?? "—"} · {sale.payment_status}
                </p>
                <ul className="space-y-1 text-sm text-[#A3A3A3]">
                  {sale.items?.map(
                    (
                      item: {
                        quantity: number;
                        unit_price: number;
                        product_snapshot: { name?: string };
                      },
                      i: number
                    ) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {item.quantity} × {item.product_snapshot?.name ?? "Produto"}
                        </span>
                        <span>{formatCurrency(Number(item.unit_price) * item.quantity)}</span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
