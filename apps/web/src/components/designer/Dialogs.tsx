"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Share2, X } from "lucide-react";
import { PageThumb } from "./ElementView";
import type { DesignPage, DesignVersionSummary } from "@/lib/designer/types";
import type { FormatoExportacao } from "@/lib/designer/export";

// ---------------------------------------------------------------------------
// Pré-visualização
// ---------------------------------------------------------------------------

export function PreviewModal({
  aberto,
  onFechar,
  pagina,
  largura,
  altura,
  titulo,
}: {
  aberto: boolean;
  onFechar: () => void;
  pagina: DesignPage | null;
  largura: number;
  altura: number;
  titulo: string;
}) {
  const [max, setMax] = useState(720);

  useEffect(() => {
    if (!aberto) return;
    const calcular = () =>
      setMax(Math.min(window.innerWidth - 48, window.innerHeight - 160, 900));
    calcular();
    window.addEventListener("resize", calcular);
    return () => window.removeEventListener("resize", calcular);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, onFechar]);

  if (!aberto || !pagina) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 backdrop-blur-sm"
      onClick={onFechar}
    >
      <div className="flex w-full max-w-3xl items-center justify-between">
        <span className="text-sm text-[#A3A3A3]">{titulo}</span>
        <button
          type="button"
          onClick={onFechar}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A3A3A3] hover:bg-white/10 hover:text-white"
          aria-label="Fechar pré-visualização"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div
        className="overflow-hidden rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <PageThumb pagina={pagina} largura={largura} altura={altura} larguraMax={max} />
      </div>
      <p className="text-[11px] text-[#5F5F5F]">
        {largura} × {altura} px · prima Esc para fechar
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

const FORMATOS: { key: FormatoExportacao; label: string; desc: string }[] = [
  { key: "png", label: "PNG", desc: "Sem perdas, fundo transparente quando aplicável" },
  { key: "jpeg", label: "JPG", desc: "Ficheiro leve, ideal para redes sociais" },
  { key: "pdf", label: "PDF", desc: "Uma página por cada página do projeto" },
];

const ESCALAS = [
  { valor: 1, label: "1×" },
  { valor: 2, label: "2×" },
  { valor: 3, label: "3×" },
];

export function ExportDialog({
  aberto,
  onFechar,
  onExportar,
  aExportar,
  numPaginas,
  largura,
  altura,
  erro,
  podePartilhar,
}: {
  aberto: boolean;
  onFechar: () => void;
  onExportar: (opcoes: { formato: FormatoExportacao; escala: number; todas: boolean }) => void;
  aExportar: boolean;
  numPaginas: number;
  largura: number;
  altura: number;
  erro: string | null;
  podePartilhar: boolean;
}) {
  const [formato, setFormato] = useState<FormatoExportacao>("png");
  const [escala, setEscala] = useState(2);
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    if (aberto) setTodas(formato === "pdf" && numPaginas > 1);
  }, [aberto, formato, numPaginas]);

  if (!aberto) return null;

  const escalaMaxima = formato === "pdf" ? 2 : 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-[#242424] bg-[#101010] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#1F1F1F] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#F5F5F5]">Exportar design</h2>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-8 w-8 items-center justify-center rounded text-[#A3A3A3] hover:bg-white/5 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#8A8A8A]">
              Formato
            </span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {FORMATOS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFormato(f.key)}
                  className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition ${
                    formato === f.key
                      ? "border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
                      : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#444]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[#6F6F6F]">
              {FORMATOS.find((f) => f.key === formato)?.desc}
            </p>
          </div>

          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#8A8A8A]">
              Resolução
            </span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {ESCALAS.map((e) => (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => setEscala(e.valor)}
                  disabled={e.valor > escalaMaxima}
                  className={`rounded-lg border px-2 py-2 text-xs transition disabled:opacity-30 ${
                    escala === e.valor
                      ? "border-[#C9A962] text-[#C9A962]"
                      : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#444]"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[#6F6F6F]">
              Saída: {Math.round(largura * Math.min(escala, escalaMaxima))} ×{" "}
              {Math.round(altura * Math.min(escala, escalaMaxima))} px
            </p>
          </div>

          {numPaginas > 1 && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#2A2A2A] px-3 py-2.5">
              <input
                type="checkbox"
                checked={todas}
                onChange={(e) => setTodas(e.target.checked)}
                className="h-4 w-4 accent-[#C9A962]"
              />
              <span className="text-xs text-[#E5E5E5]">
                Exportar as {numPaginas} páginas
                {formato !== "pdf" && " (ficheiros separados)"}
              </span>
            </label>
          )}

          {erro && (
            <p className="rounded-lg border border-[#4A1D1D] bg-[#2A1414] px-3 py-2 text-xs text-[#F87171]">
              {erro}
            </p>
          )}

          <button
            type="button"
            onClick={() => onExportar({ formato, escala: Math.min(escala, escalaMaxima), todas })}
            disabled={aExportar}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-60"
          >
            {aExportar ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> A preparar...
              </>
            ) : podePartilhar ? (
              <>
                <Share2 className="h-4 w-4" /> Exportar e partilhar
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Descarregar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aviso de conflito
// ---------------------------------------------------------------------------

export function ConflitoBanner({
  onRecarregar,
  onDuplicar,
  onIgnorar,
}: {
  onRecarregar: () => void;
  onDuplicar: () => void;
  onIgnorar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#4A3A1D] bg-[#241D0E] px-4 py-2.5">
      <p className="min-w-0 flex-1 text-xs text-[#E3D5A7]">
        Este projeto foi alterado noutro dispositivo. O que está a ver já não é a versão mais
        recente do servidor.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRecarregar}
          className="rounded border border-[#C9A962] px-3 py-1.5 text-[11px] font-medium text-[#C9A962] hover:bg-[#C9A962]/10"
        >
          Usar versão do servidor
        </button>
        <button
          type="button"
          onClick={onDuplicar}
          className="rounded border border-[#4A4A4A] px-3 py-1.5 text-[11px] text-[#E5E5E5] hover:border-[#C9A962]"
        >
          Guardar como cópia
        </button>
        <button
          type="button"
          onClick={onIgnorar}
          className="rounded px-2 py-1.5 text-[11px] text-[#8A8A8A] hover:text-white"
        >
          Continuar aqui
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico de versões
// ---------------------------------------------------------------------------

function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const agora = Date.now();
  const diff = agora - d.getTime();
  if (diff < 60_000) return "agora mesmo";
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  return d.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoricoDialog({
  aberto,
  onFechar,
  versoes,
  aCarregar,
  aProcessar,
  erro,
  versaoAtual,
  onRestaurar,
  onSnapshot,
}: {
  aberto: boolean;
  onFechar: () => void;
  versoes: DesignVersionSummary[];
  aCarregar: boolean;
  aProcessar: boolean;
  erro: string | null;
  versaoAtual: number;
  onRestaurar: (id: string) => void;
  onSnapshot: (etiqueta: string) => void;
}) {
  const [etiqueta, setEtiqueta] = useState("");
  const [confirmar, setConfirmar] = useState<string | null>(null);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onFechar}
    >
      <div
        className="flex max-h-[86dvh] w-full max-w-lg flex-col rounded-t-2xl border border-[#242424] bg-[#101010] sm:max-h-[80vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#1F1F1F] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[#F5F5F5]">Histórico de versões</h2>
            <p className="text-[11px] text-[#6F6F6F]">
              Versão atual: {versaoAtual} · máx. 30 guardadas
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-8 w-8 items-center justify-center rounded text-[#A3A3A3] hover:bg-white/5 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-[#1F1F1F] px-4 py-3">
          <div className="flex gap-2">
            <input
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
              placeholder="Etiqueta (opcional)"
              maxLength={60}
              className="min-w-0 flex-1 rounded-lg border border-[#2A2A2A] bg-[#141414] px-3 py-2 text-xs text-[#E5E5E5] outline-none focus:border-[#C9A962]"
            />
            <button
              type="button"
              disabled={aProcessar}
              onClick={() => {
                onSnapshot(etiqueta.trim());
                setEtiqueta("");
              }}
              className="shrink-0 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
            >
              Guardar versão
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {aCarregar && (
            <p className="flex items-center gap-2 px-4 py-6 text-xs text-[#A3A3A3]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> A carregar o histórico...
            </p>
          )}

          {!aCarregar && versoes.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-[#6F6F6F]">
              Ainda não há versões guardadas. As versões aparecem automaticamente a
              cada 5 minutos de trabalho, ou quando carregar em “Guardar versão”.
            </p>
          )}

          <ul className="divide-y divide-[#1A1A1A]">
            {versoes.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-[#242424] bg-[#0A0A0A]">
                  {v.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#E5E5E5]">
                    {v.label || `Versão ${v.version}`}
                  </p>
                  <p className="text-[11px] text-[#6F6F6F]">
                    v{v.version} · {quando(v.created_at)} · {v.paginas}{" "}
                    {v.paginas === 1 ? "página" : "páginas"} · {v.elementos} elem.
                  </p>
                </div>
                {confirmar === v.id ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={aProcessar}
                      onClick={() => {
                        onRestaurar(v.id);
                        setConfirmar(null);
                      }}
                      className="rounded bg-[#C9A962] px-2 py-1 text-[11px] font-semibold text-[#0A0A0A] disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmar(null)}
                      className="rounded border border-[#2A2A2A] px-2 py-1 text-[11px] text-[#A3A3A3]"
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={aProcessar}
                    onClick={() => setConfirmar(v.id)}
                    className="shrink-0 rounded border border-[#2A2A2A] px-2.5 py-1.5 text-[11px] text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:opacity-40"
                  >
                    Restaurar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {erro && (
          <p className="border-t border-[#1F1F1F] px-4 py-2 text-xs text-[#F87171]">{erro}</p>
        )}
        <p className="border-t border-[#1F1F1F] px-4 py-2.5 text-[11px] leading-relaxed text-[#6F6F6F]">
          Restaurar substitui o documento atual por essa versão. O estado atual é
          guardado antes, por isso a operação é reversível.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet (mobile)
// ---------------------------------------------------------------------------

export function Sheet({
  aberto,
  titulo,
  onFechar,
  children,
}: {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 lg:hidden" onClick={onFechar}>
      <div
        className="max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-[#242424] bg-[#0F0F0F] pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1F1F1F] bg-[#0F0F0F] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#F5F5F5]">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-8 w-8 items-center justify-center rounded text-[#A3A3A3] hover:bg-white/5"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
