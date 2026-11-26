import sharp from "sharp";

/**
 * Imagens do servidor: tudo o que sai para o utilizador sai em **PNG**.
 *
 * A regra é da casa — «descarregar» tem de dar sempre o mesmo tipo de ficheiro,
 * seja qual for o formato em que a imagem foi publicada. Uma foto tirada no
 * telemóvel chega em JPEG, uma composição do designer em PNG: quem recebe o
 * ficheiro por WhatsApp ou o guarda na galeria não tem de saber disto.
 */

/** Converte qualquer imagem (JPEG, WebP, AVIF, GIF, TIFF) em PNG. */
export async function paraPng(bytes: Buffer | Uint8Array): Promise<Buffer> {
  const entrada = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  // Já é PNG: reescrever só gastaria tempo e podia perder qualidade.
  if (entrada.subarray(0, 8).equals(PNG)) return entrada;

  return sharp(entrada, { animated: false, limitInputPixels: 268_402_689 })
    // Uma foto de telemóvel traz a rotação no EXIF; sem isto saía deitada.
    .rotate()
    .png({ compressionLevel: 9, effort: 8 })
    .toBuffer();
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Cartaz {
  /** COMUNICADO · PROMOÇÃO · TESTEMUNHO · FORMAÇÃO */
  tipo: string;
  titulo: string;
  subtitulo?: string | null;
  corpo?: string | null;
  /** Já formatada (dd/mm/aaaa). */
  data?: string | null;
}

/**
 * Cartaz PNG para publicações sem fotografia.
 *
 * Um comunicado só de texto não tem imagem para descarregar — mas quem o quer
 * reenviar não quer um `.txt` no meio das fotografias da galeria. Aqui o texto
 * é composto num cartaz 1080×1350 (o formato de um post), com a mesma paleta da
 * app, e sai como qualquer outra imagem.
 *
 * As linhas são quebradas à mão porque o SVG não quebra texto sozinho. A largura
 * é estimada pela média de avanço da DejaVu Sans (0,55 em) — folgada de
 * propósito: uma linha curta é um detalhe, uma linha a sair do cartaz é um erro.
 */
export async function cartazPng(cartaz: Cartaz): Promise<Buffer> {
  const L = 1080;
  const A = 1350;
  const M = 92;
  const util = L - M * 2;

  const blocos: { linhas: string[]; tamanho: number; cor: string; entrelinha: number; espaco: number }[] =
    [];

  const tipo = (cartaz.tipo || "INUKA").toUpperCase();
  blocos.push({
    linhas: quebrar(tipo, util, 27, 1),
    tamanho: 27,
    cor: "#C9A962",
    entrelinha: 34,
    espaco: 0,
  });

  blocos.push({
    linhas: quebrar(cartaz.titulo || "Publicação INUKA", util, 66, 5),
    tamanho: 66,
    cor: "#F5F5F5",
    entrelinha: 78,
    espaco: 26,
  });

  if (cartaz.subtitulo?.trim()) {
    blocos.push({
      linhas: quebrar(cartaz.subtitulo, util, 40, 2),
      tamanho: 40,
      cor: "#C9A962",
      entrelinha: 52,
      espaco: 22,
    });
  }

  if (cartaz.corpo?.trim()) {
    blocos.push({
      linhas: quebrar(cartaz.corpo, util, 34, 11),
      tamanho: 34,
      cor: "#A3A3A3",
      entrelinha: 52,
      espaco: 30,
    });
  }

  const alturaTexto = blocos.reduce(
    (n, b) => n + b.espaco + b.linhas.length * b.entrelinha,
    0
  );

  // O texto assenta no meio da área útil; com muito texto começa no topo.
  const topo = 250;
  const fundo = 1180;
  let y = Math.max(topo, topo + (fundo - topo - alturaTexto) / 2);

  const textos: string[] = [];
  for (const bloco of blocos) {
    y += bloco.espaco;
    bloco.linhas.forEach((linha, i) => {
      const base = y + bloco.tamanho * 0.82 + i * bloco.entrelinha;
      textos.push(
        `<text x="${M}" y="${base.toFixed(1)}" fill="${bloco.cor}" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="${bloco.tamanho}" letter-spacing="${
          bloco.tamanho === 27 ? 4 : 0
        }">${escapar(linha)}</text>`
      );
    });
    y += bloco.linhas.length * bloco.entrelinha;
  }

  const rodape = cartaz.data ? `${escapar(cartaz.data)} · inuka.ao` : "inuka.ao";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}" viewBox="0 0 ${L} ${A}">
  <defs>
    <linearGradient id="fundo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#151515"/>
      <stop offset="1" stop-color="#080808"/>
    </linearGradient>
  </defs>
  <rect width="${L}" height="${A}" fill="url(#fundo)"/>
  <rect x="0" y="0" width="${L}" height="10" fill="#C9A962"/>
  <text x="${M}" y="140" fill="#C9A962" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="30" letter-spacing="10">INUKA</text>
  <rect x="${M}" y="172" width="70" height="2" fill="#3A3A3A"/>
  ${textos.join("\n  ")}
  <rect x="${M}" y="${A - 120}" width="${util}" height="1" fill="#242424"/>
  <text x="${M}" y="${A - 78}" fill="#6F6F6F" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="26">${rodape}</text>
</svg>`;

  return sharp(Buffer.from(svg), { density: 144 })
    .png({ compressionLevel: 9, effort: 8 })
    .toBuffer();
}

/**
 * Quebra o texto em linhas que cabem na largura dada.
 *
 * Respeita as quebras que a pessoa escreveu (parágrafos) e corta por palavras.
 * Quando passa do número de linhas permitido, a última acaba em «…» em vez de
 * desaparecer sem aviso.
 */
function quebrar(texto: string, largura: number, tamanho: number, maxLinhas: number): string[] {
  const porLinha = Math.max(8, Math.floor(largura / (tamanho * 0.55)));
  const linhas: string[] = [];

  for (const paragrafo of String(texto).split(/\r?\n/)) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);

    // Linha vazia no original = espaço entre parágrafos, não um parágrafo
    // colado ao seguinte (era o que acontecia ao filtrar as linhas vazias).
    if (palavras.length === 0) {
      if (linhas.length > 0 && linhas[linhas.length - 1] !== "") linhas.push("");
      continue;
    }

    let atual = "";
    for (const palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (tentativa.length <= porLinha) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      atual = palavra.length > porLinha ? `${palavra.slice(0, porLinha - 1)}…` : palavra;
    }
    if (atual) linhas.push(atual);
  }

  if (linhas.length === 0) linhas.push("");

  if (linhas.length <= maxLinhas) return linhas;

  const cortadas = linhas.slice(0, maxLinhas);
  const ultima = cortadas[maxLinhas - 1];
  cortadas[maxLinhas - 1] = `${ultima.slice(0, Math.max(1, porLinha - 1)).trimEnd()}…`;
  return cortadas;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
