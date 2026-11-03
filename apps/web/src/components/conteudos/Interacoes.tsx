"use client";

import { useCallback, useEffect, useState } from "react";
import { Heart, Loader2, MessageCircle, Send, Sparkles, ThumbsUp } from "lucide-react";
import { comentar, listarComentarios, reagir, type Comentario } from "@/lib/conteudos";

/**
 * Reações e comentários de um conteúdo.
 *
 * As reações são alternáveis: carregar na mesma remove, carregar noutra troca.
 * A contagem vem do servidor no primeiro render e é ajustada localmente — não
 * se volta a pedir o feed inteiro por um gosto.
 */

const REACOES = [
  { key: "gosto", label: "Gosto", Icon: ThumbsUp },
  { key: "adoro", label: "Adoro", Icon: Heart },
  { key: "util", label: "Útil", Icon: Sparkles },
] as const;

export function Interacoes({
  itemId,
  permitirReacoes,
  permitirComentarios,
  reacoes,
  minhaReacao,
  comentarios,
}: {
  itemId: string;
  permitirReacoes: boolean;
  permitirComentarios: boolean;
  reacoes: number | string;
  minhaReacao: string | null;
  comentarios: number | string;
}) {
  const [reacao, setReacao] = useState<string | null>(minhaReacao);
  const [total, setTotal] = useState(Number(reacoes) || 0);
  const [aReagir, setAReagir] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [texto, setTexto] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [quantos, setQuantos] = useState(Number(comentarios) || 0);

  const carregarComentarios = useCallback(async () => {
    try {
      setLista(await listarComentarios(itemId));
    } catch {
      setLista([]);
      setErro("Não foi possível carregar os comentários.");
    }
  }, [itemId]);

  useEffect(() => {
    if (aberto && lista === null) void carregarComentarios();
  }, [aberto, carregarComentarios, lista]);

  async function alternar(chave: string) {
    if (aReagir) return;
    setAReagir(true);
    setErro(null);

    const anterior = { reacao, total };
    // Atualização otimista: o servidor confirma em seguida.
    if (reacao === chave) {
      setReacao(null);
      setTotal((n) => Math.max(0, n - 1));
    } else {
      setReacao(chave);
      setTotal((n) => (reacao ? n : n + 1));
    }

    try {
      await reagir(itemId, chave);
    } catch (e) {
      setReacao(anterior.reacao);
      setTotal(anterior.total);
      setErro(e instanceof Error ? e.message : "Não foi possível reagir.");
    } finally {
      setAReagir(false);
    }
  }

  async function enviar() {
    const limpo = texto.trim();
    if (!limpo || aEnviar) return;
    setAEnviar(true);
    setErro(null);
    try {
      await comentar(itemId, limpo);
      setTexto("");
      setQuantos((n) => n + 1);
      await carregarComentarios();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível comentar.");
    } finally {
      setAEnviar(false);
    }
  }

  if (!permitirReacoes && !permitirComentarios) return null;

  return (
    <div className="mt-3 border-t border-[#262626] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {permitirReacoes &&
          REACOES.map(({ key, label, Icon }) => {
            const ativo = reacao === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => void alternar(key)}
                disabled={aReagir}
                aria-pressed={ativo}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition ${
                  ativo
                    ? "border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
                    : "border-[#2E2E2E] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}

        {permitirReacoes && total > 0 && (
          <span className="text-[11px] text-[#6F6F6F]">
            {total} {total === 1 ? "reação" : "reações"}
          </span>
        )}

        {permitirComentarios && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="ml-auto flex items-center gap-1.5 rounded-full border border-[#2E2E2E] px-3 py-1.5 text-[11px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            aria-expanded={aberto}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {quantos > 0 ? `${quantos} comentário${quantos === 1 ? "" : "s"}` : "Comentar"}
          </button>
        )}
      </div>

      {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}

      {aberto && permitirComentarios && (
        <div className="mt-3 space-y-2">
          {lista === null ? (
            <p className="flex items-center gap-2 text-[11px] text-[#6F6F6F]">
              <Loader2 className="h-3 w-3 animate-spin" /> A carregar…
            </p>
          ) : lista.length === 0 ? (
            <p className="text-[11px] text-[#5F5F5F]">Ainda sem comentários.</p>
          ) : (
            <ul className="space-y-2">
              {lista.map((c) => (
                <li key={c.id} className="rounded-lg bg-[#111] px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-[#D4D4D4]">{c.body}</p>
                  <p className="mt-0.5 text-[10px] text-[#5F5F5F]">
                    {new Date(c.created_at).toLocaleString("pt-PT", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Escrever um comentário…"
              className="min-h-[44px] flex-1 resize-y rounded-lg border border-[#2A2A2A] bg-[#111] px-3 py-2 text-[11px] text-[#E5E5E5] outline-none placeholder:text-[#5F5F5F] focus:border-[#C9A962]"
            />
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={!texto.trim() || aEnviar}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 text-[11px] font-semibold text-[#0A0A0A] disabled:opacity-40"
            >
              {aEnviar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
