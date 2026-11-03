import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import ProductCard, { precoEfetivo } from "@/components/ProductCard";
import type { Category, Product } from "@/types";

export const dynamic = "force-dynamic";

type ProdutoComEstoque = Product & {
  inventory?: { quantity: number; reserved_quantity: number } | null;
};

const ORDENS = [
  { chave: "relevancia", etiqueta: "Relevância" },
  { chave: "preco-asc", etiqueta: "Preço ↑" },
  { chave: "preco-desc", etiqueta: "Preço ↓" },
  { chave: "novidades", etiqueta: "Novidades" },
] as const;

const FAIXAS = [
  { chave: "ate-10", etiqueta: "Até 10 000 Kz", min: undefined, max: 10_000 },
  { chave: "10-20", etiqueta: "10 000 – 20 000 Kz", min: 10_000, max: 20_000 },
  { chave: "20-30", etiqueta: "20 000 – 30 000 Kz", min: 20_000, max: 30_000 },
  { chave: "mais-30", etiqueta: "Mais de 30 000 Kz", min: 30_000, max: undefined },
] as const;

function numero(valor: string | string[] | undefined): number | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  if (!bruto) return undefined;
  const n = Number(bruto);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function texto(valor: string | string[] | undefined): string | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return bruto && bruto.trim() ? bruto.trim() : undefined;
}

function disponibilidade(p: ProdutoComEstoque): number | null {
  if (!p.inventory) return null;
  return Math.max(0, p.inventory.quantity - p.inventory.reserved_quantity);
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const supabase = await createClientServer();

  const cat = texto(sp.cat);
  const min = numero(sp.min);
  const max = numero(sp.max);
  const soPromocao = texto(sp.promo) === "1";
  const ordem = (texto(sp.ordem) ?? "relevancia") as (typeof ORDENS)[number]["chave"];

  const categoriasRes = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  const categorias = (categoriasRes.data ?? []) as Category[];

  const categoriaAtual = cat ? categorias.find((c) => c.slug === cat) : undefined;

  // ---------------------------------------------------------------- consulta
  let consulta = supabase
    .from("products")
    .select(
      "*, category:categories(*), images:product_images(*), inventory(quantity, reserved_quantity)"
    )
    .eq("is_active", true);

  // Categoria inexistente não deve devolver o catálogo inteiro como se nada
  // fosse — devolve vazio, para se ver que o filtro não existe.
  if (cat) {
    consulta = consulta.eq(
      "category_id",
      categoriaAtual?.id ?? "00000000-0000-0000-0000-000000000000"
    );
  }
  if (soPromocao) consulta = consulta.not("promotional_price", "is", null);

  // O preço que o cliente paga é `promotional_price` quando existe, senão
  // `official_price`. Filtrar só por `official_price` mostrava produtos fora
  // do intervalo escolhido.
  if (min !== undefined) {
    consulta = consulta.or(
      `and(promotional_price.is.null,official_price.gte.${min}),and(promotional_price.not.is.null,promotional_price.gte.${min})`
    );
  }
  if (max !== undefined) {
    consulta = consulta.or(
      `and(promotional_price.is.null,official_price.lte.${max}),and(promotional_price.not.is.null,promotional_price.lte.${max})`
    );
  }

  const { data, error } = await consulta;
  let produtos = ((data ?? []) as ProdutoComEstoque[]).filter(Boolean);
  if (error) produtos = [];

  produtos = [...produtos].sort((a, b) => {
    if (ordem === "preco-asc") return precoEfetivo(a) - precoEfetivo(b);
    if (ordem === "preco-desc") return precoEfetivo(b) - precoEfetivo(a);
    if (ordem === "novidades") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    return 0;
  });

  // ------------------------------------------------------------------- links
  function hrefCom(over: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const atual: Record<string, string | undefined> = {
      cat,
      min: min?.toString(),
      max: max?.toString(),
      promo: soPromocao ? "1" : undefined,
      ordem: ordem === "relevancia" ? undefined : ordem,
      ...over,
    };
    for (const [k, v] of Object.entries(atual)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/catalogo?${qs}` : "/catalogo";
  }

  const temFiltro = Boolean(cat || soPromocao || min !== undefined || max !== undefined);

  const filtros = (
    <div className="space-y-7">
      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
          Categorias
        </h2>
        <ul className="space-y-1">
          <li>
            <Link
              href={hrefCom({ cat: undefined })}
              className={`block rounded-md px-2 py-1.5 text-sm transition ${
                cat
                  ? "text-[#A3A3A3] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]"
                  : "bg-[#C9A962]/10 text-[#C9A962]"
              }`}
            >
              Todas
            </Link>
          </li>
          {categorias.map((c) => (
            <li key={c.id}>
              <Link
                href={hrefCom({ cat: c.slug })}
                className={`block rounded-md px-2 py-1.5 text-sm transition ${
                  cat === c.slug
                    ? "bg-[#C9A962]/10 text-[#C9A962]"
                    : "text-[#A3A3A3] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]"
                }`}
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
          Preço
        </h2>
        <ul className="space-y-1">
          {FAIXAS.map((f) => {
            const ativo = min === f.min && max === f.max;
            return (
              <li key={f.chave}>
                <Link
                  href={hrefCom({
                    min: ativo ? undefined : f.min?.toString(),
                    max: ativo ? undefined : f.max?.toString(),
                  })}
                  className={`block rounded-md px-2 py-1.5 text-sm transition ${
                    ativo
                      ? "bg-[#C9A962]/10 text-[#C9A962]"
                      : "text-[#A3A3A3] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]"
                  }`}
                >
                  {f.etiqueta}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
          Promoções
        </h2>
        <Link
          href={hrefCom({ promo: soPromocao ? undefined : "1" })}
          className={`inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
            soPromocao
              ? "bg-[#C9A962]/10 text-[#C9A962]"
              : "text-[#A3A3A3] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]"
          }`}
        >
          <span
            className={`h-3.5 w-3.5 rounded border ${
              soPromocao ? "border-[#C9A962] bg-[#C9A962]" : "border-[#4A4A4A]"
            }`}
          />
          Só com desconto
        </Link>
      </div>

      {temFiltro && (
        <Link
          href="/catalogo"
          className="inline-block text-xs text-[#C9A962] underline-offset-4 hover:underline"
        >
          Limpar filtros
        </Link>
      )}
    </div>
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <nav className="mb-5 flex items-center gap-2 text-xs text-[#6F6F6F]">
        <Link href="/" className="transition hover:text-[#C9A962]">
          Início
        </Link>
        <span>/</span>
        {categoriaAtual ? (
          <>
            <Link href="/catalogo" className="transition hover:text-[#C9A962]">
              Catálogo
            </Link>
            <span>/</span>
            <span className="text-[#A3A3A3]">{categoriaAtual.name}</span>
          </>
        ) : (
          <span className="text-[#A3A3A3]">Catálogo</span>
        )}
      </nav>

      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight text-[#F5F5F5]">
            {categoriaAtual ? categoriaAtual.name : "Catálogo"}
          </h1>
          <p className="mt-1.5 text-sm text-[#7A7A7A]">
            {produtos.length === 0
              ? "Nenhum produto encontrado."
              : produtos.length === 1
                ? `1 produto${categoriaAtual ? ` em ${categoriaAtual.name}` : " disponível"}`
                : `${produtos.length} produtos${categoriaAtual ? ` em ${categoriaAtual.name}` : " disponíveis"}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-[#5A5A5A]">Ordenar</span>
          {ORDENS.map((o) => (
            <Link
              key={o.chave}
              href={hrefCom({ ordem: o.chave === "relevancia" ? undefined : o.chave })}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                ordem === o.chave
                  ? "border-[#C9A962] text-[#C9A962]"
                  : "border-[#333] text-[#8A8A8A] hover:border-[#C9A962]/60 hover:text-[#C9A962]"
              }`}
            >
              {o.etiqueta}
            </Link>
          ))}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        {/* Filtros no telemóvel: <details> nativo, sem JavaScript. */}
        <aside className="mb-6 lg:mb-0">
          <details className="rounded-xl border border-[#262626] bg-[#121212] p-4 lg:hidden">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#E5E5E5]">
              <SlidersHorizontal className="h-4 w-4 text-[#C9A962]" />
              Filtros
            </summary>
            <div className="mt-5">{filtros}</div>
          </details>
          <div className="hidden lg:block">{filtros}</div>
        </aside>

        <div>
          {produtos.length === 0 ? (
            <div className="rounded-xl border border-[#262626] bg-[#141414] p-12 text-center">
              <p className="text-[#A3A3A3]">
                {temFiltro
                  ? "Nenhum produto corresponde aos filtros escolhidos."
                  : "Nenhum produto disponível de momento."}
              </p>
              <p className="mt-2 text-sm text-[#525252]">
                {temFiltro
                  ? "Experimente alargar o intervalo de preço ou escolher outra categoria."
                  : "Os produtos aparecem aqui assim que a gerência os cadastrar."}
              </p>
              {temFiltro && (
                <Link
                  href="/catalogo"
                  className="mt-6 inline-block rounded-lg border border-[#C9A962] px-5 py-2 text-sm font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
                >
                  Limpar filtros
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {produtos.map((p) => (
                <ProductCard key={p.id} product={p} disponivel={disponibilidade(p)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
