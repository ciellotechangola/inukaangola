/**
 * Tirar fotografias a uma página autenticada, sem browser automation instalado.
 *
 * Passos: sessão real (magiclink do admin → verify), cookie `sb-…-auth-token`
 * montado à mão, Chrome headless com CDP, `Page.captureScreenshot`.
 *
 * Uso:  node scripts/foto.mjs <caminho> <url> <largura> <altura> <ficheiro>
 *   ex.: node scripts/foto.mjs gerente@inuka.ao http://localhost:3000/gerente/vendas 1440 1400 out.png
 */
import fs from "node:fs";
import path from "node:path";

const [, , email, url, largura = "1440", altura = "1400", saida = "foto.png"] = process.argv;

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), "apps/web/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(BASE).host.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;

async function sessao() {
  const link = await fetch(`${BASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  }).then((r) => r.json());

  const v = await fetch(`${BASE}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
  }).then((r) => r.json());

  if (!v.access_token) throw new Error(`sem sessão: ${JSON.stringify(v)}`);
  return v;
}

async function cdp(ws, metodo, params = {}) {
  const id = Math.floor(Math.random() * 1e6);
  ws.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMsg);
      msg.error ? reject(new Error(`${metodo}: ${msg.error.message}`)) : resolve(msg.result);
    };
    ws.addEventListener("message", onMsg);
    setTimeout(() => reject(new Error(`${metodo}: tempo esgotado`)), 120000);
  });
}

const s = await sessao();
const valor = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64url");

const chrome = "/c/Program Files/Google/Chrome/Application/chrome.exe";
const perfil = path.join(process.cwd(), ".chrome-foto");
const { spawn } = await import("node:child_process");
const proc = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9333",
    `--user-data-dir=${perfil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--disable-gpu",
    `--window-size=${largura},${altura}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: false }
);
void chrome;

let alvo;
for (let i = 0; i < 60; i++) {
  try {
    const lista = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json());
    alvo = lista.find((t) => t.type === "page");
    if (alvo) break;
  } catch {
    /* ainda a arrancar */
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!alvo) {
  proc.kill();
  throw new Error("Chrome não abriu a porta de depuração");
}

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

await cdp(ws, "Network.enable");
await cdp(ws, "Page.enable");
await cdp(ws, "Emulation.setDeviceMetricsOverride", {
  width: Number(largura),
  height: Number(altura),
  deviceScaleFactor: Number(process.env.DSF || 2),
  mobile: Number(largura) < 500,
});
await cdp(ws, "Network.clearBrowserCookies");
await cdp(ws, "Network.setCookie", {
  name: COOKIE,
  value: valor,
  domain: "localhost",
  path: "/",
  httpOnly: false,
  secure: false,
});

await cdp(ws, "Page.navigate", { url });
await new Promise((r) => setTimeout(r, 6000));

// Uma segunda passagem: as fontes e as imagens chegam depois do primeiro HTML.
await cdp(ws, "Page.reload");
await new Promise((r) => setTimeout(r, 6000));

if (process.env.ANTES) {
  await cdp(ws, "Runtime.evaluate", { expression: process.env.ANTES });
  await new Promise((r) => setTimeout(r, 2500));
}

const { data } = await cdp(ws, "Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: !process.env.SO_VISTA,
});
fs.writeFileSync(saida, Buffer.from(data, "base64"));
console.log(`guardado: ${saida}`);

ws.close();
proc.kill();
