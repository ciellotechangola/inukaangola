import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CreditCard, Download, Headphones, Sparkles, Truck, Users } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { TELEFONES_INUKA, telHref } from "@/lib/contactos";
import { lerEntrega, nomesProvinciasGratis } from "@/lib/entrega-server";
import { formatCurrency } from "@/lib/utils";
import ProductCard from "@/components/ProductCard";
import { stockDosProdutos } from "@/lib/stock";
import type { Category, Product } from "@/types";

export const dynamic = "force-dynamic";

type ProdutoComEstoque = Product;

async function getDados() {
  const supabase = await createClientServer();

  const [produtosRes, categoriasRes] = await Promise.all([
    supabase
      .from("products")
      .select("*, category:categories(*), images:product_images(*)")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(24),
    supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
  ]);

  const produtos = (produtosRes.data ?? []) as ProdutoComEstoque[];

  // Stock numa só chamada. Vem de uma função pública (migração 0012): o
  // inventário só é legível por contas autenticadas e a montra é para todos.
  const stock = await stockDosProdutos(
    supabase,
    produtos.map((p) => p.id)
  );

  return {
    produtos,
    stock,
    categorias: (categoriasRes.data ?? []) as Category[],
  };
}

/** Unidades compráveis; `null` quando a base não tem registo de stock. */
function disponibilidade(stock: Map<string, number>, id: string): number | null {
  return stock.get(id) ?? null;
}

export default async function HomePage() {
  const { produtos, stock, categorias } = await getDados();

  // A regra de entrega é configurável: não se escreve «grátis em Luanda,
  // Uíge e Huambo» à mão, senão o site promete o que a caixa não cobra.
  const entrega = await lerEntrega();
  const gratisNomes = await nomesProvinciasGratis(entrega);
  const entregaCurta =
    entrega.taxaPadrao <= 0
      ? "Grátis em todo o país"
      : `Grátis: ${gratisNomes.join(" · ") || "Uíge"} · ${formatCurrency(entrega.taxaPadrao)} fora`;

  const promocoes = produtos.filter((p) => p.promotional_price !== null).slice(0, 4);

  // Destaques: primeiro os marcados pela gerência, depois os mais recentes.
  // Sem este preenchimento, uma loja com poucos produtos marcados mostrava
  // uma secção com um único cartão.
  const restantes = produtos.filter((p) => !promocoes.some((x) => x.id === p.id));
  const destaques = [
    ...restantes.filter((p) => p.is_featured || p.is_bestseller),
    ...restantes.filter((p) => !(p.is_featured || p.is_bestseller)),
  ].slice(0, 4);

  const garantias = [
    { Icone: Truck, titulo: "Entrega ao domicílio", detalhe: entregaCurta },
    { Icone: BadgeCheck, titulo: "100% original", detalhe: "Distribuição oficial" },
    { Icone: CreditCard, titulo: "Pagamento na entrega", detalhe: "Dinheiro ou transferência" },
    { Icone: Headphones, titulo: "Apoio dedicado", detalhe: TELEFONES_INUKA.join(" · ") },
  ];

  return (
    <main>
      {/* ---------------------------------------------------------------- HERO */}
      <section className="relative overflow-hidden border-b border-[#1F1F1F]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(201,169,98,0.16),transparent_62%)]"
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div>
            <p className="mb-5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.28em] text-[#C9A962]">
              <Sparkles className="h-3.5 w-3.5" />
              INUKA · Always with you
            </p>
            <h1 className="max-w-xl text-4xl font-light leading-[1.1] tracking-tight text-[#F5F5F5] sm:text-5xl lg:text-6xl">
              Tua autoestima é a <span className="text-[#C9A962]">nossa prioridade</span>.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-[#A3A3A3]">
              Perfumes e produtos de beleza originais INUKA, escolhidos para acompanhar cada
              momento do teu dia. Reserve online e receba em casa.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/catalogo"
                className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-6 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
              >
                Ver catálogo
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/download"
                className="inline-flex items-center gap-2 rounded-lg border border-[#3A3A3A] px-6 py-3 text-sm font-medium text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
              >
                <Download className="h-4 w-4" />
                Descarregar a app
              </Link>
              <Link
                href="/revendedor"
                className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962]/50 bg-[#C9A962]/5 px-6 py-3 text-sm font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
              >
                <Users className="h-4 w-4" />
                Quero ser revendedor
              </Link>
            </div>

            <p className="mt-8 text-xs text-[#6F6F6F]">
              {produtos.length > 0
                ? `${produtos.length} produtos disponíveis · ${entregaCurta.toLowerCase()}`
                : "Catálogo em actualização · fale connosco para encomendar"}
            </p>
          </div>

          <div className="relative hidden lg:block">
            <div className="relative overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[linear-gradient(160deg,#181818,#0C0C0C)] p-10">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#C9A962]/10 blur-3xl"
              />
              <Image
                src="/logo-inuka.png"
                alt="INUKA"
                width={200}
                height={100}
                className="h-16 w-auto"
                priority
              />
              <p className="mt-8 font-light leading-relaxed tracking-wide text-[#C9A962]">
                &ldquo;Mais que perfumes, é a tua melhor versão.&rdquo;
              </p>
              <div className="mt-10 grid grid-cols-3 gap-4 border-t border-[#262626] pt-6 text-center">
                {[
                  ["Perfumes", "assinatura"],
                  ["Beleza", "cuidado diário"],
                  ["Entrega", "gratuita"],
                ].map(([titulo, detalhe]) => (
                  <div key={titulo}>
                    <p className="text-sm text-[#E5E5E5]">{titulo}</p>
                    <p className="mt-1 text-[11px] text-[#6F6F6F]">{detalhe}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ GARANTIAS */}
      <section className="border-b border-[#1F1F1F] bg-[#0C0C0C]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-4 px-4 py-6 sm:grid-cols-4">
          {garantias.map(({ Icone, titulo, detalhe }) => (
            <div key={titulo} className="flex items-center gap-3 py-3">
              <Icone className="h-5 w-5 shrink-0 text-[#C9A962]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#E5E5E5]">{titulo}</p>
                <p className="text-[11px] leading-snug text-[#6F6F6F]">{detalhe}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ CATEGORIAS */}
      {categorias.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-light text-[#F5F5F5]">Categorias</h2>
              <p className="mt-1 text-sm text-[#7A7A7A]">
                Encontre o que procura por linha de produto.
              </p>
            </div>
            <Link href="/catalogo" className="shrink-0 text-sm text-[#C9A962] hover:text-[#D8BC7A]">
              Ver todas →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categorias.map((cat) => (
              <Link
                key={cat.id}
                href={`/catalogo?cat=${cat.slug}`}
                className="group flex items-center justify-between rounded-xl border border-[#262626] bg-[#141414] px-4 py-4 transition hover:border-[#C9A962]/50 hover:bg-[#181818]"
              >
                <span className="text-sm font-medium text-[#E5E5E5] transition group-hover:text-[#C9A962]">
                  {cat.name}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#4A4A4A] transition group-hover:translate-x-0.5 group-hover:text-[#C9A962]" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- PROMOÇÕES */}
      {promocoes.length > 0 && (
        <section className="border-y border-[#1F1F1F] bg-[#0C0C0C]">
          <div className="mx-auto max-w-7xl px-4 py-14">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-light text-[#F5F5F5]">Em promoção</h2>
                <p className="mt-1 text-sm text-[#7A7A7A]">Preços especiais por tempo limitado.</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
                <Link href="/catalogo?promo=1" className="text-[#C9A962] hover:text-[#D8BC7A]">
                  Ver promoções →
                </Link>
                <Link href="/promocoes" className="text-[11px] text-[#7A7A7A] hover:text-[#C9A962]">
                  Campanhas em destaque
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {promocoes.map((p) => (
                <ProductCard key={p.id} product={p} disponivel={disponibilidade(stock, p.id)} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- DESTAQUES */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-light text-[#F5F5F5]">Destaques INUKA</h2>
            <p className="mt-1 text-sm text-[#7A7A7A]">Os favoritos de quem já nos conhece.</p>
          </div>
          <Link href="/catalogo" className="shrink-0 text-sm text-[#C9A962] hover:text-[#D8BC7A]">
            Ver catálogo →
          </Link>
        </div>

        {produtos.length === 0 ? (
          <div className="rounded-xl border border-[#262626] bg-[#141414] p-12 text-center">
            <p className="text-[#A3A3A3]">Ainda não há produtos publicados.</p>
            <p className="mt-2 text-sm text-[#525252]">
              Os produtos aparecem aqui assim que a gerência os cadastrar.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {destaques.map((p) => (
              <ProductCard key={p.id} product={p} disponivel={disponibilidade(stock, p.id)} />
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------------- CTA */}
      <section className="border-t border-[#1F1F1F] bg-[linear-gradient(120deg,#0F0F0F,#15120A)]">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-light text-[#F5F5F5]">Precisa de ajuda a escolher?</h2>
            <p className="mt-1 text-sm text-[#A3A3A3]">
              Fale com um consultor INUKA e receba uma recomendação personalizada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TELEFONES_INUKA.map((t) => (
              <a
                key={t}
                href={telHref(t)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962] px-6 py-3 text-sm font-semibold text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
              >
                <Headphones className="h-4 w-4" />
                {t}
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
