"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { descarregar } from "@/lib/descarregar";
import type { Anexo } from "@/lib/chat";

/**
 * Visualizador de anexos, ao estilo do WhatsApp.
 *
 * O que estava mal: tocar numa fotografia **guardava-a**. No telemóvel isso
 * abria a galeria do sistema, ou pedia uma aplicação para abrir o ficheiro —
 * quando a pessoa só queria ver. Ver e guardar são duas acções diferentes, e
 * estavam no mesmo toque.
 *
 * Agora: tocar **abre**; guardar é um botão explícito aqui dentro. A fotografia
 * enche o ecrã, as do mesmo chat passam com as setas (ou com o dedo), e o
 * teclado faz o que se espera — `Esc` fecha, `←`/`→` andam.
 *
 * `next/image` não serve: os URLs são assinados e o host muda.
 */
function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function VisualizadorAnexo({
  anexos,
  indice,
  onFechar,
  onMudar,
}: {
  /** Só o que se pode ver aqui dentro (imagens e vídeos, por ordem do chat). */
  anexos: Anexo[];
  indice: number;
  onFechar: () => void;
  onMudar: (indice: number) => void;
}) {
  // O selo de «guardado» e o erro pertencem a **um** anexo, não ao ecrã: assim
  // mudar de fotografia não precisa de limpar nada num efeito (e não dispara
  // renders em cascata).
  const [guardadoId, setGuardadoId] = useState<string | null>(null);
  const [erro, setErro] = useState<{ id: string; texto: string } | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const toqueInicial = useRef<number | null>(null);

  const anexo = anexos[indice];
  const total = anexos.length;
  const temAnterior = indice > 0;
  const temSeguinte = indice < total - 1;
  const guardado = !!anexo && guardadoId === anexo.id;
  const mensagemErro = anexo && erro?.id === anexo.id ? erro.texto : "";

  const anterior = useCallback(() => {
    if (indice > 0) onMudar(indice - 1);
  }, [indice, onMudar]);

  const seguinte = useCallback(() => {
    if (indice < total - 1) onMudar(indice + 1);
  }, [indice, total, onMudar]);

  // Teclado: é o que se espera de uma fotografia em ecrã inteiro.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
      else if (e.key === "ArrowLeft") anterior();
      else if (e.key === "ArrowRight") seguinte();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [anterior, seguinte, onFechar]);

  // O fundo não rola enquanto a fotografia está aberta — no telemóvel o
  // conteúdo de trás fugia com o dedo.
  useEffect(() => {
    const anteriorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anteriorOverflow;
    };
  }, []);

  // Mudar de fotografia reinicia o selo de «guardado».

  async function guardar() {
    if (!anexo || aGuardar) return;
    setErro(null);
    setAGuardar(true);
    const id = anexo.id;
    try {
      await descarregar(`/api/anexos/${id}/download`, anexo.file_name);
      setGuardadoId(id);
    } catch {
      setErro({ id, texto: "Não foi possível guardar." });
    } finally {
      setAGuardar(false);
    }
  }

  if (!anexo) return null;

  const tipo = anexo.file_type ?? "";
  const eVideo = tipo.startsWith("video/");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={anexo.file_name}
      className="fixed inset-0 z-[60] flex flex-col bg-black/92 backdrop-blur-sm"
      onClick={onFechar}
    >
      {/* ------------------------------------------------------------- BARRA */}
      <header
        className="flex shrink-0 items-center gap-3 px-3 py-3 sm:px-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#F5F5F5]">{anexo.file_name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#8A8A8A]">
            <span>{formatarTamanho(anexo.file_size)}</span>
            {total > 1 && (
              <>
                <span className="text-[#3F3F3F]">·</span>
                <span>
                  {indice + 1} de {total}
                </span>
              </>
            )}
            {mensagemErro && <span className="text-[#F87171]">· {mensagemErro}</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={guardar}
          disabled={aGuardar}
          title={`Guardar ${anexo.file_name} em PNG`}
          aria-label={`Guardar ${anexo.file_name} em PNG`}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition disabled:opacity-60 ${
            guardado
              ? "bg-[#14532D]/80 text-[#86EFAC]"
              : "bg-white/10 text-[#F5F5F5] hover:bg-white/20"
          }`}
        >
          {aGuardar ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : guardado ? (
            <Check className="h-4 w-4" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{guardado ? "Guardado" : "Guardar"}</span>
        </button>

        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#F5F5F5] transition hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* ------------------------------------------------------------- IMAGEM */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          toqueInicial.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const inicio = toqueInicial.current;
          toqueInicial.current = null;
          if (inicio === null) return;
          const fim = e.changedTouches[0]?.clientX ?? inicio;
          const delta = fim - inicio;
          // 60 px é o suficiente para não confundir com um toque.
          if (Math.abs(delta) < 60) return;
          if (delta > 0) anterior();
          else seguinte();
        }}
      >
        {eVideo ? (
          <video
            src={anexo.url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={anexo.url}
            alt={anexo.file_name}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        )}

        {temAnterior && (
          <button
            type="button"
            onClick={anterior}
            aria-label="Anterior"
            className="absolute left-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/75 sm:left-4"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {temSeguinte && (
          <button
            type="button"
            onClick={seguinte}
            aria-label="Seguinte"
            className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/75 sm:right-4"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
