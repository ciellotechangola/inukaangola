// Ajustes ao Info.plist depois de `npx cap add ios`.
//
//   node scripts/pos-add.mjs
//
// O projecto Xcode que o Capacitor gera serve para qualquer app. Estes são os
// valores que a INUKA precisa e que, sem isto, teriam de ser mudados à mão no
// Xcode — fáceis de esquecer e de perder no `cap sync` seguinte.
//
// Usa `plutil`, que vem com o macOS. Não editamos o XML à mão: um plist mal
// formado impede o Xcode de abrir o projecto.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLIST = resolve(RAIZ, "ios/App/App/Info.plist");

if (process.platform !== "darwin") {
  console.error(
    "Este passo corre no macOS: o projecto iOS só existe depois de `npx cap add ios`,\n" +
      "e o Capacitor recusa criar a plataforma iOS fora de um Mac.",
  );
  process.exit(1);
}

if (!existsSync(PLIST)) {
  console.error(`Não encontrei ${PLIST}.\nCorre primeiro:  npx cap add ios`);
  process.exit(1);
}

/** `plutil -replace` falha se a chave não existir; `-insert` falha se existir. */
function definir(chave, tipo, valor) {
  const tipoFlag = tipo === "bool" ? "-bool" : tipo === "int" ? "-integer" : "-string";
  try {
    execFileSync("plutil", ["-replace", chave, tipoFlag, String(valor), PLIST]);
    console.log(`actualizado  ${chave} = ${valor}`);
  } catch {
    execFileSync("plutil", ["-insert", chave, tipoFlag, String(valor), PLIST]);
    console.log(`inserido     ${chave} = ${valor}`);
  }
}

/** Apaga uma chave se existir — `-remove` rebenta quando ela não está lá. */
function apagar(chave) {
  try {
    execFileSync("plutil", ["-remove", chave, PLIST]);
    console.log(`removido     ${chave}`);
  } catch {
    /* não existia: nada a fazer */
  }
}

// Nome debaixo do ícone. Sem isto aparece "App" ou "INUKA App".
definir("CFBundleDisplayName", "string", "INUKA");
definir("CFBundleName", "string", "INUKA");

// A loja e a área de gestão foram desenhadas na vertical. Rodar para horizontal
// parte as tabelas e as barras inferiores.
apagar("UISupportedInterfaceOrientations");
execFileSync("plutil", [
  "-insert",
  "UISupportedInterfaceOrientations",
  "-json",
  '["UIInterfaceOrientationPortrait"]',
  PLIST,
]);
console.log("inserido     UISupportedInterfaceOrientations = [retrato]");
apagar("UISupportedInterfaceOrientations~ipad");

// Texto claro na barra de estado, sobre o fundo preto. O Capacitor também o
// define em tempo de execução, mas isto evita o flash escuro-sobre-escuro
// durante o arranque.
definir("UIStatusBarStyle", "string", "UIStatusBarStyleLightContent");
definir("UIViewControllerBasedStatusBarAppearance", "bool", "false");
definir("UIStatusBarHidden", "bool", "false");

// Sem esta chave o App Store Connect pergunta, em cada envio, se a app usa
// cifra não isenta. Não usa — tudo passa por HTTPS/TLS do sistema.
definir("ITSAppUsesNonExemptEncryption", "bool", "false");

// O WKWebView precisa de saber que o domínio da INUKA é confiável para
// partilhar cookies com o servidor (sessão Supabase).
definir("WKAppBoundDomains", "json", '["inuka-angola.apps.workbuddy.host"]');

console.log("\nInfo.plist pronto.");
