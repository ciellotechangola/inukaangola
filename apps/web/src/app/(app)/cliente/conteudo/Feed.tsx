"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Heart,
  MessageCircle,
  Pin,
  Send,
  Sparkles,
  Tag,
  Megaphone,
  Quote,
} from "lucide-react";
import {
  comentar,
  comentariosDoConteudo,
  reagir,
  type ComentarioFeed,
  type Conteudo,
} from "@/lib/conteudos";
import { formatCurrency } from "@/lib/utils";

const TIPO: Record<
  string,
  { etiqueta: string; cor: string; icone: React.ReactNode }
> = {
  comunicado: {
    etiqueta: "Comunicado",
    cor: "border-[#C9A962]/40 bg-[#C9A962]/10 text-[#C9A962]",
    icone: <Megaphone className="h-3 w-3" />,
  },
  promocao: {
    etiqueta: "Promoção",
    cor: "border-[#5FBF8F]/40 bg-[#5FBF8F]/10 text-[#7FD6AB]",
    icone: <Tag className="h-3 w-3" />,
  },
  testemunho: {
    etiqueta: "Testemunho",
    cor: "border-[#7BA7D9]/40 bg-[#7BA7D9]/10 text-[#9CC2EA]",
    icone: <Quote className="h-3 w-3" />,
  },
  formacao: {
    etiqueta: "Formação",
    cor: "border-[#3A3A3A] bg-[#1A1A1A] text-[#C9C9C9]",
    icone: <Sparkles className="h-3 w-3" />,
  },
};

const FILTROS = [
  { valor: "tudo", etiqueta: "Tudo" },
  { valor: "comunicado", etiqueta: "Comunicados" },
  { valor: "promocao", etiqueta: "Promoções" },
  { valor: "testemunho", etiqueta: "Testemunhos" },
];

function quando(iso: string | null): string {
  if (!iso) return "agora";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "long" });
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[partes.length - 1]?.[0] ?? "")).toUpperCase();
}

export default function Feed({ conteudos }: { conteudos: Conteudo[] }) {
  const [filtro, setFiltro] = useState("tudo");

  const visiveis =
    filtro === "tudo" ? conteudos : conteudos.filter((c) => c.kind === filtro);

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            onClick={() => setFiltro(f.valor)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              filtro === f.valor
                ? "border border-[#C9A962] bg-[#C9A962]/10 text-[#C9A962]"
                : "border border-[#404040] text-[#A3A3A3] hover:border-[#C9A962]/50"
            }`}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-[#262626] bg-[#141414] p-10 text-center text-sm text-[#6F6F6F]">
          Ainda não há publicações neste filtro.
        </p>
      ) : (
        <div className="space-y-4">
          {visiveis.map((c) => (
            <Cartao key={c.id} conteudo={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function Cartao({ conteudo }: { conteudo: Conteudo }) {
  const tipo = TIPO[conteudo.kind] ?? TIPO.formacao;
  const autor = conteudo.author_name?.trim() || "INUKA Angola";
  const [gostei, setGostei] = useState(Boolean(conteudo.minha_reacao));
  const [reacoes, setReacoes] = useState(Number(conteudo.reacoes ?? 0));
  const [comentarios, setComentarios] = useState(Number(conteudo.comentarios ?? 0));
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<ComentarioFeed[] | null>(null);
  const [texto, setTexto] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState("");
  const [expandido, setExpandido] = useState(false);

  async function alternarGosto() {
    setErro("");
    const antes = gostei;
    setGostei(!antes);
    setReacoes((n) => Math.max(0, n + (antes ? -1 : 1)));

    try {
      await reagir(conteudo.id, "gosto");
    } catch (e) {
      setGostei(antes);
      setReacoes((n) => Math.max(0, n + (antes ? 1 : -1)));
      setErro(e instanceof Error ? e.message : "Não foi possível reagir.");
    }
  }

  async function abrirComentarios() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && lista === null) {
      try {
        setLista(await comentariosDoConteudo(conteudo.id));
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível carregar os comentários.");
        setLista([]);
      }
    }
  }

  async function enviar() {
    const corpo = texto.trim();
    if (!corpo || aEnviar) return;

    setAEnviar(true);
    setErro("");
    try {
      await comentar(conteudo.id, corpo);
      const actualizada = await comentariosDoConteudo(conteudo.id);
      setLista(actualizada);
      setComentarios(actualizada.length);
      setTexto("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível comentar.");
    } finally {
      setAEnviar(false);
    }
  }

  const corpo = conteudo.body?.trim() ?? "";
  const longo = corpo.length > 320;

  return (
    <article className="overflow-hidden rounded-xl border border-[#262626] bg-[#141414]">
      {/* ---------------------------------------------------------- cabeçalho */}
      <header className="flex items-start gap-3 px-4 pt-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C9A962]/30 bg-[#0A0A0A]">
          {conteudo.author_photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conteudo.author_photo} alt={autor} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-medium text-[#C9A962]">{iniciais(autor)}</span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#F5F5F5]">
            {autor}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${tipo.cor}`}
            >
              {tipo.icone}
              {tipo.etiqueta}
            </span>
            {conteudo.is_pinned && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[#C9A962]">
                <Pin className="h-3 w-3" /> fixado
              </span>
            )}
          </p>
          <p className="text-[11px] text-[#6F6F6F]">
            {quando(conteudo.published_at ?? conteudo.starts_at)}
            {conteudo.provincia_nome ? ` · ${conteudo.provincia_nome}` : ""}
          </p>
        </div>
      </header>

      {/* ------------------------------------------------------------- texto */}
      <div className="px-4 pt-3">
        <h2 className="text-base font-medium leading-snug text-[#EDEDED]">{conteudo.title}</h2>
        {conteudo.subtitle && (
          <p className="mt-0.5 text-sm text-[#A3A3A3]">{conteudo.subtitle}</p>
        )}
        {corpo && (
          <>
            <p
              className={`mt-2 whitespace-pre-line text-sm leading-relaxed text-[#C9C9C9] ${
                !expandido && longo ? "line-clamp-4" : ""
              }`}
            >
              {corpo}
            </p>
            {longo && (
              <button
                onClick={() => setExpandido((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-xs text-[#C9A962] hover:underline"
              >
                {expandido ? "Ver menos" : "Ver mais"}
                <ChevronDown
                  className={`h-3 w-3 transition ${expandido ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </>
        )}
      </div>

      {/* ------------------------------------------------------------ imagem */}
      {conteudo.image_url && (
        <div className="mt-3 border-y border-[#1F1F1F] bg-[#0A0A0A]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={conteudo.image_url}
            alt={conteudo.title}
            className="max-h-[520px] w-full object-contain"
            loading="lazy"
          />
        </div>
      )}

      {/* ----------------------------------------------------------- produtos */}
      {conteudo.produtos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-[#1F1F1F] px-4 py-3">
          {conteudo.produtos.map((p) => (
            <Link
              key={p.id}
              href={`/produto/${p.id}`}
              className="flex w-40 shrink-0 flex-col overflow-hidden rounded-lg border border-[#262626] bg-[#0F0F0F] transition hover:border-[#C9A962]/50"
            >
              <span className="block h-24 overflow-hidden bg-[#0A0A0A]">
                {p.imagem ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imagem} alt={p.name} className="h-full w-full object-contain" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] tracking-[0.3em] text-[#3A3A3A]">
                    INUKA
                  </span>
                )}
              </span>
              <span className="px-2 py-2">
                <span className="block truncate text-xs text-[#EDEDED]">{p.name}</span>
                <span className="block text-xs text-[#C9A962]">
                  {formatCurrency(Number(p.preco))}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* --------------------------------------------------------------- CTA */}
      {conteudo.cta_label && conteudo.cta_href && (
        <div className="px-4 pt-3">
          <Link
            href={conteudo.cta_href}
            className="inline-flex rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
          >
            {conteudo.cta_label}
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------------ acções */}
      <div className="mt-3 flex items-center gap-1 border-t border-[#1F1F1F] px-2 py-1.5">
        {conteudo.allow_reactions && (
          <button
            onClick={alternarGosto}
            aria-pressed={gostei}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
              gostei ? "text-[#F87171]" : "text-[#A3A3A3] hover:bg-[#1F1F1F] hover:text-[#F5F5F5]"
            }`}
          >
            <Heart className={`h-4 w-4 ${gostei ? "fill-current" : ""}`} />
            {reacoes > 0 ? reacoes : "Gosto"}
          </button>
        )}

        {conteudo.allow_comments && (
          <button
            onClick={abrirComentarios}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[#A3A3A3] transition hover:bg-[#1F1F1F] hover:text-[#F5F5F5]"
          >
            <MessageCircle className="h-4 w-4" />
            {comentarios > 0 ? comentarios : "Comentar"}
          </button>
        )}

        {erro && <span className="ml-2 text-[11px] text-[#F87171]">{erro}</span>}
      </div>

      {/* -------------------------------------------------------- comentários */}
      {aberto && conteudo.allow_comments && (
        <div className="border-t border-[#1F1F1F] bg-[#0F0F0F] px-4 py-3">
          {lista === null ? (
            <p className="text-xs text-[#6F6F6F]">A carregar comentários…</p>
          ) : lista.length === 0 ? (
            <p className="text-xs text-[#6F6F6F]">Ainda sem comentários. Seja o primeiro.</p>
          ) : (
            <ul className="mb-3 space-y-2.5">
              {lista.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#333] bg-[#141414] text-[10px] text-[#C9A962]">
                    {iniciais(m.autor)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-[#EDEDED]">
                      {m.autor}
                      <span className="ml-2 text-[10px] text-[#525252]">{quando(m.created_at)}</span>
                    </p>
                    <p className="whitespace-pre-line text-sm text-[#C9C9C9]">{m.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escreva um comentário"
              className="min-w-0 flex-1 rounded-full border border-[#333] bg-[#141414] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <button
              onClick={enviar}
              disabled={aEnviar || !texto.trim()}
              aria-label="Enviar comentário"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#C9A962] text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
