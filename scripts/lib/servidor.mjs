/**
 * Garante que a app web está a responder em `INUKA_WEB_API` (por omissão
 * http://localhost:3000) antes de correr testes que passam por `/api/*`.
 *
 * Porquê isto existe: o registo de contas dos testes vai a `/api/auth/registo`
 * do próprio Next. Sem servidor, os testes falhavam com 30-40 "fetch failed"
 * que escondiam a causa real. Antes pedíamos ao utilizador que abrisse outro
 * terminal; agora arrancamos o servidor, esperamos que responda e fechamo-lo
 * no fim. Se já houver um servidor a correr (o do utilizador), **não lhe
 * tocamos** — apenas usamos.
 *
 * Regras:
 *  - só matamos o processo que nós próprios arrancámos;
 *  - no Windows matamos a árvore (`taskkill /T`) porque `next dev` é neto;
 *  - se o servidor não responder a tempo, despejamos as últimas linhas do log.
 */

import { spawn, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const APP = process.env.INUKA_WEB_API ?? "http://localhost:3000";

let filho = null;
let linhas = [];
let encerrado = false;
let handlersLigados = false;

function memorizar(chunk) {
  for (const l of String(chunk).split(/\r?\n/)) {
    if (l.trim()) linhas.push(l.trimEnd());
  }
  if (linhas.length > 40) linhas = linhas.slice(-40);
}

function log() {
  return linhas.length ? `\n--- últimas linhas de \`npm run dev\` ---\n${linhas.join("\n")}` : "";
}

/** Um pedido HTTP ao servidor. `true` se respondeu (mesmo com erro 5xx). */
async function responde(timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`${APP}/`, { signal: ctrl.signal, headers: { Connection: "close" } });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Fecha o servidor **só** se foi este módulo a arrancá-lo. */
export function pararServidor() {
  if (!filho || encerrado) return;
  encerrado = true;
  const pid = filho.pid;
  filho = null;
  try {
    if (process.platform === "win32") {
      // `next dev` corre dentro de `npm`, que corre dentro de `cmd`: sem /T
      // ficaria um órfão a segurar a porta 3000.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch {
    /* o processo já não existe — nada a fazer */
  }
}

function ligarHandlers() {
  if (handlersLigados) return;
  handlersLigados = true;
  process.on("exit", pararServidor);
  for (const sinal of ["SIGINT", "SIGTERM"]) {
    process.on(sinal, () => {
      pararServidor();
      process.exit(sinal === "SIGINT" ? 130 : 143);
    });
  }
}

/**
 * Devolve `{ iniciado }`. Se já houver servidor, `iniciado` é `false` e o
 * processo não é nosso — `pararServidor()` não lhe faz nada.
 */
export async function garantirServidor({ timeoutMs = 180_000, silencioso = false } = {}) {
  if (await responde(1500)) {
    if (!silencioso) console.log(`Servidor já a responder em ${APP}.`);
    return { iniciado: false };
  }

  if (!silencioso) {
    console.log(`Servidor ausente em ${APP} — a arrancar \`npm run dev\`…`);
  }

  filho = spawn("npm run dev", [], {
    cwd: ROOT,
    shell: true,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  filho.stdout?.on("data", memorizar);
  filho.stderr?.on("data", memorizar);
  ligarHandlers();

  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (filho && filho.exitCode !== null) {
      const codigo = filho.exitCode;
      pararServidor();
      throw new Error(`\`npm run dev\` terminou sozinho (código ${codigo}).${log()}`);
    }
    if (await responde()) {
      const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
      if (!silencioso) console.log(`Servidor pronto em ${segundos}s.`);
      return { iniciado: true };
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  pararServidor();
  throw new Error(
    `O servidor não respondeu em ${Math.round(timeoutMs / 1000)}s.${log()}\n` +
      `Arranque \`npm run dev` +
      `\` manualmente para ver o erro completo.`
  );
}
