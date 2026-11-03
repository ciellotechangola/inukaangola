/**
 * Formatos de documento suportados.
 *
 * As dimensões são em píxeis a 96 dpi. Na exportação para PDF convertemos para
 * pontos (×0.75), o que preserva a proporção de cada formato.
 */

export interface DesignFormat {
  key: string;
  label: string;
  hint: string;
  width: number;
  height: number;
  /** Proporção largura/altura, para desenhar a miniatura. */
  ratio: number;
}

export const FORMATS: DesignFormat[] = [
  { key: "square", label: "Quadrado", hint: "Feed 1:1", width: 1080, height: 1080, ratio: 1 },
  { key: "portrait", label: "Vertical", hint: "Feed 4:5", width: 1080, height: 1350, ratio: 0.8 },
  { key: "story", label: "Story", hint: "9:16", width: 1080, height: 1920, ratio: 0.5625 },
  { key: "landscape", label: "Horizontal", hint: "16:9", width: 1920, height: 1080, ratio: 16 / 9 },
  { key: "a4", label: "A4", hint: "Flyer / PDF", width: 1240, height: 1754, ratio: 0.707 },
  { key: "capa", label: "Capa", hint: "Partilha 1.91:1", width: 1200, height: 630, ratio: 1.905 },
];

export const FORMAT_PADRAO = FORMATS[0];

export function getFormat(key: string): DesignFormat {
  return FORMATS.find((f) => f.key === key) ?? FORMAT_PADRAO;
}

/** Píxeis → pontos PDF (96 dpi → 72 dpi). */
export function pxParaPt(px: number): number {
  return Math.round(px * 0.75 * 100) / 100;
}
