"use client";

import { useState } from "react";
import { FeedConteudos } from "@/components/conteudos/FeedConteudos";
import type { Conteudo } from "@/lib/conteudos";

/**
 * O Feed Clientes com filtros.
 *
 * São dois filtros e não quatro: o cliente só tem promoções e testemunhos para
 * ver. Os comunicados e a formação são da equipa — não é uma questão de esconder
 * no menu, é a base de dados que os não devolve (migração 0019).
 */

const FILTROS = [
  { valor: "tudo", etiqueta: "Tudo" },
  { valor: "promocao", etiqueta: "Promoções" },
  { valor: "testemunho", etiqueta: "Testemunhos" },
] as const;

export function FeedClientes({
  itens,
  hrefNovo,
  gerirReacoes,
}: {
  itens: Conteudo[];
  hrefNovo?: string;
  gerirReacoes?: boolean;
}) {
  const [filtro, setFiltro] = useState<string>("tudo");

  const visiveis = filtro === "tudo" ? itens : itens.filter((c) => c.kind === filtro);

  return (
    <div>
      <div className="mx-auto mb-4 flex w-full max-w-[560px] flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            aria-pressed={filtro === f.valor}
            className={`rounded-full px-3.5 py-1.5 text-[11px] transition ${
              filtro === f.valor
                ? "border border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
                : "border border-[#2E2E2E] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            }`}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>

      {visiveis.length === 0 && (
        <p className="mx-auto mb-5 max-w-[560px] rounded-2xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center text-sm text-[#6F6F6F]">
          Ainda não há publicações neste filtro.
        </p>
      )}

      {/* Renderizado mesmo vazio: é aqui que vive o botão de publicar da gestão. */}
      <FeedConteudos itens={visiveis} hrefNovo={hrefNovo} gerirReacoes={gerirReacoes} />
    </div>
  );
}
