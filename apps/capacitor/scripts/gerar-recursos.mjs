// Gera os recursos nativos do iOS (ícone e ecrã de arranque) no formato que o
// `@capacitor/assets` consome.
//
//   node scripts/gerar-recursos.mjs
//
// Depois, no Mac:  npx @capacitor/assets generate --ios
//
// O desenho em si vive em `apps/web/scripts/lib/marca.mjs` — o mesmo código que
// produz os ícones do site e do Android. Antes havia duas cópias e as duas
// escalavam o ficheiro inteiro, com as margens pretas incluídas: a marca
// acabava a ~40% do ícone. Aqui a marca é recortada primeiro.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ORIGEM, icone, arranque } from "../../web/scripts/lib/marca.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");

await mkdir(resolve(RAIZ, "assets"), { recursive: true });
await mkdir(resolve(RAIZ, "www"), { recursive: true });

/**
 * Ícone da app: quadrado, sem transparência (o iOS recusa alfa no ícone).
 *
 * 0,80 do lado é o ponto em que a assinatura "INUKA / ALWAYS WITH YOU" se lê ao
 * tamanho de um ícone no ecrã principal e continua a caber depois de o iOS
 * aplicar a máscara de cantos redondos.
 */
await icone(1024, 0.8, { saida: resolve(RAIZ, "assets/icon-only.png") });

/**
 * Ecrã de arranque. O `@capacitor/assets` recorta o centro deste quadrado para
 * cada tamanho de iPhone, por isso a marca tem de ficar pequena: num ecrã
 * estreito, o recorte é mais apertado do que parece.
 */
for (const ficheiro of ["assets/splash.png", "assets/splash-dark.png"]) {
  await arranque(2732, 2732, resolve(RAIZ, ficheiro), 0.2);
}

// A página offline é servida de dentro do pacote da app: o logótipo tem de
// viajar com ela, senão fica um quadrado vazio quando não há rede.
await copyFile(ORIGEM, resolve(RAIZ, "www/logo-inuka.png"));
console.log("www/logo-inuka.png");
