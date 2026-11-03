"use client";

import type { CSSProperties, PointerEventHandler } from "react";
import { getIcon } from "@/lib/designer/icons";
import type { DesignElement, PageBackground } from "@/lib/designer/types";

/** Fundo da página como CSS — igual no editor e na miniatura. */
export function estiloFundo(bg: PageBackground): CSSProperties {
  if (bg.type === "none") return { background: "transparent" };
  if (bg.type === "gradient") {
    return { background: `linear-gradient(${bg.angle}deg, ${bg.from} 0%, ${bg.to} 100%)` };
  }
  return { background: bg.color };
}

const RECORTES: Record<string, string> = {
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

function estiloElemento(el: DesignElement): CSSProperties {
  return {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "center center",
    opacity: el.opacity,
    display: el.hidden ? "none" : undefined,
    boxSizing: "border-box",
  };
}

function conteudo(el: DesignElement) {
  if (el.type === "text") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          fontFamily: `"${el.fontFamily}", Inter, Helvetica, Arial, sans-serif`,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight,
          fontStyle: el.italic ? "italic" : "normal",
          textDecoration: el.underline ? "underline" : "none",
          textTransform: el.uppercase ? "uppercase" : "none",
          color: el.color,
          textAlign: el.align,
          lineHeight: el.lineHeight,
          letterSpacing: `${el.letterSpacing}px`,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          wordBreak: "break-word",
        }}
      >
        {el.text}
      </div>
    );
  }

  if (el.type === "image") {
    if (!el.src) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: el.radius,
            border: "2px dashed rgba(255,255,255,0.18)",
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,0.35)",
            fontSize: 14,
          }}
        >
          imagem indisponível
        </div>
      );
    }

    const crop = el.crop ?? { x: 0.5, y: 0.5, zoom: 1 };
    const px = `${crop.x * 100}%`;
    const py = `${crop.y * 100}%`;

    // O recorte é feito com `objectPosition` (escolhe a janela) + `scale`
    // (amplia em torno dessa janela). O raio fica no invólucro com
    // `overflow: hidden` para não ser ampliado com a imagem.
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: el.radius,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={el.src}
          alt=""
          draggable={false}
          crossOrigin="anonymous"
          style={{
            width: "100%",
            height: "100%",
            objectFit: el.fit,
            objectPosition: `${px} ${py}`,
            transform: crop.zoom !== 1 ? `scale(${crop.zoom})` : undefined,
            transformOrigin: `${px} ${py}`,
            filter: el.grayscale ? "grayscale(1)" : undefined,
            display: "block",
            userSelect: "none",
          }}
        />
      </div>
    );
  }

  if (el.type === "icon") {
    const Icone = getIcon(el.name);
    return (
      <Icone
        color={el.color}
        strokeWidth={el.strokeWidth}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden
      />
    );
  }

  // Formas
  if (el.shape === "line") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: el.fill,
          borderRadius: el.radius,
        }}
      />
    );
  }

  const recorte = RECORTES[el.shape];
  if (recorte) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: el.fill,
          clipPath: recorte,
          WebkitClipPath: recorte,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: el.fill,
        borderRadius: el.shape === "ellipse" ? "50%" : el.radius,
        border: el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
        boxSizing: "border-box",
      }}
    />
  );
}

export function ElementView({
  el,
  onPointerDown,
  interativo = false,
  esconderSelecao = false,
}: {
  el: DesignElement;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  interativo?: boolean;
  esconderSelecao?: boolean;
}) {
  return (
    <div
      data-elemento={el.id}
      onPointerDown={onPointerDown}
      style={{
        ...estiloElemento(el),
        cursor: interativo && !el.locked ? "move" : undefined,
        touchAction: interativo ? "none" : undefined,
        userSelect: esconderSelecao ? "none" : undefined,
      }}
    >
      {conteudo(el)}
    </div>
  );
}

/**
 * Miniatura estática de uma página — usada na galeria e na lista de páginas.
 * O contentor encolhe o documento real com `scale`, sem recalcular nada.
 */
export function PageThumb({
  pagina,
  largura,
  altura,
  larguraMax,
  className,
}: {
  pagina: { background: PageBackground; elements: DesignElement[] };
  largura: number;
  altura: number;
  larguraMax: number;
  className?: string;
}) {
  const escala = larguraMax / largura;
  return (
    <div
      className={className}
      style={{
        width: larguraMax,
        height: Math.round(altura * escala),
        overflow: "hidden",
        position: "relative",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          width: largura,
          height: altura,
          position: "absolute",
          left: 0,
          top: 0,
          transform: `scale(${escala})`,
          transformOrigin: "top left",
          ...estiloFundo(pagina.background),
        }}
      >
        {pagina.elements.map((el) => (
          <ElementView key={el.id} el={el} />
        ))}
      </div>
    </div>
  );
}
