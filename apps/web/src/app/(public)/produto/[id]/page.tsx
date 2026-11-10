import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CreditCard, ShieldCheck, Truck } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { lerEntrega, nomesProvinciasGratis } from "@/lib/entrega-server";
import ProductActions from "@/components/ProductActions";
import ProductCard, { descontoDe, precoEfetivo } from "@/components/ProductCard";
import ProductGallery from "@/components/ProductGallery";
import { stockDosProdutos } from "@/lib/stock";
import { precosDeCampanha, provinciaDoVisitante } from "@/lib/promocoes-server";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

export const dynamic = "force-dynamic";

type ProdutoComEstoque = Product;

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClientServer();

  const { data: product, error } = await supabase
    .from("products")
    .select("*, category:categories(*), images:product_images(*)")
    .eq("id", id)
    .single();

  if (error || !product) notFound();

  const p = product as ProdutoComEstoque;
  const imagens = (p.images ?? [])
    .filter((i) => Boolean(i.url))
    .sort(
      (a, b) =>
        Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
  const primaryImage = imagens[0]?.url ?? null;

  // Entrega: a mesma regra que o carrinho e o `place_order` usam. Escrita à
  // mão («grátis em Luanda, Uíge, Huambo») ficava a mentir no dia em que a
  // gerência mudasse a taxa.
  const defsEntrega = await lerEntrega();
  const gratisNomes = await nomesProvinciasGratis(defsEntrega);
  const entregaCurta =
    defsEntrega.taxaPadrao === null
      ? `Grátis: ${gratisNomes.join(" · ") || "Uíge"} · taxa por definir fora`
      : defsEntrega.taxaPadrao <= 0
        ? "Grátis em todo o país"
        : `Grátis: ${gratisNomes.join(" · ") || "Uíge"} · ${formatCurrency(defsEntrega.taxaPadrao)} fora`;

  // Relacionados: mesma categoria, nunca o próprio.
  const relacionados = p.category_id
    ? (((
        await supabase
          .from("products")
          .select("*, category:categories(*), images:product_images(*)")
          .eq("is_active", true)
          .eq("category_id", p.category_id)
          .neq("id", p.id)
          .limit(4)
      ).data ?? []) as ProdutoComEstoque[])
    : [];

  // Stock público (migração 0012): o inventário só é legível com sessão, e a
  // página do produto é aberta por visitantes — sem isto, a rutura ficava
  // invisível e o formulário de reserva nunca aparecia a quem não tem conta.
  // Uma só chamada serve o produto e os relacionados.
  const stock = await stockDosProdutos(supabase, [p.id, ...relacionados.map((r) => r.id)]);
  const disponivel = stock.get(p.id) ?? null;

  // Preço de campanha para a província de quem está a ver. É o mesmo número
  // que `place_order` vai cobrar — a promoção de outra província não aparece.
  const provinciaId = await provinciaDoVisitante();
  const precos = await precosDeCampanha(
    [p.id, ...relacionados.map((r) => r.id)],
    provinciaId
  );
  const campanha = precos.get(p.id) ?? null;
  const preco = campanha ? campanha.final : precoEfetivo(p);
  const desconto = descontoDe(Number(p.official_price), preco);

  const campanhaDe = (produto: ProdutoComEstoque) => {
    const c = precos.get(produto.id);
    return c && c.final < c.base ? { preco: c.final, nome: c.promocaoNome } : null;
  };

  const garantias = [
    { Icone: BadgeCheck, titulo: "Produto original", detalhe: "Distribuição oficial INUKA" },
    { Icone: Truck, titulo: "Entrega ao domicílio", detalhe: entregaCurta },
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
          <ProductGallery
            imagens={imagens.map((i) => ({ id: i.id, url: i.url as string }))}
            alt={p.name}
            desconto={desconto}
            esgotado={disponivel === 0}
          />
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

          {campanha?.promocaoNome && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#E3D5A7]">
              <span className="rounded-full border border-[#C9A962]/40 px-2 py-0.5">
                Campanha
              </span>
              {campanha.promocaoNome}
              <span className="text-[#525252]">· preço válido na sua província</span>
            </p>
          )}

          <p className="mt-3 text-sm">
            {disponivel === null ? (
              // Sem linha de inventário não há stock a anunciar — é diferente
              // de zero. Não se inventa um número.
              <span className="text-[#A3A3A3]">
                Disponibilidade confirmada ao finalizar a encomenda
              </span>
            ) : disponivel > 0 ? (
              <span className="text-[#16A34A]">
                Em stock · {disponivel} {disponivel === 1 ? "unidade" : "unidades"}
              </span>
            ) : (
              <span className="text-[#DC2626]">
                Esgotado de momento — pode deixar reserva abaixo
              </span>
            )}
          </p>

          <div className="mt-7 border-t border-[#1F1F1F] pt-7">
            <ProductActions
              productId={p.id}
              name={p.name}
              price={preco}
              image={primaryImage}
              disponivel={disponivel}
            />
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
                disponivel={stock.get(r.id) ?? null}
                campanha={campanhaDe(r)}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
