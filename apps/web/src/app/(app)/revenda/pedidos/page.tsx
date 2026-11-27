import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, MessageSquare } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { ESTADOS, estadoDe, normalizarPedido } from "@/lib/revenda";

export const dynamic = "force-dynamic";

/**
 * Pedidos de grosso do revendedor.
 *
 * O RLS já limita a lista ao próprio revendedor; não é preciso filtrar aqui.
 * Cada pedido mostra os itens com o preço que ficou congelado no momento em
 * que foi feito.
 */
export default async function PedidosGrossoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/revenda/pedidos");
  if (profile.role === "manager") redirect("/gerente/revendedores");
  if (profile.role !== "reseller") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase
    .from("revendedor_pedidos")
    .select(
      "id, numero, status, mensagem, total_unidades, valor_estimado, resposta, respondido_at, created_at, itens:revendedor_pedido_itens(id, nome_produto, sku, quantidade, preco_unitario, subtotal)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const pedidos = ((data ?? []) as unknown[]).map(normalizarPedido);
  const semTabela = error && /PGRST205|does not exist/i.test(error.message);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/revenda" className="text-xs text-[#6F6F6F] hover:text-[#C9A962]">
        ← Área de revenda
      </Link>

      <header className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Pedidos de grosso</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            Do pedido à entrega. Cada linha guarda o preço do dia em que foi pedida.
          </p>
        </div>
        <Link
          href="/revenda/catalogo"
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
        >
          Novo pedido
          <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      {semTabela && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0026 (`PATCH_REVENDEDORES.sql`) nesta base.
        </div>
      )}

      {error && !semTabela && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          {error.message}
        </div>
      )}

      {!error && pedidos.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <ClipboardList className="mx-auto mb-3 h-6 w-6 text-[#3A3A3A]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há pedidos.</p>
          <Link
            href="/revenda/catalogo"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#C9A962] hover:underline"
          >
            Abrir o catálogo de grosso
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {pedidos.map((p) => {
          const estado = estadoDe(p.status);
          return (
            <article key={p.id} className="rounded-xl border border-[#262626] bg-[#141414] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-[#F5F5F5]">{p.numero}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADOS[estado].cor}`}
                    >
                      {ESTADOS[estado].rotulo}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#8A8A8A]">
                    {new Date(p.created_at).toLocaleString("pt-PT")} · {p.total_unidades}{" "}
                    unidades · {p.itens?.length ?? 0} produto
                    {(p.itens?.length ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-lg font-light text-[#C9A962]">
                  {formatCurrency(p.valor_estimado)}
                </p>
              </div>

              {p.mensagem && (
                <p className="mt-3 rounded-lg bg-[#0F0F0F] p-3 text-xs leading-relaxed text-[#A3A3A3]">
                  {p.mensagem}
                </p>
              )}

              {p.resposta && (
                <div className="mt-3 rounded-lg border border-[#C9A962]/30 bg-[#C9A962]/5 p-3">
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#C9A962]">
                    <MessageSquare className="h-3 w-3" />
                    Resposta da gestão
                    {p.respondido_at
                      ? ` · ${new Date(p.respondido_at).toLocaleDateString("pt-PT")}`
                      : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[#E5E5E5]">
                    {p.resposta}
                  </p>
                </div>
              )}

              {(p.itens?.length ?? 0) > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] text-[#6F6F6F] hover:text-[#C9A962]">
                    Ver {p.itens!.length} linha{p.itens!.length === 1 ? "" : "s"} do pedido
                  </summary>
                  <ul className="mt-2 divide-y divide-[#1F1F1F] rounded-lg border border-[#1F1F1F]">
                    {p.itens!.map((i) => (
                      <li
                        key={i.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <span className="min-w-0 text-[#E5E5E5]">
                          {i.nome_produto}
                          {i.sku && <span className="ml-1 text-[#525252]">· {i.sku}</span>}
                        </span>
                        <span className="text-[#8A8A8A]">
                          {i.quantidade} × {formatCurrency(i.preco_unitario)} ={" "}
                          <span className="text-[#E5E5E5]">{formatCurrency(i.subtotal)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
