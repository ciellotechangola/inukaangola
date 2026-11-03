"use client";

import { toJpeg, toPng, getFontEmbedCSS } from "html-to-image";
import { pxParaPt } from "./formats";

/**
 * Exportação de designs.
 *
 * PNG/JPG saem do DOM real (html-to-image), por isso o ficheiro é exatamente o
 * que está no ecrã — texto, imagens, ícones e formas.
 *
 * O PDF é construído à mão: cada página vira um JPEG embutido com filtro
 * /DCTDecode. Não vale a pena arrastar uma biblioteca de PDF só para isto, e
 * assim não há nenhuma conversão intermédia a degradar o resultado.
 */

export type FormatoExportacao = "png" | "jpeg" | "pdf";

export interface OpcoesExportacao {
  formato: FormatoExportacao;
  /** 1 = tamanho real, 2 = 2×, 3 = 3×. */
  escala: number;
  nomeFicheiro: string;
  qualidade?: number;
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------

export async function capturar(
  node: HTMLElement,
  opcoes: { mime: "png" | "jpeg"; escala: number; qualidade?: number; fontEmbedCSS?: string }
): Promise<string> {
  const base = {
    pixelRatio: opcoes.escala,
    cacheBust: true,
    quality: opcoes.qualidade ?? 0.94,
    // O nó é capturado no tamanho natural; o zoom é só uma transformação do
    // contentor e não deve entrar no ficheiro. A camada de exportação vive
    // fora do ecrã, por isso anulamos também o posicionamento.
    style: {
      transform: "none",
      margin: "0",
      boxShadow: "none",
      position: "static",
      left: "0",
      top: "0",
    },
    ...(opcoes.fontEmbedCSS ? { fontEmbedCSS: opcoes.fontEmbedCSS } : {}),
  };

  return opcoes.mime === "png" ? toPng(node, base) : toJpeg(node, base);
}

export async function prepararFontes(node: HTMLElement): Promise<string | undefined> {
  try {
    return await getFontEmbedCSS(node);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Ficheiros
// ---------------------------------------------------------------------------

export function dataUrlParaBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export function descarregar(dataUrl: string, nome: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function descarregarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function nomeSeguro(titulo: string, extensao: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "design-inuka"}.${extensao}`;
}

// ---------------------------------------------------------------------------
// PDF (escrito à mão, uma página por imagem JPEG)
// ---------------------------------------------------------------------------

export interface PaginaPdf {
  jpeg: Uint8Array;
  /** Dimensões reais do JPEG, em píxeis (usadas no dicionário da imagem). */
  larguraPx: number;
  alturaPx: number;
  /** Dimensões da página, em pontos. */
  larguraPt: number;
  alturaPt: number;
}

export function construirPdf(paginas: PaginaPdf[]): Blob {
  if (paginas.length === 0) throw new Error("Sem páginas para exportar.");

  const encoder = new TextEncoder();
  const partes: Uint8Array[] = [];
  let posicao = 0;

  const escrever = (dados: string | Uint8Array) => {
    const bytes = typeof dados === "string" ? encoder.encode(dados) : dados;
    partes.push(bytes);
    posicao += bytes.length;
  };

  const deslocamentos: number[] = [];
  const marcarObjeto = (id: number) => {
    deslocamentos[id] = posicao;
    escrever(`${id} 0 obj\n`);
  };

  const totalObjetos = 2 + paginas.length * 3;
  const idsPaginas: { pagina: number; imagem: number; conteudo: number }[] = [];
  let proximo = 3;
  for (let i = 0; i < paginas.length; i++) {
    idsPaginas.push({ pagina: proximo, imagem: proximo + 1, conteudo: proximo + 2 });
    proximo += 3;
  }

  escrever("%PDF-1.4\n");

  marcarObjeto(1);
  escrever("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids = idsPaginas.map((p) => `${p.pagina} 0 R`).join(" ");
  marcarObjeto(2);
  escrever(`<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>\nendobj\n`);

  paginas.forEach((pagina, i) => {
    const ids = idsPaginas[i];
    const w = pagina.larguraPt;
    const h = pagina.alturaPt;

    marcarObjeto(ids.pagina);
    escrever(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${ids.imagem} 0 R >> >> ` +
        `/Contents ${ids.conteudo} 0 R >>\nendobj\n`
    );

    marcarObjeto(ids.imagem);
    escrever(
      `<< /Type /XObject /Subtype /Image /Width ${pagina.larguraPx} /Height ${
        pagina.alturaPx
      } /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${
        pagina.jpeg.length
      } >>\nstream\n`
    );
    escrever(pagina.jpeg);
    escrever("\nendstream\nendobj\n");

    const conteudo = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    marcarObjeto(ids.conteudo);
    escrever(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream\nendobj\n`);
  });

  const inicioXref = posicao;
  let xref = `xref\n0 ${totalObjetos + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= totalObjetos; id++) {
    const off = deslocamentos[id] ?? 0;
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  escrever(xref);

  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) {
    saida.set(parte, offset);
    offset += parte.length;
  }
  return new Blob([saida], { type: "application/pdf" });
}

/** Converte píxeis do documento em pontos PDF. */
export function paginaPdfDeJpeg(
  jpeg: Uint8Array,
  larguraPx: number,
  alturaPx: number,
  escala: number
): PaginaPdf {
  return {
    jpeg,
    larguraPx: Math.round(larguraPx * escala),
    alturaPx: Math.round(alturaPx * escala),
    larguraPt: pxParaPt(larguraPx),
    alturaPt: pxParaPt(alturaPx),
  };
}

// ---------------------------------------------------------------------------
// Partilha nativa (telemóvel)
// ---------------------------------------------------------------------------

export async function partilharFicheiro(
  blob: Blob,
  nome: string,
  titulo: string
): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  if (!nav.share || !nav.canShare) return false;

  const ficheiro = new File([blob], nome, { type: blob.type });
  if (!nav.canShare({ files: [ficheiro] })) return false;

  try {
    await nav.share({ files: [ficheiro], title: titulo });
    return true;
  } catch {
    return false;
  }
}
