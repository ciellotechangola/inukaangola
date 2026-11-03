import Link from "next/link";
import { CalendarDays, MapPin, Pin } from "lucide-react";
import { Interacoes } from "./Interacoes";
import {
  dataConteudo,
  estadoDaPromocao,
  type Conteudo,
} from "@/lib/conteudos";
import { formatCurrency } from "@/lib/utils";

/**
 * Cartão de conteúdo — a mesma peça nos três destinos.
 *
 * `variante` muda a hierarquia, não os dados: o feed dos colaboradores lê
 * primeiro o título, os testemunhos leem primeiro a citação, a loja lê primeiro
 * a imagem e o preço.
 */

export function CartaoConteudo({
  conteudo,
  variante = "feed",
  mostrarInteracoes = true,
  detalheHref,
}: {
  conteudo: Conteudo;
  variante?: "feed" | "testemunho" | "loja";
  mostrarInteracoes?: boolean;
  /** Quando existe, a imagem e o título abrem a página do conteúdo. */
  detalheHref?: string;
}) {
  const produtos = conteudo.produtos ?? [];
  const promo = estadoDaPromocao(conteudo);

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-[#141414] ${
        conteudo.is_pinned ? "border-[#C9A962]/45" : "border-[#262626]"
      }`}
    >
      {conteudo.image_url && (
        <div className={variante === "loja" ? "aspect-square bg-[#0A0A0A]" : "aspect-[16/10] bg-[#0A0A0A]"}>
          {detalheHref ? (
            <Link href={detalheHref} className="block h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={conteudo.image_url}
                alt={conteudo.title}
                className="h-full w-full object-cover transition hover:opacity-90"
                loading="lazy"
              />
            </Link>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={conteudo.image_url}
              alt={conteudo.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          )}
        </div>
      )}

      <div className="p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {conteudo.is_pinned && (
            <span className="flex items-center gap-1 rounded bg-[#2A2410] px-1.5 py-0.5 text-[10px] text-[#E3D5A7]">
              <Pin className="h-2.5 w-2.5" /> Importante
            </span>
          )}
          {conteudo.kind === "promocao" && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                promo === "ativa"
                  ? "bg-[#0F2A18] text-[#4ADE80]"
                  : promo === "breve"
                    ? "bg-[#2A2410] text-[#E3D5A7]"
                    : "bg-[#2A1010] text-[#F87171]"
              }`}
            >
              {promo === "ativa" ? "Em curso" : promo === "breve" ? "Em breve" : "Terminada"}
            </span>
          )}
          {conteudo.provincia_nome && (
            <span className="flex items-center gap-1 text-[10px] text-[#6F6F6F]">
              <MapPin className="h-2.5 w-2.5" /> {conteudo.provincia_nome}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-[10px] text-[#5F5F5F]">
            <CalendarDays className="h-2.5 w-2.5" />
            {dataConteudo(conteudo.published_at)}
          </span>
        </div>

        <h3
          className={`font-light text-[#F5F5F5] ${
            variante === "testemunho" ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"
          }`}
        >
          {detalheHref ? (
            <Link href={detalheHref} className="transition hover:text-[#C9A962]">
              {conteudo.title}
            </Link>
          ) : (
            conteudo.title
          )}
        </h3>

        {conteudo.subtitle && (
          <p className="mt-1 text-sm text-[#C9A962]">{conteudo.subtitle}</p>
        )}

        {conteudo.body && (
          <p
            className={`mt-3 text-sm leading-relaxed text-[#A3A3A3] ${
              variante === "testemunho" ? "italic" : ""
            } ${variante === "loja" ? "line-clamp-3" : ""}`}
          >
            {conteudo.body}
          </p>
        )}

        {conteudo.author_name && (
          <p className="mt-3 text-[11px] uppercase tracking-wider text-[#6F6F6F]">
            — {conteudo.author_name}
          </p>
        )}

        {conteudo.kind === "promocao" && (conteudo.starts_at || conteudo.ends_at) && (
          <p className="mt-3 text-[11px] text-[#6F6F6F]">
            {conteudo.starts_at ? `De ${dataConteudo(conteudo.starts_at)}` : "Sem data de início"}
            {conteudo.ends_at ? ` até ${dataConteudo(conteudo.ends_at)}` : ""}
          </p>
        )}

        {produtos.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
              Produtos anunciados
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {produtos.map((p) => (
                <Link
                  key={p.id}
                  href={`/produto/${p.id}`}
                  className="group flex w-24 shrink-0 flex-col"
                >
                  <div className="aspect-square w-full overflow-hidden rounded-lg border border-[#262626] bg-[#0A0A0A]">
                    {p.imagem ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imagem}
                        alt={p.name}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[9px] text-[#4A4A4A]">
                        sem foto
                      </div>
                    )}
                  </div>
                  <span className="mt-1 line-clamp-2 text-[10px] leading-tight text-[#D4D4D4] group-hover:text-[#C9A962]">
                    {p.name}
                  </span>
                  <span className="text-[10px] text-[#C9A962]">
                    {formatCurrency(Number(p.preco))}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {conteudo.cta_label && conteudo.cta_href && (
          <Link
            href={conteudo.cta_href}
            className="mt-4 inline-flex items-center rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
          >
            {conteudo.cta_label}
          </Link>
        )}

        {mostrarInteracoes && (
          <Interacoes
            itemId={conteudo.id}
            permitirReacoes={conteudo.allow_reactions}
            permitirComentarios={conteudo.allow_comments}
            reacoes={conteudo.reacoes}
            minhaReacao={conteudo.minha_reacao}
            comentarios={conteudo.comentarios}
          />
        )}
      </div>
    </article>
  );
}
