"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Download,
  Eye,
  History,
  Loader2,
  MoreVertical,
  Redo2,
  Send,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export type EstadoSync =
  | { tipo: "pronto" }
  | { tipo: "a-guardar" }
  | { tipo: "guardado"; quando: Date }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "conflito" };

export function TopBar({
  titulo,
  onTitulo,
  formato,
  podeDesfazer,
  podeRefazer,
  onDesfazer,
  onRefazer,
  estado,
  onGuardar,
  onPrevisualizar,
  onExportar,
  zoom,
  onZoom,
  onAjustar,
  onDuplicar,
  onApagar,
  onPublicar,
  onPublicarConteudo,
  podePublicar,
  onHistorico,
  rascunho,
}: {
  titulo: string;
  onTitulo: (v: string) => void;
  formato: string;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  onDesfazer: () => void;
  onRefazer: () => void;
  estado: EstadoSync;
  onGuardar: () => void;
  onPrevisualizar: () => void;
  onExportar: () => void;
  zoom: number;
  onZoom: (z: number) => void;
  onAjustar: () => void;
  onDuplicar: () => void;
  onApagar: () => void;
  onPublicar: () => void;
  /** Publicar o projeto como conteúdo (comunicado, promoção, …). */
  onPublicarConteudo: () => void;
  podePublicar: boolean;
  onHistorico: () => void;
  /** Há alterações guardadas apenas neste dispositivo. */
  rascunho: boolean;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-[#1F1F1F] bg-[#0D0D0D] px-2 sm:px-3">
      <Link
        href="/designer"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#A3A3A3] transition hover:bg-[#1A1A1A] hover:text-[#C9A962]"
        aria-label="Voltar aos projetos"
      >
        <ArrowLeft className="h-4.5 w-4.5" />
      </Link>

      <div className="min-w-0 flex-1">
        <input
          value={titulo}
          onChange={(e) => onTitulo(e.target.value)}
          onBlur={onGuardar}
          className="w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-[#F5F5F5] outline-none transition hover:border-[#2A2A2A] focus:border-[#C9A962]"
          aria-label="Nome do projeto"
        />
        <span className="hidden px-1 text-[10px] text-[#5F5F5F] sm:block">{formato}</span>
      </div>

      <div className="hidden items-center gap-1 md:flex">
        <BotaoIcone onClick={onDesfazer} disabled={!podeDesfazer} titulo="Desfazer (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </BotaoIcone>
        <BotaoIcone onClick={onRefazer} disabled={!podeRefazer} titulo="Refazer (Ctrl+Shift+Z)">
          <Redo2 className="h-4 w-4" />
        </BotaoIcone>
        <div className="mx-1 h-5 w-px bg-[#242424]" />
        <BotaoIcone onClick={() => onZoom(zoom / 1.2)} titulo="Reduzir">
          <ZoomOut className="h-4 w-4" />
        </BotaoIcone>
        <button
          type="button"
          onClick={onAjustar}
          title="Ajustar ao ecrã"
          className="min-w-12 rounded px-1.5 py-1 text-[11px] text-[#A3A3A3] transition hover:text-[#C9A962]"
        >
          {Math.round(zoom * 100)}%
        </button>
        <BotaoIcone onClick={() => onZoom(zoom * 1.2)} titulo="Ampliar">
          <ZoomIn className="h-4 w-4" />
        </BotaoIcone>
        <div className="mx-1 h-5 w-px bg-[#242424]" />
      </div>

      <IndicadorSync estado={estado} rascunho={rascunho} />

      <BotaoIcone onClick={onHistorico} titulo="Histórico de versões">
        <History className="h-4 w-4" />
      </BotaoIcone>

      <button
        type="button"
        onClick={onPublicarConteudo}
        className="hidden h-9 items-center gap-1.5 rounded-lg border border-[#C9A962]/40 px-3 text-xs font-medium text-[#C9A962] transition hover:border-[#C9A962] hover:bg-[#1D1A12] sm:flex"
      >
        <Send className="h-4 w-4" />
        Publicar
      </button>

      <button
        type="button"
        onClick={onPrevisualizar}
        className="hidden h-9 items-center gap-1.5 rounded-lg border border-[#2E2E2E] px-3 text-xs font-medium text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962] sm:flex"
      >
        <Eye className="h-4 w-4" />
        Pré-visualizar
      </button>

      <button
        type="button"
        onClick={onExportar}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Exportar</span>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          className="flex h-9 w-8 items-center justify-center rounded-lg text-[#A3A3A3] transition hover:bg-[#1A1A1A] hover:text-[#C9A962]"
          aria-label="Mais ações"
          aria-expanded={menu}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenu(false)}
              aria-hidden
            />
            <div className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-lg border border-[#242424] bg-[#141414] py-1 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onDuplicar();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#E5E5E5] hover:bg-[#1D1D1D]"
              >
                <Copy className="h-3.5 w-3.5" /> Duplicar projeto
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onHistorico();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#E5E5E5] hover:bg-[#1D1D1D]"
              >
                <History className="h-3.5 w-3.5" /> Histórico de versões
              </button>
              {podePublicar && (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    onPublicar();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#E5E5E5] hover:bg-[#1D1D1D]"
                >
                  <Upload className="h-3.5 w-3.5" /> Publicar como modelo
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onApagar();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#F87171] hover:bg-[#2A1414]"
              >
                <Trash2 className="h-3.5 w-3.5" /> Apagar projeto
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function BotaoIcone({
  onClick,
  disabled,
  titulo,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      aria-label={titulo}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A3A3A3] transition hover:bg-[#1A1A1A] hover:text-[#C9A962] disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function IndicadorSync({ estado, rascunho }: { estado: EstadoSync; rascunho: boolean }) {
  if (estado.tipo === "a-guardar") {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[11px] text-[#A3A3A3]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden sm:inline">A guardar</span>
      </span>
    );
  }
  if (estado.tipo === "guardado") {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[11px] text-[#16A34A]">
        <Check className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Guardado</span>
      </span>
    );
  }
  if (estado.tipo === "erro") {
    return (
      <span
        className="flex items-center gap-1.5 px-2 text-[11px] text-[#F87171]"
        title={
          rascunho
            ? `${estado.mensagem} — as alterações ficaram guardadas neste dispositivo e serão enviadas quando a ligação voltar.`
            : estado.mensagem
        }
      >
        <CloudOff className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{rascunho ? "Por guardar" : "Sem ligação"}</span>
      </span>
    );
  }
  if (estado.tipo === "conflito") {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[11px] text-[#F59E0B]">
        <Cloud className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Conflito</span>
      </span>
    );
  }
  return null;
}
