/**
 * `npm run test:all` — corre todas as suites pela ordem certa, com **um** único
 * servidor web arrancado no início e fechado no fim.
 *
 * Antes: `npm run test:sql && npm run test:live && …`. Cada suite que precisa
 * do servidor falhava se o utilizador não o tivesse arrancado noutro terminal.
 * Agora o servidor é gerido aqui; as suites filhas recebem
 * `INUKA_SERVIDOR_EXTERNO=1` para não o arrancarem/fecharem outra vez.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { garantirServidor, pararServidor, APP } from "./lib/servidor.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Ordem importa: o SQL é local, o designer só fala com o Supabase. */
const SUITES = [
  { script: "test:sql", precisaServidor: false },
  { script: "test:live", precisaServidor: true },
  { script: "test:crud", precisaServidor: true },
  { script: "test:web", precisaServidor: true },
  { script: "test:designer", precisaServidor: false },
];

function correr(script) {
  return new Promise((res) => {
    const p = spawn("npm", ["run", script], {
      cwd: ROOT,
      shell: true,
      stdio: "inherit",
      env: { ...process.env, INUKA_SERVIDOR_EXTERNO: "1", INUKA_WEB_API: APP },
    });
    p.on("error", () => res(1));
    p.on("exit", (c, sinal) => res(c ?? (sinal ? 1 : 0)));
  });
}

const resultados = [];
let servidorArrancado = false;

for (const { script, precisaServidor } of SUITES) {
  if (precisaServidor && !servidorArrancado) {
    try {
      const { iniciado } = await garantirServidor();
      servidorArrancado = iniciado;
    } catch (e) {
      console.error(`\n${e.message}\n`);
      process.exit(2);
    }
  }

  const inicio = Date.now();
  const codigo = await correr(script);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  resultados.push({ script, codigo, segundos });

  if (codigo !== 0) break;
}

pararServidor();

console.log("\n" + "=".repeat(64));
console.log("RESUMO FINAL");
console.log("=".repeat(64));
for (const { script, codigo, segundos } of resultados) {
  const estado = codigo === 0 ? "OK  " : `FALHA (código ${codigo})`;
  console.log(`  ${script.padEnd(16)} ${estado}  ${segundos}s`);
}
const saltadas = SUITES.slice(resultados.length).map((s) => s.script);
if (saltadas.length) console.log(`  não corridas: ${saltadas.join(", ")}`);

const falhou = resultados.find((r) => r.codigo !== 0);
console.log("=".repeat(64));
if (falhou) {
  console.log(`\nParou em \`npm run ${falhou.script}\`. Corrija-se a causa e repita.\n`);
} else {
  console.log("\nTudo verde.\n");
}
process.exit(falhou ? 1 : 0);
