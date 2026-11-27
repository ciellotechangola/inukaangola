"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Save, Search } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import type { ProdutoPreco } from "./page";

/**
 * Preços de grosso por produto.
 *
 * Vazio = «desconto da empresa». É a diferença entre um preço escrito à mão
 * (que não se mexe quando a empresa muda a política) e um preço que segue a
 * política. O botão «Repor» apaga a linha e devolve o produto ao automático.
 */
export default function PrecosGrosso({
  produtos,
  descontoEmpresa,
}: {
  produtos: ProdutoPreco[];
  descontoEmpresa: number;
}) {
  const router = useRouter();
  const [procura, setProcura] = useState("");
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      produtos.map((p) => [p.id, p.preco_revenda === null ? "" : String(p.preco_revenda)])
    )
  );
  const [aGuardar, setAGuardar] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const filtrados = useMemo(() => {
    const termo = procura.trim().toLowerCase();
    if (termo === "") return produtos;
    return produtos.filter(
      (p) => p.nome.toLowerCase().includes(termo) || (p.sku ?? "").toLowerCase().includes(termo)
    );
  }, [produtos, procura]);

  function precoAutomatico(p: ProdutoPreco): number {
    return Math.round(p.official_price * (1 - descontoEmpresa) * 100) / 100;
  }

  async function guardar(p: ProdutoPreco, limpar: boolean) {
    setErro("");
    setGuardado(null);
    setAGuardar(p.id);
    try {
      const supabase = createClientBrowser();

      if (limpar) {
        const { error } = await supabase.rpc("limpar_preco_revenda", { p_produto: p.id });
        if (error) throw new Error(error.message);
        setValores((v) => ({ ...v, [p.id]: "" }));
      } else {
        const bruto = valores[p.id] ?? "";
        const preco = Number(bruto.replace(/[^0-9.,]/g, "").replace(",", "."));
        if (!Number.isFinite(preco) || preco <= 0) {
          setErro(`Indique um preço válido para ${p.nome}.`);
          return;
        }
        const { error } = await supabase.rpc("definir_preco_revenda", {
          p_produto: p.id,
          p_preco: preco,
          p_nota: null,
        });
        if (error) throw new Error(error.message);
      }

      setGuardado(p.id);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAGuardar(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-light text-[#F5F5F5]">Preços de grosso</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#8A8A8A]">
            Um preço escrito aqui vence o desconto. Vazio = desconto da empresa (
            {Math.round(descontoEmpresa * 100)}%). O preço de grosso é o custo do revendedor —
            deve ficar próximo do custo de importação.
          </p>
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#525252]" />
          <input
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            placeholder="Procurar produto"
            className="w-56 rounded-lg border border-[#333] bg-[#0A0A0A] py-1.5 pl-8 pr-2.5 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>
      </div>

      {erro && (
        <p className="mb-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-[#262626]">
        <table className="w-full text-sm">
          <thead className="bg-[#141414] text-left text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            <tr>
              <th className="px-3 py-2.5">Produto</th>
              <th className="px-3 py-2.5">Loja</th>
              <th className="px-3 py-2.5">Automático</th>
              <th className="px-3 py-2.5">Preço de grosso</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => (
              <tr key={p.id} className="border-t border-[#1F1F1F] bg-[#0F0F0F]">
                <td className="px-3 py-2">
                  <p className="text-xs text-[#E5E5E5]">{p.nome}</p>
                  <p className="text-[10px] text-[#525252]">{p.sku ?? "sem SKU"}</p>
                </td>
                <td className="px-3 py-2 text-xs text-[#8A8A8A]">
                  {formatCurrency(p.official_price)}
                </td>
                <td className="px-3 py-2 text-xs text-[#6F6F6F]">
                  {formatCurrency(precoAutomatico(p))}
                </td>
                <td className="px-3 py-2">
                  <input
                    value={valores[p.id] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [p.id]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="automático"
                    className="w-28 rounded-lg border border-[#333] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => guardar(p, false)}
                      disabled={aGuardar === p.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#C9A962] px-2 py-1 text-[10px] font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
                    >
                      <Save className="h-3 w-3" />
                      Guardar
                    </button>
                    {p.preco_revenda !== null && (
                      <button
                        type="button"
                        onClick={() => guardar(p, true)}
                        disabled={aGuardar === p.id}
                        title="Voltar ao desconto da empresa"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#333] px-2 py-1 text-[10px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Repor
                      </button>
                    )}
                    {guardado === p.id && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#4ADE80]">
                        <Check className="h-3 w-3" />
                        ok
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
