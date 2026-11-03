"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Percent } from "lucide-react";
import { definirTaxaComissao, formatarTaxa } from "@/lib/comissoes";

/**
 * A taxa de comissão da empresa.
 *
 * Um número só, num sítio só. Os colaboradores herdam-no; quem tiver uma taxa
 * pessoal mantém-na (a lista de colaboradores continua a permitir ajustá-la
 * caso a caso).
 */
export default function TaxaComissao({
  taxaGlobal,
  colaboradoresSemTaxa,
}: {
  taxaGlobal: number;
  colaboradoresSemTaxa: number;
}) {
  const router = useRouter();

  // O campo mostra percentagem; a base guarda fracção (0.1 = 10%).
  const [valor, setValor] = useState(String(Number((taxaGlobal * 100).toFixed(2))));
  const [recalcular, setRecalcular] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aGravar, setAGravar] = useState(false);

  async function gravar() {
    setErro("");
    setAviso("");

    const pct = Number(valor.replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setErro("Indique uma percentagem entre 0 e 100.");
      return;
    }

    setAGravar(true);
    try {
      const r = await definirTaxaComissao(pct / 100, recalcular);
      setAviso(
        r.recalculadas > 0
          ? `Taxa actualizada para ${formatarTaxa(r.rate)}. ${r.recalculadas} comissõe(s) por pagar recalculada(s).`
          : `Taxa actualizada para ${formatarTaxa(r.rate)}. Aplica-se às próximas vendas.`
      );
      setRecalcular(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setAGravar(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#C9A962]/30 bg-gradient-to-br from-[#1A1A1A] to-[#121212] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-[#C9A962]/10 p-2 text-[#C9A962]">
            <Percent className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-[#F5F5F5]">Taxa de comissão da empresa</p>
            <p className="mt-0.5 text-xs text-[#8A8A8A]">
              Aplica-se a todos os colaboradores que não tenham uma taxa própria.
              {colaboradoresSemTaxa > 0
                ? ` Neste momento, ${colaboradoresSemTaxa} colaborador(es) herdam este valor.`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
              Taxa
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 focus-within:border-[#C9A962]">
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="w-16 bg-transparent py-2 text-sm text-[#F5F5F5] outline-none"
              />
              <span className="text-sm text-[#6F6F6F]">%</span>
            </div>
          </label>

          <button
            onClick={gravar}
            disabled={aGravar}
            className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
          >
            {aGravar ? "A gravar…" : "Gravar taxa"}
          </button>
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 text-xs text-[#8A8A8A]">
        <input
          type="checkbox"
          checked={recalcular}
          onChange={(e) => setRecalcular(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[#C9A962]"
        />
        <span>
          Recalcular também as comissões <strong className="text-[#A3A3A3]">por pagar</strong> de
          quem herda esta taxa. As já pagas nunca são alteradas.
        </span>
      </label>

      {erro && (
        <p className="mt-3 rounded-lg border border-[#4A2020] bg-[#2A1010] p-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mt-3 rounded-lg border border-[#1F3D2B] bg-[#0F1F16] p-2 text-xs text-[#6EE7A0]">
          {aviso}
        </p>
      )}
    </div>
  );
}
