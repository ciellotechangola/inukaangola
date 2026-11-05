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
  const imagem = product.images?.[0]?.url ?? null;
  const esgotado = disponivel === 0;

  return (
    <Link
      href={`/produto/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#141414] transition hover:border-[#C9A962]/50 hover:shadow-[0_0_24px_-8px_rgba(201,169,98,0.35)]"
    >
      <div className="relative aspect-square overflow-hidden bg-[#0F0F0F]">
        {imagem ? (
          <ProductImage
            src={imagem}
            alt={product.name}
            width={400}
            height={400}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            priority={prioridade}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#1C1C1C,#0B0B0B)]">
            <span className="text-xs tracking-[0.35em] text-[#3A3A3A]">INUKA</span>
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {desconto > 0 && (
            <span className="rounded-full bg-[#C9A962] px-2 py-0.5 text-[11px] font-bold leading-tight text-[#0A0A0A]">
              -{desconto}%
            </span>
          )}
          {product.is_new && (
            <span className="rounded-full border border-[#C9A962]/50 bg-[#0A0A0A]/85 px-2 py-0.5 text-[11px] font-medium leading-tight text-[#C9A962]">
              Novo
            </span>
          )}
        </div>

        {jaComprou && !esgotado && (
          <span className="absolute right-2 top-2 rounded-full border border-[#C9A962]/40 bg-[#0A0A0A]/85 px-2 py-0.5 text-[10px] font-medium leading-tight text-[#C9A962]">
            Já comprou
          </span>
        )}

        {esgotado && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0A]/72">
            <span className="rounded-full border border-[#4A4A4A] px-3 py-1 text-xs font-medium text-[#C9C9C9]">
              Esgotado
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        {product.category?.name && (
          <p className="text-[11px] uppercase tracking-wider text-[#7A7A7A]">{product.category.name}</p>
        )}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[#EDEDED] transition group-hover:text-[#C9A962]">
          {product.name}
        </h3>
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-2">
          <span className="text-[15px] font-semibold text-[#C9A962]">{formatCurrency(precoEfetivo(product))}</span>
          {desconto > 0 && (
            <span className="text-xs text-[#6F6F6F] line-through">
              {formatCurrency(Number(product.official_price))}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
