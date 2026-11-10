"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, ChevronUp, Loader2, Pencil } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { mensagemDeErro } from "@/lib/erros";
import { formatCurrency } from "@/lib/utils";

export interface LinhaVenda {
  id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  produto: string | null;
}

export interface VendaCorrigivel {
  id: string;
  reference: string;
  total_amount: number;
  status: string;
  payment_status: string;
  created_at: string;
  linhas: LinhaVenda[];
}

/**
 * Corrigir uma venda já registada.
 *
 * O total de uma venda não é um campo livre: é a soma das linhas
 * (`trg_recalc_sale_total`) e é dela que sai a comissão
 * (`trg_fill_commission`). Editar o total à mão deixaria as linhas a dizer uma
 * coisa e o cabeçalho outra — por isso a correcção faz-se na quantidade e no
 * preço unitário, e o resto acompanha sozinho.
 *
 * Uma venda com a comissão já paga não se mexe: a base recusa (e diz porquê)
 * antes de ficar um valor errado no histórico.
 */
export function CorrigirVendas({
  vendas,
  falhaLeitura,
}: {
  vendas: VendaCorrigivel[];
  falhaLeitura?: string | null;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [linhas, setLinhas] = useState<Record<string, { qtd: string; preco: string }>>({});

  function limpar() {
    setErro("");
    setAviso("");
  }

  function abrir(v: VendaCorrigivel) {
    limpar();
    if (aberta === v.id) {
      setAberta(null);
      return;
    }
    const inicial: Record<string, { qtd: string; preco: string }> = {};
    for (const l of v.linhas) {
      inicial[l.id] = { qtd: String(l.quantity), preco: String(Number(l.unit_price)) };
    }
    setLinhas((antes) => ({ ...antes, ...inicial }));
    setAberta(v.id);
  }

  async function guardar(v: VendaCorrigivel) {
    limpar();
    setOcupada(v.id);
    const supabase = createClientBrowser();

    // Sequencial de propósito: cada UPDATE faz o Postgres recalcular o total da
    // venda a partir de todas as linhas. Em paralelo, a última escrita podia
    // somar um estado que já não existe.
    for (const l of v.linhas) {
      const estado = linhas[l.id];
      if (!estado) continue;

      const qtd = Math.max(1, Math.trunc(Number(estado.qtd) || 0));
      const preco = Math.max(0, Number(String(estado.preco).replace(",", ".")) || 0);
      if (qtd === l.quantity && preco === Number(l.unit_price)) continue;

      const { error } = await supabase
        .from("sale_items")
        .update({ quantity: qtd, unit_price: preco, total_price: qtd * preco })
        .eq("id", l.id);

      if (error) {
        setOcupada(null);
        const texto = mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql");
        setErro(
          /comissão paga/i.test(texto)
            ? "Esta venda já tem a comissão paga. Anule o pagamento em Levantamentos antes de a corrigir."
            : texto
        );
        return;
      }
    }

    setOcupada(null);
    setAviso("Venda corrigida. O total e a comissão acompanharam.");
    setAberta(null);
    router.refresh();
  }

  async function anular(v: VendaCorrigivel) {
    if (
      !window.confirm(
        `Anular a venda ${v.reference}? Deixa de contar para as vendas e para a comissão. O registo mantém-se, marcado como cancelado.`
      )
    ) {
      return;
    }

    limpar();
    setOcupada(v.id);
    const supabase = createClientBrowser();
    const { error } = await supabase
      .from("sales")
      .update({ status: "cancelled" })
      .eq("id", v.id);

    setOcupada(null);
    if (error) {
      const texto = mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql");
      setErro(
        /comissão paga/i.test(texto)
          ? "Esta venda já tem a comissão paga. Anule o pagamento em Levantamentos antes de a anular."
          : texto
      );
      return;
    }

    setAviso(`Venda ${v.reference} anulada.`);
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
        <Pencil className="h-4 w-4 text-[#C9A962]" />
        Corrigir vendas
      </h2>
      <p className="mb-4 text-[11px] text-[#6F6F6F]">
        Quantidade e preço unitário de cada linha. O total da venda e a comissão
        recalculam-se sozinhos. Uma venda com a comissão já paga não se altera.
      </p>

      {erro && (
        <p className="mb-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg border border-[#1F4D2E] bg-[#0F2A18] px-3 py-2 text-xs text-[#4ADE80]">
          {aviso}
        </p>
      )}
      {falhaLeitura && (
        <p className="mb-3 rounded-lg border border-[#4A3F1A] bg-[#2A2410] px-3 py-2 text-xs text-[#E3D5A7]">
          {falhaLeitura}
        </p>
      )}

      {vendas.length === 0 ? (
        <p className="text-sm text-[#525252]">Sem vendas registadas.</p>
      ) : (
        <ul className="space-y-2">
          {vendas.map((v) => {
            const cancelada = v.status === "cancelled";
            const abertaAgora = aberta === v.id;
            return (
              <li
                key={v.id}
                className={`rounded-lg border ${
                  cancelada ? "border-[#232323] bg-[#131313]" : "border-[#2A2A2A] bg-[#141414]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => abrir(v)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="font-mono text-[11px] tracking-wide text-[#C9A962]">
                      {v.reference}
                    </span>
                    <span className="text-[10px] text-[#6F6F6F]">
                      {new Date(v.created_at).toLocaleDateString("pt-PT")}
                    </span>
                    {cancelada && (
                      <span className="rounded bg-[#2A1010] px-1.5 py-0.5 text-[9px] text-[#F87171]">
                        anulada
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-[#E5E5E5]">
                      {formatCurrency(Number(v.total_amount))}
                    </span>
                    {abertaAgora ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[#6F6F6F]" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6F6F6F]" />
                    )}
                  </button>

                  {!cancelada && (
                    <button
                      type="button"
                      onClick={() => anular(v)}
                      disabled={ocupada === v.id}
                      title="Anular esta venda"
                      className="flex shrink-0 items-center gap-1 rounded border border-[#333] px-2 py-1 text-[10px] text-[#A3A3A3] transition hover:border-[#DC2626]/60 hover:text-[#DC2626] disabled:opacity-40"
                    >
                      <Ban className="h-3 w-3" /> Anular
                    </button>
                  )}
                </div>

                {abertaAgora && (
                  <div className="border-t border-[#232323] px-3 py-3">
                    {v.linhas.length === 0 ? (
                      <p className="text-[11px] text-[#6F6F6F]">
                        Esta venda não tem linhas de detalhe — só o valor total, que não se
                        corrige por aqui.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {v.linhas.map((l) => {
                          const estado = linhas[l.id] ?? {
                            qtd: String(l.quantity),
                            preco: String(Number(l.unit_price)),
                          };
                          const total =
                            (Math.trunc(Number(estado.qtd) || 0) || 0) *
                            (Number(String(estado.preco).replace(",", ".")) || 0);
                          return (
                            <div
                              key={l.id}
                              className="grid grid-cols-12 items-center gap-2 text-xs"
                            >
                              <span className="col-span-12 truncate text-[#D4D4D4] sm:col-span-4">
                                {l.produto ?? "Produto"}
                              </span>
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={estado.qtd}
                                onChange={(e) =>
                                  setLinhas({
                                    ...linhas,
                                    [l.id]: { ...estado, qtd: e.target.value },
                                  })
                                }
                                className="col-span-3 rounded border border-[#333] bg-[#0A0A0A] px-2 py-1 text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none sm:col-span-2"
                                aria-label="Quantidade"
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={estado.preco}
                                onChange={(e) =>
                                  setLinhas({
                                    ...linhas,
                                    [l.id]: { ...estado, preco: e.target.value },
                                  })
                                }
                                className="col-span-5 rounded border border-[#333] bg-[#0A0A0A] px-2 py-1 text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none sm:col-span-3"
                                aria-label="Preço unitário"
                              />
                              <span className="col-span-4 text-right text-[#C9A962] sm:col-span-3">
                                {formatCurrency(total)}
                              </span>
                            </div>
                          );
                        })}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-[10px] text-[#6F6F6F]">
                            Quantidade · preço unitário · total da linha
                          </span>
                          <button
                            type="button"
                            onClick={() => guardar(v)}
                            disabled={ocupada === v.id || cancelada}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:cursor-not-allowed disabled:bg-[#262626] disabled:text-[#6F6F6F]"
                          >
                            {ocupada === v.id && <Loader2 className="h-3 w-3 animate-spin" />}
                            {cancelada ? "Venda anulada" : "Guardar correcção"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
