"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Percent } from "lucide-react";
import { assinarTaxa, formatarTaxa, taxaComissao, type TaxaComissao } from "@/lib/comissoes";

/**
 * A taxa de comissão que se aplica a este colaborador.
 *
 * Actualiza-se sozinha quando a gestão muda a taxa: sem isto, quem tivesse a
 * página aberta continuava a ver a taxa antiga e a fazer contas erradas ao
 * valor que vai receber.
 */
export default function TaxaAoVivo({ inicial }: { inicial: TaxaComissao }) {
  const router = useRouter();
  const [taxa, setTaxa] = useState<TaxaComissao>(inicial);
  const [mudou, setMudou] = useState(false);

  useEffect(() => {
    let vivo = true;

    const cancelar = assinarTaxa(async () => {
      try {
        const nova = await taxaComissao();
        if (!vivo) return;
        setTaxa(nova);
        setMudou(true);
        // Os valores em Kwanzas também mudam quando a taxa muda: o painel
        // recalcula no servidor.
        router.refresh();
      } catch {
        // Sem rede, fica o valor que já estava. Não vale a pena alarmar.
      }
    });

    return () => {
      vivo = false;
      cancelar();
    };
  }, [router]);

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm transition ${
        mudou
          ? "border-[#C9A962]/60 bg-[#C9A962]/10"
          : "border-[#262626] bg-[#1A1A1A]"
      }`}
    >
      <span className="flex items-center gap-2 text-[#C9A962]">
        <Percent className="h-4 w-4" />
        <span className="font-medium">{formatarTaxa(taxa.efetiva)}</span>
      </span>
      <span className="text-[#A3A3A3]">por venda</span>
      <span className="text-xs text-[#525252]">
        {taxa.origem === "pessoal"
          ? `taxa pessoal · a empresa paga ${formatarTaxa(taxa.global)}`
          : "taxa da empresa, igual para toda a equipa"}
      </span>
      {mudou && (
        <span className="rounded-full bg-[#C9A962]/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#E3D5A7]">
          actualizada agora
        </span>
      )}
    </div>
  );
}
