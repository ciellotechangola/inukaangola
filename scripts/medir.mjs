/**
 * Diagnóstico de largura: que elementos passam da viewport?
 * Uso: node scripts/medir.mjs <email> <url> <largura>
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [, , email, url, largura = "390"] = process.argv;

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
const valor = "base64-" + Buffer.from(JSON.stringify(v)).toString("base64url");

const proc = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9334",
    `--user-data-dir=${path.join(process.cwd(), ".chrome-medir")}`,
    "--no-first-run",
    "--hide-scrollbars",
    "--disable-gpu",
    `--window-size=${largura},900`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

let alvo;
for (let i = 0; i < 60; i++) {
  try {
    const lista = await fetch("http://127.0.0.1:9334/json/list").then((r) => r.json());
    alvo = lista.find((t) => t.type === "page");
    if (alvo) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let seq = 0;
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", on);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", on);
    setTimeout(() => reject(new Error(method + " timeout")), 40000);
  });
}

await cdp("Network.enable");
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", {
  width: Number(largura),
  height: 900,
  deviceScaleFactor: 1,
  mobile: Number(largura) < 500,
});
await cdp("Network.clearBrowserCookies");
await cdp("Network.setCookie", {
  name: COOKIE,
  value: valor,
  domain: "localhost",
  path: "/",
  secure: false,
});
await cdp("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 7000));

const { result } = await cdp("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const vw = document.documentElement.clientWidth;
    const largos = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        largos.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 90), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
      }
    });
    return { vw, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, n: largos.length, largos: largos.slice(0, 14) };
  })()`,
});

console.log(JSON.stringify(result.value, null, 1));
ws.close();
proc.kill();
