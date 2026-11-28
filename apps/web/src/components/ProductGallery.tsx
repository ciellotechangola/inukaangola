"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ProductImage from "@/components/ProductImage";

export interface FotoProduto {
  id: string;
  url: string;
}

interface Props {
  imagens: FotoProduto[];
  alt: string;
  /** Percentagem de desconto, mostrada no canto. 0 = sem etiqueta. */
  desconto?: number;
  /** Produto sem stock: a fotografia escurece e diz «Esgotado». */
  esgotado?: boolean;
}

/**
 * Galeria do produto: desliza entre as fotografias disponíveis.
 *
 * Porque `overflow-x-auto` + `scroll-snap` e não um carrossel com estado?
 *  - O deslize com o dedo é o gesto que o telemóvel já faz; um carrossel
 *    controlado por JavaScript perde o «arrastar» e fica a meio caminho.
 *  - As setas e as miniaturas só chamam `scrollTo` — o índice é lido do
 *    próprio contentor, por isso nunca dessincroniza.
 *  - Funciona sem JavaScript a meio: a primeira fotografia aparece sempre.
 */
export default function ProductGallery({ imagens, alt, desconto = 0, esgotado = false }: Props) {
  const pistaRef = useRef<HTMLDivElement>(null);
  const [indice, setIndice] = useState(0);

  const total = imagens.length;

  const irPara = useCallback((i: number) => {
    const pista = pistaRef.current;
    if (!pista) return;
    const alvo = Math.max(0, Math.min(i, total - 1));
    pista.scrollTo({ left: alvo * pista.clientWidth, behavior: "smooth" });
    setIndice(alvo);
  }, [total]);

  // O índice segue o deslize — calculado pela posição real, não por um
  // contador que se pode atrasar em relação ao dedo.
  useEffect(() => {
    const pista = pistaRef.current;
    if (!pista) return;

    let quadro = 0;
    function aoDeslizar() {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        if (!pista || pista.clientWidth === 0) return;
        setIndice(Math.round(pista.scrollLeft / pista.clientWidth));
      });
    }

    pista.addEventListener("scroll", aoDeslizar, { passive: true });
    return () => {
      cancelAnimationFrame(quadro);
      pista.removeEventListener("scroll", aoDeslizar);
    };
  }, []);

  // Mudar de produto na mesma página (relacionados) tem de voltar ao início.
  useEffect(() => {
    pistaRef.current?.scrollTo({ left: 0 });
    setIndice(0);
  }, [imagens[0]?.id]);

  if (total === 0) {
    return (
      <div className="foto-painel flex aspect-square w-full items-center justify-center rounded-2xl">
        <span className="text-sm tracking-[0.4em] text-[#C9A962]/35">INUKA</span>
      </div>
    );
  }

  return (
    <div>
      {/* Painel branco: as fotos oficiais têm fundo branco, por isso a
          fotografia funde-se com o painel e desaparecem as faixas pretas que
          ficavam de cada lado dos frascos (a foto é retrato, a caixa é
          quadrada). `object-contain` mantém a proporção e nunca corta. */}
      <div className="foto-painel relative rounded-2xl">
        <div
          ref={pistaRef}
          className="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={`Fotografias de ${alt}`}
        >
          {imagens.map((img, i) => (
            <div key={img.id} className="relative h-full w-full shrink-0 snap-center">
              <ProductImage
                src={img.url}
                alt={total > 1 ? `${alt} — fotografia ${i + 1} de ${total}` : alt}
                width={800}
                height={800}
                priority={i === 0}
                sizes="(max-width: 768px) 100vw, 50vw"
                className="h-full w-full object-contain p-3 sm:p-6"
              />
            </div>
          ))}
        </div>

        {desconto > 0 && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-[#C9A962] px-2.5 py-1 text-xs font-bold text-[#0A0A0A] shadow-sm">
            -{desconto}%
          </span>
        )}

        {esgotado && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
            <span className="rounded-full bg-[#0A0A0A]/85 px-4 py-1.5 text-sm font-medium text-[#F5F5F5]">
              Esgotado
            </span>
          </div>
        )}

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => irPara(indice - 1)}
              disabled={indice === 0}
              aria-label="Fotografia anterior"
              className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#E2E2E2] bg-white/90 text-[#1A1A1A] shadow-sm transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:pointer-events-none disabled:opacity-0 sm:flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => irPara(indice + 1)}
              disabled={indice >= total - 1}
              aria-label="Fotografia seguinte"
              className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#E2E2E2] bg-white/90 text-[#1A1A1A] shadow-sm transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:pointer-events-none disabled:opacity-0 sm:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-[#0A0A0A]/80 px-2.5 py-0.5 text-[11px] font-medium text-[#F5F5F5]">
              {indice + 1}/{total}
            </span>
          </>
        )}
      </div>

      {total > 1 && (
        <>
          {/* Miniaturas: no telemóvel deslizam na horizontal para caberem
              todas, sem encolher até ao ilegível. */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {imagens.map((img, i) => (
              // O botão é o próprio painel branco (`foto-painel`): a moldura
              // dourada da miniatura activa fica por fora da fotografia.
              <button
                key={img.id}
                type="button"
                onClick={() => irPara(i)}
                aria-label={`Ver fotografia ${i + 1}`}
                aria-current={i === indice}
                className={`foto-painel h-16 w-16 shrink-0 rounded-lg border-2 transition sm:h-20 sm:w-20 ${
                  i === indice
                    ? "border-[#C9A962]"
                    : "border-transparent hover:border-[#C9A962]/40"
                }`}
              >
                <ProductImage
                  src={img.url}
                  alt=""
                  width={160}
                  height={160}
                  className="h-full w-full object-contain p-1.5"
                />
              </button>
            ))}
          </div>

          {/* Pontos: só no telemóvel, onde não há setas. */}
          <div className="mt-3 flex justify-center gap-1.5 sm:hidden">
            {imagens.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => irPara(i)}
                aria-label={`Fotografia ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === indice ? "w-5 bg-[#C9A962]" : "w-1.5 bg-[#3A3A3A]"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
