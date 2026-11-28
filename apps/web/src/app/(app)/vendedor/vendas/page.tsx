import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { COR_PAGAMENTO, ROTULO_PAGAMENTO, type EstadoPagamento } from "@/lib/vendas";

export const dynamic = "force-dynamic";

/**
 * Histórico de vendas do colaborador.
 *
 * A situação aparece como selo, não como texto técnico: `pending` e `paid` são
 * nomes da base de dados e não dizem nada a quem vende. «Pendente» diz que o
 * dinheiro ainda não entrou e que não conta para o que pode levantar; «Pago»
 * diz que a gestão já confirmou.
 *
 * O colaborador vê o estado e não o muda — quem confirma o recebimento é a
 * gestão. Isso é uma regra da base (`sales_update_manager`), não uma omissão
 * desta página.
 */
export default async function SellerSalesPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  const supabase = await createClientServer();
  const { data: sales } = await supabase
    .from("sales")
    .select(
      "id, reference, total_amount, payment_status, status, payment_method, created_at, payment_confirmed_at, items:sale_items(quantity, unit_price, product_snapshot)"
    )
    .eq("seller_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const lista = (sales ?? []) as unknown as {
    id: string;
    reference: string;
    total_amount: number;
    payment_status: EstadoPagamento;
    status: "completed" | "cancelled";
    payment_method: string | null;
    created_at: string;
    payment_confirmed_at: string | null;
    items: { quantity: number; unit_price: number; product_snapshot: { name?: string } }[] | null;
  }[];

  const porConfirmar = lista
    .filter((s) => s.status !== "cancelled" && s.payment_status !== "paid")
    .reduce((soma, s) => soma + Number(s.total_amount), 0);
  const confirmado = lista
    .filter((s) => s.status !== "cancelled" && s.payment_status === "paid")
    .reduce((soma, s) => soma + Number(s.total_amount), 0);

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/vendedor" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
          ← Área do colaborador
        </Link>
        <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">Histórico de vendas</h1>
        <p className="mb-6 text-sm text-[#A3A3A3]">
          O que está pendente ainda não entrou; o que está pago já foi confirmado pela gestão.
        </p>

        {lista.length > 0 && (
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
              <p className="text-[10px] uppercase tracking-wide text-[#525252]">Volume vendido</p>
              <p className="mt-1 text-lg text-[#E5E5E5]">
                {formatCurrency(porConfirmar + confirmado)}
              </p>
            </div>
            <div className="rounded-xl border border-[#4A3F1F] bg-[#241E0E]/60 p-4">
              <p className="text-[10px] uppercase tracking-wide text-[#8A7A3F]">Por confirmar</p>
              <p className="mt-1 text-lg text-[#C9A962]">{formatCurrency(porConfirmar)}</p>
            </div>
            <div className="rounded-xl border border-[#1F4D2E] bg-[#0E2417]/60 p-4">
              <p className="text-[10px] uppercase tracking-wide text-[#3F7A54]">Confirmado</p>
              <p className="mt-1 text-lg text-[#4ADE80]">{formatCurrency(confirmado)}</p>
            </div>
          </div>
        )}

        {lista.length === 0 ? (
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
            {lista.map((sale) => {
              const anulada = sale.status === "cancelled";
              return (
                <div key={sale.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[#F5F5F5]">{sale.reference}</p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          anulada
                            ? "border-[#4A2020] bg-[#2A1010] text-[#F87171]"
                            : COR_PAGAMENTO[sale.payment_status]
                        }`}
                      >
                        {anulada ? "Anulada" : ROTULO_PAGAMENTO[sale.payment_status]}
                      </span>
                    </div>
                    <span className="text-[#C9A962]">{formatCurrency(Number(sale.total_amount))}</span>
                  </div>
                  <p className="mb-2 text-xs text-[#525252]">
                    {new Date(sale.created_at).toLocaleString("pt-PT")} ·{" "}
                    {sale.payment_method ?? "—"}
                    {sale.payment_status === "paid" && sale.payment_confirmed_at
                      ? ` · confirmado a ${new Date(sale.payment_confirmed_at).toLocaleDateString("pt-PT")}`
                      : ""}
                  </p>
                  <ul className="space-y-1 text-sm text-[#A3A3A3]">
                    {sale.items?.map((item, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {item.quantity} × {item.product_snapshot?.name ?? "Produto"}
                        </span>
                        <span>{formatCurrency(Number(item.unit_price) * item.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
