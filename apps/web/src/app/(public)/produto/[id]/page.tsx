import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CreditCard, ShieldCheck, Truck } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import ProductActions from "@/components/ProductActions";
import ProductImage from "@/components/ProductImage";
import ProductCard, { percentagemDesconto, precoEfetivo } from "@/components/ProductCard";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

export const dynamic = "force-dynamic";

type ProdutoComEstoque = Product & {
  inventory?: { quantity: number; reserved_quantity: number } | null;
};

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClientServer();

  const { data: product, error } = await supabase
    .from("products")
    .select("*, category:categories(*), images:product_images(*), inventory(quantity, reserved_quantity)")
    .eq("id", id)
    .single();

  if (error || !product) notFound();

  const p = product as ProdutoComEstoque;
  const desconto = percentagemDesconto(p);
  const preco = precoEfetivo(p);
  const imagens = (p.images ?? []).filter((i) => Boolean(i.url));
  const primaryImage = imagens[0]?.url ?? null;

  const disponivel = p.inventory
    ? Math.max(0, p.inventory.quantity - p.inventory.reserved_quantity)
    : null;

  // Relacionados: mesma categoria, nunca o próprio.
  const relacionados = p.category_id
    ? (((
        await supabase
          .from("products")
          .select("*, category:categories(*), images:product_images(*), inventory(quantity, reserved_quantity)")
          .eq("is_active", true)
          .eq("category_id", p.category_id)
          .neq("id", p.id)
          .limit(4)
      ).data ?? []) as ProdutoComEstoque[])
    : [];

  const garantias = [
    { Icone: BadgeCheck, titulo: "Produto original", detalhe: "Distribuição oficial INUKA" },
    { Icone: Truck, titulo: "Entrega gratuita", detalhe: "Luanda, Uíge, Huambo e outras" },
    { Icone: CreditCard, titulo: "Pagamento na entrega", detalhe: "Dinheiro ou transferência" },
    { Icone: ShieldCheck, titulo: "Reserva garantida", detalhe: "Stock reservado ao encomendar" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-[#6F6F6F]">
        <Link href="/" className="transition hover:text-[#C9A962]">
          Início
        </Link>
        <span>/</span>
        <Link href="/catalogo" className="transition hover:text-[#C9A962]">
          Catálogo
        </Link>
        {p.category && (
          <>
            <span>/</span>
            <Link href={`/catalogo?cat=${p.category.slug}`} className="transition hover:text-[#C9A962]">
              {p.category.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="truncate text-[#A3A3A3]">{p.name}</span>
      </nav>

      <div className="grid gap-10 md:grid-cols-2">
        {/* ------------------------------------------------------------- imagem */}
        <div>
          <div className="overflow-hidden rounded-2xl border border-[#262626] bg-[#111]">
            <div className="relative aspect-square">
              {primaryImage ? (
                <ProductImage
                  src={primaryImage}
                  alt={p.name}
                  width={700}
                  height={700}
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#1C1C1C,#0B0B0B)]">
                  <span className="text-sm tracking-[0.4em] text-[#3A3A3A]">INUKA</span>
                </div>
              )}
              {desconto > 0 && (
                <span className="absolute left-3 top-3 rounded-full bg-[#C9A962] px-2.5 py-1 text-xs font-bold text-[#0A0A0A]">
                  -{desconto}%
                </span>
              )}
            </div>
          </div>

          {imagens.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {imagens.slice(1, 5).map((img) => (
                <div key={img.id} className="overflow-hidden rounded-lg border border-[#262626] bg-[#111]">
                  <ProductImage
                    src={img.url as string}
                    alt={p.name}
                    width={160}
                    height={160}
                    className="aspect-square h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* -------------------------------------------------------------- detalhe */}
        <div>
          {p.category && (
            <Link
              href={`/catalogo?cat=${p.category.slug}`}
              className="text-[11px] uppercase tracking-[0.2em] text-[#C9A962] hover:text-[#D8BC7A]"
            >
              {p.category.name}
            </Link>
          )}
          <h1 className="mt-2 text-3xl font-light leading-tight tracking-tight text-[#F5F5F5] sm:text-4xl">
            {p.name}
          </h1>
          {p.sku && <p className="mt-2 text-xs text-[#525252]">Referência: {p.sku}</p>}

          <div className="mt-6 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold text-[#C9A962]">{formatCurrency(preco)}</span>
            {desconto > 0 && (
              <>
                <span className="text-lg text-[#6F6F6F] line-through">
                  {formatCurrency(Number(p.official_price))}
                </span>
                <span className="rounded-full bg-[#C9A962]/15 px-2.5 py-1 text-xs font-medium text-[#C9A962]">
                  Poupa {formatCurrency(Number(p.official_price) - preco)}
                </span>
              </>
            )}
          </div>

          <p className="mt-3 text-sm">
            {disponivel === null ? (
              // O inventário é legível apenas por contas autenticadas (RLS).
              // Para um visitante não inventamos stock: dizemos a verdade.
              <span className="text-[#A3A3A3]">
                Disponibilidade confirmada ao finalizar a encomenda
              </span>
            ) : disponivel > 0 ? (
              <span className="text-[#16A34A]">
                Em stock · {disponivel} {disponivel === 1 ? "unidade" : "unidades"}
              </span>
            ) : (
              <span className="text-[#DC2626]">Esgotado de momento</span>
            )}
          </p>

          <div className="mt-7 border-t border-[#1F1F1F] pt-7">
            <ProductActions productId={p.id} name={p.name} price={preco} image={primaryImage} />
          </div>

          <div className="mt-7 grid grid-cols-2 gap-3">
            {garantias.map(({ Icone, titulo, detalhe }) => (
              <div key={titulo} className="flex items-start gap-2.5 rounded-lg border border-[#1F1F1F] bg-[#111] p-3">
                <Icone className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A962]" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#E5E5E5]">{titulo}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[#6F6F6F]">{detalhe}</p>
                </div>
              </div>
            ))}
          </div>

          {p.description && (
            <div className="mt-8">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#6F6F6F]">
                Descrição
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[#A3A3A3]">
                {p.description}
              </p>
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-[#525252]">
            O preço final e a disponibilidade são confirmados pelo servidor ao finalizar a
            encomenda.
          </p>
        </div>
      </div>

      {relacionados.length > 0 && (
        <section className="mt-16 border-t border-[#1F1F1F] pt-10">
          <h2 className="mb-5 text-xl font-light text-[#F5F5F5]">
            Também em {p.category?.name ?? "catálogo"}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {relacionados.map((r) => (
              <ProductCard
                key={r.id}
                product={r}
                disponivel={
                  r.inventory ? Math.max(0, r.inventory.quantity - r.inventory.reserved_quantity) : null
                }
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
