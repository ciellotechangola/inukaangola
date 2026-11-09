"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, ArrowUpDown } from "lucide-react";

export interface OpcaoOrdem {
  chave: string;
  etiqueta: string;
  /** Para onde ir quando esta opção é escolhida. */
  href: string;
}

/**
 * Ordenação do catálogo no telemóvel.
 *
 * Quatro pastilhas («Relevância», «Preço ↑», «Preço ↓», «Novidades») não cabem
 * em 360 px: a última ficava cortada no bordo do ecrã. Um `<select>` nativo
 * ocupa uma linha, não corta nada e é o controlo que o sistema já sabe usar —
 * no Android abre a roda de opções, no iPhone a lista.
 *
 * A partir de `sm` a página mostra as pastilhas, que aí cabem todas; este
 * componente esconde-se para não haver dois controlos iguais.
 */
export default function OrdenarCatalogo({
  opcoes,
  atual,
}: {
  opcoes: OpcaoOrdem[];
  atual: string;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2 sm:hidden">
      <ArrowUpDown className="h-4 w-4 shrink-0 text-[#C9A962]" />
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-[#5A5A5A]">Ordenar</span>
      <div className="relative min-w-0 flex-1">
        <select
          value={atual}
          onChange={(e) => {
            const escolhida = opcoes.find((o) => o.chave === e.target.value);
            // `scroll: false` mantém o cliente onde está na lista em vez de o
            // atirar para o topo só por mudar a ordem.
            if (escolhida) router.push(escolhida.href, { scroll: false });
          }}
          aria-label="Ordenar produtos"
          className="w-full appearance-none rounded-lg border border-[#333] bg-[#121212] py-2 pl-3 pr-9 text-sm text-[#E5E5E5] focus:border-[#C9A962] focus:outline-none"
        >
          {opcoes.map((o) => (
            <option key={o.chave} value={o.chave} className="bg-[#121212]">
              {o.etiqueta}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6F6F6F]" />
      </div>
    </div>
  );
}
