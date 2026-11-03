"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pin, Send, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import type { Provincia } from "@/lib/provincias";
import {
  TIPOS,
  type EstadoConteudo,
  type TipoConteudo,
  type EntradaPublicacao,
} from "@/lib/conteudos";

/**
 * Publicar o que está no estúdio no destino certo.
 *
 * O gestor escolhe o destino e preenche só os campos que aquele destino usa —
 * datas para promoções, autor para testemunhos, fixar para comunicados. A
 * imagem é a página atual, capturada pelo editor no momento de publicar.
 */

interface ProdutoResumo {
  id: string;
  name: string;
  sku: string | null;
}

export function PublicarDialog({
  aberto,
  onFechar,
  onPublicar,
  aPublicar,
  erro,
  miniatura,
  provincias,
  existente,
  tipoInicial,
  tituloProjeto,
}: {
  aberto: boolean;
  onFechar: () => void;
  onPublicar: (entrada: Omit<EntradaPublicacao, "imagem">) => void;
  aPublicar: boolean;
  erro: string | null;
  /** Data URL da página atual, para pré-visualizar o cartão. */
  miniatura: string | null;
  provincias: Provincia[];
  /** Conteúdo já ligado a este projeto, se existir. */
  existente: { id: string; status: EstadoConteudo } | null;
  tipoInicial?: TipoConteudo;
  tituloProjeto: string;
}) {
  const [tipo, setTipo] = useState<TipoConteudo>(tipoInicial ?? "promocao");
  const [titulo, setTitulo] = useState(tituloProjeto);
  const [subtitulo, setSubtitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [provincia, setProvincia] = useState("");
  const [fixado, setFixado] = useState(false);
  const [vista, setVista] = useState<"desktop" | "telemovel">("desktop");
  const [reacoes, setReacoes] = useState(true);
  const [comentarios, setComentarios] = useState(true);
  const [autor, setAutor] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [cta, setCta] = useState("");
  const [ctaHref, setCtaHref] = useState("");

  const [produtos, setProdutos] = useState<ProdutoResumo[]>([]);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [aCarregarProdutos, setACarregarProdutos] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTitulo((t) => t || tituloProjeto);
  }, [aberto, tituloProjeto]);

  useEffect(() => {
    if (!aberto || tipo !== "promocao") return;
    let vivo = true;
    setACarregarProdutos(true);
    const supabase = createClientBrowser();
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, sku")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(80);
      if (vivo) {
        setProdutos((data ?? []) as ProdutoResumo[]);
        setACarregarProdutos(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [aberto, tipo]);

  const produtosFiltrados = useMemo(() => {
    const t = buscaProduto.trim().toLowerCase();
    if (!t) return produtos;
    return produtos.filter(
      (p) => p.name.toLowerCase().includes(t) || (p.sku ?? "").toLowerCase().includes(t)
    );
  }, [buscaProduto, produtos]);

  if (!aberto) return null;

  const destino = TIPOS.find((t) => t.key === tipo);

  function submeter(status: EstadoConteudo) {
    onPublicar({
      kind: tipo,
      title: titulo.trim() || tituloProjeto,
      subtitle: subtitulo,
      body: corpo,
      status,
      provincia_id: provincia || null,
      is_pinned: tipo === "comunicado" ? fixado : false,
      allow_reactions: reacoes,
      allow_comments: comentarios,
      author_name: tipo === "testemunho" ? autor : null,
      starts_at: tipo === "promocao" && inicio ? new Date(`${inicio}T00:00:00`).toISOString() : null,
      ends_at: tipo === "promocao" && fim ? new Date(`${fim}T23:59:59`).toISOString() : null,
      cta_label: cta || null,
      cta_href: ctaHref || null,
      produtos: tipo === "promocao" ? escolhidos : [],
    });
  }

  const podePublicar = titulo.trim().length > 0 && !aPublicar;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-[#2A2A2A] bg-[#0D0D0D] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#1F1F1F] px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-[#F5F5F5]">Publicar conteúdo</h2>
            <p className="text-[11px] text-[#6F6F6F]">
              {existente
                ? "Este projeto já está publicado — publicar atualiza o conteúdo existente."
                : "O cartaz é capturado agora e enviado com o conteúdo."}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg p-1.5 text-[#8A8A8A] hover:bg-[#1A1A1A] hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[1fr_260px]">
          <div className="space-y-4 p-4">
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-[#8A8A8A]">Destino</p>
              <div className="grid grid-cols-2 gap-2">
                {TIPOS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTipo(t.key)}
                    className={`rounded-lg border px-2.5 py-2 text-left transition ${
                      tipo === t.key
                        ? "border-[#C9A962] bg-[#1D1A12]"
                        : "border-[#2A2A2A] hover:border-[#444]"
                    }`}
                  >
                    <span
                      className={`block text-[11px] font-medium ${
                        tipo === t.key ? "text-[#C9A962]" : "text-[#E5E5E5]"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="block text-[9px] leading-tight text-[#6F6F6F]">
                      {t.destino}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Campo rotulo="Título">
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={160}
                className={ENTRADA}
                placeholder="Ex.: Nova coleção Signature"
              />
            </Campo>

            <Campo rotulo="Linha de apoio (opcional)">
              <input
                value={subtitulo}
                onChange={(e) => setSubtitulo(e.target.value)}
                maxLength={200}
                className={ENTRADA}
                placeholder={
                  tipo === "promocao" ? "Válido até ao fim do mês" : "Uma frase curta de contexto"
                }
              />
            </Campo>

            <Campo rotulo="Mensagem (opcional)">
              <textarea
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                rows={3}
                maxLength={2000}
                className={ENTRADA}
                placeholder="Texto que acompanha a imagem."
              />
            </Campo>

            {tipo === "testemunho" && (
              <Campo rotulo="Identificação autorizada do cliente">
                <input
                  value={autor}
                  onChange={(e) => setAutor(e.target.value)}
                  maxLength={80}
                  className={ENTRADA}
                  placeholder="Nome ou iniciais — só com autorização"
                />
                <p className="mt-1 text-[10px] text-[#6F6F6F]">
                  Só publique nome ou fotografia com autorização do cliente.
                </p>
              </Campo>
            )}

            {tipo === "promocao" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="Começa">
                    <input
                      type="date"
                      value={inicio}
                      onChange={(e) => setInicio(e.target.value)}
                      className={ENTRADA}
                    />
                  </Campo>
                  <Campo rotulo="Termina">
                    <input
                      type="date"
                      value={fim}
                      onChange={(e) => setFim(e.target.value)}
                      className={ENTRADA}
                    />
                  </Campo>
                </div>

                <Campo rotulo={`Produtos anunciados (${escolhidos.length})`}>
                  <input
                    value={buscaProduto}
                    onChange={(e) => setBuscaProduto(e.target.value)}
                    className={ENTRADA}
                    placeholder="Procurar produto por nome ou referência"
                  />
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[#2A2A2A]">
                    {aCarregarProdutos ? (
                      <p className="px-3 py-3 text-[11px] text-[#6F6F6F]">A carregar…</p>
                    ) : produtosFiltrados.length === 0 ? (
                      <p className="px-3 py-3 text-[11px] text-[#6F6F6F]">Sem resultados.</p>
                    ) : (
                      produtosFiltrados.map((p) => {
                        const marcado = escolhidos.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setEscolhidos((atual) =>
                                marcado ? atual.filter((x) => x !== p.id) : [...atual, p.id]
                              )
                            }
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition ${
                              marcado ? "bg-[#1D1A12] text-[#C9A962]" : "text-[#D4D4D4] hover:bg-[#151515]"
                            }`}
                          >
                            <span
                              className={`grid h-3.5 w-3.5 place-items-center rounded border ${
                                marcado ? "border-[#C9A962] bg-[#C9A962]" : "border-[#444]"
                              }`}
                            >
                              {marcado && <Check className="h-2.5 w-2.5 text-[#0A0A0A]" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 text-[10px] text-[#5F5F5F]">{p.sku ?? ""}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </Campo>
              </>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Campo rotulo="Botão (opcional)">
                <input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  maxLength={40}
                  className={ENTRADA}
                  placeholder="Ver catálogo"
                />
              </Campo>
              <Campo rotulo="Ligação do botão">
                <input
                  value={ctaHref}
                  onChange={(e) => setCtaHref(e.target.value)}
                  maxLength={200}
                  className={ENTRADA}
                  placeholder="/catalogo"
                />
              </Campo>
            </div>

            <Campo rotulo="Província">
              <select
                value={provincia}
                onChange={(e) => setProvincia(e.target.value)}
                className={ENTRADA}
              >
                <option value="">Nacional — todas as províncias</option>
                {provincias.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="flex flex-wrap gap-4 text-[11px] text-[#A3A3A3]">
              {tipo === "comunicado" && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fixado}
                    onChange={(e) => setFixado(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#C9A962]"
                  />
                  <Pin className="h-3 w-3" /> Comunicado importante (topo do feed)
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reacoes}
                  onChange={(e) => setReacoes(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#C9A962]"
                />
                Permitir reações
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={comentarios}
                  onChange={(e) => setComentarios(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#C9A962]"
                />
                Permitir comentários
              </label>
            </div>
          </div>

          <aside className="border-t border-[#1F1F1F] bg-[#0A0A0A] p-4 md:border-l md:border-t-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-[#8A8A8A]">
                Pré-visualização
              </p>
              <div className="flex gap-1 rounded-lg border border-[#262626] p-0.5">
                {(
                  [
                    { key: "desktop", label: "Computador" },
                    { key: "telemovel", label: "Telemóvel" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setVista(v.key)}
                    aria-pressed={vista === v.key}
                    className={`rounded px-2 py-0.5 text-[9px] transition ${
                      vista === v.key
                        ? "bg-[#C9A962] text-[#0A0A0A]"
                        : "text-[#8A8A8A] hover:text-[#C9A962]"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            {/* A largura muda, o conteúdo não: é o mesmo cartão que o destino
                vai mostrar, só com a largura de um telemóvel. */}
            <div
              className={`overflow-hidden rounded-xl border border-[#262626] bg-[#1A1A1A] transition-all ${
                vista === "telemovel" ? "mx-auto max-w-[210px]" : "w-full"
              }`}
            >
              <div className="aspect-square w-full bg-[#0A0A0A]">
                {miniatura ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={miniatura} alt="Pré-visualização" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-[10px] text-[#5F5F5F]">
                    sem pré-visualização
                  </div>
                )}
              </div>
              <div className="p-2.5">
                {fixado && (
                  <span className="mb-1 inline-block rounded bg-[#2A2410] px-1.5 py-0.5 text-[9px] text-[#E3D5A7]">
                    Importante
                  </span>
                )}
                <p className="line-clamp-2 text-[11px] font-medium text-[#F5F5F5]">
                  {titulo || "Título do conteúdo"}
                </p>
                <p className="mt-0.5 text-[10px] text-[#6F6F6F]">{destino?.label}</p>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-[#5F5F5F]">
              {tipo === "promocao"
                ? "As promoções fora das datas deixam de aparecer na loja automaticamente."
                : tipo === "comunicado"
                  ? "Só os colaboradores veem este comunicado. Os clientes não têm acesso."
                  : tipo === "testemunho"
                    ? "Aparece na área de testemunhos dos clientes depois de publicado."
                    : "Fica disponível na área de formação dos colaboradores."}
            </p>
          </aside>
        </div>

        {erro && (
          <p className="border-t border-[#4A2020] bg-[#2A1010] px-4 py-2 text-[11px] text-[#F87171]">
            {erro}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1F1F1F] px-4 py-3">
          <button
            type="button"
            onClick={() => submeter("rascunho")}
            disabled={!podePublicar}
            className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#D4D4D4] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-40"
          >
            Guardar rascunho
          </button>
          <button
            type="button"
            onClick={() => submeter("publicado")}
            disabled={!podePublicar}
            className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-40"
          >
            {aPublicar ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {aPublicar ? "A publicar…" : existente ? "Atualizar publicação" : "Publicar agora"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ENTRADA =
  "w-full rounded-lg border border-[#2A2A2A] bg-[#111] px-2.5 py-2 text-xs text-[#E5E5E5] outline-none placeholder:text-[#5F5F5F] focus:border-[#C9A962]";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">{rotulo}</span>
      {children}
    </label>
  );
}
