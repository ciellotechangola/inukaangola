import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { Interacoes } from "@/components/conteudos/Interacoes";
import { dataConteudo, type Conteudo, type ConteudoProduto } from "@/lib/conteudos";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface LinhaProduto {
  sort_order: number | null;
  products:
    | {
        id: string;
        name: string;
        sku: string | null;
        official_price: number | string;
        promotional_price: number | string | null;
        product_images: { url: string; is_primary: boolean | null; sort_order: number | null }[] | null;
      }
    | null;
}

/**
 * Testemunho em tamanho completo.
 *
 * A leitura passa pela mesma tabela que o resto do site — a política RLS
 * `content_items_read` decide se esta linha existe para quem está a pedir. Um
 * testemunho em rascunho ou suspenso simplesmente não é encontrado, e a página
 * responde 404 em vez de revelar que existe.
 */
export default async function TestemunhoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) redirect(`/login?redirect=/cliente/testemunhos/${id}`);

  const supabase = await createClientServer();

  const { data, error } = await supabase
    .from("content_items")
    .select(
      "id, kind, title, subtitle, body, image_url, status, is_pinned, allow_reactions, allow_comments, author_name, author_photo, starts_at, ends_at, published_at, cta_label, cta_href, metadata, provincia_id, project_id"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();
  if (data.kind !== "testemunho") notFound();

  // O nome da província vem em separado: um embed aqui obrigaria a que a
  // relação estivesse exposta ao PostgREST com o nome certo, e isto é só um
  // rótulo — uma segunda consulta é mais previsível.
  const { data: provinciaLinha } = data.provincia_id
    ? await supabase.from("provincias").select("nome").eq("id", data.provincia_id).maybeSingle()
    : { data: null };

  const [{ data: produtos }, { count: reacoes }, { count: comentarios }, { data: minha }] =
    await Promise.all([
      supabase
        .from("content_products")
        .select(
          "sort_order, products ( id, name, sku, official_price, promotional_price, product_images ( url, is_primary, sort_order ) )"
        )
        .eq("item_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("content_reactions")
        .select("id", { count: "exact", head: true })
        .eq("item_id", id),
      supabase
        .from("content_comments")
        .select("id", { count: "exact", head: true })
        .eq("item_id", id),
      supabase
        .from("content_reactions")
        .select("reaction")
        .eq("item_id", id)
        .eq("user_id", profile.id)
        .maybeSingle(),
    ]);

  const provincia = (provinciaLinha as { nome?: string } | null)?.nome ?? null;

  const listaProdutos: ConteudoProduto[] = ((produtos ?? []) as unknown as LinhaProduto[])
    .map((linha) => linha.products)
    .filter((p): p is NonNullable<LinhaProduto["products"]> => !!p)
    .map((p) => {
      const imagens = [...(p.product_images ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order) - Number(b.sort_order)
      );
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        preco: p.promotional_price ?? p.official_price,
        oficial: p.official_price,
        imagem: imagens[0]?.url ?? null,
      };
    });

  const conteudo: Conteudo = {
    ...(data as unknown as Conteudo),
    provincia_nome: provincia,
    reacoes: reacoes ?? 0,
    comentarios: comentarios ?? 0,
    minha_reacao: (minha as { reaction: string } | null)?.reaction ?? null,
    produtos: listaProdutos,
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/cliente/testemunhos"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-[#8A8A8A] transition hover:text-[#C9A962]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Testemunhos de Clientes
      </Link>

      <article className="overflow-hidden rounded-2xl border border-[#262626] bg-[#141414]">
        {conteudo.image_url && (
          <div className="bg-[#0A0A0A]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={conteudo.image_url}
              alt={conteudo.title}
              className="mx-auto max-h-[70vh] w-full object-contain"
            />
          </div>
        )}

        <div className="p-5 sm:p-7">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
            {provincia && (
              <span className="flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5" /> {provincia}
              </span>
            )}
            <span className="flex items-center gap-1">
              <CalendarDays className="h-2.5 w-2.5" />
              {dataConteudo(conteudo.published_at)}
            </span>
          </div>

          <h1 className="text-2xl font-light text-[#F5F5F5] sm:text-3xl">{conteudo.title}</h1>
          {conteudo.subtitle && <p className="mt-1 text-sm text-[#C9A962]">{conteudo.subtitle}</p>}

          {conteudo.body && (
            <p className="mt-4 whitespace-pre-wrap text-base italic leading-relaxed text-[#C4C4C4]">
              {conteudo.body}
            </p>
          )}

          {conteudo.author_name && (
            <p className="mt-4 text-[11px] uppercase tracking-wider text-[#6F6F6F]">
              — {conteudo.author_name}
            </p>
          )}

          {listaProdutos.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
                Produtos deste testemunho
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {listaProdutos.map((p) => (
                  <Link
                    key={p.id}
                    href={`/produto/${p.id}`}
                    className="group rounded-lg border border-[#262626] bg-[#0F0F0F] p-2 transition hover:border-[#C9A962]/50"
                  >
                    <div className="mb-2 aspect-square overflow-hidden rounded bg-[#0A0A0A]">
                      {p.imagem ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imagem}
                          alt={p.name}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-[10px] text-[#4A4A4A]">
                          sem foto
                        </div>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs text-[#D4D4D4] group-hover:text-[#C9A962]">
                      {p.name}
                    </p>
                    <p className="mt-0.5 text-xs text-[#C9A962]">{formatCurrency(Number(p.preco))}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {conteudo.cta_label && conteudo.cta_href && (
            <Link
              href={conteudo.cta_href}
              className="mt-6 inline-flex items-center rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
            >
              {conteudo.cta_label}
            </Link>
          )}

          <div className="mt-6 border-t border-[#242424] pt-4">
            <Interacoes
              itemId={conteudo.id}
              permitirReacoes={conteudo.allow_reactions}
              permitirComentarios={conteudo.allow_comments}
              reacoes={conteudo.reacoes}
              minhaReacao={conteudo.minha_reacao}
              comentarios={conteudo.comentarios}
            />
          </div>
        </div>
      </article>
    </main>
  );
}
