// Gera os recursos nativos do iOS (ícone e ecrã de arranque) a partir do
// logótipo da marca, no formato que o `@capacitor/assets` consome.
//
//   node scripts/gerar-recursos.mjs
//
// Depois, no Mac:  npx @capacitor/assets generate --ios
//
// Não usamos o `@capacitor/assets` para desenhar: ele centra a imagem mas não
// sabe que o logótipo da INUKA já traz fundo próprio. Se a tela fosse de outro
// preto aparecia uma costura quadrada à volta da marca. Amostramos o canto do
// ficheiro e usamos exactamente essa cor.
import sharp from "sharp";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");
const ORIGEM = resolve(RAIZ, "../web/public/logo-inuka.png");

const canto = await sharp(ORIGEM)
  .extract({ left: 0, top: 0, width: 1, height: 1 })
  .raw()
  .toBuffer();
const FUNDO = { r: canto[0], g: canto[1], b: canto[2] };
console.log(`fundo do logótipo: rgb(${FUNDO.r}, ${FUNDO.g}, ${FUNDO.b})`);

await mkdir(resolve(RAIZ, "assets"), { recursive: true });
await mkdir(resolve(RAIZ, "www"), { recursive: true });

/**
 * Ícone da app: quadrado, sem transparência (o iOS recusa alfa no ícone).
 *
 * O logótipo é uma assinatura larga ("INUKA / ALWAYS WITH YOU"), não um símbolo
 * compacto. Com 0,58 do lado sobrava tanto preto que a marca desaparecia depois
 * de o iOS aplicar a máscara de cantos redondos. A 0,80 lê-se ao tamanho de um
 * ícone no ecrã principal e continua a caber sem cortes.
 */
const LADO = 1024;
const marcaIcone = await sharp(ORIGEM)
  .resize(Math.round(LADO * 0.8), Math.round(LADO * 0.8), { fit: "contain" })
  .toBuffer();

await sharp({ create: { width: LADO, height: LADO, channels: 3, background: FUNDO } })
  .composite([{ input: marcaIcone, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(RAIZ, "assets/icon-only.png"));
console.log(`assets/icon-only.png  ${LADO}x${LADO}`);

/**
 * Ecrã de arranque. O `@capacitor/assets` recorta o centro deste quadrado para
 * cada tamanho de iPhone, por isso a marca tem de ficar pequena: num ecrã
 * estreito, o recorte é mais apertado do que parece.
 */
const SPLASH = 2732;
const marcaSplash = await sharp(ORIGEM)
  .resize(Math.round(SPLASH * 0.20), null, { fit: "inside" })
  .toBuffer();

for (const [ficheiro, cor] of [
  ["assets/splash.png", FUNDO],
  ["assets/splash-dark.png", FUNDO],
]) {
  await sharp({ create: { width: SPLASH, height: SPLASH, channels: 3, background: cor } })
    .composite([{ input: marcaSplash, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(resolve(RAIZ, ficheiro));
  console.log(`${ficheiro}  ${SPLASH}x${SPLASH}`);
}

// A página offline é servida de dentro do pacote da app: o logótipo tem de
// viajar com ela, senão fica um quadrado vazio quando não há rede.
await copyFile(ORIGEM, resolve(RAIZ, "www/logo-inuka.png"));
console.log("www/logo-inuka.png");
