"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Italic,
  Trash2,
  Underline,
} from "lucide-react";
import type { Editor } from "@/lib/designer/store";
import type { DesignElement } from "@/lib/designer/types";
import { ICONS } from "@/lib/designer/icons";
import { PALETA, Rotulo, Seccao } from "./ToolPanels";

const FONTES = [
  "Inter",
  "Georgia",
  "Times New Roman",
  "Arial",
  "Verdana",
  "Trebuchet MS",
  "Courier New",
  "Impact",
];

function CampoNumero({
  rotulo,
  valor,
  onChange,
  min,
  max,
  passo = 1,
  sufixo,
}: {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  passo?: number;
  sufixo?: string;
}) {
  return (
    <label className="flex items-center gap-1 rounded border border-[#2A2A2A] bg-[#131313] px-2 py-1.5">
      <span className="text-[10px] uppercase text-[#6F6F6F]">{rotulo}</span>
      <input
        type="number"
        value={Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0}
        min={min}
        max={max}
        step={passo}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-full min-w-0 bg-transparent text-right text-xs text-[#E5E5E5] outline-none"
      />
      {sufixo && <span className="text-[10px] text-[#5F5F5F]">{sufixo}</span>}
    </label>
  );
}

function CampoDeslizante({
  rotulo,
  valor,
  onChange,
  min,
  max,
  passo = 0.01,
  formatar,
}: {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  passo?: number;
  formatar?: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[10px] uppercase text-[#6F6F6F]">
        {rotulo}
        <span className="text-[10px] normal-case text-[#A3A3A3]">
          {formatar ? formatar(valor) : Math.round(valor * 100) / 100}
        </span>
      </span>
      <input
        type="range"
        value={valor}
        min={min}
        max={max}
        step={passo}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#2A2A2A] accent-[#C9A962]"
      />
    </label>
  );
}

function Controlo({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function BotaoAlternar({
  ativo,
  onClick,
  children,
  titulo,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  titulo: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-pressed={ativo}
      className={`flex h-8 items-center justify-center rounded border transition ${
        ativo
          ? "border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
          : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#444]"
      }`}
    >
      {children}
    </button>
  );
}

export function PropertiesPanel({ editor }: { editor: Editor }) {
  const selecionados = editor.selecionados;

  if (selecionados.length === 0) {
    return (
      <div className="p-4">
        <p className="text-xs leading-relaxed text-[#8A8A8A]">
          Selecione um elemento no ecrã para editar posição, tamanho, cor e tipografia.
        </p>
        <div className="mt-4 rounded-lg border border-[#232323] p-3">
          <Rotulo>Documento</Rotulo>
          <p className="mt-2 text-xs text-[#6F6F6F]">
            {editor.paginas.length} {editor.paginas.length === 1 ? "página" : "páginas"} ·{" "}
            {editor.pagina.elements.length} elementos nesta página
          </p>
        </div>
      </div>
    );
  }

  if (selecionados.length > 1) {
    return (
      <div>
        <Seccao titulo={`${selecionados.length} elementos selecionados`}>
          <Controlo>
            <CampoNumero
              rotulo="Opac."
              valor={Math.round((selecionados[0].opacity ?? 1) * 100)}
              min={0}
              max={100}
              sufixo="%"
              onChange={(v) => editor.atualizarSelecionados({ opacity: Math.min(1, Math.max(0, v / 100)) })}
            />
          </Controlo>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={editor.duplicarSelecionados}
              className="flex items-center justify-center gap-1 rounded border border-[#2A2A2A] py-2 text-xs text-[#E5E5E5] hover:border-[#C9A962]"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicar
            </button>
            <button
              type="button"
              onClick={editor.removerSelecionados}
              className="flex items-center justify-center gap-1 rounded border border-[#4A1D1D] py-2 text-xs text-[#F87171] hover:bg-[#2A1414]"
            >
              <Trash2 className="h-3.5 w-3.5" /> Apagar
            </button>
          </div>
        </Seccao>
      </div>
    );
  }

  const el = selecionados[0];
  const atualizar = (patch: Partial<DesignElement>) => editor.atualizarElemento(el.id, patch, true);

  return (
    <div>
      <Seccao titulo="Posição e tamanho">
        <Controlo>
          <CampoNumero rotulo="X" valor={el.x} onChange={(v) => atualizar({ x: v })} />
          <CampoNumero rotulo="Y" valor={el.y} onChange={(v) => atualizar({ y: v })} />
          <CampoNumero rotulo="L" valor={el.w} min={4} onChange={(v) => atualizar({ w: Math.max(4, v) })} />
          <CampoNumero rotulo="A" valor={el.h} min={4} onChange={(v) => atualizar({ h: Math.max(4, v) })} />
          <CampoNumero
            rotulo="Rot."
            valor={el.rotation}
            min={-360}
            max={360}
            sufixo="°"
            onChange={(v) => atualizar({ rotation: v })}
          />
          <CampoNumero
            rotulo="Opac."
            valor={Math.round(el.opacity * 100)}
            min={0}
            max={100}
            sufixo="%"
            onChange={(v) => atualizar({ opacity: Math.min(1, Math.max(0, v / 100)) })}
          />
        </Controlo>
      </Seccao>

      {el.type === "text" && (
        <>
          <Seccao titulo="Tipografia">
            <select
              value={el.fontFamily}
              onChange={(e) => atualizar({ fontFamily: e.target.value })}
              className="w-full rounded border border-[#2A2A2A] bg-[#131313] px-2 py-2 text-xs text-[#E5E5E5] outline-none focus:border-[#C9A962]"
            >
              {FONTES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <CampoNumero
                rotulo="Tam."
                valor={el.fontSize}
                min={4}
                max={600}
                onChange={(v) => atualizar({ fontSize: Math.max(4, v) })}
              />
              <label className="flex items-center gap-1 rounded border border-[#2A2A2A] bg-[#131313] px-2 py-1.5">
                <span className="text-[10px] uppercase text-[#6F6F6F]">Peso</span>
                <select
                  value={el.fontWeight}
                  onChange={(e) => atualizar({ fontWeight: Number(e.target.value) })}
                  className="w-full bg-transparent text-right text-xs text-[#E5E5E5] outline-none"
                >
                  {[300, 400, 500, 600, 700, 800].map((p) => (
                    <option key={p} value={p} className="bg-[#131313]">
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <BotaoAlternar
                ativo={el.align === "left"}
                onClick={() => atualizar({ align: "left" })}
                titulo="Alinhar à esquerda"
              >
                <AlignLeft className="h-4 w-4" />
              </BotaoAlternar>
              <BotaoAlternar
                ativo={el.align === "center"}
                onClick={() => atualizar({ align: "center" })}
                titulo="Centrar"
              >
                <AlignCenter className="h-4 w-4" />
              </BotaoAlternar>
              <BotaoAlternar
                ativo={el.align === "right"}
                onClick={() => atualizar({ align: "right" })}
                titulo="Alinhar à direita"
              >
                <AlignRight className="h-4 w-4" />
              </BotaoAlternar>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <BotaoAlternar
                ativo={el.fontWeight >= 600}
                onClick={() => atualizar({ fontWeight: el.fontWeight >= 600 ? 400 : 700 })}
                titulo="Negrito"
              >
                <Bold className="h-4 w-4" />
              </BotaoAlternar>
              <BotaoAlternar
                ativo={el.italic}
                onClick={() => atualizar({ italic: !el.italic })}
                titulo="Itálico"
              >
                <Italic className="h-4 w-4" />
              </BotaoAlternar>
              <BotaoAlternar
                ativo={el.underline}
                onClick={() => atualizar({ underline: !el.underline })}
                titulo="Sublinhado"
              >
                <Underline className="h-4 w-4" />
              </BotaoAlternar>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <CampoNumero
                rotulo="Entrelinha"
                valor={el.lineHeight}
                min={0.6}
                max={3}
                passo={0.05}
                onChange={(v) => atualizar({ lineHeight: v })}
              />
              <CampoNumero
                rotulo="Espaço"
                valor={el.letterSpacing}
                min={-10}
                max={80}
                passo={0.5}
                onChange={(v) => atualizar({ letterSpacing: v })}
              />
            </div>

            <div className="mt-2">
              <BotaoAlternar
                ativo={el.uppercase}
                onClick={() => atualizar({ uppercase: !el.uppercase })}
                titulo="Maiúsculas"
              >
                <span className="text-[11px] font-semibold tracking-wider">AA</span>
              </BotaoAlternar>
            </div>
          </Seccao>

          <Seccao titulo="Cor do texto">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(el.color) ? el.color : "#F5F5F5"}
                onChange={(e) => atualizar({ color: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border border-[#333] bg-transparent"
                aria-label="Cor do texto"
              />
              <div className="grid flex-1 grid-cols-8 gap-1">
                {PALETA.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => atualizar({ color: c })}
                    className="h-4 rounded border border-white/10"
                    style={{ background: c }}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
            </div>
          </Seccao>
        </>
      )}

      {el.type === "shape" && (
        <>
          <Seccao titulo="Preenchimento">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(el.fill) ? el.fill : "#C9A962"}
                onChange={(e) => atualizar({ fill: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border border-[#333] bg-transparent"
                aria-label="Preenchimento"
              />
              <div className="grid flex-1 grid-cols-8 gap-1">
                {PALETA.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => atualizar({ fill: c })}
                    className="h-4 rounded border border-white/10"
                    style={{ background: c }}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
            </div>
          </Seccao>

          {el.shape === "rect" && (
            <Seccao titulo="Cantos">
              <CampoNumero
                rotulo="Raio"
                valor={el.radius}
                min={0}
                max={400}
                onChange={(v) => atualizar({ radius: Math.max(0, v) })}
              />
            </Seccao>
          )}

          <Seccao titulo="Contorno">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(el.stroke) ? el.stroke : "#C9A962"}
                onChange={(e) => atualizar({ stroke: e.target.value })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-[#333] bg-transparent"
                aria-label="Cor do contorno"
              />
              <CampoNumero
                rotulo="Espessura"
                valor={el.strokeWidth}
                min={0}
                max={80}
                onChange={(v) => atualizar({ strokeWidth: Math.max(0, v) })}
              />
            </div>
          </Seccao>
        </>
      )}

      {el.type === "image" && (
        <Seccao titulo="Imagem">
          <div className="grid grid-cols-2 gap-2">
            <BotaoAlternar
              ativo={el.fit === "cover"}
              onClick={() => atualizar({ fit: "cover" })}
              titulo="Preencher"
            >
              <span className="text-[11px]">Preencher</span>
            </BotaoAlternar>
            <BotaoAlternar
              ativo={el.fit === "contain"}
              onClick={() => atualizar({ fit: "contain" })}
              titulo="Conter"
            >
              <span className="text-[11px]">Conter</span>
            </BotaoAlternar>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <CampoNumero
              rotulo="Raio"
              valor={el.radius}
              min={0}
              max={800}
              onChange={(v) => atualizar({ radius: Math.max(0, v) })}
            />
            <BotaoAlternar
              ativo={el.grayscale}
              onClick={() => atualizar({ grayscale: !el.grayscale })}
              titulo="Preto e branco"
            >
              <span className="text-[11px]">P&B</span>
            </BotaoAlternar>
          </div>
        </Seccao>
      )}

      {el.type === "image" && (
        <Seccao titulo="Recorte">
          <div className="space-y-2.5">
            <CampoDeslizante
              rotulo="Ampliação"
              valor={el.crop?.zoom ?? 1}
              min={1}
              max={4}
              passo={0.02}
              formatar={(v) => `${v.toFixed(2)}×`}
              onChange={(v) =>
                atualizar({
                  crop: { ...(el.crop ?? { x: 0.5, y: 0.5, zoom: 1 }), zoom: v },
                })
              }
            />
            <CampoDeslizante
              rotulo="Horizontal"
              valor={el.crop?.x ?? 0.5}
              min={0}
              max={1}
              formatar={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) =>
                atualizar({
                  crop: { ...(el.crop ?? { x: 0.5, y: 0.5, zoom: 1 }), x: v },
                })
              }
            />
            <CampoDeslizante
              rotulo="Vertical"
              valor={el.crop?.y ?? 0.5}
              min={0}
              max={1}
              formatar={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) =>
                atualizar({
                  crop: { ...(el.crop ?? { x: 0.5, y: 0.5, zoom: 1 }), y: v },
                })
              }
            />
            <button
              type="button"
              onClick={() => atualizar({ crop: { x: 0.5, y: 0.5, zoom: 1 } })}
              className="w-full rounded border border-[#2A2A2A] py-1.5 text-[11px] text-[#A3A3A3] transition hover:border-[#444] hover:text-[#E5E5E5]"
            >
              Repor recorte
            </button>
          </div>
        </Seccao>
      )}

      {el.type === "icon" && (
        <>
          <Seccao titulo="Cor do ícone">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(el.color) ? el.color : "#C9A962"}
                onChange={(e) => atualizar({ color: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border border-[#333] bg-transparent"
                aria-label="Cor do ícone"
              />
              <div className="grid flex-1 grid-cols-8 gap-1">
                {PALETA.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => atualizar({ color: c })}
                    className="h-4 rounded border border-white/10"
                    style={{ background: c }}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
            </div>
          </Seccao>

          <Seccao titulo="Substituir ícone">
            <div className="grid max-h-40 grid-cols-6 gap-1.5 overflow-y-auto">
              {ICONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => atualizar({ name: key })}
                  title={label}
                  className={`flex aspect-square items-center justify-center rounded border transition ${
                    el.name === key
                      ? "border-[#C9A962] text-[#C9A962]"
                      : "border-[#2A2A2A] text-[#8A8A8A] hover:border-[#444]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </Seccao>
        </>
      )}

      <Seccao titulo="Ordem e ações">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => editor.moverOrdem(el.id, "frente")}
            className="rounded border border-[#2A2A2A] py-2 text-xs text-[#E5E5E5] hover:border-[#C9A962]"
          >
            Para a frente
          </button>
          <button
            type="button"
            onClick={() => editor.moverOrdem(el.id, "tras")}
            className="rounded border border-[#2A2A2A] py-2 text-xs text-[#E5E5E5] hover:border-[#C9A962]"
          >
            Para trás
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={editor.duplicarSelecionados}
            className="flex items-center justify-center gap-1 rounded border border-[#2A2A2A] py-2 text-xs text-[#E5E5E5] hover:border-[#C9A962]"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicar
          </button>
          <button
            type="button"
            onClick={editor.removerSelecionados}
            className="flex items-center justify-center gap-1 rounded border border-[#4A1D1D] py-2 text-xs text-[#F87171] hover:bg-[#2A1414]"
          >
            <Trash2 className="h-3.5 w-3.5" /> Apagar
          </button>
        </div>
      </Seccao>
    </div>
  );
}
