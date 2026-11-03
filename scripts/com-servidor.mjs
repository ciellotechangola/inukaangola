/**
 * Corre um ficheiro de teste garantindo que o servidor web está de pé.
 *
 *   node scripts/com-servidor.mjs supabase/tests/live.test.mjs
 *
 * Se já houver um servidor a responder (por exemplo o `npm run dev` do
 * utilizador), usa-se esse e não se mata nada no fim. Se `test-all.mjs` já o
 * arrancou, `INUKA_SERVIDOR_EXTERNO=1` faz este wrapper só correr o teste.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { garantirServidor, pararServidor } from "./lib/servidor.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const alvo = process.argv[2];

if (!alvo) {
  console.error("uso: node scripts/com-servidor.mjs <ficheiro-de-teste.mjs>");
  process.exit(2);
}

const externo = process.env.INUKA_SERVIDOR_EXTERNO === "1";

if (!externo) {
  try {
    await garantirServidor();
  } catch (e) {
    console.error(`\n${e.message}\n`);
    process.exit(2);
  }
}

const codigo = await new Promise((res) => {
  const p = spawn(process.execPath, [resolve(ROOT, alvo)], { stdio: "inherit", env: process.env });
  p.on("error", (e) => {
    console.error(`Não foi possível lançar o teste: ${e.message}`);
    res(1);
  });
  p.on("exit", (c, sinal) => res(c ?? (sinal ? 1 : 0)));
});

if (!externo) pararServidor();
process.exit(codigo);
