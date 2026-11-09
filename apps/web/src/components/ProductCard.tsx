import Link from "next/link";
import ProductImage from "@/components/ProductImage";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

/** Desconto em percentagem inteira. 0 quando não há promoção válida. */
export function percentagemDesconto(product: Product): number {
  const oficial = Number(product.official_price);
  const promo = product.promotional_price === null ? null : Number(product.promotional_price);
  if (!oficial || promo === null || promo >= oficial) return 0;
  return Math.round((1 - promo / oficial) * 100);
}

/** Preço que o cliente paga. A base manda: promoção quando existe. */
export function precoEfetivo(product: Product): number {
  return Number(product.promotional_price ?? product.official_price);
}

/**
 * Fotografia de capa.
 *
 * Um produto pode ter várias; a que o representa é a marcada `is_primary`.
 * Sem marca (dados antigos) vale a primeira por `sort_order`.
 */
export function fotoPrincipal(product: Product): string | null {
  const imagens = product.images ?? [];
  const capa =
    imagens.find((i) => i.is_primary && i.url) ??
    [...imagens].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];
  return capa?.url ?? null;
}

interface Props {
  product: Product;
  /** Unidades disponíveis; `null` = desconhecido, `0` = esgotado. */
  disponivel?: number | null;
  prioridade?: boolean;
  /** O cliente já comprou este produto — mostra a marca de recompra. */
  jaComprou?: boolean;
}

export default function ProductCard({
  product,
  disponivel = null,
  prioridade = false,
  jaComprou = false,
}: Props) {
  const desconto = percentagemDesconto(product);
  const imagem = fotoPrincipal(product);
  const esgotado = disponivel === 0;
  const variasFotos = (product.images?.filter((i) => i.url).length ?? 0) > 1;

  return (
    <Link
      href={`/produto/${product.id}`}
      className="group flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#141414] transition hover:border-[#C9A962]/50 hover:shadow-[0_0_24px_-8px_rgba(201,169,98,0.35)]"
    >
      {/* `object-contain` e não `object-cover`: numa grelha de duas colunas o
          cartão tem ~150 px e o `cover` cortava as laterais das fotografias
          não quadradas — o frasco aparecia sem tampa ou sem rótulo. Assim a
          imagem inteira cabe sempre, com uma margem curta em volta. */}
      <div className="relative aspect-square overflow-hidden bg-[#0F0F0F]">
        {imagem ? (
          <ProductImage
            src={imagem}
            alt={product.name}
            width={400}
            height={400}
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw"
            priority={prioridade}
            className="h-full w-full object-contain p-1.5 transition duration-500 group-hover:scale-[1.04] sm:p-2"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#1C1C1C,#0B0B0B)]">
            <span className="text-xs tracking-[0.35em] text-[#3A3A3A]">INUKA</span>
          </div>
        )}

        <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1 sm:left-2 sm:top-2">
          {desconto > 0 && (
            <span className="rounded-full bg-[#C9A962] px-1.5 py-0.5 text-[10px] font-bold leading-tight text-[#0A0A0A] sm:px-2 sm:text-[11px]">
              -{desconto}%
            </span>
          )}
          {product.is_new && (
            <span className="rounded-full border border-[#C9A962]/50 bg-[#0A0A0A]/85 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-[#C9A962] sm:px-2 sm:text-[11px]">
              Novo
            </span>
          )}
        </div>

        {jaComprou && !esgotado && (
          <span className="absolute right-1.5 top-1.5 rounded-full border border-[#C9A962]/40 bg-[#0A0A0A]/85 px-1.5 py-0.5 text-[9px] font-medium leading-tight text-[#C9A962] sm:right-2 sm:top-2 sm:px-2 sm:text-[10px]">
            Já comprou
          </span>
        )}

        {esgotado && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0A]/72">
            <span className="rounded-full border border-[#4A4A4A] px-2.5 py-1 text-[11px] font-medium text-[#C9C9C9] sm:px-3 sm:text-xs">
              Esgotado
            </span>
          </div>
        )}

        {/* Sinal de que há mais do que uma fotografia — a página do produto
            desliza entre elas. */}
        {variasFotos && (
          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-[#0A0A0A]/80 px-1.5 py-0.5 text-[9px] font-medium text-[#E5E5E5] sm:text-[10px]">
            {(product.images ?? []).filter((i) => i.url).length} fotos
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2.5 sm:gap-1 sm:p-3.5">
        {product.category?.name && (
          // Uma linha só: «PERFUMARIA FEMININA» ocupava duas linhas em letras
          // maiúsculas e empurrava o preço para fora do cartão.
          <p className="truncate text-[10px] uppercase tracking-wider text-[#7A7A7A] sm:text-[11px]">
            {product.category.name}
          </p>
        )}
        {/* Sem altura mínima fixa: em ecrãs estreitos, com letra grande do
            sistema, uma altura imposta empurrava o preço para fora do cartão.
            Duas linhas com reticências chegam para o nome. */}
        <h3 className="line-clamp-2 break-words text-[13px] font-medium leading-snug text-[#EDEDED] transition group-hover:text-[#C9A962] sm:text-sm">
          {product.name}
        </h3>
        <div className="mt-auto flex min-w-0 flex-wrap items-baseline gap-x-1.5 pt-1.5 sm:gap-x-2 sm:pt-2">
          <span className="text-sm font-semibold text-[#C9A962] sm:text-[15px]">
            {formatCurrency(precoEfetivo(product))}
          </span>
          {desconto > 0 && (
            <span className="text-[11px] text-[#6F6F6F] line-through sm:text-xs">
              {formatCurrency(Number(product.official_price))}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
