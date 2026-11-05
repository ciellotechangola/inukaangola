"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, RotateCcw } from "lucide-react";
import ProductImage from "@/components/ProductImage";
import { useCart } from "@/components/cart-context";
import { formatCurrency } from "@/lib/utils";

export interface ProdutoParaRepetir {
  id: string;
  name: string;
  price: number;
  image: string | null;
  /** `0` = esgotado; `null` = desconhecido. */
  disponivel: number | null;
}

/**
 * «Comprar novamente»: o que o cliente comprou por último, à mão para repetir
 * num toque. É um carrossel no telemóvel (não empurra o catálogo para baixo) e
 * uma grelha a partir de `sm`.
 */
export default function ComprarNovamente({ produtos }: { produtos: ProdutoParaRepetir[] }) {
  const { add } = useCart();
  const [adicionado, setAdicionado] = useState<string | null>(null);

  if (produtos.length === 0) return null;

  function repetir(p: ProdutoParaRepetir) {
    add({ product_id: p.id, name: p.name, price: p.price, image: p.image }, 1);
    setAdicionado(p.id);
    window.setTimeout(() => setAdicionado((atual) => (atual === p.id ? null : atual)), 1800);
  }

  return (
    <section className="mb-8 rounded-xl border border-[#C9A962]/25 bg-[#141414] p-3 sm:p-4">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#F5F5F5]">
            <RotateCcw className="h-4 w-4 text-[#C9A962]" />
            Comprar novamente
          </h2>
          <p className="mt-0.5 text-[11px] text-[#7A7A7A] sm:text-xs">
            O que comprou da última vez, pronto a repetir.
          </p>
        </div>
      </div>

      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {produtos.map((p) => {
          const esgotado = p.disponivel === 0;
          const feito = adicionado === p.id;
          return (
            <div
              key={p.id}
              className="flex w-[260px] shrink-0 snap-start items-center gap-3 rounded-lg border border-[#262626] bg-[#1A1A1A] p-2.5 sm:w-auto"
            >
              <Link
                href={`/produto/${p.id}`}
                className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-[#0A0A0A]"
              >
                {p.image ? (
                  <ProductImage
                    src={p.image}
                    alt={p.name}
                    width={56}
                    height={56}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-[#404040]">
                    INUKA
                  </div>
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/produto/${p.id}`}
                  className="line-clamp-2 text-xs font-medium leading-snug text-[#EDEDED] transition hover:text-[#C9A962]"
                >
                  {p.name}
                </Link>
                <p className="mt-0.5 text-xs text-[#C9A962]">{formatCurrency(p.price)}</p>
              </div>

              <button
                onClick={() => repetir(p)}
                disabled={esgotado}
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                  esgotado
                    ? "cursor-not-allowed border border-[#333] text-[#5A5A5A]"
                    : feito
                      ? "bg-green-900/40 text-green-200"
                      : "bg-[#C9A962] text-[#0A0A0A] hover:bg-[#E3D5A7]"
                }`}
                aria-label={esgotado ? `${p.name} esgotado` : `Repetir compra de ${p.name}`}
              >
                {esgotado ? (
                  "Esgotado"
                ) : feito ? (
                  <>
                    <Check className="h-3 w-3" />
                    No carrinho
                  </>
                ) : (
                  "Repetir"
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
