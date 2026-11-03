/**
 * Modelo de dados do designer.
 *
 * O documento de um projeto é uma lista de páginas; cada página tem um fundo e
 * uma lista de elementos. As coordenadas são sempre em píxeis do documento
 * (nunca em píxeis do ecrã), para que o mesmo projeto abra igual num telemóvel
 * e num monitor 4K. O zoom é apenas uma transformação visual.
 */

export type ElementType = "text" | "image" | "shape" | "icon";

export interface BaseElement {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Graus, sentido horário. */
  rotation: number;
  /** 0 a 1. */
  opacity: number;
  locked: boolean;
  hidden: boolean;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  color: string;
  align: "left" | "center" | "right";
  /** Multiplicador do tamanho da fonte. */
  lineHeight: number;
  /** Píxeis. */
  letterSpacing: number;
}

export interface ImageElement extends BaseElement {
  type: "image";
  /** URL assinado (bucket privado) ou data URL. */
  src: string;
  /** Caminho no Storage, para renovar o URL assinado quando expira. */
  storagePath: string | null;
  fit: "cover" | "contain";
  radius: number;
  grayscale: boolean;
  /** Recorte: centro da área visível (0–1) e ampliação (>= 1). */
  crop: ImageCrop;
}

export interface ImageCrop {
  /** 0 = esquerda, 0.5 = centro, 1 = direita. */
  x: number;
  /** 0 = topo, 0.5 = centro, 1 = base. */
  y: number;
  /** 1 = sem ampliação. */
  zoom: number;
}

export const CROP_PADRAO: ImageCrop = { x: 0.5, y: 0.5, zoom: 1 };

export type ShapeKind = "rect" | "ellipse" | "triangle" | "star" | "diamond" | "line";

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface IconElement extends BaseElement {
  type: "icon";
  /** Chave de `ICONS` em icons.tsx. */
  name: string;
  color: string;
  strokeWidth: number;
}

export type DesignElement = TextElement | ImageElement | ShapeElement | IconElement;

export interface PageBackground {
  type: "solid" | "gradient" | "none";
  color: string;
  from: string;
  to: string;
  /** Graus. */
  angle: number;
}

export interface DesignPage {
  id: string;
  name: string;
  background: PageBackground;
  elements: DesignElement[];
}

export interface DesignProject {
  id: string;
  title: string;
  format_key: string;
  width: number;
  height: number;
  pages: DesignPage[];
  thumbnail: string | null;
  template_id: string | null;
  version: number;
  updated_at: string;
  last_saved_at: string | null;
}

export interface DesignProjectSummary {
  id: string;
  title: string;
  format_key: string;
  width: number;
  height: number;
  thumbnail: string | null;
  updated_at: string;
  version: number;
}

export interface DesignTemplate {
  id: string;
  title: string;
  description: string | null;
  category: string;
  format_key: string;
  width: number;
  height: number;
  pages: DesignPage[];
  thumbnail: string | null;
}

export interface DesignAsset {
  id: string;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
  /** URL assinado, preenchido no cliente. */
  url?: string;
}

export interface DesignVersionSummary {
  id: string;
  version: number;
  title: string;
  label: string | null;
  created_at: string;
  thumbnail: string | null;
  paginas: number;
  elementos: number;
}

export interface DesignerPreferences {
  last_format_key: string;
  last_font: string;
  snap_enabled: boolean;
  grid_size: number;
}

export const PREFERENCIAS_PADRAO: DesignerPreferences = {
  last_format_key: "square",
  last_font: "Inter",
  snap_enabled: true,
  grid_size: 8,
};

// ---------------------------------------------------------------------------
// Construtores
// ---------------------------------------------------------------------------

export function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export const FUNDO_PADRAO: PageBackground = {
  type: "solid",
  color: "#0A0A0A",
  from: "#0A0A0A",
  to: "#1A1A1A",
  angle: 160,
};

export function novaPagina(nome = "Página 1", background: PageBackground = FUNDO_PADRAO): DesignPage {
  return { id: novoId(), name: nome, background: { ...background }, elements: [] };
}

const BASE: Omit<BaseElement, "id" | "type" | "name" | "x" | "y" | "w" | "h"> = {
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
};

export function novoTexto(over: Partial<TextElement> = {}): TextElement {
  return {
    ...BASE,
    id: novoId(),
    type: "text",
    name: "Texto",
    x: 80,
    y: 80,
    w: 520,
    h: 120,
    text: "Escreva aqui",
    fontFamily: "Inter",
    fontSize: 64,
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    color: "#F5F5F5",
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...over,
  };
}

export function novoShape(shape: ShapeKind = "rect", over: Partial<ShapeElement> = {}): ShapeElement {
  return {
    ...BASE,
    id: novoId(),
    type: "shape",
    name: shape,
    x: 120,
    y: 120,
    w: 360,
    h: 360,
    shape,
    fill: "#C9A962",
    stroke: "transparent",
    strokeWidth: 0,
    radius: shape === "rect" ? 16 : 0,
    ...over,
  };
}

export function novaImagem(src: string, over: Partial<ImageElement> = {}): ImageElement {
  return {
    ...BASE,
    id: novoId(),
    type: "image",
    name: "Imagem",
    x: 100,
    y: 100,
    w: 480,
    h: 480,
    src,
    storagePath: null,
    fit: "cover",
    radius: 0,
    grayscale: false,
    crop: { ...CROP_PADRAO },
    ...over,
  };
}

export function novoIcone(name: string, over: Partial<IconElement> = {}): IconElement {
  return {
    ...BASE,
    id: novoId(),
    type: "icon",
    name,
    x: 120,
    y: 120,
    w: 120,
    h: 120,
    color: "#C9A962",
    strokeWidth: 1.6,
    ...over,
  };
}

export function duplicarElemento(el: DesignElement, desvio = 24): DesignElement {
  return { ...el, id: novoId(), x: el.x + desvio, y: el.y + desvio };
}

// ---------------------------------------------------------------------------
// Normalização defensiva
// ---------------------------------------------------------------------------

/**
 * O documento vem da base de dados e pode ter sido escrito por uma versão
 * anterior da app. Em vez de confiar no formato, reparamos o que falta para o
 * editor nunca rebentar a meio de um projeto antigo.
 */
export function normalizarPaginas(raw: unknown): DesignPage[] {
  if (!Array.isArray(raw) || raw.length === 0) return [novaPagina()];

  return raw.map((p, i) => {
    const page = (p ?? {}) as Partial<DesignPage>;
    const bg = (page.background ?? {}) as Partial<PageBackground>;
    const elementos = Array.isArray(page.elements) ? page.elements : [];

    return {
      id: typeof page.id === "string" && page.id ? page.id : novoId(),
      name: typeof page.name === "string" && page.name ? page.name : `Página ${i + 1}`,
      background: {
        type: bg.type === "gradient" || bg.type === "none" ? bg.type : "solid",
        color: typeof bg.color === "string" ? bg.color : FUNDO_PADRAO.color,
        from: typeof bg.from === "string" ? bg.from : FUNDO_PADRAO.from,
        to: typeof bg.to === "string" ? bg.to : FUNDO_PADRAO.to,
        angle: typeof bg.angle === "number" ? bg.angle : FUNDO_PADRAO.angle,
      },
      elements: elementos.map((e) => normalizarElemento(e as Partial<DesignElement>)),
    };
  });
}

function normalizarElemento(raw: Partial<DesignElement>): DesignElement {
  const comum = {
    id: typeof raw.id === "string" && raw.id ? raw.id : novoId(),
    name: typeof raw.name === "string" ? raw.name : "Elemento",
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: Math.max(4, num(raw.w, 100)),
    h: Math.max(4, num(raw.h, 100)),
    rotation: num(raw.rotation, 0),
    opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
    locked: raw.locked === true,
    hidden: raw.hidden === true,
  };

  if (raw.type === "text") {
    const t = raw as Partial<TextElement>;
    return {
      ...comum,
      type: "text",
      text: typeof t.text === "string" ? t.text : "",
      fontFamily: t.fontFamily || "Inter",
      fontSize: num(t.fontSize, 48),
      fontWeight: num(t.fontWeight, 400),
      italic: t.italic === true,
      underline: t.underline === true,
      uppercase: t.uppercase === true,
      color: t.color || "#F5F5F5",
      align: t.align === "center" || t.align === "right" ? t.align : "left",
      lineHeight: num(t.lineHeight, 1.2),
      letterSpacing: num(t.letterSpacing, 0),
    };
  }

  if (raw.type === "image") {
    const im = raw as Partial<ImageElement>;
    const c = (im.crop ?? {}) as Partial<ImageCrop>;
    return {
      ...comum,
      type: "image",
      src: im.src || "",
      storagePath: im.storagePath ?? null,
      fit: im.fit === "contain" ? "contain" : "cover",
      radius: num(im.radius, 0),
      grayscale: im.grayscale === true,
      crop: {
        x: Math.min(1, Math.max(0, num(c.x, 0.5))),
        y: Math.min(1, Math.max(0, num(c.y, 0.5))),
        zoom: Math.min(8, Math.max(1, num(c.zoom, 1))),
      },
    };
  }

  if (raw.type === "icon") {
    const ic = raw as Partial<IconElement>;
    return {
      ...comum,
      type: "icon",
      name: ic.name || "sparkles",
      color: ic.color || "#C9A962",
      strokeWidth: num(ic.strokeWidth, 1.6),
    };
  }

  const s = raw as Partial<ShapeElement>;
  const kinds: ShapeKind[] = ["rect", "ellipse", "triangle", "star", "diamond", "line"];
  return {
    ...comum,
    type: "shape",
    shape: kinds.includes(s.shape as ShapeKind) ? (s.shape as ShapeKind) : "rect",
    fill: s.fill || "#C9A962",
    stroke: s.stroke || "transparent",
    strokeWidth: num(s.strokeWidth, 0),
    radius: num(s.radius, 0),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
