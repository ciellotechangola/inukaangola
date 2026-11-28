import type { ReactNode } from "react";
import ProductImage from "@/components/ProductImage";
import { cn } from "@/lib/utils";

/**
 * A ÁREA DA FOTOGRAFIA DE UM PRODUTO — um sítio só.
 *
 * A regra, e é sempre a mesma em todo o sistema:
 *
 *   · o fundo é **branco puro** e pertence ao sistema, não à fotografia —
 *     uma imagem com fundo preto, transparente ou irregular continua a viver
 *     num painel branco;
 *   · o painel é **quadrado** (`aspect-ratio: 1 / 1`), tenha a fotografia a
 *     proporção que tiver, para que todos os cartões tenham a mesma altura;
 *   · a fotografia é `object-fit: contain` e `object-position: center`:
 *     aparece inteira, centrada, sem esticar nem cortar;
 *   · sobra espaço? Sobra branco — não sobra buraco escuro.
 *
 * Antes disto cada ecrã repetia o seu `div` com o seu raio, o seu padding e,
 * num caso, `object-cover` (que cortava a tampa dos frascos). Repetir a regra
 * é a maneira mais fiável de ela se perder: aqui é uma só.
 *
 * Os ficheiros das fotografias **não** são tocados — isto é só o palco.
 */
const RAIO = {
  nenhum: "",
  sm: "rounded",
  md: "rounded-lg",
  lg: "rounded-xl",
  xl: "rounded-2xl",
} as const;

/** Margem entre a fotografia e a borda do painel. */
const RESPIRO = {
  nenhum: "",
  curto: "p-1",
  normal: "p-2",
  amplo: "p-3 sm:p-5",
} as const;

export interface FotoProdutoProps {
  /** URL da fotografia. Sem ela mostra-se o lugar de «sem fotografia». */
  src?: string | null;
  alt: string;
  /** Lado fixo em píxeis (miniaturas). Sem isto, ocupa a largura do pai. */
  lado?: number;
  raio?: keyof typeof RAIO;
  respiro?: keyof typeof RESPIRO;
  prioridade?: boolean;
  sizes?: string;
  /** Classes no painel — para margens, bordas ou posicionamento. */
  className?: string;
  /** Classes na imagem — para animações (ex.: zoom no hover). */
  classNameImagem?: string;
  /** Selos por cima da fotografia (desconto, «Novo», «N fotos»…). */
  children?: ReactNode;
  /** O que mostrar quando não há fotografia. */
  vazio?: ReactNode;
}

export default function FotoProduto({
  src,
  alt,
  lado,
  raio = "md",
  respiro = "curto",
  prioridade = false,
  sizes,
  className,
  classNameImagem,
  children,
  vazio,
}: FotoProdutoProps) {
  return (
    <div
      className={cn("foto-painel", RAIO[raio], className)}
      style={lado ? { width: lado, height: lado } : undefined}
    >
      {src ? (
        <ProductImage
          src={src}
          alt={alt}
          width={lado ?? 600}
          height={lado ?? 600}
          sizes={sizes}
          priority={prioridade}
          className={cn("h-full w-full object-contain object-center", RESPIRO[respiro], classNameImagem)}
        />
      ) : (
        (vazio ?? (
          <span className="select-none text-[10px] tracking-[0.35em] text-[#C9A962]/35">INUKA</span>
        ))
      )}
      {children}
    </div>
  );
}
