// Utilitário partilhado para desenhar a marca INUKA.
//
// Existe porque três sítios diferentes precisam do mesmo ícone: o site (PWA e
// favicon), a app Android (mipmaps + ícone adaptativo) e o shell iOS. Antes
// cada um tinha a sua cópia da lógica e todos partilhavam o mesmo defeito.
//
// O DEFEITO: `assets/logo-inuka.png` é um quadrado de 375×375 com a assinatura
// ao centro e muito preto à volta. Redimensionar o ficheiro inteiro para 60–80%
// do ícone punha a marca a ocupar ~40% — no ecrã principal do telemóvel lia-se
// mal. A correcção é recortar primeiro as margens (`trim`) e só depois escalar.
import sharp from "sharp";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Fonte única da verdade: o logótipo original da INUKA Angola. */
export const ORIGEM = resolve(AQUI, "../../../../assets/logo-inuka.png");

// O logótipo não é transparente: traz o seu próprio fundo. Se usarmos um preto
// diferente do dele, aparece uma costura quadrada à volta da marca.
const canto = await sharp(ORIGEM)
  .extract({ left: 0, top: 0, width: 1, height: 1 })
  .raw()
  .toBuffer();

export const FUNDO = { r: canto[0], g: canto[1], b: canto[2] };

/** `#rrggbb` do fundo, para o XML do ícone adaptativo do Android. */
export const FUNDO_HEX =
  "#" +
  [canto[0], canto[1], canto[2]]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

let _recortada = null;

/** O logótipo sem as margens pretas. Calculado uma vez por execução. */
export async function marca() {
  if (!_recortada) {
    _recortada = await sharp(ORIGEM).trim({ threshold: 18 }).png().toBuffer();
    const m = await sharp(_recortada).metadata();
    console.log(`marca recortada: ${m.width}×${m.height} (de 375×375)`);
  }
  return _recortada;
}

/**
 * Ícone quadrado com a marca centrada.
 *
 * `ocupacao` é a fracção do lado que a marca pode ocupar **depois** do recorte.
 * 0,80 serve para ícones de ecrã (iOS/PWA); 0,60 é o limite seguro do ícone
 * adaptativo do Android, onde o sistema recorta a 66% com a máscara que quiser.
 */
export async function icone(lado, ocupacao, { saida, fundo = FUNDO } = {}) {
  const m = await marca();
  const alvo = Math.round(lado * ocupacao);

  const redimensionada = await sharp(m)
    .resize(alvo, alvo, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  const imagem = sharp({
    create: { width: lado, height: lado, channels: 3, background: fundo },
  }).composite([{ input: redimensionada, gravity: "center" }]);

  if (saida) {
    await imagem.png({ compressionLevel: 9 }).toFile(saida);
    console.log(`${saida}  ${lado}×${lado} (marca a ${Math.round(ocupacao * 100)}%)`);
  }

  return imagem.png().toBuffer();
}

/** Ecrã de arranque: fundo liso com a marca pequena ao centro. */
export async function arranque(largura, altura, saida, fraccao = 0.34) {
  const m = await marca();
  const alvo = Math.round(largura * fraccao);
  const marcaRedim = await sharp(m).resize(alvo, alvo, { fit: "inside" }).toBuffer();

  await sharp({ create: { width: largura, height: altura, channels: 3, background: FUNDO } })
    .composite([{ input: marcaRedim, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(saida);

  console.log(`${saida}  ${largura}×${altura}`);
}
