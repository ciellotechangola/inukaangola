"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Magnet } from "lucide-react";
import { ElementView, estiloFundo } from "./ElementView";
import type { Editor } from "@/lib/designer/store";
import type { DesignElement, TextElement } from "@/lib/designer/types";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ALCANCE_SNAP = 7;
const TAMANHO_MINIMO = 8;

type Gesto =
  | null
  | {
      tipo: "mover";
      ids: string[];
      inicio: { x: number; y: number };
      origens: Record<string, { x: number; y: number }>;
    }
  | {
      tipo: "redimensionar";
      id: string;
      lado: string;
      inicio: { x: number; y: number };
      origem: { x: number; y: number; w: number; h: number; rotation: number };
    }
  | {
      tipo: "rodar";
      id: string;
      centro: { x: number; y: number };
      anguloInicial: number;
      rotacaoInicial: number;
    }
  | { tipo: "pan"; inicio: { x: number; y: number }; origem: { x: number; y: number } };

const LADOS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

/** Posição de cada alça em percentagem da caixa do elemento. */
const POSICAO: Record<string, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
};

const CURSOR: Record<string, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

export function CanvasStage({
  editor,
  largura,
  altura,
  artboardRef,
  zoom,
  setZoom,
  pan,
  setPan,
  snapAtivo = true,
  onToggleSnap,
  className,
}: {
  editor: Editor;
  largura: number;
  altura: number;
  artboardRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: (z: number) => void;
  pan: { x: number; y: number };
  setPan: (p: { x: number; y: number }) => void;
  /** Preferência do cliente: encaixar no centro e nas margens. */
  snapAtivo?: boolean;
  onToggleSnap?: () => void;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gesto = useRef<Gesto>(null);
  const moveu = useRef(false);
  const ajustado = useRef(false);
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<{ distancia: number; zoom: number } | null>(null);

  const [editando, setEditando] = useState<string | null>(null);
  const [tamanhoViewport, setTamanhoViewport] = useState({ w: 0, h: 0 });

  const pagina = editor.pagina;
  const selecionadoUnico =
    editor.selecionados.length === 1 ? editor.selecionados[0] : null;

  // ---------------------------------------------------------------- medição
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const medir = () => setTamanhoViewport({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ajustar = useCallback(() => {
    const { w, h } = tamanhoViewport;
    if (!w || !h) return;
    const margem = w < 640 ? 24 : 64;
    const z = Math.min((w - margem) / largura, (h - margem) / altura);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)));
    setPan({ x: 0, y: 0 });
  }, [altura, largura, setPan, setZoom, tamanhoViewport]);

  useEffect(() => {
    if (!tamanhoViewport.w || ajustado.current) return;
    ajustado.current = true;
    ajustar();
  }, [ajustar, tamanhoViewport.w]);

  // ------------------------------------------------------- coordenadas doc
  const paraDocumento = useCallback(
    (clientX: number, clientY: number) => {
      const r = artboardRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
    },
    [artboardRef, zoom]
  );

  // ------------------------------------------------------------- snapping
  const comSnap = useCallback(
    (x: number, y: number, w: number, h: number) => {
      if (!snapAtivo) return { x, y };
      const limite = ALCANCE_SNAP / zoom;
      const alvosX = [0, largura / 2, largura];
      const alvosY = [0, altura / 2, altura];

      let sx = x;
      let sy = y;
      let melhorX = limite;
      let melhorY = limite;

      for (const alvo of alvosX) {
        for (const offset of [0, w / 2, w]) {
          const d = Math.abs(x + offset - alvo);
          if (d < melhorX) {
            melhorX = d;
            sx = alvo - offset;
          }
        }
      }
      for (const alvo of alvosY) {
        for (const offset of [0, h / 2, h]) {
          const d = Math.abs(y + offset - alvo);
          if (d < melhorY) {
            melhorY = d;
            sy = alvo - offset;
          }
        }
      }
      return { x: sx, y: sy };
    },
    [altura, largura, snapAtivo, zoom]
  );

  // ---------------------------------------------------------------- gestos
  const terminarGesto = useCallback(() => {
    gesto.current = null;
    moveu.current = false;
    editor.terminarTransacao();
  }, [editor]);

  const ligarGesto = useCallback(
    (inicial: Gesto) => {
      gesto.current = inicial;
      moveu.current = false;

      const aoMover = (ev: PointerEvent) => {
        const g = gesto.current;
        if (!g) return;

        if (g.tipo === "pan") {
          setPan({
            x: g.origem.x + (ev.clientX - g.inicio.x),
            y: g.origem.y + (ev.clientY - g.inicio.y),
          });
          return;
        }

        if (g.tipo === "rodar") {
          if (!moveu.current) {
            moveu.current = true;
            editor.iniciarTransacao();
          }
          const angulo = (Math.atan2(ev.clientY - g.centro.y, ev.clientX - g.centro.x) * 180) / Math.PI;
          let rot = g.rotacaoInicial + (angulo - g.anguloInicial);
          if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
          rot = ((rot % 360) + 360) % 360;
          editor.aplicarContinuo((paginas) =>
            paginas.map((p, i) =>
              i !== editor.atual
                ? p
                : {
                    ...p,
                    elements: p.elements.map((el) =>
                      el.id === g.id ? { ...el, rotation: Math.round(rot) } : el
                    ),
                  }
            )
          );
          return;
        }

        if (!moveu.current) {
          moveu.current = true;
          editor.iniciarTransacao();
        }

        const ponto = paraDocumento(ev.clientX, ev.clientY);
        const dx = ponto.x - g.inicio.x;
        const dy = ponto.y - g.inicio.y;

        if (g.tipo === "mover") {
          editor.aplicarContinuo((paginas) =>
            paginas.map((p, i) => {
              if (i !== editor.atual) return p;
              return {
                ...p,
                elements: p.elements.map((el) => {
                  const origem = g.origens[el.id];
                  if (!origem) return el;
                  const alvo = comSnap(origem.x + dx, origem.y + dy, el.w, el.h);
                  return { ...el, x: Math.round(alvo.x), y: Math.round(alvo.y) };
                }),
              };
            })
          );
          return;
        }

        if (g.tipo === "redimensionar") {
          const rad = (-g.origem.rotation * Math.PI) / 180;
          const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
          const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

          let { x, y, w, h } = g.origem;
          if (g.lado.includes("e")) w = g.origem.w - lx;
          if (g.lado.includes("w")) w = g.origem.w + lx;
          if (g.lado.includes("n")) h = g.origem.h - ly;
          if (g.lado.includes("s")) h = g.origem.h + ly;

          w = Math.max(TAMANHO_MINIMO, w);
          h = Math.max(TAMANHO_MINIMO, h);

          // O centro desloca-se metade da variação de cada eixo, no referencial
          // local do elemento; depois volta-se a rodar para o referencial do
          // documento, para o canto oposto ficar parado.
          const cxLocal = (w - g.origem.w) / 2;
          const cyLocal = (h - g.origem.h) / 2;
          const radR = (g.origem.rotation * Math.PI) / 180;
          const cx = g.origem.x + g.origem.w / 2 + (cxLocal * Math.cos(radR) - cyLocal * Math.sin(radR));
          const cy = g.origem.y + g.origem.h / 2 + (cxLocal * Math.sin(radR) + cyLocal * Math.cos(radR));

          x = cx - w / 2;
          y = cy - h / 2;

          editor.aplicarContinuo((paginas) =>
            paginas.map((p, i) =>
              i !== editor.atual
                ? p
                : {
                    ...p,
                    elements: p.elements.map((el) =>
                      el.id === g.id
                        ? { ...el, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
                        : el
                    ),
                  }
            )
          );
          return;
        }
      };

      const aoTerminar = () => {
        window.removeEventListener("pointermove", aoMover);
        window.removeEventListener("pointerup", aoTerminar);
        window.removeEventListener("pointercancel", aoTerminar);
        terminarGesto();
      };

      window.addEventListener("pointermove", aoMover);
      window.addEventListener("pointerup", aoTerminar);
      window.addEventListener("pointercancel", aoTerminar);
    },
    [comSnap, editor, paraDocumento, setPan, terminarGesto]
  );

  // ------------------------------------------------------------- elementos
  const aoApanharElemento = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, el: DesignElement) => {
      if (editando) return;
      ev.stopPropagation();
      if (el.locked) {
        editor.selecionar([el.id]);
        return;
      }

      const comShift = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      let ids: string[];
      if (comShift) {
        ids = editor.selecao.includes(el.id)
          ? editor.selecao.filter((i) => i !== el.id)
          : [...editor.selecao, el.id];
      } else {
        ids = editor.selecao.includes(el.id) ? editor.selecao : [el.id];
      }
      editor.selecionar(ids);

      const elementos = pagina?.elements ?? [];
      const origens: Record<string, { x: number; y: number }> = {};
      elementos.forEach((e) => {
        if (ids.includes(e.id)) origens[e.id] = { x: e.x, y: e.y };
      });

      const inicio = paraDocumento(ev.clientX, ev.clientY);
      ligarGesto({ tipo: "mover", ids, inicio, origens });
    },
    [editando, editor, ligarGesto, pagina, paraDocumento]
  );

  const aoApanharFundo = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      if (editando) return;
      if (ev.target !== ev.currentTarget) return;
      editor.selecionar([]);
      ligarGesto({
        tipo: "pan",
        inicio: { x: ev.clientX, y: ev.clientY },
        origem: { x: pan.x, y: pan.y },
      });
    },
    [editando, editor, ligarGesto, pan]
  );

  const aoApanharAlca = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, el: DesignElement, lado: string) => {
      ev.stopPropagation();
      const inicio = paraDocumento(ev.clientX, ev.clientY);
      ligarGesto({
        tipo: "redimensionar",
        id: el.id,
        lado,
        inicio,
        origem: { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation },
      });
    },
    [ligarGesto, paraDocumento]
  );

  const aoApanharRotacao = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, el: DesignElement) => {
      ev.stopPropagation();
      const r = artboardRef.current?.getBoundingClientRect();
      if (!r) return;
      const cx = r.left + (el.x + el.w / 2) * zoom;
      const cy = r.top + (el.y + el.h / 2) * zoom;
      ligarGesto({
        tipo: "rodar",
        id: el.id,
        centro: { x: cx, y: cy },
        anguloInicial: (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI,
        rotacaoInicial: el.rotation,
      });
    },
    [artboardRef, ligarGesto, zoom]
  );

  // ------------------------------------------------------------ roda / pinca
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const aoRodar = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const fator = ev.deltaY > 0 ? 0.92 : 1.08;
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * fator)));
    };

    el.addEventListener("wheel", aoRodar, { passive: false });
    return () => el.removeEventListener("wheel", aoRodar);
  }, [setZoom, zoom]);

  const aoPonteiroBaixo = useCallback((ev: ReactPointerEvent<HTMLDivElement>) => {
    ponteiros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ponteiros.current.size === 2) {
      const [a, b] = [...ponteiros.current.values()];
      pinca.current = { distancia: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }, [zoom]);

  const aoPonteiroMover = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      if (!ponteiros.current.has(ev.pointerId)) return;
      ponteiros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ponteiros.current.size !== 2 || !pinca.current) return;

      const [a, b] = [...ponteiros.current.values()];
      const distancia = Math.hypot(a.x - b.x, a.y - b.y);
      if (distancia < 1) return;
      const fator = distancia / pinca.current.distancia;
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinca.current.zoom * fator)));
    },
    [setZoom]
  );

  const aoPonteiroSolta = useCallback((ev: ReactPointerEvent<HTMLDivElement>) => {
    ponteiros.current.delete(ev.pointerId);
    if (ponteiros.current.size < 2) pinca.current = null;
  }, []);

  // -------------------------------------------------------------- edição de texto
  const aoDuploClique = useCallback(
    (el: DesignElement) => {
      if (el.type !== "text") return;
      setEditando(el.id);
    },
    []
  );

  const confirmarTexto = useCallback(
    (el: TextElement, texto: string) => {
      setEditando(null);
      if (texto !== el.text) {
        editor.atualizarElemento(el.id, { text: texto } as Partial<DesignElement>, true);
      }
    },
    [editor]
  );

  const selecao = useMemo(
    () => editor.selecionados.filter((e) => !e.hidden),
    [editor.selecionados]
  );

  return (
    <div
      ref={viewportRef}
      className={className}
      style={{
        position: "relative",
        flex: 1,
        overflow: "hidden",
        touchAction: "none",
        background:
          "radial-gradient(circle at 50% 0%, #161616 0%, #0B0B0B 60%, #080808 100%)",
      }}
      onPointerDown={aoPonteiroBaixo}
      onPointerMove={aoPonteiroMover}
      onPointerUp={aoPonteiroSolta}
      onPointerCancel={aoPonteiroSolta}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: largura * zoom,
            height: altura * zoom,
          }}
        >
          <div
            ref={artboardRef}
            onPointerDown={aoApanharFundo}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: largura,
              height: altura,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
              ...estiloFundo(pagina.background),
            }}
          >
            {pagina.elements.map((el) =>
              editando === el.id ? null : (
                <div key={el.id} onDoubleClick={() => aoDuploClique(el)}>
                  <ElementView
                    el={el}
                    interativo
                    onPointerDown={(ev) => aoApanharElemento(ev, el)}
                  />
                </div>
              )
            )}
          </div>

          {/* Camada de seleção: fora do artboard para não sair na exportação */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: largura,
              height: altura,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          >
            {selecao.map((el) => (
              <div
                key={el.id}
                style={{
                  position: "absolute",
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  transformOrigin: "center center",
                  outline: `${1.5 / zoom}px solid #C9A962`,
                  outlineOffset: 0,
                }}
              />
            ))}

            {selecionadoUnico && !selecionadoUnico.locked && (
              <div
                style={{
                  position: "absolute",
                  left: selecionadoUnico.x,
                  top: selecionadoUnico.y,
                  width: selecionadoUnico.w,
                  height: selecionadoUnico.h,
                  transform: selecionadoUnico.rotation
                    ? `rotate(${selecionadoUnico.rotation}deg)`
                    : undefined,
                  transformOrigin: "center center",
                }}
              >
                {LADOS.map((lado) => (
                  <div
                    key={lado}
                    onPointerDown={(ev) => aoApanharAlca(ev, selecionadoUnico, lado)}
                    style={{
                      position: "absolute",
                      left: `${POSICAO[lado][0]}%`,
                      top: `${POSICAO[lado][1]}%`,
                      width: 12 / zoom,
                      height: 12 / zoom,
                      marginLeft: -6 / zoom,
                      marginTop: -6 / zoom,
                      background: "#0A0A0A",
                      border: `${1.5 / zoom}px solid #C9A962`,
                      borderRadius: 2 / zoom,
                      cursor: CURSOR[lado],
                      pointerEvents: "auto",
                      touchAction: "none",
                    }}
                  />
                ))}

                <div
                  onPointerDown={(ev) => aoApanharRotacao(ev, selecionadoUnico)}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    width: 14 / zoom,
                    height: 14 / zoom,
                    marginLeft: -7 / zoom,
                    marginTop: -28 / zoom,
                    borderRadius: "50%",
                    background: "#C9A962",
                    border: `${1.5 / zoom}px solid #0A0A0A`,
                    cursor: "grab",
                    pointerEvents: "auto",
                    touchAction: "none",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {editando &&
        (() => {
          const el = pagina.elements.find((e) => e.id === editando);
          if (!el || el.type !== "text") return null;
          return (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
                width: largura * zoom,
                height: altura * zoom,
                pointerEvents: "none",
              }}
            >
              <div
                contentEditable
                suppressContentEditableWarning
                autoFocus
                onBlur={(ev) => confirmarTexto(el, ev.currentTarget.innerText)}
                onKeyDown={(ev) => {
                  if (ev.key === "Escape") {
                    ev.preventDefault();
                    (ev.currentTarget as HTMLDivElement).blur();
                  }
                  ev.stopPropagation();
                }}
                style={{
                  position: "absolute",
                  left: el.x * zoom,
                  top: el.y * zoom,
                  width: el.w * zoom,
                  height: el.h * zoom,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  transformOrigin: "center center",
                  fontFamily: `"${el.fontFamily}", Inter, Helvetica, Arial, sans-serif`,
                  fontSize: el.fontSize * zoom,
                  fontWeight: el.fontWeight,
                  fontStyle: el.italic ? "italic" : "normal",
                  textDecoration: el.underline ? "underline" : "none",
                  textTransform: el.uppercase ? "uppercase" : "none",
                  color: el.color,
                  textAlign: el.align,
                  lineHeight: el.lineHeight,
                  letterSpacing: `${el.letterSpacing * zoom}px`,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "break-word",
                  outline: "none",
                  caretColor: "#C9A962",
                  pointerEvents: "auto",
                  cursor: "text",
                }}
              >
                {el.text}
              </div>
            </div>
          );
        })()}

      {onToggleSnap && (
        <button
          type="button"
          onClick={onToggleSnap}
          title={snapAtivo ? "Encaixe ativo — clique para desligar" : "Encaixe desligado"}
          aria-pressed={snapAtivo}
          style={{ touchAction: "manipulation" }}
          className={`absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur transition ${
            snapAtivo
              ? "border-[#C9A962]/50 bg-[#1D1A12]/90 text-[#C9A962]"
              : "border-[#2A2A2A] bg-[#101010]/90 text-[#6F6F6F] hover:text-[#A3A3A3]"
          }`}
        >
          <Magnet className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

