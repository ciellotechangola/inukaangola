// Gera TODOS os ícones da marca INUKA a partir do logótipo original:
// site (PWA + favicon), app Android (mipmaps + ícone adaptativo) e shell iOS.
//
//   cd apps/web && node scripts/gerar-icones.mjs
//
// Porquê um script só: o mesmo desenho tem de aparecer igual no browser, no
// ecrã principal do iPhone e no launcher do Android. Antes havia dois geradores
// separados e o Android nunca foi feito — o APK saía com o ícone azul do
// Flutter.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FUNDO, FUNDO_HEX, arranque, icone } from "./lib/marca.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(AQUI, "../public");
const APP = resolve(AQUI, "../src/app");
const ANDROID = resolve(AQUI, "../../mobile/android/app/src/main/res");

await mkdir(resolve(PUBLIC, "ios"), { recursive: true });

// ---------------------------------------------------------------------------
// 1. SITE — PWA e iOS
// ---------------------------------------------------------------------------
// O iOS ignora os ícones do manifest: o que conta é o apple-touch-icon.
// 180×180 é o tamanho que o iPhone usa; o iPad usa 167.
await icone(180, 0.8, { saida: resolve(PUBLIC, "apple-touch-icon.png") });
await icone(167, 0.8, { saida: resolve(PUBLIC, "ios/icon-167.png") });
await icone(192, 0.8, { saida: resolve(PUBLIC, "ios/icon-192.png") });
await icone(512, 0.8, { saida: resolve(PUBLIC, "ios/icon-512.png") });
await icone(1024, 0.8, { saida: resolve(PUBLIC, "ios/icon-1024.png") });

// `purpose: "maskable"` é outra coisa: o Android recorta o ícone a um círculo
// (ou à forma que o fabricante quiser) e só garante os 80% centrais. Reutilizar
// o ícone normal aqui cortava as pontas do "INUKA".
await icone(512, 0.58, { saida: resolve(PUBLIC, "ios/icon-maskable-512.png") });

// Ecrãs de arranque — um por cada proporção de iPhone em uso. Sem isto o
// iPhone mostra um flash branco antes da app aparecer.
const ecras = [
  [828, 1792, "splash-828x1792.png"], // iPhone XR, 11 (6.1" @2x)
  [1170, 2532, "splash-1170x2532.png"], // 12, 13, 14 (6.1" @3x)
  [1125, 2436, "splash-1125x2436.png"], // X, XS, 11 Pro, 12/13 mini
  [1242, 2688, "splash-1242x2688.png"], // XS Max, 11 Pro Max
  [1179, 2556, "splash-1179x2556.png"], // 14 Pro, 15, 16
  [1206, 2622, "splash-1206x2622.png"], // 16 Pro
  [1290, 2796, "splash-1290x2796.png"], // 14/15/16 Pro Max
];
for (const [l, a, nome] of ecras) {
  await arranque(l, a, resolve(PUBLIC, `ios/${nome}`));
}

// ---------------------------------------------------------------------------
// 2. FAVICON
// ---------------------------------------------------------------------------
// O `favicon.ico` que vinha do `create-next-app` é o símbolo do Next. Este
// ficheiro é lido pelo browser antes de qualquer <link>, por isso é o que
// aparece no separador.
async function ico() {
  const lados = [32, 48];
  const pngs = await Promise.all(lados.map((l) => icone(l, 0.86)));

  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = ícone
  cabecalho.writeUInt16LE(lados.length, 4);

  let deslocamento = 6 + 16 * lados.length;
  const entradas = [];
  for (let i = 0; i < lados.length; i++) {
    const e = Buffer.alloc(16);
    e.writeUInt8(lados[i] >= 256 ? 0 : lados[i], 0);
    e.writeUInt8(lados[i] >= 256 ? 0 : lados[i], 1);
    e.writeUInt8(0, 2); // paleta
    e.writeUInt8(0, 3); // reservado
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += pngs[i].length;
    entradas.push(e);
  }

  await writeFile(
    resolve(APP, "favicon.ico"),
    Buffer.concat([cabecalho, ...entradas, ...pngs]),
  );
  console.log(`src/app/favicon.ico  ${lados.join("+")} px`);
}
await ico();

// ---------------------------------------------------------------------------
// 3. ANDROID — launcher
// ---------------------------------------------------------------------------
// Duas famílias de ficheiros:
//  - `ic_launcher.png` (densidades clássicas) para Android 7 e anteriores;
//  - `ic_launcher_foreground.png` + XML adaptativo para Android 8+, onde o
//    sistema aplica a máscara que o fabricante quiser (círculo, squircle…).
//    Aqui a marca tem de caber nos 66% centrais, senão é cortada.
const DENSIDADES = [
  ["mipmap-mdpi", 48, 108],
  ["mipmap-hdpi", 72, 162],
  ["mipmap-xhdpi", 96, 216],
  ["mipmap-xxhdpi", 144, 324],
  ["mipmap-xxxhdpi", 192, 432],
];

for (const [pasta, lado, ladoAdaptativo] of DENSIDADES) {
  const destino = resolve(ANDROID, pasta);
  await mkdir(destino, { recursive: true });

  await icone(lado, 0.8, { saida: resolve(destino, "ic_launcher.png") });
  await icone(ladoAdaptativo, 0.6, {
    saida: resolve(destino, "ic_launcher_foreground.png"),
  });
}

// XML do ícone adaptativo. O fundo é a mesma cor do logótipo, para o quadrado
// opaco da marca não se notar contra a tela.
const ANYDPI = resolve(ANDROID, "mipmap-anydpi-v26");
await mkdir(ANYDPI, { recursive: true });
await writeFile(
  resolve(ANYDPI, "ic_launcher.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`,
);
console.log("mipmap-anydpi-v26/ic_launcher.xml");

const VALORES = resolve(ANDROID, "values");
await mkdir(VALORES, { recursive: true });
await writeFile(
  resolve(VALORES, "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${FUNDO_HEX}</color>
</resources>
`,
);
console.log(`values/ic_launcher_background.xml  ${FUNDO_HEX}`);

// ---------------------------------------------------------------------------
// 4. ARRANQUE DO ANDROID
// ---------------------------------------------------------------------------
// O template do Flutter pinta o arranque de BRANCO. Num telemóvel com tema
// escuro é um flash branco antes de a app aparecer — e nada a ver com a marca.
for (const pasta of ["drawable", "drawable-v21"]) {
  const ficheiro = resolve(ANDROID, pasta, "launch_background.xml");
  await writeFile(
    ficheiro,
    `<?xml version="1.0" encoding="utf-8"?>
<!-- Fundo de arranque da INUKA: preto da marca, sem flash branco. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <solid android:color="${FUNDO_HEX}" />
        </shape>
    </item>
</layer-list>
`,
  );
  console.log(`${pasta}/launch_background.xml  ${FUNDO_HEX}`);
}

console.log(`\nfundo: rgb(${FUNDO.r}, ${FUNDO.g}, ${FUNDO.b}) · ${FUNDO_HEX}`);
