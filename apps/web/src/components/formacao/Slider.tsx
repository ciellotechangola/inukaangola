"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Carrossel horizontal.
 *
 * Em telemóvel é scroll nativo com `snap` (o gesto que as pessoas já usam);
 * no computador ganha setas. Sem biblioteca: um `overflow-x` com botões é
 * menos código e não quebra a hidratação.
 */
export function Slider({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function andar(direcao: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direcao * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-light text-[#F5F5F5]">{titulo}</h2>
          {descricao && <p className="text-xs text-[#6F6F6F]">{descricao}</p>}
        </div>
        <div className="hidden shrink-0 gap-1 sm:flex">
          <button
            type="button"
            onClick={() => andar(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2A2A2A] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => andar(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2A2A2A] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            aria-label="Seguinte"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={ref}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </section>
  );
}
