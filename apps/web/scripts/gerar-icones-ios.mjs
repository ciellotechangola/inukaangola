// Gera os ícones e ecrãs de arranque do iOS a partir do logótipo.
// Correr de dentro de apps/web:  node scripts/gerar-icones-ios.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const ORIGEM = "public/logo-inuka.png";

// O logótipo não é transparente: traz o seu próprio fundo. Se usarmos um
// preto diferente do dele, aparece uma costura quadrada à volta da marca.
// Amostramos o canto superior esquerdo e usamos essa cor como tela.
const canto = await sharp(ORIGEM)
  .extract({ left: 0, top: 0, width: 1, height: 1 })
  .raw()
  .toBuffer();
const FUNDO = { r: canto[0], g: canto[1], b: canto[2] };
console.log(`fundo do logótipo: rgb(${FUNDO.r}, ${FUNDO.g}, ${FUNDO.b})`);

async function icone(lado, saida, ocupacao = 0.62) {
  const alvo = Math.round(lado * ocupacao);
  const marca = await sharp(ORIGEM)
    .resize(alvo, alvo, { fit: "contain", background: { r: 10, g: 10, b: 10, alpha: 0 } })
    .toBuffer();

  await sharp({ create: { width: lado, height: lado, channels: 3, background: FUNDO } })
    .composite([{ input: marca, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(saida);

  console.log(`${saida}  ${lado}x${lado}`);
}

async function arranque(largura, altura, saida) {
  const marca = await sharp(ORIGEM)
    .resize(Math.round(largura * 0.34), null, { fit: "inside" })
    .toBuffer();

  await sharp({ create: { width: largura, height: altura, channels: 3, background: FUNDO } })
    .composite([{ input: marca, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(saida);

  console.log(`${saida}  ${largura}x${altura}`);
}

await mkdir("public/ios", { recursive: true });

// iOS ignora os ícones do manifest: o que conta é o apple-touch-icon.
// 180x180 é o tamanho que o iPhone usa; o iPad usa 167.
await icone(180, "public/apple-touch-icon.png");
await icone(167, "public/ios/icon-167.png");
await icone(192, "public/ios/icon-192.png");
await icone(512, "public/ios/icon-512.png");
await icone(1024, "public/ios/icon-1024.png", 0.58);

// Ecrãs de arranque — um por cada proporção de iPhone em uso.
// Sem isto o iPhone mostra um flash branco antes da app aparecer.
const ecras = [
  [828, 1792, "splash-828x1792.png"],   // iPhone XR, 11 (6.1" @2x)
  [1170, 2532, "splash-1170x2532.png"], // 12, 13, 14 (6.1" @3x)
  [1125, 2436, "splash-1125x2436.png"], // X, XS, 11 Pro, 12/13 mini
  [1242, 2688, "splash-1242x2688.png"], // XS Max, 11 Pro Max
  [1179, 2556, "splash-1179x2556.png"], // 14 Pro, 15, 16
  [1206, 2622, "splash-1206x2622.png"], // 16 Pro
  [1290, 2796, "splash-1290x2796.png"], // 14/15/16 Pro Max
];
for (const [l, a, nome] of ecras) await arranque(l, a, `public/ios/${nome}`);
