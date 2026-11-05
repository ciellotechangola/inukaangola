import { redirect } from "next/navigation";
import Link from "next/link";
import { Receipt, Store } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ItemCompra {
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | string;
  total_price: number | string;
}

interface Compra {
  id: string;
  reference: string;
  created_at: string;
  total: number | string;
  payment_status: string;
  payment_method: string | null;
  seller_name: string | null;
  seller_phone: string | null;
  provincia: string | null;
  items: ItemCompra[];
}

const ESTADO: Record<string, { label: string; cor: string }> = {
  paid: { label: "Pago", cor: "text-[#7FD1A0] border-[#1F4D2E]" },
  partial: { label: "Parcial", cor: "text-[#C9A962] border-[#4A3F24]" },
  pending: { label: "Pendente", cor: "text-[#D4A5A5] border-[#4A2020]" },
  refunded: { label: "Reembolsado", cor: "text-[#A3A3A3] border-[#333]" },
};

const PAGAMENTO: Record<string, string> = {
  cash: "Numerário",
  transfer: "Transferência",
  multicaixa: "Multicaixa",
  other: "Outro",
};

function dataLonga(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * As compras do cliente.
 *
 * Inclui as que foram registadas **antes** de ele ter conta: o colaborador
 * vendeu e anotou o telefone; no registo, `ligar_reserva_ao_cliente` entregou
 * essas vendas a esta conta. Sem esta página, o cliente tinha compras em seu
 * nome que nunca conseguiria ver.
 *
 * Os dados vêm de `minhas_compras()` — uma função que devolve só o que é do
 * próprio, incluindo o nome do colaborador que vendeu (que o RLS de `profiles`
 * não deixaria ler directamente).
 */
export default async function ComprasPage() {
  const perfil = await getProfile();
  if (!perfil) redirect("/login?redirect=/cliente/compras");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("minhas_compras");
  const compras = (data ?? []) as Compra[];

  const total = compras.reduce((n, c) => n + (Number(c.total) || 0), 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/cliente"
        className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]"
      >
        ← Área do cliente
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">As minhas compras</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          {compras.length === 0
            ? "Ainda não há compras registadas com o seu número."
            : `${compras.length} ${compras.length === 1 ? "compra" : "compras"} · ${formatCurrency(total)}`}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          Não foi possível ler as compras. {error.message}
        </div>
      )}

      {compras.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
          <Receipt className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Sem compras por enquanto.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            Quando comprar na loja ou a um colaborador INUKA, a compra aparece aqui — com o
            produto, a quantidade e o preço.
          </p>
          <Link
            href="/catalogo"
            className="mt-1 inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
          >
            Ver catálogo
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {compras.map((c) => {
            const estado = ESTADO[c.payment_status] ?? {
              label: c.payment_status,
              cor: "text-[#A3A3A3] border-[#333]",
            };

            return (
              <li key={c.id} className="rounded-xl border border-[#262626] bg-[#141414] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[#F5F5F5]">
                      Compra <span className="font-mono text-[13px] text-[#C9A962]">{c.reference}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-[#6F6F6F]">{dataLonga(c.created_at)}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8A8A8A]">
                      <Store className="h-3 w-3 text-[#C9A962]" />
                      {c.seller_name ? `Vendido por ${c.seller_name}` : "Vendido pela loja INUKA"}
                      {c.provincia ? ` · ${c.provincia}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-[#C9A962]">{formatCurrency(Number(c.total) || 0)}</p>
                    <span
                      className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${estado.cor}`}
                    >
                      {estado.label}
                    </span>
                    {c.payment_method && (
                      <p className="mt-1 text-[10px] text-[#5F5F5F]">
                        {PAGAMENTO[c.payment_method] ?? c.payment_method}
                      </p>
                    )}
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5 border-t border-[#242424] pt-3">
                  {c.items.map((it, i) => (
                    <li key={`${c.id}-${i}`} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm text-[#D4D4D4]">
                        <span className="text-[#C9A962]">{it.quantity}×</span> {it.name}
                        {it.sku && <span className="ml-1 text-[11px] text-[#525252]">{it.sku}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-[#8A8A8A]">
                        {formatCurrency(Number(it.total_price) || 0)}
                      </span>
                    </li>
                  ))}
                  {c.items.length === 0 && (
                    <li className="text-xs text-[#525252]">Sem linhas registadas.</li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-xs leading-relaxed text-[#525252]">
        Estas compras estão associadas ao seu número de telefone. Se comprou a um colaborador
        antes de ter conta na INUKA, ela aparece aqui a partir do momento em que se registou com
        esse número.
      </p>
    </main>
  );
}
