"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Download, MapPin, Pin, Plus, X } from "lucide-react";
import { Interacoes } from "./Interacoes";
import { QuemReagiu } from "./QuemReagiu";
import {
  dataConteudo,
  estadoDaPromocao,
  rotuloCurto,
  type Conteudo,
} from "@/lib/conteudos";
import { formatCurrency } from "@/lib/utils";

/**
 * Feed de publicações, no formato de uma rede social.
 *
 * Serve os dois feeds da casa: o **Feed Inuka** (comunicados, só para a equipa)
 * e o **Feed Clientes** (promoções e testemunhos). São o mesmo cartão de
 * propósito — quem passa de um para o outro não reaprende nada.
 *
 * O cartão antigo mostrava o texto inteiro num bloco de altura fixa: um
 * comunicado de três linhas ficava com metade da área vazia e o título a 48 px
 * empurrava tudo para fora do ecrã. Aqui a hierarquia é a de um feed — quem
 * publicou, a imagem, duas linhas de legenda e as acções — e o texto completo
 * abre por cima, quando se quer ler.
 *
 * Descarregar está em cada cartão e dentro do leitor: é o que se faz a seguir a
 * ler um aviso que é preciso reenviar ou guardar.
 */

export function FeedConteudos({
  itens,
  hrefNovo,
  rotuloNovo = "Publicar",
  gerirReacoes,
}: {
  itens: Conteudo[];
  /** Só a gestão recebe isto — o colaborador e o cliente são leitores. */
  hrefNovo?: string;
  /** Texto do botão de publicação, quando existe. */
  rotuloNovo?: string;
  /** A gestão vê **quem** reagiu, não só quantos. */
  gerirReacoes?: boolean;
}) {
  const [aberto, setAberto] = useState<Conteudo | null>(null);

  const fechar = useCallback(() => setAberto(null), []);

  // O leitor é uma camada por cima: sem isto a página de trás rolava por baixo
  // e, no telemóvel, o `Esc` não existia para sair.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    window.addEventListener("keydown", aoTeclar);

    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto, fechar]);

  return (
    <>
      {hrefNovo && (
        <div className="mb-4 flex justify-end">
          <Link
            href={hrefNovo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
          >
            <Plus className="h-3.5 w-3.5" /> {rotuloNovo}
          </Link>
        </div>
      )}

      <div className="mx-auto w-full max-w-[560px] space-y-5">
        {itens.map((c) => (
          <Cartao
            key={c.id}
            conteudo={c}
            gerirReacoes={gerirReacoes}
            onAbrir={() => setAberto(c)}
          />
        ))}
      </div>

      {aberto && <Leitor conteudo={aberto} onFechar={fechar} />}
    </>
  );
}

function Cartao({
  conteudo,
  gerirReacoes,
  onAbrir,
}: {
  conteudo: Conteudo;
  gerirReacoes?: boolean;
  onAbrir: () => void;
}) {
  const promo = estadoDaPromocao(conteudo);
  const temTexto = Boolean(conteudo.body && conteudo.body.length > 160);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#232323] bg-[#121212]">
      {/* Cabeçalho: quem publicou, quando. Clicar abre o conteúdo todo. */}
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#161616]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E3D5A7] to-[#8A6F2E] text-[11px] font-bold text-[#0A0A0A]">
          IN
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-[#F5F5F5]">
              {conteudo.author_name?.trim() || "Gestão INUKA"}
            </span>
            {conteudo.is_pinned && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-[#2A2410] px-1.5 py-0.5 text-[9px] text-[#E3D5A7]">
                <Pin className="h-2.5 w-2.5" /> Importante
              </span>
            )}
            {conteudo.kind === "promocao" && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
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
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[10px] text-[#6F6F6F]">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-2.5 w-2.5" />
              {dataConteudo(conteudo.published_at)}
            </span>
            {conteudo.provincia_nome && (
              <span className="flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5" />
                {conteudo.provincia_nome}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Mídia. Sem fotografia, o título é o cartaz — mas contido, não a 48 px. */}
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        {conteudo.image_url ? (
          <span className="block bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={conteudo.image_url}
              alt={conteudo.title}
              className="mx-auto max-h-[70vh] w-full object-contain"
              loading="lazy"
            />
          </span>
        ) : (
          <span className="block bg-gradient-to-br from-[#1B1B1B] via-[#141414] to-[#0C0C0C] px-5 py-9">
            <span className="block text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
              {rotuloCurto(conteudo.kind)}
            </span>
            <span className="mt-2 block line-clamp-4 text-2xl font-light leading-tight text-[#F5F5F5]">
              {conteudo.title}
            </span>
          </span>
        )}
      </button>

      <div className="px-4 pb-3 pt-3">
        {conteudo.image_url && (
          <h3 className="text-sm font-medium text-[#F5F5F5]">{conteudo.title}</h3>
        )}
        {conteudo.subtitle && (
          <p className="mt-0.5 text-xs text-[#C9A962]">{conteudo.subtitle}</p>
        )}

        {conteudo.body && (
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-[#A3A3A3]">
            {conteudo.body}
          </p>
        )}

        {temTexto && (
          <button
            type="button"
            onClick={onAbrir}
            className="mt-1 text-xs text-[#C9A962] transition hover:text-[#E3D5A7]"
          >
            Ver tudo
          </button>
        )}

        {conteudo.kind === "promocao" && (conteudo.starts_at || conteudo.ends_at) && (
          <p className="mt-2 text-[11px] text-[#6F6F6F]">
            {conteudo.starts_at ? `De ${dataConteudo(conteudo.starts_at)}` : "Sem data de início"}
            {conteudo.ends_at ? ` até ${dataConteudo(conteudo.ends_at)}` : ""}
          </p>
        )}

        {conteudo.produtos && conteudo.produtos.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {conteudo.produtos.map((p) => (
              <Link
                key={p.id}
                href={`/produto/${p.id}`}
                className="group flex w-20 shrink-0 flex-col"
              >
                <span className="aspect-square w-full overflow-hidden rounded-lg border border-[#262626] bg-[#0A0A0A]">
                  {p.imagem ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imagem}
                      alt={p.name}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-[9px] text-[#4A4A4A]">
                      sem foto
                    </span>
                  )}
                </span>
                <span className="mt-1 line-clamp-2 text-[10px] leading-tight text-[#D4D4D4]">
                  {p.name}
                </span>
                <span className="text-[10px] text-[#C9A962]">
                  {formatCurrency(Number(p.preco))}
                </span>
              </Link>
            ))}
          </div>
        )}

        {conteudo.cta_label && conteudo.cta_href && (
          <Link
            href={conteudo.cta_href}
            className="mt-3 inline-flex items-center rounded-lg border border-[#C9A962] px-3 py-1.5 text-[11px] font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
          >
            {conteudo.cta_label}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-[#1F1F1F] px-2 py-1">
        <div className="min-w-0 flex-1">
          <Interacoes
            itemId={conteudo.id}
            permitirReacoes={conteudo.allow_reactions}
            permitirComentarios={conteudo.allow_comments}
            reacoes={conteudo.reacoes}
            minhaReacao={conteudo.minha_reacao}
            comentarios={conteudo.comentarios}
            compacto
          />
        </div>
        {gerirReacoes && <QuemReagiu itemId={conteudo.id} total={conteudo.reacoes} />}
        <a
          href={`/api/conteudos/${conteudo.id}/download`}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] text-[#A3A3A3] transition hover:bg-[#1D1D1D] hover:text-[#C9A962]"
          title="Descarregar esta publicação"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Descarregar</span>
        </a>
      </div>
    </article>
  );
}

/** Leitura completa, por cima do feed. */
function Leitor({ conteudo, onFechar }: { conteudo: Conteudo; onFechar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/90 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={conteudo.title}
      onClick={onFechar}
    >
      <div
        className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#0F0F0F]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#1F1F1F] px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E3D5A7] to-[#8A6F2E] text-[10px] font-bold text-[#0A0A0A]">
            IN
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-[#F5F5F5]">
              {conteudo.author_name?.trim() || "Gestão INUKA"}
            </p>
            <p className="text-[10px] text-[#6F6F6F]">
              {dataConteudo(conteudo.published_at)}
              {conteudo.provincia_nome ? ` · ${conteudo.provincia_nome}` : ""}
            </p>
          </div>
          <a
            href={`/api/conteudos/${conteudo.id}/download`}
            className="flex items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#C9A962] transition hover:border-[#C9A962]"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Descarregar</span>
          </a>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#A3A3A3] transition hover:bg-[#1D1D1D] hover:text-[#F5F5F5]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {conteudo.image_url && (
          <div className="bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={conteudo.image_url}
              alt={conteudo.title}
              className="mx-auto max-h-[70vh] w-full object-contain"
            />
          </div>
        )}

        <div className="px-5 py-5">
          {conteudo.is_pinned && (
            <p className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#E3D5A7]">
              <Pin className="h-3 w-3" /> Importante
            </p>
          )}
          <h2 className="text-xl font-light leading-snug text-[#F5F5F5]">{conteudo.title}</h2>
          {conteudo.subtitle && (
            <p className="mt-1 text-sm text-[#C9A962]">{conteudo.subtitle}</p>
          )}
          {conteudo.body && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[#C4C4C4]">
              {conteudo.body}
            </p>
          )}

          {conteudo.produtos && conteudo.produtos.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
                Produtos anunciados
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {conteudo.produtos.map((p) => (
                  <Link
                    key={p.id}
                    href={`/produto/${p.id}`}
                    className="flex w-24 shrink-0 flex-col"
                  >
                    <span className="aspect-square w-full overflow-hidden rounded-lg border border-[#262626] bg-[#0A0A0A]">
                      {p.imagem ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imagem}
                          alt={p.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="grid h-full place-items-center text-[9px] text-[#4A4A4A]">
                          sem foto
                        </span>
                      )}
                    </span>
                    <span className="mt-1 line-clamp-2 text-[10px] text-[#D4D4D4]">{p.name}</span>
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

          <p className="mt-5 text-[11px] text-[#5F5F5F]">
            Toque fora da caixa, ou prima Esc, para voltar ao feed.
          </p>
        </div>
      </div>
    </div>
  );
}
