"use client";

import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Package,
  Plus,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import { ICONS, getIcon } from "@/lib/designer/icons";
import { instanciarTemplate, TEMPLATES } from "@/lib/designer/templates";
import type { Editor } from "@/lib/designer/store";
import {
  novaImagem,
  novoIcone,
  novoShape,
  novoTexto,
  type DesignAsset,
  type DesignElement,
  type DesignTemplate,
  type ShapeKind,
} from "@/lib/designer/types";
import { PageThumb } from "./ElementView";

export const PALETA = [
  "#C9A962",
  "#E3D5A7",
  "#F5F5F5",
  "#A3A3A3",
  "#0A0A0A",
  "#1A1A1A",
  "#7C2D12",
  "#B91C1C",
  "#DB2777",
  "#7E22CE",
  "#1D4ED8",
  "#0F766E",
  "#15803D",
  "#CA8A04",
  "#EA580C",
  "#000000",
];

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

export function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wider text-[#8A8A8A]">
      {children}
    </span>
  );
}

export function Seccao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#232323] px-4 py-3 last:border-b-0">
      <Rotulo>{titulo}</Rotulo>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function BotaoPainel({
  onClick,
  children,
  variante = "normal",
  disabled,
  className = "",
}: {
  onClick?: () => void;
  children: React.ReactNode;
  variante?: "normal" | "ouro" | "perigo";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition disabled:opacity-40";
  const estilos =
    variante === "ouro"
      ? "bg-[#C9A962] text-[#0A0A0A] hover:bg-[#D8BC7A]"
      : variante === "perigo"
        ? "border border-[#4A1D1D] text-[#F87171] hover:bg-[#2A1414]"
        : "border border-[#333] text-[#E5E5E5] hover:border-[#C9A962] hover:text-[#C9A962]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${estilos} ${className}`}>
      {children}
    </button>
  );
}

function Cor({
  valor,
  onChange,
  paleta = PALETA,
}: {
  valor: string;
  onChange: (v: string) => void;
  paleta?: string[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(valor) ? valor : "#C9A962"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded border border-[#333] bg-transparent"
          aria-label="Escolher cor"
        />
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-[#333] bg-[#141414] px-2 py-1.5 text-xs text-[#E5E5E5] outline-none focus:border-[#C9A962]"
          aria-label="Código da cor"
        />
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {paleta.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="h-5 w-full rounded border border-white/10 transition hover:scale-110"
            style={{ background: c }}
            aria-label={`Cor ${c}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

export function TextoPanel({
  editor,
  fontePreferida = "Inter",
}: {
  editor: Editor;
  /** Última fonte usada por este cliente (preferências). */
  fontePreferida?: string;
}) {
  const adicionar = (tipo: "titulo" | "subtitulo" | "corpo") => {
    const config =
      tipo === "titulo"
        ? { text: "Título", fontSize: 88, fontWeight: 700, w: 700, h: 220 }
        : tipo === "subtitulo"
          ? { text: "Subtítulo", fontSize: 48, fontWeight: 500, w: 620, h: 120, color: "#C9A962" }
          : { text: "Escreva o seu texto aqui.", fontSize: 32, fontWeight: 400, w: 620, h: 120 };

    editor.adicionarElemento(novoTexto({ ...config, fontFamily: fontePreferida }));
  };

  return (
    <div>
      <Seccao titulo="Adicionar texto">
        <div className="space-y-2">
          <BotaoPainel onClick={() => adicionar("titulo")} variante="ouro">
            <Plus className="h-4 w-4" /> Título
          </BotaoPainel>
          <BotaoPainel onClick={() => adicionar("subtitulo")}>
            <Plus className="h-4 w-4" /> Subtítulo
          </BotaoPainel>
          <BotaoPainel onClick={() => adicionar("corpo")}>
            <Plus className="h-4 w-4" /> Corpo de texto
          </BotaoPainel>
        </div>
      </Seccao>
      <Seccao titulo="Dica">
        <p className="text-xs leading-relaxed text-[#8A8A8A]">
          Faça duplo clique (ou toque duas vezes) sobre um texto no ecrã para escrever. As
          alterações de fonte, cor e alinhamento ficam no painel da direita.
        </p>
      </Seccao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

export function ImagensPanel({
  editor,
  assets,
  aCarregar,
  onCarregar,
  onApagar,
  largura,
  altura,
  onAbrirCatalogo,
}: {
  editor: Editor;
  assets: DesignAsset[];
  aCarregar: boolean;
  onCarregar: (file: File) => void;
  onApagar: (asset: DesignAsset) => void;
  largura: number;
  altura: number;
  /** Abre o catálogo de produtos no painel ao lado. */
  onAbrirCatalogo?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const inserir = (src: string, storagePath: string | null, ratio?: number) => {
    const base = Math.min(largura * 0.6, 640);
    const w = base;
    const h = ratio && ratio > 0 ? base / ratio : base;
    editor.adicionarElemento(
      novaImagem(src, {
        storagePath,
        w: Math.round(w),
        h: Math.round(h),
        x: Math.round((largura - w) / 2),
        y: Math.round((altura - h) / 2),
      })
    );
  };

  return (
    <div>
      {onAbrirCatalogo && (
        <Seccao titulo="Catálogo INUKA">
          <BotaoPainel onClick={onAbrirCatalogo} variante="ouro">
            <Package className="h-4 w-4" />
            Usar imagem deste produto
          </BotaoPainel>
          <p className="mt-2 text-[11px] leading-relaxed text-[#6F6F6F]">
            Traz a fotografia, o nome e o preço do catálogo — sem descarregar nada.
          </p>
        </Seccao>
      )}

      <Seccao titulo="Carregar imagem">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCarregar(f);
            e.target.value = "";
          }}
        />
        <BotaoPainel onClick={() => inputRef.current?.click()} variante="ouro" disabled={aCarregar}>
          <Upload className="h-4 w-4" />
          {aCarregar ? "A carregar..." : "Escolher ficheiro"}
        </BotaoPainel>
        <p className="mt-2 text-[11px] text-[#6F6F6F]">PNG, JPG, WEBP, GIF ou SVG até 8 MB.</p>
      </Seccao>

      <Seccao titulo="Logótipo INUKA">
        <button
          type="button"
          onClick={() => inserir("/logo-inuka.png", null)}
          className="flex w-full items-center justify-center rounded-lg border border-[#2A2A2A] bg-[#111] p-4 transition hover:border-[#C9A962]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-inuka.png" alt="INUKA" className="h-10 w-auto" />
        </button>
      </Seccao>

      <Seccao titulo={`Os meus ficheiros (${assets.length})`}>
        {assets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#2A2A2A] py-8 text-center">
            <ImageIcon className="h-6 w-6 text-[#3F3F3F]" />
            <p className="text-xs text-[#6F6F6F]">Ainda não carregou imagens.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {assets.map((a) => (
              <div key={a.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    const ratio = a.width && a.height ? a.width / a.height : undefined;
                    if (a.url) inserir(a.url, a.storage_path, ratio);
                  }}
                  className="block aspect-square w-full overflow-hidden rounded border border-[#2A2A2A] transition hover:border-[#C9A962]"
                  title={a.name}
                >
                  {a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] text-[#5A5A5A]">
                      indisponível
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onApagar(a)}
                  className="absolute -right-1 -top-1 hidden rounded-full bg-[#1A1A1A] p-1 text-[#F87171] group-hover:block"
                  aria-label={`Apagar ${a.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Seccao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formas e ícones
// ---------------------------------------------------------------------------

const FORMAS: { key: ShapeKind; label: string }[] = [
  { key: "rect", label: "Retângulo" },
  { key: "ellipse", label: "Círculo" },
  { key: "triangle", label: "Triângulo" },
  { key: "diamond", label: "Losango" },
  { key: "star", label: "Estrela" },
  { key: "line", label: "Linha" },
];

export function FormasPanel({ editor }: { editor: Editor }) {
  const [cor, setCor] = useState("#C9A962");

  const adicionar = (shape: ShapeKind) => {
    const base = shape === "line" ? { h: 6, w: 360 } : { w: 320, h: 320 };
    editor.adicionarElemento(
      novoShape(shape, {
        ...base,
        fill: cor,
        x: 120,
        y: 120,
      })
    );
  };

  return (
    <div>
      <Seccao titulo="Cor">
        <Cor valor={cor} onChange={setCor} />
      </Seccao>
      <Seccao titulo="Formas">
        <div className="grid grid-cols-3 gap-2">
          {FORMAS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => adicionar(f.key)}
              title={f.label}
              className="flex aspect-square items-center justify-center rounded-lg border border-[#2A2A2A] bg-[#111] transition hover:border-[#C9A962]"
            >
              <span
                className="block h-7 w-7"
                style={{
                  background: cor,
                  borderRadius: f.key === "ellipse" ? "50%" : f.key === "rect" ? 4 : 0,
                  height: f.key === "line" ? 4 : 28,
                  clipPath:
                    f.key === "triangle"
                      ? "polygon(50% 0%, 100% 100%, 0% 100%)"
                      : f.key === "diamond"
                        ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
                        : f.key === "star"
                          ? "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)"
                          : undefined,
                }}
              />
            </button>
          ))}
        </div>
      </Seccao>
      <Seccao titulo="Ícones">
        <div className="grid grid-cols-5 gap-2">
          {ICONS.map(({ key, label }) => {
            const Icone = getIcon(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => editor.adicionarElemento(novoIcone(key, { color: cor }))}
                title={label}
                className="flex aspect-square items-center justify-center rounded-lg border border-[#2A2A2A] bg-[#111] text-[#C9A962] transition hover:border-[#C9A962]"
              >
                <Icone className="h-5 w-5" />
              </button>
            );
          })}
        </div>
      </Seccao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fundo
// ---------------------------------------------------------------------------

export function FundoPanel({ editor }: { editor: Editor }) {
  const bg = editor.pagina.background;

  const mudar = (patch: Partial<typeof bg>) => editor.definirFundo({ ...bg, ...patch }, true);

  return (
    <div>
      <Seccao titulo="Tipo de fundo">
        <div className="grid grid-cols-3 gap-2">
          {(["solid", "gradient", "none"] as const).map((tipo) => (
            <button
              key={tipo}
              type="button"
              onClick={() => mudar({ type: tipo })}
              className={`rounded-lg border px-2 py-2 text-xs transition ${
                bg.type === tipo
                  ? "border-[#C9A962] text-[#C9A962]"
                  : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#444]"
              }`}
            >
              {tipo === "solid" ? "Sólido" : tipo === "gradient" ? "Gradiente" : "Nenhum"}
            </button>
          ))}
        </div>
      </Seccao>

      {bg.type === "solid" && (
        <Seccao titulo="Cor">
          <Cor valor={bg.color} onChange={(color) => mudar({ color })} />
        </Seccao>
      )}

      {bg.type === "gradient" && (
        <>
          <Seccao titulo="De">
            <Cor valor={bg.from} onChange={(from) => mudar({ from })} />
          </Seccao>
          <Seccao titulo="Até">
            <Cor valor={bg.to} onChange={(to) => mudar({ to })} />
          </Seccao>
          <Seccao titulo={`Ângulo ${bg.angle}°`}>
            <input
              type="range"
              min={0}
              max={360}
              value={bg.angle}
              onChange={(e) => mudar({ angle: Number(e.target.value) })}
              className="w-full accent-[#C9A962]"
            />
          </Seccao>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Camadas
// ---------------------------------------------------------------------------

const NOME_TIPO: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  shape: "Forma",
  icon: "Ícone",
};

function nomeCamada(el: DesignElement): string {
  if (el.type === "text") {
    const t = el.text.replace(/\s+/g, " ").trim();
    return t.length > 22 ? `${t.slice(0, 22)}…` : t || "Texto";
  }
  if (el.type === "icon") return `Ícone ${el.name}`;
  if (el.type === "image") return el.name || "Imagem";
  return el.shape === "rect" ? "Retângulo" : el.shape;
}

export function CamadasPanel({ editor }: { editor: Editor }) {
  const elementos = [...editor.pagina.elements].reverse();

  return (
    <div className="py-1">
      {elementos.length === 0 && (
        <p className="px-4 py-8 text-center text-xs text-[#6F6F6F]">
          Esta página ainda não tem elementos.
        </p>
      )}
      {elementos.map((el) => {
        const ativo = editor.selecao.includes(el.id);
        return (
          <div
            key={el.id}
            className={`group flex items-center gap-2 px-3 py-2 transition ${
              ativo ? "bg-[#1D1A12]" : "hover:bg-[#151515]"
            }`}
          >
            <button
              type="button"
              onClick={() => editor.selecionar([el.id])}
              className="min-w-0 flex-1 text-left"
            >
              <span
                className={`block truncate text-xs ${ativo ? "text-[#C9A962]" : "text-[#D4D4D4]"}`}
              >
                {nomeCamada(el)}
              </span>
              <span className="block text-[10px] text-[#5F5F5F]">
                {NOME_TIPO[el.type] ?? el.type}
              </span>
            </button>

            <button
              type="button"
              onClick={() => editor.atualizarElemento(el.id, { hidden: !el.hidden }, true)}
              className="text-[#6F6F6F] hover:text-[#C9A962]"
              aria-label={el.hidden ? "Mostrar" : "Ocultar"}
            >
              {el.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => editor.atualizarElemento(el.id, { locked: !el.locked }, true)}
              className="text-[#6F6F6F] hover:text-[#C9A962]"
              aria-label={el.locked ? "Desbloquear" : "Bloquear"}
            >
              {el.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
            <div className="hidden flex-col gap-0.5 group-hover:flex">
              <button
                type="button"
                onClick={() => editor.moverOrdem(el.id, "frente")}
                className="text-[#6F6F6F] hover:text-[#C9A962]"
                aria-label="Subir"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => editor.moverOrdem(el.id, "tras")}
                className="text-[#6F6F6F] hover:text-[#C9A962]"
                aria-label="Descer"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

export function PaginasPanel({
  editor,
  largura,
  altura,
}: {
  editor: Editor;
  largura: number;
  altura: number;
}) {
  return (
    <div className="space-y-3 p-3">
      {editor.paginas.map((p, i) => (
        <div key={p.id} className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => editor.irParaPagina(i)}
            className={`shrink-0 overflow-hidden rounded border transition ${
              i === editor.atual ? "border-[#C9A962]" : "border-[#2A2A2A] hover:border-[#555]"
            }`}
          >
            <PageThumb pagina={p} largura={largura} altura={altura} larguraMax={64} />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={p.name}
              onChange={(e) => editor.renomearPagina(i, e.target.value)}
              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[#E5E5E5] outline-none hover:border-[#2A2A2A] focus:border-[#C9A962]"
            />
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[10px] text-[#5F5F5F]">
                {i === editor.atual ? "em edição" : `página ${i + 1}`}
              </span>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => editor.duplicarPagina(i)}
                  className="text-[#6F6F6F] hover:text-[#C9A962]"
                  aria-label="Duplicar página"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => editor.removerPagina(i)}
                  disabled={editor.paginas.length <= 1}
                  className="text-[#6F6F6F] hover:text-[#F87171] disabled:opacity-30"
                  aria-label="Apagar página"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
      <BotaoPainel onClick={editor.adicionarPagina}>
        <Plus className="h-4 w-4" /> Nova página
      </BotaoPainel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export function ModelosPanel({
  editor,
  modelos,
}: {
  editor: Editor;
  modelos: DesignTemplate[];
}) {
  const todos = [...TEMPLATES, ...modelos];

  const aplicar = (tpl: DesignTemplate) => {
    const paginas = instanciarTemplate(tpl);
    editor.setPaginas((atuais) => [...atuais, ...paginas], true);
    editor.irParaPagina(editor.paginas.length);
  };

  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {todos.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          onClick={() => aplicar(tpl)}
          className="group text-left"
          title={`Adicionar “${tpl.title}”`}
        >
          <div className="overflow-hidden rounded-lg border border-[#2A2A2A] transition group-hover:border-[#C9A962]">
            <PageThumb
              pagina={tpl.pages[0]}
              largura={tpl.width}
              altura={tpl.height}
              larguraMax={120}
            />
          </div>
          <span className="mt-1.5 block truncate text-[11px] text-[#A3A3A3] group-hover:text-[#C9A962]">
            {tpl.title}
          </span>
        </button>
      ))}
    </div>
  );
}
