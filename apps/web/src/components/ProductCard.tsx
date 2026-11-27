import Link from "next/link";
import ProductImage from "@/components/ProductImage";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

/** Desconto em percentagem inteira. 0 quando não há promoção válida. */
export function percentagemDesconto(product: Product): number {
  return descontoDe(Number(product.official_price), precoEfetivo(product));
}

/** Desconto de um preço sobre outro. 0 quando não há vantagem nenhuma. */
export function descontoDe(oficial: number, preco: number): number {
  if (!oficial || !Number.isFinite(oficial) || preco >= oficial) return 0;
  return Math.round((1 - preco / oficial) * 100);
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
  /**
   * Preço de campanha já resolvido para a província de quem está a ver
   * (`precos_efetivos`). Sem isto o cartão mostra o preço do produto — que é
   * o correcto para quem não tem província ou quando não há campanha.
   */
  campanha?: { preco: number; nome: string | null } | null;
}

export default function ProductCard({
  product,
  disponivel = null,
  prioridade = false,
  jaComprou = false,
  campanha = null,
}: Props) {
  const preco = campanha ? campanha.preco : precoEfetivo(product);
  const desconto = descontoDe(Number(product.official_price), preco);
  const imagem = fotoPrincipal(product);
  const esgotado = disponivel === 0;
  const variasFotos = (product.images?.filter((i) => i.url).length ?? 0) > 1;

  return (
    <Link
      href={`/produto/${product.id}`}
      className="group flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-[#232323] bg-[linear-gradient(180deg,#171717_0%,#101010_100%)] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_18px_38px_-26px_rgba(0,0,0,0.95)] transition duration-300 hover:-translate-y-0.5 hover:border-[#C9A962]/45 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_26px_48px_-22px_rgba(201,169,98,0.25)]"
    >
      {/* A fotografia vive num painel branco (`foto-painel`) com uma margem
          curta em volta. Antes o fundo era escuro e, como as fotos oficiais
          são retrato sobre branco, sobravam faixas pretas de cada lado. Agora
          o branco da foto continua no painel e o produto fica centrado e
          sempre do mesmo tamanho, seja qual for a proporção da imagem.
          `object-contain` e não `object-cover`: numa grelha de duas colunas o
          cartão tem ~150 px e o `cover` cortava as laterais — o frasco
          aparecia sem tampa ou sem rótulo. */}
      <div className="p-1.5 sm:p-2">
        <div className="foto-painel relative aspect-square overflow-hidden rounded-xl">
          {imagem ? (
            <ProductImage
              src={imagem}
              alt={product.name}
              width={400}
              height={400}
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw"
              priority={prioridade}
              className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.04] sm:p-3"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,#FFFFFF_0%,#F4F3F0_100%)]">
              <span className="text-xs tracking-[0.35em] text-[#C9A962]/35">INUKA</span>
            </div>
          )}

          <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1 sm:left-2 sm:top-2">
            {desconto > 0 && (
              <span className="rounded-full bg-[#C9A962] px-1.5 py-0.5 text-[10px] font-bold leading-tight text-[#0A0A0A] shadow-sm sm:px-2 sm:text-[11px]">
                -{desconto}%
              </span>
            )}
            {product.is_new && (
              <span className="rounded-full bg-[#0A0A0A]/85 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-[#C9A962] backdrop-blur-sm sm:px-2 sm:text-[11px]">
                Novo
              </span>
            )}
          </div>

          {jaComprou && !esgotado && (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-[#0A0A0A]/85 px-1.5 py-0.5 text-[9px] font-medium leading-tight text-[#C9A962] backdrop-blur-sm sm:right-2 sm:top-2 sm:px-2 sm:text-[10px]">
              Já comprou
            </span>
          )}

          {esgotado && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
              <span className="rounded-full bg-[#0A0A0A]/85 px-2.5 py-1 text-[11px] font-medium text-[#F5F5F5] sm:px-3 sm:text-xs">
                Esgotado
              </span>
            </div>
          )}

          {/* Sinal de que há mais do que uma fotografia — a página do produto
              desliza entre elas. */}
          {variasFotos && (
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-[#0A0A0A]/80 px-1.5 py-0.5 text-[9px] font-medium text-[#E5E5E5] backdrop-blur-sm sm:text-[10px]">
              {(product.images ?? []).filter((i) => i.url).length} fotos
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 pb-2.5 pt-1 sm:px-3.5 sm:pb-3.5 sm:pt-1.5">
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
            {formatCurrency(preco)}
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
