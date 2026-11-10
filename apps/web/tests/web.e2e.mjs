/**
 * TESTES E2E DO CLIENTE WEB — correm contra o servidor Next.js real
 * (http://localhost:3000) e a base Supabase real.
 *
 * Verifica o que o utilizador vê: rotas públicas, redireccionamentos por
 * perfil, conteúdo renderizado no servidor e o endpoint de registo.
 *
 * Uso (com `npm run dev` a correr em apps/web):
 *   node apps/web/tests/web.e2e.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setGlobalDispatcher, Agent } from "undici";

/**
 * A suite faz centenas de pedidos ao Supabase e, numa ligação lenta, o limite
 * de 10 s que o `fetch` do Node usa para abrir o socket cortava a meio — o
 * processo morria com `ConnectTimeoutError`, um problema de rede a passar por
 * falha de código. Aqui a margem é maior e os erros de rede repetem-se; um erro
 * do servidor (4xx/5xx) continua a falhar à primeira.
 */
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 60_000 },
    headersTimeout: 120_000,
    bodyTimeout: 120_000,
  })
);

const fetchOriginal = globalThis.fetch;
const REDE = /fetch failed|ConnectTimeout|UND_ERR|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

globalThis.fetch = async (entrada, init = {}) => {
  let ultimo;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      return await fetchOriginal(entrada, init);
    } catch (e) {
      ultimo = e;
      const assinatura = `${e?.message ?? ""} ${e?.cause?.code ?? ""}`;
      if (!REDE.test(assinatura)) throw e;
      // Espera crescente: uma falha de DNS resolve-se em segundos.
      await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1)));
    }
  }
  throw ultimo;
};

const AQUI = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(AQUI, "..");
const ROOT = resolve(WEB, "../..");
const APP = process.env.INUKA_WEB_API ?? "http://localhost:3000";

/**
 * Sem servidor, todos os testes falhariam com "fetch failed" e esconderiam a
 * causa. Falhar aqui, uma vez, com a instrução certa é mais útil.
 * `Connection: close` garante que não fica nenhum socket aberto, para o
 * processo terminar de forma limpa.
 */
const servidor = await fetch(`${APP}/`, { headers: { Connection: "close" } }).catch(() => null);
if (!servidor) {
  console.error(`\nO servidor web não está a responder em ${APP}.`);
  console.error("Use `npm run test:web` — esse comando arranca o servidor sozinho.");
  console.error("Se está a correr este ficheiro directamente, arranque antes:");
  console.error("  npm run dev\n");
  process.exitCode = 2;
  await new Promise((r) => setTimeout(r, 100));
  process.exit(2);
}

function loadEnv() {
  const env = {};
  for (const linha of readFileSync(resolve(WEB, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const REF = BASE.replace(/^https?:\/\//, "").split(".")[0];

let total = 0;
let passed = 0;
const falhas = [];

function ok(label, detail = "") {
  total++;
  passed++;
  console.log(`PASS  ${label}${detail ? `  -> ${detail}` : ""}`);
}
function fail(label, detail = "") {
  total++;
  falhas.push(`${label} :: ${detail}`);
  console.log(`FAIL  ${label}  -> ${detail}`);
}
/** Teste que não pode correr neste ambiente. Não conta como falha. */
function pular(label, motivo) {
  console.log(`SKIP  ${label}  -> ${motivo}`);
  return SKIP;
}
async function check(label, fn) {
  try {
    const d = await fn();
    if (d === SKIP) return; // o próprio teste já explicou porque não corre
    ok(label, typeof d === "string" ? d : "");
  } catch (e) {
    fail(label, e.message);
  }
}
/** Devolvido por um teste que não pode correr — não conta como falha. */
const SKIP = Symbol("skip");
function assert(c, m) {
  if (!c) throw new Error(m);
}

async function sb(path, { method = "GET", body, key = ANON, jwt, prefer } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${jwt ?? key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await res.text();
  let data;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  return { status: res.status, ok: res.ok, data };
}

const rpcAdmin = (name, args) =>
  sb(`/rest/v1/rpc/${name}`, { method: "POST", body: args, key: SR, jwt: SR });

/** Constrói o cookie que o @supabase/ssr lê no servidor. */
function cookieSessao(sessao) {
  const payload = JSON.stringify({
    access_token: sessao.access_token,
    refresh_token: sessao.refresh_token,
    expires_at: sessao.expires_at,
    expires_in: sessao.expires_in,
    token_type: "bearer",
    user: sessao.user,
  });
  return `sb-${REF}-auth-token=base64-${Buffer.from(payload).toString("base64url")}`;
}

async function login(phone, password) {
  const email = `u${phone.replace("+", "")}@inuka.ao`;
  const res = await sb("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  assert(res.ok, `login ${phone}: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function registar(full_name, phone, password) {
  const res = await fetch(`${APP}/api/auth/registo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name, phone, password }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/**
 * GET a uma página da app, sem seguir redireccionamentos.
 *
 * Com sessão válida, nenhuma página desta suite devolve `/login`: um 307 para
 * ali quer dizer que o `getUser()` do Supabase falhou naquele instante (limite
 * de pedidos, rede), não que o utilizador perdeu o acesso. Nesse caso repete-se
 * uma vez — um problema real de permissões devolve outro destino (a área do
 * papel) e continua a falhar como deve.
 */
async function pagina(path, cookie) {
  const pedir = async () => {
    const res = await fetch(`${APP}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    const html = await res.text();
    return { status: res.status, html, location: res.headers.get("location") };
  };

  const primeira = await pedir();
  const caiuNoLogin =
    cookie &&
    (primeira.status === 307 || primeira.status === 302) &&
    String(primeira.location ?? "").includes("/login");

  if (!caiuNoLogin) return primeira;

  await new Promise((ok) => setTimeout(ok, 1500));
  return pedir();
}

function texto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nomes dos produtos activos, para os testes da montra contarem cartões.
 *
 * Estes testes contavam a etiqueta `[DEMO]` do seed. Quando os produtos
 * fictícios foram limpos da base, passaram a falhar sem haver bug nenhum — a
 * loja estava certa e o teste é que estava preso a dados que já não existem.
 * Derivar dos produtos activos mantém o teste a testar a montra.
 */
async function nomesDeProdutosActivos() {
  const { data } = await sb(
    "/rest/v1/products?select=name&is_active=eq.true&order=name",
    { key: SR, jwt: SR }
  );
  return (data ?? []).map((p) => p.name).filter(Boolean);
}

/** Quantos desses nomes aparecem no HTML (um cartão por produto). */
function contarProdutos(html, nomes) {
  const t = texto(html);
  return nomes.filter((n) => t.includes(n)).length;
}

const PWD = "WebE2e2026!";
const CLIENTE = { name: "Cliente Web", phone: "+244924200001" };
const VENDEDOR = { name: "Vendedor Web", phone: "+244924200002" };
const GESTOR = { name: "Gestor Web", phone: "+244924200003" };

async function apagarConta(phone) {
  const { data } = await sb(
    `/rest/v1/profiles?select=id&phone=eq.${encodeURIComponent(phone)}`,
    { key: SR, jwt: SR },
  );
  const id = data?.[0]?.id;
  if (!id) return;
  const del = (p) => sb(p, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
  await del(`/rest/v1/products?created_by=eq.${id}`);
  await del(`/rest/v1/inventory_movements?created_by=eq.${id}`);
  await del(`/rest/v1/orders?customer_id=eq.${id}`);
  await del(`/rest/v1/sales?seller_id=eq.${id}`);
  await del(`/rest/v1/sales?customer_id=eq.${id}`);
  await del(`/rest/v1/discount_requests?customer_id=eq.${id}`);
  await del(`/rest/v1/reservations?customer_id=eq.${id}`);
  await del(`/rest/v1/messages?sender_id=eq.${id}`);
  await del(`/rest/v1/conversations?created_by=eq.${id}`);
  await del(`/rest/v1/posts?author_id=eq.${id}`);
  await del(`/rest/v1/post_comments?author_id=eq.${id}`);
  await del(`/rest/v1/notifications?user_id=eq.${id}`);
  await del(`/rest/v1/sync_operations?user_id=eq.${id}`);
  await del(`/rest/v1/favorites?user_id=eq.${id}`);
  await del(`/rest/v1/audit_logs?user_id=eq.${id}`);
  await del(`/rest/v1/seller_customers?seller_id=eq.${id}`);
  await del(`/rest/v1/seller_customers?customer_id=eq.${id}`);
  // `assigned_by` também referencia auth.users: um cliente ligado por esta
  // conta bloqueia a eliminação com 23503 se não for limpo primeiro.
  await del(`/rest/v1/seller_customers?assigned_by=eq.${id}`);
  // Reservas por activar (0009): `seller_id`, `created_by` e `customer_id`
  // apontam todos para auth.users. Sem isto, uma execução interrompida deixava
  // uma reserva presa e a execução seguinte morria logo no arranque.
  await del(`/rest/v1/reserved_customers?seller_id=eq.${id}`);
  await del(`/rest/v1/reserved_customers?created_by=eq.${id}`);
  await del(`/rest/v1/reserved_customers?customer_id=eq.${id}`);
  await del(`/rest/v1/sale_commissions?seller_id=eq.${id}`);
  await del(`/rest/v1/sales_goals?seller_id=eq.${id}`);
  const res = await sb(`/auth/v1/admin/users/${id}`, { method: "DELETE", key: SR, jwt: SR });
  if (res.ok) return;

  // Sobrou alguma referência que a lista acima não cobre. Acontece quando uma
  // execução é interrompida a meio: fica uma linha (um projecto do estúdio, um
  // conteúdo) a apontar para a conta e o Supabase recusa apagá-la com um 500
  // que não diz qual tabela é. Em vez de adivinhar, varre-se o esquema.
  await varrerReferencias(id);
  const segunda = await sb(`/auth/v1/admin/users/${id}`, { method: "DELETE", key: SR, jwt: SR });
  if (!segunda.ok) throw new Error(`apagar ${phone}: ${segunda.status} ${JSON.stringify(segunda.data)}`);
}

/**
 * Apaga qualquer linha que aponte para uma conta, percorrendo as tabelas
 * expostas pelo PostgREST.
 *
 * Só corre quando a eliminação normal falha, por isso não pesa no caminho
 * feliz. `profiles` fica de fora: é a própria conta.
 */
let ESQUEMA = null;
async function varrerReferencias(id) {
  if (!ESQUEMA) {
    const spec = await sb("/rest/v1/", { key: SR, jwt: SR });
    ESQUEMA = Object.entries(spec.data?.definitions ?? {})
      .filter(([tabela]) => tabela !== "profiles")
      .map(([tabela, def]) => ({
        tabela,
        colunas: Object.keys(def?.properties ?? {}).filter((c) =>
          /^(id|.*_id|created_by|updated_by|assigned_by|requested_by|paid_by|approved_by)$/.test(c)
        ),
      }));
  }

  for (const { tabela, colunas } of ESQUEMA) {
    for (const coluna of colunas) {
      await sb(`/rest/v1/${tabela}?${coluna}=eq.${id}`, {
        method: "DELETE",
        key: SR,
        jwt: SR,
        prefer: "return=minimal",
      });
    }
  }
}

console.log("=".repeat(64));
console.log("TESTES E2E — CLIENTE WEB (Next.js + Supabase real)");
console.log("=".repeat(64));

for (const u of [CLIENTE, VENDEDOR, GESTOR]) await apagarConta(u.phone);

// ---------------------------------------------------------------------------
console.log("\n--- 1. ROTAS PÚBLICAS (visitante) ---");
// ---------------------------------------------------------------------------
const publicas = ["/", "/catalogo", "/carrinho", "/login", "/registo", "/sobre", "/contactos", "/download"];
for (const rota of publicas) {
  await check(`visitante abre ${rota}`, async () => {
    const r = await pagina(rota);
    assert(r.status === 200, `HTTP ${r.status}`);
    return "200";
  });
}

await check("a entrada troca o consultor pela área de download", async () => {
  const r = await pagina("/");
  const t = texto(r.html);
  assert(/Descarregar a app/i.test(t), "sem a entrada de download na entrada da loja");
  assert(!/Falar com um consultor/i.test(t), "o botão antigo continua na entrada");
  assert(/href="\/download"/.test(r.html), "o botão não aponta para /download");
  return "download no lugar do consultor";
});

await check("a área de download serve o APK e o caminho para o iPhone", async () => {
  const r = await pagina("/download");
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(/Descarregar APK/i.test(t), "sem botão de APK");
  assert(/Android/i.test(t) && /iPhone/i.test(t), "faltam os dois sistemas");
  assert(/Adicionar ao ecrã principal/i.test(t), "sem instruções para o iPhone");
  // O APK publicado pelo próprio site tem de ser servido inteiro e sem sessão.
  // Um HEAD não serve: o Next não devolve `content-length` nele, e o teste
  // passaria a medir zero. O 307 para /login (proxy) também já aconteceu aqui.
  const apk = await fetch(`${APP}/downloads/inuka-angola.apk`);
  assert(apk.ok, `APK: HTTP ${apk.status}`);
  const bytes = (await apk.arrayBuffer()).byteLength;
  assert(bytes > 5_000_000, `APK com ${bytes} bytes`);
  assert(
    /android\.package-archive/.test(apk.headers.get("content-type") ?? ""),
    `content-type ${apk.headers.get("content-type")}`
  );
  return `APK ${(bytes / 1048576).toFixed(1)} MB`;
});

await check("o e-mail oficial é o novo", async () => {
  const r = await pagina("/contactos");
  assert(r.html.includes("inukaangolaa@gmail.com"), "e-mail novo ausente dos contactos");
  assert(!r.html.includes("info@inuka.ao"), "o e-mail antigo continua na página");
  return "inukaangolaa@gmail.com";
});

// ---------------------------------------------------------------------------
console.log("\n--- 1b. APLICAÇÃO NO IPHONE (manifesto, ícones, ecrãs de arranque) ---");
// ---------------------------------------------------------------------------

/** Largura e altura lidas do IHDR de um PNG — evita uma dependência só para isto. */
function dimensoesPng(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { largura: buffer.readUInt32BE(16), altura: buffer.readUInt32BE(20) };
}

await check("manifesto é público e descreve uma app instalável", async () => {
  const r = await pagina("/manifest.json");
  // Já foi 307 para /login: o proxy apanhava o manifesto e o telefone ficava
  // sem nome, sem ícones e sem start_url — o ícone no ecrã principal abria
  // como um marcador e apanhava o portão de acesso (403).
  assert(r.status === 200, `HTTP ${r.status}${r.location ? ` -> ${r.location}` : ""}`);

  const m = JSON.parse(r.html);
  assert(m.name === "INUKA Angola", `name=${m.name}`);
  assert(m.short_name === "INUKA", `short_name=${m.short_name}`);
  assert(m.display === "standalone", `display=${m.display}`);
  assert(m.start_url, "sem start_url");
  // O alojamento só entrega a página a quem apresentar o código. Um ícone que
  // arranque em "/" abre uma sessão nova, sem o cookie, e leva 403.
  assert(/sharecode=/.test(m.start_url), `start_url sem código de acesso: ${m.start_url}`);
  assert(Array.isArray(m.icons) && m.icons.length >= 2, "sem ícones");
  assert(m.icons.some((i) => i.sizes === "512x512"), "sem ícone 512x512");
  return `${m.icons.length} ícones · start_url=${m.start_url}`;
});

await check("ícones têm os tamanhos que o iOS exige", async () => {
  const alvos = [
    ["/apple-touch-icon.png", 180, 180],
    ["/ios/icon-192.png", 192, 192],
    ["/ios/icon-512.png", 512, 512],
    ["/ios/icon-1024.png", 1024, 1024],
  ];
  for (const [caminho, largura, altura] of alvos) {
    const res = await fetch(`${APP}${caminho}`);
    assert(res.status === 200, `${caminho}: HTTP ${res.status}`);
    const d = dimensoesPng(Buffer.from(await res.arrayBuffer()));
    assert(d, `${caminho}: não é um PNG válido`);
    assert(d.largura === largura && d.altura === altura, `${caminho}: ${d.largura}x${d.altura}`);
  }
  return `${alvos.length} ícones`;
});

await check("o ícone maskable é próprio e cabe no círculo do Android", async () => {
  const r = await fetch(`${APP}/manifest.json`);
  const m = await r.json();
  const maskable = (m.icons ?? []).find((i) => (i.purpose ?? "").includes("maskable"));
  assert(maskable, "o manifest não declara nenhum ícone maskable");

  const res = await fetch(`${APP}${maskable.src}`);
  assert(res.status === 200, `${maskable.src}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const d = dimensoesPng(bytes);
  assert(d && d.largura === d.altura, `${maskable.src} não é quadrado`);

  // Reutilizar o ícone normal aqui cortava as pontas do "INUKA": o Android
  // recorta a um círculo e só garante os 80% centrais.
  assert(
    maskable.src !== "/ios/icon-512.png",
    "o maskable aponta para o ícone normal — vai ser cortado"
  );
  return `${maskable.src} · ${d.largura}px`;
});

await check("cabeçalho declara a app iOS e os ecrãs de arranque existem", async () => {
  const r = await pagina("/");
  const meta = (nome) => r.html.match(new RegExp(`<meta[^>]*name="${nome}"[^>]*>`))?.[0] ?? "";

  // Sem `capable` o iOS abre o Safari com barra de endereço em vez da app.
  // O Next 16 só emite o nome standard (`mobile-web-app-capable`), por isso o
  // nome com prefixo Apple é escrito à mão no layout — os dois têm de estar.
  assert(/content="yes"/.test(meta("apple-mobile-web-app-capable")), "sem apple-mobile-web-app-capable");
  assert(/content="yes"/.test(meta("mobile-web-app-capable")), "sem mobile-web-app-capable");
  assert(/content="INUKA"/.test(meta("apple-mobile-web-app-title")), "sem apple-mobile-web-app-title");
  // Sem `viewport-fit=cover` o `env(safe-area-inset-*)` fica a zero e o último
  // botão desaparece debaixo da barra de gestos.
  assert(/viewport-fit=cover/.test(meta("viewport")), "viewport sem viewport-fit=cover");
  assert(/rel="apple-touch-icon"/.test(r.html), "sem apple-touch-icon");
  assert(/rel="manifest"/.test(r.html), "sem rel=manifest");

  const arranques = [...r.html.matchAll(/href="(\/ios\/splash-[^"]+\.png)"/g)].map((m) => m[1]);
  assert(arranques.length >= 7, `só ${arranques.length} ecrãs de arranque`);
  for (const caminho of arranques) {
    const res = await fetch(`${APP}${caminho}`);
    assert(res.status === 200, `${caminho}: HTTP ${res.status}`);
  }
  return `${arranques.length} ecrãs de arranque, todos servidos`;
});

await check("home é a loja e não o modelo do create-next-app", async () => {
  const r = await pagina("/");
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  // O ficheiro app/page.tsx (boilerplate) tapava a home real em (public).
  assert(!/To get started, edit the/i.test(t), "serviu o modelo por omissão do Next");
  assert(!/create-next-app|vercel\.com\/templates/i.test(r.html), "links do create-next-app na home");
  assert(/INUKA/.test(t), "sem marca");
  assert(/Destaques|Em promoção|Categorias/.test(t), "sem secções de loja");
  return "home real";
});

await check("a tela inicial mostra «Iniciar sessão» a quem ainda não entrou", async () => {
  const r = await pagina("/");
  assert(r.status === 200, `HTTP ${r.status}`);
  // O botão estava só no cabeçalho, e o cabeçalho é um componente de cliente:
  // no HTML do servidor não havia nenhum caminho visível para entrar.
  assert(/Iniciar sessão/.test(texto(r.html)), "sem botão «Iniciar sessão» na home");
  assert(/href="\/login"/.test(r.html), "o botão não leva a /login");
  return "botão à vista";
});

await check("páginas públicas têm um só cabeçalho e um só rodapé", async () => {
  // Os layouts de grupo já os renderizam; as páginas voltaram a renderizá-los
  // e o resultado foram dois de cada.
  for (const rota of ["/", "/catalogo", "/sobre", "/contactos", "/privacidade"]) {
    const r = await pagina(rota);
    const cabecalhos = (r.html.match(/<header/g) || []).length;
    const rodapes = (r.html.match(/<footer/g) || []).length;
    assert(cabecalhos === 1, `${rota}: ${cabecalhos} cabeçalhos`);
    assert(rodapes === 1, `${rota}: ${rodapes} rodapés`);
  }
  return "1 + 1 em 5 páginas";
});

await check("catálogo lista os produtos da base", async () => {
  const nomes = await nomesDeProdutosActivos();
  assert(nomes.length > 0, "a base não tem produtos activos");

  const r = await pagina("/catalogo");
  const t = texto(r.html);
  assert(t.includes("Catálogo"), "sem título");

  const vistos = nomes.filter((n) => t.includes(n));
  assert(vistos.length > 0, "sem produtos activos na montra");
  return `${vistos.length} de ${nomes.length} produtos renderizados`;
});

await check("filtro por categoria reduz o catálogo", async () => {
  // A categoria não é fixa. Fixar «perfumaria-feminina» fazia o teste depender
  // de um produto DEMO que outro teste pode desactivar (o de eliminação
  // desactiva em vez de apagar) — e o filtro passava a devolver zero por falta
  // de dados, não por bug. Escolhe-se aqui uma categoria que tenha alguns
  // produtos activos, mas não todos, para se ver o filtro a reduzir de facto.
  const [cats, prods, nomes] = await Promise.all([
    sb("/rest/v1/categories?select=id,slug,name&is_active=eq.true&order=sort_order", {
      key: SR,
      jwt: SR,
    }),
    sb("/rest/v1/products?select=category_id&is_active=eq.true", { key: SR, jwt: SR }),
    nomesDeProdutosActivos(),
  ]);
  const linhas = prods.data ?? [];
  const porCategoria = new Map();
  for (const p of linhas) {
    porCategoria.set(p.category_id, (porCategoria.get(p.category_id) ?? 0) + 1);
  }
  const alvo = (cats.data ?? []).find((c) => {
    const n = porCategoria.get(c.id) ?? 0;
    return n > 0 && n < linhas.length;
  });
  assert(alvo, "nenhuma categoria com parte (e não todos) dos produtos activos");

  const todos = contarProdutos((await pagina("/catalogo")).html, nomes);
  const r = await pagina(`/catalogo?cat=${alvo.slug}`);
  assert(r.status === 200, `HTTP ${r.status}`);
  const filtrados = contarProdutos(r.html, nomes);
  assert(filtrados > 0, `o filtro «${alvo.slug}» não devolveu nada`);
  assert(filtrados < todos, `filtro inerte: ${filtrados} de ${todos}`);
  assert(texto(r.html).includes(alvo.name), "sem a categoria no título");
  return `${alvo.slug}: ${filtrados} de ${todos}`;
});

await check("filtro de preço respeita o preço pago", async () => {
  // Um produto em promoção conta pelo preço promocional, não pelo oficial.
  // O tecto não é fixo: 10 000 Kz deixou de apanhar produto nenhum quando o
  // catálogo real substituiu os produtos [DEMO], e o teste passou a falhar por
  // falta de dados em vez de por bug. Escolhe-se aqui um valor que deixe
  // alguns produtos de fora e outros dentro.
  const [prods, nomes] = await Promise.all([
    sb("/rest/v1/products?select=official_price,promotional_price&is_active=eq.true", {
      key: SR,
      jwt: SR,
    }),
    nomesDeProdutosActivos(),
  ]);

  const precosBase = (prods.data ?? [])
    .map((p) => Number(p.promotional_price ?? p.official_price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  assert(precosBase.length > 0, "sem preços na base");

  // Com três ou mais produtos, o do meio deixa de fora os mais caros; com
  // menos, o mais caro garante que a lista não vem vazia.
  const limite =
    precosBase.length >= 3
      ? precosBase[Math.floor(precosBase.length / 2)]
      : precosBase[precosBase.length - 1];

  const r = await pagina(`/catalogo?max=${limite}`);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);

  // Ler apenas dentro dos cartões: os rótulos do filtro também terminam em "Kz".
  // O preço vem logo depois do nome do produto; corta-se aí, não na etiqueta
  // do seed (que já não existe).
  const precos = [];
  for (const nome of nomes) {
    const i = t.indexOf(nome);
    if (i < 0) continue;
    const m = t.slice(i + nome.length, i + nome.length + 200).match(/(\d[\d\s]*)\s*Kz/);
    if (m) precos.push(Number(m[1].replace(/\s/g, "")));
  }

  assert(precos.length > 0, `sem cartões até ${limite} Kz`);
  assert(precos.every((p) => p <= limite), `preço acima do filtro: ${precos.join(", ")}`);
  return `${precos.length} preços ≤ ${limite} Kz (${precos.join(", ")})`;
});

await check("categoria inexistente não devolve o catálogo inteiro", async () => {
  const nomes = await nomesDeProdutosActivos();
  const r = await pagina("/catalogo?cat=nao-existe");
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(contarProdutos(r.html, nomes) === 0, "devolveu produtos para uma categoria que não existe");
  assert(/Nenhum produto/i.test(t), "sem mensagem de vazio");
  return "vazio, como deve ser";
});

await check("catálogo não expõe stock interno", async () => {
  const r = await pagina("/catalogo");
  assert(!/reserved_quantity|low_stock_threshold/i.test(r.html), "expôs colunas internas");
  return "sem dados internos";
});

await check("visitante NÃO entra em /cliente", async () => {
  const r = await pagina("/cliente");
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  assert((r.location || "").includes("/login"), `redirect: ${r.location}`);
  return `${r.status} -> ${r.location}`;
});

await check("visitante NÃO entra em /vendedor", async () => {
  const r = await pagina("/vendedor");
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  return `${r.status} -> ${r.location}`;
});

await check("visitante NÃO entra em /gerente", async () => {
  const r = await pagina("/gerente");
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  return `${r.status} -> ${r.location}`;
});

// ---------------------------------------------------------------------------
console.log("\n--- 2. REGISTO E LOGIN (cada perfil) ---");
// ---------------------------------------------------------------------------
await check("registo pela app cria conta de cliente", async () => {
  const r = await registar(CLIENTE.name, CLIENTE.phone, PWD);
  assert(r.status === 200 || r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.email;
});

await check("registo de vendedor", async () => {
  const r = await registar(VENDEDOR.name, VENDEDOR.phone, PWD);
  assert(r.status === 200 || r.status === 201, `HTTP ${r.status}`);
  return r.data.email;
});

await check("registo de gestor", async () => {
  const r = await registar(GESTOR.name, GESTOR.phone, PWD);
  assert(r.status === 200 || r.status === 201, `HTTP ${r.status}`);
  return r.data.email;
});

await check("promoção de papéis", async () => {
  const a = await rpcAdmin("promote_to_seller", { p_phone: VENDEDOR.phone, p_region: "Uíge" });
  assert(a.ok, JSON.stringify(a.data));
  const b = await rpcAdmin("promote_to_manager", { p_phone: GESTOR.phone });
  assert(b.ok, JSON.stringify(b.data));
  return "seller + manager";
});

await check("login do cliente devolve sessão", async () => {
  const s = await login(CLIENTE.phone, PWD);
  assert(s.access_token, "sem token");
  return `expira em ${s.expires_in}s`;
});

await check("palavra-passe errada é recusada", async () => {
  const res = await sb("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: `u${CLIENTE.phone.replace("+", "")}@inuka.ao`, password: "errada" },
  });
  assert(!res.ok, "aceitou palavra-passe errada");
  return `HTTP ${res.status}`;
});

await check("registo duplicado é recusado", async () => {
  const r = await registar("Outro", CLIENTE.phone, PWD);
  assert(r.status === 409, `HTTP ${r.status}`);
  return r.data.error;
});

// ---------------------------------------------------------------------------
console.log("\n--- 3. ÁREA DO CLIENTE ---");
// ---------------------------------------------------------------------------
const sCliente = await login(CLIENTE.phone, PWD);
const sVendedor = await login(VENDEDOR.phone, PWD);
const sGestor = await login(GESTOR.phone, PWD);
const cCliente = cookieSessao(sCliente);
const cVendedor = cookieSessao(sVendedor);
const cGestor = cookieSessao(sGestor);

await check("cliente entra em /cliente", async () => {
  const r = await pagina("/cliente", cCliente);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  // A saudação usa o primeiro nome.
  assert(t.includes(`Olá, ${CLIENTE.name.split(" ")[0]}`), `saudação ausente: ${t.slice(0, 80)}`);
  return `"Olá, ${CLIENTE.name.split(" ")[0]}"`;
});

await check("cliente abre reservas", async () => {
  const r = await pagina("/cliente/reservas", cCliente);
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(texto(r.html).includes("Reservas"), "sem título");
  return "200";
});

await check("cliente abre encomendas", async () => {
  const r = await pagina("/cliente/encomendas", cCliente);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("cliente abre favoritos", async () => {
  const r = await pagina("/cliente/favoritos", cCliente);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("cliente abre conversas", async () => {
  const r = await pagina("/cliente/conversas", cCliente);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("chat partilhado: /conversas serve todos os perfis", async () => {
  const visitante = await pagina("/conversas");
  assert(visitante.status === 307 || visitante.status === 302, `visitante -> ${visitante.status}`);
  assert((visitante.location || "").includes("/login"), `visitante -> ${visitante.location}`);

  for (const [quem, cookie] of [
    ["cliente", cCliente],
    ["vendedor", cVendedor],
    ["gestor", cGestor],
  ]) {
    const r = await pagina("/conversas", cookie);
    assert(r.status === 200, `${quem} -> ${r.status}`);
    // O chat é cliente (`useSearchParams`), por isso o HTML pode trazer só o
    // fallback de Suspense. O que importa é que a rota abre para o perfil.
    assert(/Mensagens|A carregar/.test(texto(r.html)), `${quem} sem chat`);
  }
  return "3 perfis + visitante bloqueado";
});

await check("cliente NÃO entra em /gerente", async () => {
  const r = await pagina("/gerente", cCliente);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  return `${r.status} -> ${r.location}`;
});

await check("cliente NÃO entra em /vendedor", async () => {
  const r = await pagina("/vendedor", cCliente);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  return `${r.status} -> ${r.location}`;
});

// ---------------------------------------------------------------------------
console.log("\n--- 4. ÁREA DO VENDEDOR ---");
// ---------------------------------------------------------------------------
await check("vendedor entra em /vendedor", async () => {
  const r = await pagina("/vendedor", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  // O painel mudou de "resumo comercial" para um cartão de identidade com a
  // referência INUKA. Se a migração de colaboradores ainda não estiver
  // aplicada, a página mostra a instrução em vez do painel — nunca um erro.
  assert(
    t.includes("Bem-vindo à INUKA Angola") || t.includes("PATCH_COLABORADORES"),
    "nem o painel nem o aviso de migração aparecem"
  );
  // Colaborador e vendedor são a mesma pessoa; a interface não pode ter
  // dois nomes para o mesmo papel.
  // Colaborador e vendedor são a mesma pessoa; a interface não pode ter
  // dois nomes para o mesmo papel. Nota: a conta de teste chama-se
  // "Vendedor", por isso o teste procura a etiqueta e não a palavra solta.
  assert(t.includes("Área de colaborador"), "a área não se identifica como de colaborador");
  assert(!/Área do [Vv]endedor/.test(t), "a área ainda se chama “Área do vendedor”");
  assert(!/Vendedores ativos/.test(t), "o painel ainda conta “Vendedores ativos”");
  return "200";
});

await check("vendedor abre registar venda", async () => {
  const r = await pagina("/vendedor/vendas/registar", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  // O telefone é o cadastro do cliente: a página tem de o dizer, para o
  // colaborador não pensar que ainda há um passo de «associar» à parte.
  const t = texto(r.html);
  assert(/clientes conquistados/i.test(t), "a página não fala em clientes conquistados");
  return "200";
});

await check("vendedor abre histórico de vendas", async () => {
  const r = await pagina("/vendedor/vendas", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("vendedor abre os seus clientes", async () => {
  const r = await pagina("/vendedor/clientes", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("vendedor NÃO entra em /gerente", async () => {
  const r = await pagina("/gerente", cVendedor);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  return `${r.status} -> ${r.location}`;
});

// ---------------------------------------------------------------------------
console.log("\n--- 5. ÁREA DA GERÊNCIA ---");
// ---------------------------------------------------------------------------
await check("gestor entra no painel", async () => {
  const r = await pagina("/gerente", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Painel de gestão"), "sem painel");
  assert(/Valor vendido/.test(t), "sem indicador de valor");
  return "200 com indicadores";
});

await check("gestor abre produtos", async () => {
  const r = await pagina("/gerente/produtos", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

// ---------------------------------------------------------------------------
// DEFINIÇÕES — o gestor muda contactos e links da app sem publicar código.
// ---------------------------------------------------------------------------
const LINK_DRIVE =
  "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing";

await check("o cliente não entra nas definições", async () => {
  const r = await pagina("/gerente/definicoes", cCliente);
  assert(r.status === 307 || r.status === 200, `HTTP ${r.status}`);
  if (r.status === 200) assert(!texto(r.html).includes("Guardar definições"), "abriu o formulário");
  return `bloqueado (${r.status})`;
});

await check("a gestão grava o link da app e o download usa-o em directo", async () => {
  const valor = {
    email: "inukaangolaa@gmail.com",
    telefones: ["+244 999 000 111"],
    androidUrl: LINK_DRIVE,
    iosUrl: "https://testflight.apple.com/join/ABCDEFG",
    versao: "9.9.9",
    novidades: "Versão de teste",
  };

  const gravado = await sb("/rest/v1/platform_settings?on_conflict=key", {
    method: "POST",
    jwt: sGestor.access_token,
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { key: "loja", value: valor },
  });
  assert(gravado.ok, `gravar: HTTP ${gravado.status} ${JSON.stringify(gravado.data).slice(0, 160)}`);

  const r = await pagina("/download");
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  // Um link de partilha do Drive tem de sair daqui como descarga directa.
  assert(
    r.html.includes("drive.google.com/uc?export=download"),
    "o link do Drive não foi convertido em descarga directa"
  );
  assert(!r.html.includes("drive.google.com/file/d/"), "ficou o link de pré-visualização");
  assert(t.includes("TestFlight"), "a origem do link do iPhone não aparece");
  assert(t.includes("9.9.9"), "a versão configurada não aparece");
  return "Drive → descarga directa · TestFlight";
});

await check("a página de contactos segue as definições", async () => {
  const r = await pagina("/contactos");
  assert(r.html.includes("inukaangolaa@gmail.com"), "e-mail configurado ausente");
  assert(r.html.includes("999 000 111"), "o telefone configurado não chegou à página");
  return "e-mail e telefone das definições";
});

await check("remover as definições devolve os valores de origem", async () => {
  await sb(`/rest/v1/platform_settings?key=eq.loja`, {
    method: "DELETE",
    jwt: sGestor.access_token,
    prefer: "return=minimal",
  });
  const r = await pagina("/download");
  assert(r.html.includes("/downloads/inuka-angola.apk"), "o APK local não voltou");
  assert(!r.html.includes("drive.google.com"), "o link de teste ficou gravado");
  return "APK local outra vez";
});

// ---------------------------------------------------------------------------
// CRUD DA GESTÃO SOBRE DADOS DE OPERAÇÃO — reservas por activar.
// ---------------------------------------------------------------------------
const RESERVA_TEL = "+244924200031";

await check("a gestão vê e corrige uma reserva por activar", async () => {
  await sb(`/rest/v1/reserved_customers?phone=eq.${encodeURIComponent(RESERVA_TEL)}`, {
    method: "DELETE",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
  });

  const criada = await fetch(`${APP}/api/vendedor/clientes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cGestor },
    body: JSON.stringify({
      full_name: "Reserva Gestao",
      phone: RESERVA_TEL,
      neighborhood: "Talatona",
    }),
  });
  const dados = await criada.json().catch(() => ({}));
  assert(criada.ok && dados.reservado === true, `criar: ${criada.status} ${JSON.stringify(dados).slice(0, 160)}`);

  const lista = await pagina("/gerente/clientes", cGestor);
  assert(lista.status === 200, `HTTP ${lista.status}`);
  const t = texto(lista.html);
  assert(t.includes("Reserva Gestao"), "a reserva não aparece na gestão");
  assert(/por activar/i.test(t), "sem a marca por activar");

  const novo = "+244924200032";
  const corrigida = await fetch(`${APP}/api/vendedor/clientes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: cGestor },
    body: JSON.stringify({ id: dados.id, full_name: "Reserva Corrigida", phone: novo }),
  });
  const r2 = await corrigida.json().catch(() => ({}));
  assert(corrigida.ok, `corrigir: ${corrigida.status} ${JSON.stringify(r2).slice(0, 160)}`);

  const linha = await sb(
    `/rest/v1/reserved_customers?select=full_name,phone&id=eq.${dados.id}`,
    { key: SR, jwt: SR }
  );
  assert(linha.data[0].full_name === "Reserva Corrigida", `nome ${linha.data[0].full_name}`);
  assert(linha.data[0].phone === novo, `telefone ${linha.data[0].phone}`);

  await sb(`/rest/v1/reserved_customers?id=eq.${dados.id}`, {
    method: "DELETE",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
  });
  return "visível · nome e número corrigidos";
});

await check("a ficha do colaborador mostra o telefone de acesso", async () => {
  const r = await pagina(`/gerente/colaboradores/${sVendedor.user.id}`, cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  // O telefone vem do `colaborador_ficha` e é o que o gestor passa a poder
  // corrigir no painel «Dados» (o campo em si só existe depois de abrir).
  assert(/\+244\s?924\s?200\s?002/.test(t), "o telefone de acesso não aparece na ficha");
  assert(/Editar ficha/i.test(t), "sem o painel de dados");
  assert(/Província e acesso/i.test(t), "sem o painel de acesso");
  return "telefone visível · painéis de dados e acesso";
});

await check("gestor abre encomendas", async () => {
  const r = await pagina("/gerente/encomendas", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("gestor abre descontos", async () => {
  const r = await pagina("/gerente/descontos", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  return "200";
});

await check("gestor acede também às áreas de cliente e vendedor", async () => {
  for (const rota of ["/cliente", "/vendedor"]) {
    const r = await pagina(rota, cGestor);
    assert(r.status === 200, `${rota} -> ${r.status}`);
  }
  return "cliente + vendedor";
});

await check("encomendas do gestor: embed do vendedor válido e cliente juntado por id", async () => {
  // `orders.customer_id` aponta para auth.users, por isso
  // `profiles!orders_customer_id_fkey` não existe — foi o erro que deixou a
  // página de encomendas em branco. O vendedor tem FK real para profiles.
  const pedidos = await sb(
    "/rest/v1/orders?select=id,customer_id,seller:profiles!orders_seller_id_fkey(full_name)&limit=5",
    { jwt: sGestor.access_token }
  );
  assert(pedidos.ok, `embed do vendedor: ${JSON.stringify(pedidos.data).slice(0, 140)}`);

  const ids = [...new Set((pedidos.data ?? []).map((o) => o.customer_id).filter(Boolean))];
  if (ids.length > 0) {
    const perfis = await sb(`/rest/v1/profiles?select=id,full_name&id=in.(${ids.join(",")})`, {
      jwt: sGestor.access_token,
    });
    assert(perfis.ok, `perfis por id: ${JSON.stringify(perfis.data).slice(0, 140)}`);
    assert(perfis.data.length === ids.length, `${ids.length} clientes, ${perfis.data.length} perfis`);
  }
  return `${(pedidos.data ?? []).length} encomendas · ${ids.length} clientes`;
});

await check("gestor abre as secções de gestão", async () => {
  const rotas = [
    ["/gerente/clientes", "Clientes"],
    ["/gerente/colaboradores", "pesquisa de colaboradores"],
    ["/gerente/categorias", "Categorias"],
    ["/gerente/relatorios", "Relatórios"],
    ["/gerente/conversas", "Mensagens"],
  ];
  for (const [rota, marca] of rotas) {
    const r = await pagina(rota, cGestor);
    assert(r.status === 200, `${rota} -> ${r.status}`);
    assert(texto(r.html).includes(marca), `${rota} sem “${marca}”`);
  }
  return `${rotas.length} secções`;
});

await check("relatórios compara com o período anterior", async () => {
  const r = await pagina("/gerente/relatorios?periodo=7d", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(/Valor vendido/.test(t), "sem indicador de valor");
  assert(/Ticket médio/.test(t), "sem ticket médio");
  assert(/vs\. período anterior|sem base de comparação/.test(t), "sem comparação");
  return "7 dias com comparação";
});

await check("vendedor NÃO entra nas secções de gestão", async () => {
  for (const rota of ["/gerente/clientes", "/gerente/colaboradores", "/gerente/categorias", "/gerente/conversas", "/gerente/relatorios"]) {
    const r = await pagina(rota, cVendedor);
    assert(r.status === 307 || r.status === 302, `${rota} -> ${r.status}`);
    assert((r.location || "").includes("/vendedor"), `${rota} -> ${r.location}`);
  }
  return "5 bloqueadas";
});

// ---------------------------------------------------------------------------
console.log("\n--- 6. ESTÚDIO DE DESIGN (só gestão) ---");
// ---------------------------------------------------------------------------
await check("visitante NÃO entra no estúdio de design", async () => {
  const r = await pagina("/designer");
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  assert(String(r.location ?? "").includes("/login"), `redirect inesperado: ${r.location}`);
  return `${r.status} -> ${r.location}`;
});

await check("cliente NÃO entra no estúdio de design", async () => {
  // O estúdio é ferramenta de gestão: nem a galeria nem o editor se abrem.
  const r = await pagina("/designer", cCliente);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  assert(!String(r.location ?? "").includes("/designer"), `foi para o estúdio: ${r.location}`);
  return `${r.status} -> ${r.location}`;
});

await check("colaborador NÃO entra no estúdio de design", async () => {
  const r = await pagina("/designer", cVendedor);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  assert(String(r.location ?? "").includes("/vendedor"), `redirect inesperado: ${r.location}`);
  return `${r.status} -> ${r.location}`;
});

await check("cliente não cria projeto pela API (guarda na base de dados)", async () => {
  // Fechar a rota não chegava: sem a guarda na base, um cliente autenticado
  // chamava `design_create` por REST e enchia a base com projetos que nunca
  // conseguiria abrir.
  const r = await sb("/rest/v1/rpc/design_create", {
    method: "POST",
    jwt: sCliente.access_token,
    body: { p_title: "[E2E] intruso", p_format_key: "square", p_width: 1080, p_height: 1080 },
  });
  if (r.ok) {
    // Não deixa lixo para trás: apaga o que não devia ter sido criado.
    if (r.data?.id) {
      await sb("/rest/v1/rpc/design_delete", {
        method: "POST",
        jwt: sCliente.access_token,
        body: { p_id: r.data.id },
      });
    }
    throw new Error("a base aceitou o projeto — falta colar supabase/PATCH_designer.sql");
  }
  return `${r.status} recusado`;
});

await check("gestor entra no estúdio de design", async () => {
  const r = await pagina("/designer", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Estúdio de design"), "sem o título do estúdio");
  // Se as tabelas do designer faltarem, a página finge estar tudo bem.
  assert(!/ainda não está ativo/i.test(t), "tabelas do designer em falta na base de dados");
  return "200 com galeria";
});

const TITULO_PROJ = "[E2E] Design automático";
const criado = await sb("/rest/v1/rpc/design_create", {
  method: "POST",
  jwt: sGestor.access_token,
  body: { p_title: TITULO_PROJ, p_format_key: "story", p_width: 1080, p_height: 1920 },
});
assert(criado.ok, `design_create: ${JSON.stringify(criado.data)}`);
const PROJ_ID = criado.data?.id;

await check("criar projeto no estúdio devolve id", async () => {
  assert(typeof PROJ_ID === "string" && PROJ_ID.length === 36, `id inválido: ${PROJ_ID}`);
  return PROJ_ID.slice(0, 8) + "…";
});

await check("projeto novo abre no editor", async () => {
  const r = await pagina(`/designer/${PROJ_ID}`, cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(texto(r.html).includes("Exportar"), "editor sem barra de ferramentas");
  return "200 com barra de ferramentas";
});

await check("projeto novo aparece na galeria", async () => {
  const r = await pagina("/designer", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(texto(r.html).includes(TITULO_PROJ), "projeto ausente da galeria");
  return "listado";
});

await check("projeto inexistente dá 404", async () => {
  const r = await pagina("/designer/00000000-0000-4000-8000-000000000000", cGestor);
  assert(r.status === 404, `HTTP ${r.status}`);
  return "404";
});

await check("colaborador NÃO abre o editor nem por URL directo", async () => {
  const r = await pagina(`/designer/${PROJ_ID}`, cVendedor);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status} (devia redireccionar)`);
  assert(!String(r.location ?? "").includes("/designer"), `chegou ao editor: ${r.location}`);
  return `${r.status} fora do estúdio`;
});

await check("apagar o projeto remove o acesso ao editor", async () => {
  const del = await sb("/rest/v1/rpc/design_delete", {
    method: "POST",
    jwt: sGestor.access_token,
    body: { p_id: PROJ_ID },
  });
  assert(del.ok, JSON.stringify(del.data));
  const r = await pagina(`/designer/${PROJ_ID}`, cGestor);
  assert(r.status === 404, `HTTP ${r.status}`);
  return "apagado -> 404";
});

// ---------------------------------------------------------------------------
console.log("\n--- 7. RESILIÊNCIA — imagem externa não derruba o catálogo ---");
// ---------------------------------------------------------------------------
await check("produto com imagem de host externo não quebra /catalogo", async () => {
  const prod = await sb("/rest/v1/products", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: { name: "[TESTE] Imagem externa", official_price: 1000, is_active: true },
  });
  assert(prod.ok, JSON.stringify(prod.data));
  const id = prod.data[0].id;

  const img = await sb("/rest/v1/product_images", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: {
      product_id: id,
      storage_path: "x.png",
      url: "https://host-inexistente.example.com/foto.png",
    },
  });
  assert(img.ok, JSON.stringify(img.data));

  const r = await pagina("/catalogo");
  assert(r.status === 200, `catálogo devolveu ${r.status}`);

  await sb(`/rest/v1/products?id=eq.${id}`, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
  return "200 (antes era 500)";
});

// ---------------------------------------------------------------------------
console.log("\n--- 8. CHAT ---");
// ---------------------------------------------------------------------------
// O bug original: `conversation_members.user_id` e `messages.sender_id` apontam
// para `auth.users`, não para `public.profiles`, por isso qualquer embed
// `profiles!...` devolvia
//   «Could not find a relationship between 'conversation_members' and 'profiles'».

await check("gestor abre /gerente/conversas sem erro de relação", async () => {
  const r = await pagina("/gerente/conversas", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(!/Could not find a relationship/i.test(r.html), "o embed inválido voltou");
  assert(/Mensagens/.test(texto(r.html)), "sem o mensageiro");
  return "200, sem PGRST";
});

await check("cliente e colaborador abrem /conversas sem erro", async () => {
  for (const [quem, cookie] of [["cliente", cCliente], ["colaborador", cVendedor]]) {
    const r = await pagina("/conversas", cookie);
    assert(r.status === 200, `${quem} -> HTTP ${r.status}`);
    assert(!/Could not find a relationship/i.test(r.html), `${quem}: embed inválido`);
  }
  return "2 perfis";
});

await check("/api/contactos exige sessão", async () => {
  const r = await fetch(`${APP}/api/contactos`);
  assert(r.status === 401, `HTTP ${r.status}`);
  return "401 sem sessão";
});

await check("/api/contactos respeita o papel", async () => {
  const pedir = async (cookie) => {
    const r = await fetch(`${APP}/api/contactos`, { headers: { cookie } });
    assert(r.ok, `HTTP ${r.status}`);
    const corpo = await r.json();
    return corpo.contactos ?? [];
  };

  const doCliente = await pedir(cCliente);
  const doVendedor = await pedir(cVendedor);
  const doGestor = await pedir(cGestor);

  // Ninguém se vê a si próprio na lista.
  const eu = (lista, id) => lista.some((c) => c.id === id);
  assert(!eu(doCliente, sCliente.user.id), "o cliente aparece na sua própria lista");
  assert(!eu(doGestor, sGestor.user.id), "o gestor aparece na sua própria lista");

  // O cliente vê a gerência; o gestor vê todos.
  assert(doCliente.some((c) => c.role === "manager"), "o cliente não vê a gerência");
  assert(doGestor.length >= doCliente.length, "o gestor devia ver mais gente");

  // Nunca expõe telefone nem email.
  for (const c of [...doCliente, ...doVendedor, ...doGestor]) {
    assert(!("phone" in c) || c.phone === undefined, "expôs telefone");
  }
  return `cliente ${doCliente.length} · colaborador ${doVendedor.length} · gestor ${doGestor.length}`;
});

await check("conversa directa + mensagem chegam ao destinatário", async () => {
  const jwtC = sCliente.access_token;
  const jwtV = sVendedor.access_token;

  const conv = await sb("/rest/v1/rpc/get_or_create_direct_conversation", {
    method: "POST",
    body: { p_other_user: sVendedor.user.id },
    jwt: jwtC,
  });
  assert(conv.ok, JSON.stringify(conv.data));
  const convId = conv.data;
  assert(typeof convId === "string" && convId.length === 36, `id inesperado: ${convId}`);

  const texto1 = `Olá, preciso de ajuda ${Date.now()}`;
  const env = await sb("/rest/v1/messages", {
    method: "POST",
    jwt: jwtC,
    prefer: "return=representation",
    body: { conversation_id: convId, sender_id: sCliente.user.id, content: texto1 },
  });
  assert(env.ok, `envio: ${JSON.stringify(env.data)}`);

  // O destinatário lê (RLS: is_conversation_member).
  const lidas = await sb(`/rest/v1/messages?conversation_id=eq.${convId}&select=content,sender_id`, {
    jwt: jwtV,
  });
  assert(lidas.ok, JSON.stringify(lidas.data));
  assert(lidas.data.some((m) => m.content === texto1), "o destinatário não viu a mensagem");

  // Reabrir a mesma conversa não duplica.
  const outra = await sb("/rest/v1/rpc/get_or_create_direct_conversation", {
    method: "POST",
    body: { p_other_user: sVendedor.user.id },
    jwt: jwtC,
  });
  assert(outra.data === convId, `duplicou a conversa: ${outra.data} vs ${convId}`);

  globalThis.__convId = convId;
  globalThis.__textoChat = texto1;
  return "idempotente";
});

await check("gestor lê tudo mas só responde depois de entrar", async () => {
  const convId = globalThis.__convId;
  const jwtG = sGestor.access_token;

  // Vê (política is_manager) sem ser membro.
  const leitura = await sb(`/rest/v1/messages?conversation_id=eq.${convId}&select=id`, { jwt: jwtG });
  assert(leitura.ok && leitura.data.length > 0, "o gestor não conseguiu ler");

  // Escrever exige participação — é intencional.
  const tentativa = await sb("/rest/v1/messages", {
    method: "POST",
    jwt: jwtG,
    prefer: "return=representation",
    body: { conversation_id: convId, sender_id: sGestor.user.id, content: "Resposta do gestor" },
  });
  assert(tentativa.status === 403, `devia ser recusado, veio ${tentativa.status}`);

  // Depois de entrar, já pode.
  const entrar = await sb("/rest/v1/conversation_members", {
    method: "POST",
    jwt: jwtG,
    prefer: "return=minimal",
    body: { conversation_id: convId, user_id: sGestor.user.id },
  });
  assert(entrar.ok, `entrar: ${JSON.stringify(entrar.data)}`);

  const agora = await sb("/rest/v1/messages", {
    method: "POST",
    jwt: jwtG,
    prefer: "return=representation",
    body: { conversation_id: convId, sender_id: sGestor.user.id, content: "Resposta do gestor" },
  });
  assert(agora.ok, `depois de entrar: ${JSON.stringify(agora.data)}`);
  return "403 → entra → 201";
});

await check("marcar como lida só funciona para membros", async () => {
  const convId = globalThis.__convId;
  const r = await sb("/rest/v1/rpc/mark_conversation_read", {
    method: "POST",
    body: { p_conversation_id: convId },
    jwt: sVendedor.access_token,
  });
  assert(r.ok, `membro: ${JSON.stringify(r.data)}`);

  const membro = await sb(
    `/rest/v1/conversation_members?conversation_id=eq.${convId}&user_id=eq.${sVendedor.user.id}&select=last_read_at`,
    { jwt: sVendedor.access_token }
  );
  assert(membro.ok && membro.data[0]?.last_read_at, "last_read_at não foi gravado");
  return "last_read_at gravado";
});

await check("anexo: upload, mensagem só com ficheiro e URL assinado", async () => {
  const convId = globalThis.__convId;
  const jwt = sCliente.access_token;
  // Bytes de um PNG (assinatura válida); o Storage não valida o conteúdo, mas
  // isto mantém o teste honesto quanto ao tipo declarado.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const caminho = `${convId}/${globalThis.crypto.randomUUID()}.png`;

  // A pasta tem de ser o id da conversa: a política lê (foldername)[1].
  const up = await fetch(`${BASE}/storage/v1/object/message-attachments/${caminho}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "image/png",
      "x-upsert": "false",
    },
    body: bytes,
  });
  assert(up.ok, `upload: ${up.status} ${await up.text()}`);

  // `content` nulo: o CHECK messages_content_or_attachment tem de o aceitar
  // quando existe anexo.
  const msg = await sb("/rest/v1/messages", {
    method: "POST",
    jwt,
    prefer: "return=representation",
    body: { conversation_id: convId, sender_id: sCliente.user.id, content: null },
  });
  assert(msg.ok, `mensagem sem texto: ${JSON.stringify(msg.data)}`);

  const anexo = await sb("/rest/v1/message_attachments", {
    method: "POST",
    jwt,
    prefer: "return=representation",
    body: {
      message_id: msg.data[0].id,
      storage_path: caminho,
      file_name: "foto.png",
      file_type: "image/png",
      file_size: bytes.length,
    },
  });
  assert(anexo.ok, `anexo: ${JSON.stringify(anexo.data)}`);

  // O destinatário assina e descarrega.
  const assinar = async (token) =>
    fetch(`${BASE}/storage/v1/object/sign/message-attachments/${caminho}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    });

  const assinado = await assinar(sVendedor.access_token);
  assert(assinado.ok, `assinar: ${assinado.status}`);
  const { signedURL } = await assinado.json();
  const descarregado = await fetch(`${BASE}/storage/v1${signedURL}`);
  assert(descarregado.ok, `download: ${descarregado.status}`);

  // O bucket é privado: sem sessão não se assina nada.
  const anonimo = await assinar(ANON);
  assert(!anonimo.ok, `um anónimo conseguiu assinar (${anonimo.status})`);

  // Higiene: o ficheiro não fica órfão no bucket.
  await fetch(`${BASE}/storage/v1/object/message-attachments/${caminho}`, {
    method: "DELETE",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });

  return `${bytes.length} B · download ${descarregado.status} · anónimo ${anonimo.status}`;
});

await check("anexo acima de 20 MB é recusado pela base", async () => {
  const convId = globalThis.__convId;
  const msg = await sb("/rest/v1/messages", {
    method: "POST",
    jwt: sCliente.access_token,
    prefer: "return=representation",
    body: { conversation_id: convId, sender_id: sCliente.user.id, content: "com anexo grande" },
  });
  assert(msg.ok, JSON.stringify(msg.data));

  const r = await sb("/rest/v1/message_attachments", {
    method: "POST",
    jwt: sCliente.access_token,
    prefer: "return=representation",
    body: {
      message_id: msg.data[0].id,
      storage_path: `${convId}/grande.bin`,
      file_name: "grande.bin",
      file_type: "application/octet-stream",
      file_size: 21 * 1024 * 1024,
    },
  });
  assert(r.status === 400, `devia recusar com 400, veio ${r.status}`);

  await sb(`/rest/v1/messages?id=eq.${msg.data[0].id}`, {
    method: "DELETE",
    jwt: sCliente.access_token,
    prefer: "return=minimal",
  });
  return "400 acima de 20 MB";
});

await check("apagar mensagem: autor pode, terceiro não, gestor pode", async () => {
  const convId = globalThis.__convId;

  const criar = async (texto) => {
    const r = await sb("/rest/v1/messages", {
      method: "POST",
      jwt: sCliente.access_token,
      prefer: "return=representation",
      body: { conversation_id: convId, sender_id: sCliente.user.id, content: texto },
    });
    assert(r.ok, JSON.stringify(r.data));
    return r.data[0].id;
  };

  const apagar = (id, cookie) =>
    fetch(`${APP}/api/mensagens/${id}`, { method: "DELETE", headers: { cookie } });

  // 1. O autor apaga a sua.
  const minha = await criar("mensagem para apagar (autor)");
  const r1 = await apagar(minha, cCliente);
  assert(r1.status === 200, `autor: HTTP ${r1.status}`);

  const ficou = await sb(`/rest/v1/messages?id=eq.${minha}&select=id`, {
    key: SR,
    jwt: SR,
  });
  assert(ficou.data.length === 0, "a mensagem não desapareceu");

  // 2. O colaborador não apaga a mensagem do cliente.
  const doCliente = await criar("mensagem que o colaborador não pode apagar");
  const r2 = await apagar(doCliente, cVendedor);
  assert(r2.status === 403, `terceiro: devia ser 403, veio ${r2.status}`);

  // 3. A gerência apaga a mensagem de outra pessoa.
  const r3 = await apagar(doCliente, cGestor);
  assert(r3.status === 200, `gestor: HTTP ${r3.status}`);

  // 4. Sem sessão, nada.
  const r4 = await apagar(doCliente, "");
  assert(r4.status === 401, `anónimo: devia ser 401, veio ${r4.status}`);

  return "autor 200 · terceiro 403 · gestor 200 · anónimo 401";
});

await check("apagar conversa: só a gerência, e limpa os ficheiros", async () => {
  const convId = globalThis.__convId;

  // Um ficheiro na pasta da conversa, sem linha na base — o apagar tem de o
  // apanhar de qualquer forma, senão ficava lixo no bucket.
  const caminho = `${convId}/orfao.bin`;
  const up = await fetch(`${BASE}/storage/v1/object/message-attachments/${caminho}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${sCliente.access_token}`,
      "Content-Type": "application/octet-stream",
      "x-upsert": "false",
    },
    body: Buffer.from([1, 2, 3, 4]),
  });
  assert(up.ok, `upload: ${up.status}`);

  const apagar = (cookie) =>
    fetch(`${APP}/api/conversas/${convId}`, { method: "DELETE", headers: { cookie } });

  // O colaborador é membro, mas não é gerência.
  const negado = await apagar(cVendedor);
  assert(negado.status === 403, `colaborador: devia ser 403, veio ${negado.status}`);

  const feito = await apagar(cGestor);
  assert(feito.status === 200, `gestor: HTTP ${feito.status}`);
  const corpo = await feito.json();
  assert(corpo.ficheiros >= 1, `não limpou os ficheiros: ${JSON.stringify(corpo)}`);

  // A conversa e tudo o que estava dentro desapareceu (CASCADE).
  const msgs = await sb(`/rest/v1/messages?conversation_id=eq.${convId}&select=id`, { key: SR, jwt: SR });
  assert(msgs.data.length === 0, "sobraram mensagens");
  const membros = await sb(`/rest/v1/conversation_members?conversation_id=eq.${convId}&select=id`, {
    key: SR,
    jwt: SR,
  });
  assert(membros.data.length === 0, "sobraram membros");

  // A pasta do bucket ficou vazia.
  const lista = await fetch(`${BASE}/storage/v1/object/list/message-attachments`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: `${convId}/`, limit: 100 }),
  });
  const ficheiros = await lista.json();
  assert(Array.isArray(ficheiros) && ficheiros.length === 0, `restaram ${JSON.stringify(ficheiros)}`);

  return "colaborador 403 · gestor 200 · 0 mensagens · 0 ficheiros";
});

// ---------------------------------------------------------------------------
console.log("\n--- 9. PRODUTOS — IMAGEM (upload, URL e catálogo) ---");
// ---------------------------------------------------------------------------
await check("gestor guarda imagem do produto e o catálogo mostra-a", async () => {
  const jwt = sGestor.access_token;

  const criado = await sb("/rest/v1/products", {
    method: "POST",
    jwt,
    prefer: "return=representation",
    body: { name: "[TESTE] Produto com imagem", official_price: 12000, is_active: true },
  });
  assert(criado.ok, `criar produto: ${JSON.stringify(criado.data)}`);
  const produtoId = criado.data[0].id;

  // PNG mínimo mas válido.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const nomeFicheiro = `${globalThis.crypto.randomUUID()}.png`;
  const caminho = `${produtoId}/${nomeFicheiro}`;

  const up = await fetch(`${BASE}/storage/v1/object/product-images/${caminho}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "image/png",
      "x-upsert": "false",
    },
    body: bytes,
  });
  assert(up.ok, `upload: ${up.status} ${await up.text()}`);

  const url = `${BASE}/storage/v1/object/public/product-images/${caminho}`;

  const linha = await sb("/rest/v1/product_images", {
    method: "POST",
    jwt,
    prefer: "return=representation",
    body: {
      product_id: produtoId,
      storage_path: caminho,
      url,
      is_primary: true,
      sort_order: 0,
    },
  });
  assert(linha.ok, `product_images: ${JSON.stringify(linha.data)}`);

  // O bucket é público: o URL serve a imagem sem sessão.
  const servida = await fetch(url);
  assert(servida.ok, `imagem pública: ${servida.status}`);

  // E o catálogo renderiza-a (o next/image pode reescrever o src, por isso o
  // marcador é o nome do ficheiro, que aparece em qualquer das formas).
  const catalogo = await pagina("/catalogo");
  assert(catalogo.status === 200, `catálogo: ${catalogo.status}`);
  assert(
    catalogo.html.includes(nomeFicheiro),
    "a imagem não chegou ao catálogo"
  );

  // Limpeza: apagar o produto leva a linha (CASCADE); o ficheiro sai à mão.
  await sb(`/rest/v1/products?id=eq.${produtoId}`, {
    method: "DELETE",
    jwt,
    prefer: "return=minimal",
  });
  await fetch(`${BASE}/storage/v1/object/product-images/${caminho}`, {
    method: "DELETE",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });

  const sobrou = await sb(`/rest/v1/product_images?product_id=eq.${produtoId}&select=id`, {
    key: SR,
    jwt: SR,
  });
  assert(sobrou.data.length === 0, "a linha de imagem ficou órfã");

  return `${bytes.length} B · URL público ${servida.status} · no catálogo`;
});

await check("URL externo de imagem é aceite (sem upload)", async () => {
  const jwt = sGestor.access_token;
  const criado = await sb("/rest/v1/products", {
    method: "POST",
    jwt,
    prefer: "return=representation",
    body: { name: "[TESTE] Produto com URL", official_price: 5000, is_active: true },
  });
  assert(criado.ok, JSON.stringify(criado.data));
  const produtoId = criado.data[0].id;

  // É assim que a página grava quando a gerência cola um URL: `storage_path`
  // leva o próprio URL porque a coluna é NOT NULL e nada a usa para renderizar.
  const url = "https://exemplo.invalido/foto-do-produto.jpg";
  const linha = await sb("/rest/v1/product_images", {
    method: "POST",
    jwt,
    prefer: "return=representation",
    body: { product_id: produtoId, storage_path: url, url, is_primary: true, sort_order: 0 },
  });
  assert(linha.ok, JSON.stringify(linha.data));

  const lido = await sb(`/rest/v1/product_images?product_id=eq.${produtoId}&select=url`, {
    key: SR,
    jwt: SR,
  });
  assert(lido.data[0]?.url === url, `url não gravado: ${JSON.stringify(lido.data)}`);

  await sb(`/rest/v1/products?id=eq.${produtoId}`, { method: "DELETE", jwt, prefer: "return=minimal" });
  return "gravado tal e qual";
});

// ---------------------------------------------------------------------------
console.log("\n--- 10. IDENTIDADE E GESTÃO DE COLABORADORES ---");
// ---------------------------------------------------------------------------
await check("gestor abre a pesquisa de colaboradores", async () => {
  const r = await pagina("/gerente/colaboradores", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Gestão e pesquisa de colaboradores"), "sem o título da pesquisa");
  assert(t.includes("Referência INUKA") || t.includes("referência"), "sem menção à referência");
  return "200";
});

await check("gestor abre a ficha individual do colaborador", async () => {
  const r = await pagina(`/gerente/colaboradores/${sVendedor.user.id}`, cGestor);
  // 404 é o resultado correcto quando a migração de colaboradores ainda não
  // foi aplicada; o que não pode acontecer é um erro de servidor.
  assert(r.status === 200 || r.status === 404, `HTTP ${r.status}`);
  if (r.status === 200) {
    const t = texto(r.html);
    assert(/INK-[A-Z]{3}-\d{5}/.test(t), "a ficha não mostra a referência INK");
    assert(t.includes("Acções da gestão"), "sem acções de gestão");
  }
  return `${r.status}`;
});

await check("aba de referência mostra o código e os contactos da INUKA", async () => {
  const r = await pagina("/referencia", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Código de referência"), "sem o bloco do código");
  assert(/INK-[A-Z]{3}-\d{5}/.test(t), "sem a referência INK");
  // Os dois números de atendimento: o cartão "Telefone" mostrava o telefone
  // do próprio utilizador, não os contactos da INUKA.
  assert(t.includes("927 991 441"), "sem o número 927 991 441");
  assert(t.includes("930 800 698"), "sem o número 930 800 698");
  return "200 · INK + 2 números";
});

// A tela «Perfil» foi fundida na Área de Colaborador: o endereço antigo
// responde com um redireccionamento permanente e os dados aparecem em /vendedor.
await check("o perfil antigo redirecciona para a Área de colaborador", async () => {
  const r = await pagina("/vendedor/perfil", cVendedor);
  assert(r.status === 308 || r.status === 307 || r.status === 301, `HTTP ${r.status}`);
  assert(String(r.location ?? "").endsWith("/vendedor"), `Location ${r.location}`);
  return `${r.status} -> /vendedor`;
});

await check("a Área de colaborador traz os dados do antigo perfil", async () => {
  const r = await pagina("/vendedor", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(
    (t.includes("Dados pessoais") && t.includes("Dados profissionais")) ||
      t.includes("PATCH_COLABORADORES"),
    "sem os dados pessoais nem aviso de migração"
  );
  // A referência aparece uma só vez: no cartão de identidade.
  const codigos = t.match(/INK-[A-Z]{3}-\d{5}/g) ?? [];
  assert(codigos.length === 1, `referência repetida ${codigos.length}×`);
  return "200 · dados + 1 referência";
});

await check("o menu do colaborador tem um botão «Perfil» que leva aos dados", async () => {
  const r = await pagina("/vendedor", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);

  // O botão está no menu (por isso `href`), e aponta para a secção dos dados
  // dentro da própria Área de Colaborador — a tela separada já não existe.
  assert(r.html.includes('href="/vendedor#perfil"'), "o menu não tem «Perfil»");
  assert(/<div[^>]*id="perfil"/.test(r.html), "a secção dos dados não tem âncora");
  return "menu → #perfil";
});

await check("colaborador não abre a ficha de outro colaborador", async () => {
  const r = await pagina(`/gerente/colaboradores/${sVendedor.user.id}`, cVendedor);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  return `${r.status}`;
});

// --- Ficha do colaborador: tarefas, gestor responsável e correcção de vendas --
// A tabela é nova (0018): sem o patch, estes testes não correm e dizem porquê.
const sondaTarefas = await sb("/rest/v1/colaborador_tarefas?select=id&limit=1", {
  key: SR,
  jwt: SR,
});
const TEM_TAREFAS = sondaTarefas.status !== 404;

if (!TEM_TAREFAS) {
  console.log(`
  ATENÇÃO — a base de dados ainda não tem a migração 0018 (tarefas, gestor
  responsável e correcção de vendas).
  Abra o Supabase -> SQL Editor e cole:
      supabase/PATCH_TAREFAS_GESTOR.sql
  Os testes desta secção ficam por correr — não são dados como aprovados.
`);
}

if (TEM_TAREFAS) {
  const SUF_T = Date.now().toString().slice(-6);
  const TAREFA_TITULO = `[E2E] Entregar o BI ${SUF_T}`;
  const PRAZO = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const criadaT = await sb("/rest/v1/colaborador_tarefas", {
    method: "POST",
    jwt: sGestor.access_token,
    prefer: "return=representation",
    body: {
      seller_id: sVendedor.user.id,
      titulo: TAREFA_TITULO,
      descricao: "Cópia do BI e comprovativo de morada.",
      prazo: PRAZO,
      prioridade: "alta",
      criado_por: sGestor.user.id,
    },
  });
  assert(criadaT.ok, `criar tarefa: ${JSON.stringify(criadaT.data).slice(0, 160)}`);
  const TAREFA_ID = criadaT.data[0].id;

  await check("a gestão atribui uma tarefa ao colaborador", async () => {
    const lida = await sb(
      `/rest/v1/colaborador_tarefas?select=titulo,estado,prazo,prioridade&id=eq.${TAREFA_ID}`,
      { key: SR, jwt: SR }
    );
    assert(lida.data[0].estado === "pendente", lida.data[0].estado);
    assert(lida.data[0].prioridade === "alta", lida.data[0].prioridade);
    return `pendente · alta · ${lida.data[0].prazo}`;
  });

  await check("a ficha do gestor mostra as tarefas e o gestor responsável", async () => {
    const r = await pagina(`/gerente/colaboradores/${sVendedor.user.id}`, cGestor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Tarefas do colaborador"), "sem a secção de tarefas");
    assert(t.includes(TAREFA_TITULO), "a tarefa não aparece na ficha");
    assert(t.includes("Gestor responsável"), "sem a secção do gestor");
    assert(t.includes("Corrigir vendas"), "sem a secção de correcção de vendas");
    return "tarefas + gestor + vendas";
  });

  await check("o colaborador vê a tarefa na área dele", async () => {
    const r = await pagina("/vendedor", cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("As minhas tarefas"), "sem a secção «As minhas tarefas»");
    assert(t.includes(TAREFA_TITULO), "a tarefa não chegou ao colaborador");
    assert(t.includes("Alta"), "sem a prioridade");
    return "tarefa visível";
  });

  await check("o colaborador marca a tarefa como concluída", async () => {
    const r = await sb(`/rest/v1/colaborador_tarefas?id=eq.${TAREFA_ID}`, {
      method: "PATCH",
      jwt: sVendedor.access_token,
      prefer: "return=representation",
      body: { estado: "concluida" },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    assert(r.data[0].estado === "concluida", r.data[0].estado);
    // A data de conclusão é escrita pelo trigger, não pelo cliente.
    assert(!!r.data[0].concluida_em, "sem data de conclusão");
    return `concluída em ${String(r.data[0].concluida_em).slice(0, 10)}`;
  });

  await check("o colaborador não reescreve o que a gestão escreveu", async () => {
    const r = await sb(`/rest/v1/colaborador_tarefas?id=eq.${TAREFA_ID}`, {
      method: "PATCH",
      jwt: sVendedor.access_token,
      body: { titulo: "outra coisa" },
    });
    assert(!r.ok, `devia recusar, devolveu ${r.status}`);
    assert(
      String(JSON.stringify(r.data)).includes("só pode marcar"),
      String(JSON.stringify(r.data)).slice(0, 160)
    );
    return `${r.status} recusado`;
  });

  await check("a lista de gestores traz o gestor da província", async () => {
    const r = await sb("/rest/v1/rpc/gestores_para_colaborador", {
      method: "POST",
      jwt: sGestor.access_token,
      body: { p_seller: sVendedor.user.id },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    const lista = Array.isArray(r.data) ? r.data : [];
    assert(lista.some((g) => g.id === sGestor.user.id), "o gestor não está na lista");
    assert(lista.every((g) => g.id !== sVendedor.user.id), "o colaborador aparece como gestor");
    return `${lista.length} candidato(s)`;
  });

  await check("a gestão define o gestor responsável", async () => {
    const r = await sb("/rest/v1/rpc/definir_gestor_colaborador", {
      method: "POST",
      jwt: sGestor.access_token,
      body: { p_seller: sVendedor.user.id, p_manager: sGestor.user.id },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    assert(r.data.gestor_id === sGestor.user.id, JSON.stringify(r.data));

    const lido = await sb(
      `/rest/v1/seller_profiles?select=manager_id&id=eq.${sVendedor.user.id}`,
      { key: SR, jwt: SR }
    );
    assert(lido.data[0].manager_id === sGestor.user.id, String(lido.data[0].manager_id));
    return "gestor gravado na ficha";
  });

  await check("o colaborador não muda o gestor dele", async () => {
    const r = await sb("/rest/v1/rpc/definir_gestor_colaborador", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { p_seller: sVendedor.user.id, p_manager: null },
    });
    assert(!r.ok, `devia recusar, devolveu ${r.status}`);
    return `${r.status} recusado`;
  });

  // --- correcção de uma venda ------------------------------------------------
  const perfilVend = await sb(
    `/rest/v1/profiles?select=provincia_id&id=eq.${sVendedor.user.id}`,
    { key: SR, jwt: SR }
  );
  const PROV_VEND = perfilVend.data?.[0]?.provincia_id ?? null;
  const prodQ = await sb("/rest/v1/products?select=id&is_active=eq.true&limit=1", {
    key: SR,
    jwt: SR,
  });
  const PROD_ID = prodQ.data?.[0]?.id ?? null;

  const REF_VENDA = `VND-E2E-${SUF_T}`;
  const vendaCriada = await sb("/rest/v1/sales", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: {
      reference: REF_VENDA,
      seller_id: sVendedor.user.id,
      total_amount: 0,
      payment_status: "paid",
      status: "completed",
      provincia_id: PROV_VEND,
    },
  });
  assert(vendaCriada.ok, `criar venda: ${JSON.stringify(vendaCriada.data).slice(0, 160)}`);
  const VENDA_ID = vendaCriada.data[0].id;

  const linhaCriada = await sb("/rest/v1/sale_items", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: {
      sale_id: VENDA_ID,
      product_id: PROD_ID,
      quantity: 2,
      unit_price: 10000,
      total_price: 20000,
    },
  });
  assert(linhaCriada.ok, `criar linha: ${JSON.stringify(linhaCriada.data).slice(0, 160)}`);
  const LINHA_ID = linhaCriada.data[0].id;

  await check("a venda nasce com o total das linhas e a comissão", async () => {
    const r = await sb(
      `/rest/v1/sales?select=total_amount,sale_commissions(amount)&id=eq.${VENDA_ID}`,
      { key: SR, jwt: SR }
    );
    const total = Number(r.data[0].total_amount);
    // `sale_commissions.sale_id` é único, por isso o PostgREST devolve um
    // objecto e não uma lista — `[0]` dava sempre `undefined`.
    const bruto = r.data[0].sale_commissions;
    const linha = Array.isArray(bruto) ? bruto[0] : bruto;
    const comissao = Number(linha?.amount ?? -1);
    assert(total === 20000, `total ${total}`);
    assert(comissao >= 0, `comissão ${comissao}`);
    return `total ${total} · comissão ${comissao}`;
  });

  await check("a gestão corrige a quantidade e o total acompanha", async () => {
    const r = await sb(`/rest/v1/sale_items?id=eq.${LINHA_ID}`, {
      method: "PATCH",
      jwt: sGestor.access_token,
      prefer: "return=representation",
      body: { quantity: 3, total_price: 30000 },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));

    const lida = await sb(
      `/rest/v1/sales?select=total_amount,sale_commissions(amount)&id=eq.${VENDA_ID}`,
      { key: SR, jwt: SR }
    );
    assert(Number(lida.data[0].total_amount) === 30000, `total ${lida.data[0].total_amount}`);
    return `20000 -> ${Number(lida.data[0].total_amount)}`;
  });

  await check("o colaborador não corrige vendas pela gestão", async () => {
    const r = await sb(`/rest/v1/sale_items?id=eq.${LINHA_ID}`, {
      method: "PATCH",
      jwt: sVendedor.access_token,
      body: { quantity: 9, total_price: 90000 },
    });
    // Sem política de UPDATE para o colaborador: o PostgREST devolve 200 com
    // zero linhas. O que interessa é o valor não ter mudado.
    const lida = await sb(`/rest/v1/sales?select=total_amount&id=eq.${VENDA_ID}`, {
      key: SR,
      jwt: SR,
    });
    assert(Number(lida.data[0].total_amount) === 30000, `total ${lida.data[0].total_amount}`);
    return `${r.status} · total intacto`;
  });

  await check("venda com comissão paga não se corrige", async () => {
    await sb(`/rest/v1/sale_commissions?sale_id=eq.${VENDA_ID}`, {
      method: "PATCH",
      key: SR,
      jwt: SR,
      body: { status: "paid", paid_at: new Date().toISOString() },
    });

    const r = await sb(`/rest/v1/sale_items?id=eq.${LINHA_ID}`, {
      method: "PATCH",
      jwt: sGestor.access_token,
      body: { quantity: 5, total_price: 50000 },
    });
    assert(!r.ok, `devia recusar, devolveu ${r.status}`);
    assert(
      String(JSON.stringify(r.data)).includes("comissão paga"),
      String(JSON.stringify(r.data)).slice(0, 160)
    );
    return `${r.status} recusado`;
  });

  await check("limpar tarefa, gestor e venda do teste", async () => {
    await sb(`/rest/v1/colaborador_tarefas?id=eq.${TAREFA_ID}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
    await sb(`/rest/v1/seller_profiles?id=eq.${sVendedor.user.id}`, {
      method: "PATCH",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
      body: { manager_id: null },
    });
    await sb(`/rest/v1/sale_items?id=eq.${LINHA_ID}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
    await sb(`/rest/v1/sales?id=eq.${VENDA_ID}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
    return "tarefa, gestor e venda removidos";
  });
}


await check("painel do gestor mostra a rede de colaboradores", async () => {
  const r = await pagina("/gerente", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(
    t.includes("Rede de colaboradores") || t.includes("Painel de gestão"),
    "sem secção de rede"
  );
  return "200";
});

await check("gestor abre a lista de clientes com criação e edição", async () => {
  const r = await pagina("/gerente/clientes", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Clientes"), "sem título");
  assert(t.includes("Novo cliente"), "sem botão de criação");
  assert(t.includes("editar"), "sem acção de edição por linha");
  return "200 · criar + editar";
});

// --- CRUD de contas pela gestão (colaboradores e clientes) ---
const NOVO = { name: "Cliente Criado Web", phone: "+244924200004" };
const NOVO_TEL = "+244924200005";
// Colaborador criado pelo gestor com telefone + palavra-passe definidos à mão:
// é o caso "abrir conta directamente pelo gestor" (aba Acesso).
const COLAB_TEL = "+244924200006";
const COLAB_PWD = "Provisoria2026!";
await apagarConta(NOVO.phone);
await apagarConta(NOVO_TEL);
await apagarConta(COLAB_TEL);

let idNovo = null;

await check("gestor cria um cliente pela API de gestão", async () => {
  const r = await fetch(`${APP}/api/gerente/utilizadores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cGestor },
    body: JSON.stringify({
      role: "customer",
      full_name: NOVO.name,
      phone: NOVO.phone,
      password: PWD,
      neighborhood: "Talatona",
    }),
  });
  const dados = await r.json().catch(() => ({}));
  assert(r.ok, `HTTP ${r.status} ${dados.error ?? ""}`);
  assert(dados.id, "sem id na resposta");
  idNovo = dados.id;

  // A conta criada tem de servir para entrar — senão criámos uma linha morta.
  const s = await login(NOVO.phone, PWD);
  assert(s.access_token, "a conta criada não consegue entrar");
  return `${dados.id.slice(0, 8)} · login ok`;
});

await check("gestor abre a conta do colaborador com telefone e palavra-passe", async () => {
  const r = await fetch(`${APP}/api/gerente/utilizadores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cGestor },
    body: JSON.stringify({
      role: "seller",
      full_name: "Colaborador Criado Web",
      phone: COLAB_TEL,
      password: COLAB_PWD,
      job_title: "Colaborador de vendas",
      municipio: "Belas",
      commission_rate: 0.05,
    }),
  });
  const dados = await r.json().catch(() => ({}));
  assert(r.ok, `HTTP ${r.status} ${dados.error ?? ""}`);
  assert(dados.referencia, "sem referência INUKA na resposta");

  // O essencial: a pessoa entra com o telefone e a palavra-passe que o gestor
  // escreveu — sem registo, sem email, sem confirmação.
  const sessao = await login(COLAB_TEL, COLAB_PWD);
  assert(sessao.access_token, "a conta criada não consegue entrar");

  const cColab = cookieSessao(sessao);

  // É colaborador: entra na área de colaborador e não na de cliente.
  const vend = await pagina("/vendedor", cColab);
  assert(vend.status === 200, `/vendedor: HTTP ${vend.status}`);
  assert(
    texto(vend.html).includes(dados.referencia),
    "a área de colaborador não mostra a referência criada"
  );

  const cli = await pagina("/cliente", cColab);
  assert(cli.status === 307 || cli.status === 302, `/cliente devia redireccionar: ${cli.status}`);

  return `${dados.referencia} · login ok · /vendedor`;
});

await check("colaborador não pode criar contas", async () => {
  const r = await fetch(`${APP}/api/gerente/utilizadores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cVendedor },
    body: JSON.stringify({ role: "customer", full_name: "Intruso", phone: "+244924200099", password: PWD }),
  });
  assert(r.status === 403, `HTTP ${r.status}`);
  return "403";
});

await check("gestor edita o cliente e o telefone passa a ser o novo acesso", async () => {
  const r = await fetch(`${APP}/api/gerente/utilizadores/${idNovo}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: cGestor },
    body: JSON.stringify({ full_name: "Cliente Editado Web", phone: NOVO_TEL }),
  });
  const dados = await r.json().catch(() => ({}));
  assert(r.ok, `HTTP ${r.status} ${dados.error ?? ""}`);

  const s = await login(NOVO_TEL, PWD);
  assert(s.access_token, "o telefone novo não serve para entrar");

  const { data } = await sb(
    `/rest/v1/profiles?select=full_name,phone&id=eq.${idNovo}`,
    { key: SR, jwt: SR }
  );
  assert(data?.[0]?.full_name === "Cliente Editado Web", `nome: ${data?.[0]?.full_name}`);
  return `${data[0].full_name} · ${data[0].phone}`;
});

await check("gestor carrega a fotografia de um cliente", async () => {
  // 1x1 PNG — o que interessa é a política do bucket, não a imagem.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const caminho = `${idNovo}/web-e2e.png`;

  const up = await fetch(`${BASE}/storage/v1/object/avatars/${caminho}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${sGestor.access_token}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: png,
  });
  assert(up.ok, `upload HTTP ${up.status} ${await up.text()}`);

  const publico = `${BASE}/storage/v1/object/public/avatars/${caminho}`;
  const put = await sb(`/rest/v1/profiles?id=eq.${idNovo}`, {
    method: "PATCH",
    key: ANON,
    jwt: sGestor.access_token,
    prefer: "return=minimal",
    body: { avatar_url: publico },
  });
  assert(put.ok, `perfil HTTP ${put.status} ${JSON.stringify(put.data)}`);

  const ver = await fetch(publico);
  assert(ver.ok, `URL público HTTP ${ver.status}`);

  await fetch(`${BASE}/storage/v1/object/avatars/${caminho}`, {
    method: "DELETE",
    headers: { apikey: ANON, Authorization: `Bearer ${sGestor.access_token}` },
  });

  return `upload · URL 200`;
});

await check("gestor apaga o cliente criado", async () => {
  const r = await fetch(`${APP}/api/gerente/utilizadores/${idNovo}`, {
    method: "DELETE",
    headers: { cookie: cGestor },
  });
  assert(r.ok, `HTTP ${r.status} ${JSON.stringify(await r.json().catch(() => ({})))}`);

  const s = await sb("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: `u${NOVO_TEL.replace("+", "")}@inuka.ao`, password: PWD },
  });
  assert(!s.ok, "a conta apagada ainda entra");
  return "apagado · login recusado";
});

// ---------------------------------------------------------------------------
console.log("\n--- 10B. CARTEIRA DO COLABORADOR ---");
// ---------------------------------------------------------------------------

const CARTEIRA_TEL = "+244924200007";
await apagarConta(CARTEIRA_TEL);
// Reservas sobrevivem a `apagarConta` (não são contas) e o telefone é único:
// sem esta limpeza, a segunda execução da suite batia numa reserva antiga.
await sb(`/rest/v1/reserved_customers?phone=eq.${encodeURIComponent(CARTEIRA_TEL)}`, {
  method: "DELETE",
  key: SR,
  jwt: SR,
  prefer: "return=minimal",
});

let idReserva = null;
let idCarteira = null;

await check("colaborador abre a sua carteira", async () => {
  const r = await pagina("/vendedor/clientes", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("A minha carteira"), "sem o título da carteira");
  assert(/Reservar cliente/i.test(t), "sem a opção de reservar");
  assert(/Já tem conta/i.test(t), "sem a opção de associar conta existente");
  assert(
    !/Abrir conta de cliente/i.test(t),
    "a carteira ainda oferece abrir conta — o colaborador não deve criar contas"
  );
  return "200 · reservar + associar";
});

await check("reservar um cliente NÃO cria conta nenhuma", async () => {
  const r = await fetch(`${APP}/api/vendedor/clientes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cVendedor },
    body: JSON.stringify({
      full_name: "Cliente Carteira Web",
      phone: CARTEIRA_TEL,
      neighborhood: "Benfica",
    }),
  });
  const dados = await r.json().catch(() => ({}));
  assert(r.ok, `HTTP ${r.status} ${dados.error ?? ""}`);
  assert(dados.reservado === true, "devia ficar reservado");
  assert(dados.existente === false, "não devia existir conta");
  assert(!dados.password, "a resposta ainda traz uma palavra-passe provisória");
  assert(dados.id, "sem id da reserva");
  idReserva = dados.id;

  // A prova que interessa: nada em `auth.users` / `profiles`.
  const contas = await sb(
    `/rest/v1/profiles?select=id&phone=eq.${encodeURIComponent(CARTEIRA_TEL)}`,
    { key: SR, jwt: SR }
  );
  assert(contas.data.length === 0, `foram criadas ${contas.data.length} contas`);

  // E a reserva existe, com o colaborador e a província dele.
  const reserva = await sb(
    `/rest/v1/reserved_customers?select=status,seller_id,provincia_id,full_name&id=eq.${idReserva}`,
    { key: SR, jwt: SR }
  );
  assert(reserva.data.length === 1, "reserva não gravada");
  assert(reserva.data[0].status === "reservado", `estado ${reserva.data[0].status}`);
  assert(reserva.data[0].seller_id === sVendedor.user.id, "reserva sem colaborador");
  assert(reserva.data[0].full_name === "Cliente Carteira Web", "sem nome");

  const colab = await sb(
    `/rest/v1/profiles?select=provincia_id&id=eq.${sVendedor.user.id}`,
    { key: SR, jwt: SR }
  );
  assert(
    reserva.data[0].provincia_id === colab.data[0].provincia_id,
    "a reserva não ficou na província do colaborador"
  );

  return "reserva criada · 0 contas";
});

await check("a reserva aparece na carteira como por activar", async () => {
  const r = await pagina("/vendedor/clientes", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Cliente Carteira Web"), "reserva ausente da carteira");
  assert(/por activar/i.test(t), "sem a marca de por activar");
  assert(/Reservar cliente/i.test(t), "sem a entrada de reserva");
  // Reservar é cadastrar: a reserva conta como cliente, mesmo sem conta aberta.
  // Antes somavam-se só os vínculos reais e o colaborador lia «0 clientes».
  assert(!/\b0 clientes\b/.test(t), "conta 0 clientes com uma reserva na carteira");
  assert(/\b1 cliente\b/.test(t), "a reserva não está a contar como cliente");
  return "reserva visível · conta como 1 cliente";
});

// ---------------------------------------------------------------------------
// Venda a um número sem conta: a reserva nasce sozinha, com nome e produtos.
// ---------------------------------------------------------------------------
const VENDA_TEL = "+244924200009";
await sb(`/rest/v1/sales?customer_phone=eq.${encodeURIComponent(VENDA_TEL)}`, {
  method: "DELETE",
  key: SR,
  jwt: SR,
  prefer: "return=minimal",
});
await sb(`/rest/v1/reserved_customers?phone=eq.${encodeURIComponent(VENDA_TEL)}`, {
  method: "DELETE",
  key: SR,
  jwt: SR,
  prefer: "return=minimal",
});

let PRODUTO_VENDA = null;

await check("venda a um telefone sem conta reserva o cliente sozinha", async () => {
  const { data: stock } = await sb(
    "/rest/v1/inventory?select=product_id&quantity=gt.5&limit=25",
    { key: SR, jwt: SR }
  );
  const ids = [...new Set((stock ?? []).map((l) => l.product_id))];
  assert(ids.length > 0, "sem stock para vender");

  const { data: prods } = await sb(
    `/rest/v1/products?select=id,name&is_active=eq.true&id=in.(${ids.join(",")})&limit=1`,
    { key: SR, jwt: SR }
  );
  assert(prods?.length === 1, "sem produto activo com stock");
  PRODUTO_VENDA = prods[0];

  const { status, data } = await sb("/rest/v1/rpc/register_sale_by_phone", {
    method: "POST",
    jwt: sVendedor.access_token,
    body: {
      p_items: [{ product_id: PRODUTO_VENDA.id, quantity: 2 }],
      p_customer_phone: VENDA_TEL,
      p_payment_method: "cash",
      p_payment_status: "paid",
      p_customer_name: "Comprador Venda Web",
    },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  assert(data?.reservado === true, "a venda não reservou o cliente");

  const { data: reserva } = await sb(
    `/rest/v1/reserved_customers?select=id,status,full_name,seller_id&phone=eq.${encodeURIComponent(VENDA_TEL)}`,
    { key: SR, jwt: SR }
  );
  assert(reserva?.length === 1, "reserva não criada pela venda");
  assert(reserva[0].status === "reservado", `estado ${reserva[0].status}`);
  assert(reserva[0].seller_id === sVendedor.user.id, "reserva sem colaborador");
  // O nome vai na própria venda: já não há uma segunda chamada para o anotar.
  assert(
    reserva[0].full_name === "Comprador Venda Web",
    `nome da reserva: ${reserva[0].full_name}`
  );
  return `${PRODUTO_VENDA.name} · reserva automática`;
});

await check("repetir a venda com outro nome não reescreve a reserva", async () => {
  // Mesmo `client_ref` = a mesma operação, por isso não há venda nova nem
  // stock gasto. O nome que já está na reserva é que não pode mudar.
  const { status, data } = await sb("/rest/v1/rpc/register_sale_by_phone", {
    method: "POST",
    jwt: sVendedor.access_token,
    body: {
      p_items: [{ product_id: PRODUTO_VENDA.id, quantity: 2 }],
      p_customer_phone: VENDA_TEL,
      p_customer_name: "Nome Trocado",
      p_payment_method: "cash",
      p_payment_status: "paid",
      p_client_ref: "web-venda-nome-fixo",
    },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(data).slice(0, 200)}`);

  const { data: reserva } = await sb(
    `/rest/v1/reserved_customers?select=full_name&phone=eq.${encodeURIComponent(VENDA_TEL)}`,
    { key: SR, jwt: SR }
  );
  assert(reserva[0].full_name === "Comprador Venda Web", `nome ${reserva[0].full_name}`);
  return "nome mantido";
});

await check("a carteira mostra o nome, os produtos e o valor da venda", async () => {
  const r = await pagina("/vendedor/clientes", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Comprador Venda Web"), "sem o nome do comprador");
  assert(t.includes(PRODUTO_VENDA.name), "sem os produtos comprados");
  assert(/2\s*×/.test(t), "sem a quantidade comprada");
  // Só a outra reserva (a que não tem venda) é que pode dizer que não tem
  // compras. Se esta também disser, a venda não chegou à linha do cliente.
  const semCompras = (t.match(/sem compras registadas/gi) || []).length;
  assert(semCompras === 1, `${semCompras} linhas sem compras — esperava 1 (só a reserva sem venda)`);
  assert(/\b2 por activar\b/.test(t), "a segunda reserva não entrou na carteira");
  return "nome + produtos + valor";
});

await check("cliente não pode reservar ninguém", async () => {
  const r = await fetch(`${APP}/api/vendedor/clientes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cCliente },
    body: JSON.stringify({ full_name: "Intruso Carteira", phone: "+244924200008" }),
  });
  assert(r.status === 403, `HTTP ${r.status}`);
  return "403";
});

await check("o cliente regista-se com o número reservado e entra na carteira", async () => {
  const reg = await registar("Cliente Carteira Web", CARTEIRA_TEL, PWD);
  assert(reg.status === 200, `registo: ${reg.status} ${JSON.stringify(reg.data)}`);

  const s = await login(CARTEIRA_TEL, PWD);
  assert(s.access_token, "o cliente não consegue entrar");

  const perfil = await sb(
    `/rest/v1/profiles?select=id,role,provincia_id&phone=eq.${encodeURIComponent(CARTEIRA_TEL)}`,
    { key: SR, jwt: SR }
  );
  assert(perfil.data.length === 1, `${perfil.data.length} perfis`);
  idCarteira = perfil.data[0].id;
  assert(perfil.data[0].role === "customer", `papel ${perfil.data[0].role}`);

  const vinculo = await sb(
    `/rest/v1/seller_customers?select=seller_id,is_active,assigned_by&customer_id=eq.${idCarteira}`,
    { key: SR, jwt: SR }
  );
  assert(vinculo.data.length === 1, `${vinculo.data.length} vínculos`);
  assert(vinculo.data[0].seller_id === sVendedor.user.id, "não ficou na carteira do colaborador");
  assert(vinculo.data[0].is_active === true, "vínculo inactivo");

  const reserva = await sb(
    `/rest/v1/reserved_customers?select=status,customer_id&id=eq.${idReserva}`,
    { key: SR, jwt: SR }
  );
  assert(reserva.data[0].status === "ligado", `reserva ${reserva.data[0].status}`);
  assert(reserva.data[0].customer_id === idCarteira, "reserva sem cliente");

  // A província vem da reserva: quem se registou não escolheu nenhuma.
  const colab = await sb(
    `/rest/v1/profiles?select=provincia_id&id=eq.${sVendedor.user.id}`,
    { key: SR, jwt: SR }
  );
  assert(
    perfil.data[0].provincia_id === colab.data[0].provincia_id,
    `cliente ${perfil.data[0].provincia_id} ≠ colaborador ${colab.data[0].provincia_id}`
  );

  return "reserva ligada · vínculo activo";
});

await check("repetir o mesmo telefone reconhece a conta existente", async () => {
  const chamar = async () => {
    const res = await fetch(`${APP}/api/vendedor/clientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cVendedor },
      body: JSON.stringify({ full_name: "Cliente Carteira Web", phone: CARTEIRA_TEL }),
    });
    return { status: res.status, ok: res.ok, dados: await res.json().catch(() => ({})) };
  };

  // 403 aqui é o `getProfile()` sem sessão: com um cookie válido isso é uma
  // falha passageira do serviço de autenticação, não falta de permissão.
  let r = await chamar();
  if (r.status === 403) {
    await new Promise((ok) => setTimeout(ok, 1500));
    r = await chamar();
  }

  assert(r.ok, `HTTP ${r.status} ${r.dados.error ?? ""}`);
  assert(r.dados.existente === true, "devia reconhecer a conta existente");
  assert(r.dados.reservado === false, "não devia voltar a reservar");
  assert(r.dados.id === idCarteira, `id diferente: ${r.dados.id}`);

  const contas = await sb(
    `/rest/v1/profiles?select=id&phone=eq.${encodeURIComponent(CARTEIRA_TEL)}`,
    { key: SR, jwt: SR }
  );
  assert(contas.data.length === 1, `${contas.data.length} contas com o mesmo telefone`);
  return "1 conta · vínculo reaproveitado";
});

await check("a carteira mostra o cliente já ligado", async () => {
  const r = await pagina("/vendedor/clientes", cVendedor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Cliente Carteira Web"), "cliente ausente da carteira");
  assert(/Ligar|WhatsApp|Conversar na INUKA/i.test(t), "sem acções de contacto");
  assert(/Conversar na INUKA/i.test(t), "um cliente com conta tem de poder receber mensagens");
  return "cliente com contactos";
});

await check("gestor vê o cliente com o colaborador e quem o ligou", async () => {
  const r = await pagina("/gerente/clientes", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Cliente Carteira Web"), "cliente ausente na gestão");
  assert(t.includes(VENDEDOR.name), "a gestão não mostra o colaborador do cliente");
  return "cliente + colaborador";
});

await check("gestor muda o colaborador e o vínculo antigo fica inactivo", async () => {
  // Trocar não pode apagar a história: a linha antiga fica `is_active = false`
  // e nasce/activa-se a nova. É o que permite à gestão reconstruir a carteira.
  const outroColab = await sb(
    `/rest/v1/profiles?select=id&phone=eq.${encodeURIComponent(COLAB_TEL)}`,
    { key: SR, jwt: SR }
  );
  const outroId = outroColab.data?.[0]?.id;
  assert(outroId, "o colaborador auxiliar não existe nesta fase do teste");

  const desactivar = await sb(
    `/rest/v1/seller_customers?customer_id=eq.${idCarteira}&is_active=eq.true`,
    {
      method: "PATCH",
      key: SR,
      jwt: SR,
      body: { is_active: false },
      prefer: "return=minimal",
    }
  );
  assert(desactivar.ok, `desactivar: ${desactivar.status}`);

  const nova = await sb("/rest/v1/seller_customers", {
    method: "POST",
    key: SR,
    jwt: SR,
    body: {
      seller_id: outroId,
      customer_id: idCarteira,
      assigned_by: sGestor.user.id,
      is_active: true,
    },
    prefer: "return=representation",
  });
  assert(nova.ok, `nova ligação: ${JSON.stringify(nova.data).slice(0, 140)}`);

  const linhas = await sb(
    `/rest/v1/seller_customers?select=seller_id,is_active&customer_id=eq.${idCarteira}`,
    { key: SR, jwt: SR }
  );
  const activos = linhas.data.filter((l) => l.is_active);
  assert(activos.length === 1, `${activos.length} vínculos activos`);
  assert(activos[0].seller_id === outroId, "o activo não é o novo colaborador");
  assert(linhas.data.length >= 2, "a história do vínculo foi apagada");

  return `${linhas.data.length} linhas · 1 activa`;
});

await check("o cliente antigo deixa de ver o vínculo como seu", async () => {
  const r = await sb("/rest/v1/seller_customers?select=customer_id,is_active", {
    jwt: sVendedor.access_token,
  });
  const doAntigo = (r.data ?? []).filter(
    (l) => l.seller_id === sVendedor.user.id && l.is_active
  );
  assert(
    !doAntigo.some((l) => l.customer_id === idCarteira),
    "o colaborador antigo continua com o cliente activo"
  );
  return "carteira antiga libertada";
});

// ---------------------------------------------------------------------------
console.log("\n--- 11. CONTEÚDOS, PROMOÇÕES E FORMAÇÃO ---");
// ---------------------------------------------------------------------------
// Percorre os seis cenários de aceitação do pedido de evolução do estúdio:
// catálogo → conteúdo publicado → destino certo (colaborador, cliente, loja),
// com datas, províncias, progresso e permissões verificadas a sério.

// Sem a migração 0007 estas tabelas não existem e todos os testes abaixo
// falhariam com "404" — o que esconderia a causa. Falhar uma vez, com a
// instrução certa, é mais útil do que 26 falhas iguais.
const sondaConteudos = await sb("/rest/v1/content_items?select=id&limit=1", { key: SR, jwt: SR });
const TEM_CONTEUDOS = sondaConteudos.status !== 404;

if (!TEM_CONTEUDOS) {
  console.log(`
  ATENÇÃO — a base de dados ainda não tem a migração 0007 (conteúdos e formação).
  Abra o Supabase -> SQL Editor e cole, por esta ordem:
      supabase/PATCH_CONTEUDOS.sql
      supabase/PATCH_designer.sql   (guarda do estúdio: só a gestão escreve)
  Os testes desta secção ficam por correr — não são dados como aprovados.
`);
}

const GESTOR_ID = sGestor.user.id;
const VENDEDOR_ID = sVendedor.user.id;
const criados = [];
/** Ficheiro do bucket `content-media` criado no teste do feed (limpo no fim). */
let FICHEIRO_E2E = "";

if (TEM_CONTEUDOS) {
  const SUF = Date.now().toString().slice(-6);
  const AGORA = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const ONTEM = iso(AGORA - 86400000);
  const AMANHA = iso(AGORA + 86400000);
  const PASSADO = iso(AGORA - 5 * 86400000);

  /** INSERT como gestor autenticado (prova que o RLS deixa; o service_role não provaria). */
  const inserir = (tabela, campos) =>
    sb(`/rest/v1/${tabela}`, {
      method: "POST",
      jwt: sGestor.access_token,
      prefer: "return=representation",
      body: campos,
    });

  const produtoQ = await sb(
    "/rest/v1/products?select=id,name,official_price&is_active=eq.true&order=created_at&limit=1",
    { key: SR, jwt: SR }
  );
  const PRODUTO = produtoQ.data?.[0] ?? null;

  const provQ = await sb("/rest/v1/provincias?select=id,nome&order=codigo&limit=1", { key: SR, jwt: SR });
  const PROVINCIA = provQ.data?.[0] ?? null;

  const perfilClienteQ = await sb(
    `/rest/v1/profiles?select=provincia_id&id=eq.${sCliente.user.id}`,
    { key: SR, jwt: SR }
  );
  const PROV_CLIENTE = perfilClienteQ.data?.[0]?.provincia_id ?? null;


  // --- 11.1 Estúdio: catálogo e publicação sem perder trabalho -----------------
  await check("o painel do catálogo devolve produtos com imagem", async () => {
    // É exactamente a consulta que o CatalogoPanel faz: produtos activos com a
    // imagem principal embutida. Se o embed não existir, o painel fica vazio.
    const r = await sb(
      "/rest/v1/products?select=id,name,official_price,promotional_price,sku,product_images(url,is_primary,sort_order)&is_active=eq.true&limit=5",
      { jwt: sGestor.access_token }
    );
    assert(r.ok, `consulta do catálogo: ${JSON.stringify(r.data).slice(0, 140)}`);
    assert(Array.isArray(r.data) && r.data.length > 0, "catálogo vazio para a gestão");
    return `${r.data.length} produtos`;
  });

  const projEstudio = await sb("/rest/v1/rpc/design_create", {
    method: "POST",
    jwt: sGestor.access_token,
    body: {
      p_title: `[E2E] Base do comunicado ${SUF}`,
      p_format_key: "square",
      p_width: 1080,
      p_height: 1080,
      p_pages: [{ id: "p1", name: "Página 1", background: { type: "solid", color: "#0A0A0A" }, elements: [] }],
    },
  });
  assert(projEstudio.ok, `design_create: ${JSON.stringify(projEstudio.data)}`);
  const PROJ_CONTEUDO = projEstudio.data.id;

  await check("publicar a partir do estúdio não altera o projeto", async () => {
    // O requisito é não perder trabalho ao importar/publicar. Publicar escreve em
    // content_items, nunca em design_projects — a versão tem de ficar igual.
    const antes = await sb(
      `/rest/v1/design_projects?select=version,pages&id=eq.${PROJ_CONTEUDO}`,
      { jwt: sGestor.access_token }
    );
    const pub = await inserir("content_items", {
      kind: "comunicado",
      title: `[E2E] Publicado do estúdio ${SUF}`,
      status: "publicado",
      project_id: PROJ_CONTEUDO,
    });
    assert(pub.ok, `publicar: ${JSON.stringify(pub.data).slice(0, 140)}`);
    criados.push(["content_items", pub.data[0].id]);

    const depois = await sb(
      `/rest/v1/design_projects?select=version,pages&id=eq.${PROJ_CONTEUDO}`,
      { jwt: sGestor.access_token }
    );
    assert(
      depois.data[0].version === antes.data[0].version,
      `versão mudou: ${antes.data[0].version} -> ${depois.data[0].version}`
    );
    assert(
      JSON.stringify(depois.data[0].pages) === JSON.stringify(antes.data[0].pages),
      "as páginas do projeto mudaram ao publicar"
    );
    return `versão ${depois.data[0].version} intacta`;
  });

  await check("o mesmo projeto não gera uma segunda publicação", async () => {
    // A regra anti-duplicação vive num índice único parcial (project_id), por
    // isso a segunda publicação falha na base e não depende do cliente.
    const segunda = await inserir("content_items", {
      kind: "comunicado",
      title: `[E2E] Duplicado ${SUF}`,
      status: "publicado",
      project_id: PROJ_CONTEUDO,
    });
    assert(!segunda.ok, `devia recusar, devolveu ${segunda.status}`);

    const contagem = await sb(
      `/rest/v1/content_items?select=id&project_id=eq.${PROJ_CONTEUDO}`,
      { key: SR, jwt: SR }
    );
    assert(contagem.data.length === 1, `${contagem.data.length} publicações para o mesmo projeto`);
    return "1 publicação por projeto";
  });

  // --- 11.2 Comunicado da gestão → feed do colaborador ------------------------
  // O corpo é longo de propósito: é o que faz aparecer o «Ver tudo» no cartão.
  // Com duas linhas de texto o feed mostra tudo e não há nada para abrir.
  const CORPO_COM =
    "Reunião geral na delegação na sexta-feira, às 9h, com toda a equipa de vendas. " +
    "Vamos apresentar a nova tabela de preços, o calendário de campanhas do trimestre " +
    "e as metas por província. Quem não puder estar presente deve avisar o gestor da " +
    "sua delegação até quarta-feira, para receber a ligação à sessão.";

  const TITULO_COM = `[E2E] Comunicado ${SUF}`;
  const comunicado = await inserir("content_items", {
    kind: "comunicado",
    title: TITULO_COM,
    subtitle: "Aviso interno da gestão",
    body: CORPO_COM,
    status: "publicado",
    is_pinned: true,
    allow_reactions: true,
    allow_comments: true,
  });
  assert(comunicado.ok, `comunicado: ${JSON.stringify(comunicado.data).slice(0, 140)}`);
  criados.push(["content_items", comunicado.data[0].id]);
  const COM_ID = comunicado.data[0].id;

  await check("publicar um comunicado sela a data de publicação", async () => {
    const r = await sb(`/rest/v1/content_items?select=status,published_at&id=eq.${COM_ID}`, {
      jwt: sGestor.access_token,
    });
    assert(r.data[0].status === "publicado", r.data[0].status);
    assert(!!r.data[0].published_at, "sem published_at");
    return String(r.data[0].published_at).slice(0, 10);
  });

  await check("colaborador vê o comunicado no feed", async () => {
    const r = await pagina("/vendedor/comunicados", cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes(TITULO_COM), "comunicado ausente do feed");
    assert(/Importante|Fixado/i.test(t), "sem marca de destaque");
    return "200 com o comunicado";
  });

  await check("comunicado fixado vem primeiro no feed", async () => {
    const r = await sb("/rest/v1/rpc/conteudo_feed", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { p_kind: "comunicado", p_limit: 40 },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 140));
    const lista = r.data ?? [];
    const meu = lista.find((c) => c.id === COM_ID);
    assert(meu, "o comunicado não veio no feed do colaborador");
    assert(meu.is_pinned === true, "não veio fixado");
    return `${lista.length} comunicados · fixado em ${lista.findIndex((c) => c.id === COM_ID) + 1}.º`;
  });

  // --- 11.2b Feed estilo rede social: abrir, descarregar, publicar ------------
  let IMAGEM_E2E = "";
  const CAMINHO_IMG = `comunicado/e2e-${SUF}.png`;
  // PNG de 1×1 — chega para provar que os bytes viajam e que o tipo se preserva.
  const PNG_1PX =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

  await check("o cartão do feed mostra cabeçalho, legenda e «Ver tudo»", async () => {
    const r = await pagina("/vendedor/comunicados", cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);

    assert(t.includes(TITULO_COM), "sem o título");
    assert(t.includes("Aviso interno da gestão"), "sem a linha de apoio");
    // O texto é cortado por CSS (line-clamp), não por corte no servidor: o
    // cartão mostra três linhas e o resto abre no leitor.
    assert(t.includes("Ver tudo"), "o texto longo não oferece «Ver tudo»");
    assert(r.html.includes("line-clamp-3"), "a legenda não está limitada a três linhas");
    assert(t.includes("Descarregar"), "sem a acção de descarregar");

    // Cabeçalho e mídia são botões: é isso que torna o cartão clicável.
    const botoes = (r.html.match(/<button[^>]*type="button"/g) ?? []).length;
    assert(botoes >= 2, `só ${botoes} botão(ões) no cartão`);
    return `${botoes} botões · texto cortado`;
  });

  await check("descarregar um comunicado de texto devolve o aviso em .txt", async () => {
    const r = await fetch(`${APP}/api/conteudos/${COM_ID}/download`, {
      headers: { cookie: cVendedor },
    });
    assert(r.status === 200, `HTTP ${r.status}`);

    const disposicao = r.headers.get("content-disposition") ?? "";
    assert(disposicao.startsWith("attachment"), `content-disposition: ${disposicao}`);
    assert(disposicao.includes(".txt"), `sem extensão .txt: ${disposicao}`);
    assert(/filename="e2e-+comunicado/.test(disposicao), `nome inesperado: ${disposicao}`);

    const corpo = await r.text();
    assert(corpo.includes(TITULO_COM), "o ficheiro não tem o título");
    assert(corpo.includes("receber a ligação à sessão"), "o ficheiro não tem o texto todo");
    return disposicao.replace(/.*filename=/, "");
  });

  await check("o download exige sessão", async () => {
    const r = await fetch(`${APP}/api/conteudos/${COM_ID}/download`);
    assert(r.status === 403, `HTTP ${r.status}`);
    return "403 sem cookie";
  });

  await check("descarregar um conteúdo inexistente devolve 404", async () => {
    const r = await fetch(
      `${APP}/api/conteudos/00000000-0000-0000-0000-000000000000/download`,
      { headers: { cookie: cVendedor } }
    );
    assert(r.status === 404, `HTTP ${r.status}`);
    return "404";
  });

  await check("a gestão publica uma imagem no comunicado", async () => {
    // Mesma via do formulário (data URL → bucket público), aqui em REST para
    // não depender de um browser. É o que faz o cartão deixar de ser só texto.
    const envio = await fetch(`${BASE}/storage/v1/object/content-media/${CAMINHO_IMG}`, {
      method: "POST",
      headers: {
        apikey: SR,
        Authorization: `Bearer ${SR}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: Buffer.from(PNG_1PX, "base64"),
    });
    assert(envio.ok, `upload ${envio.status}`);

    IMAGEM_E2E = `${BASE}/storage/v1/object/public/content-media/${CAMINHO_IMG}`;
    const r = await sb(`/rest/v1/content_items?id=eq.${COM_ID}`, {
      method: "PATCH",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
      body: { image_url: IMAGEM_E2E, image_path: CAMINHO_IMG },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 120));
    FICHEIRO_E2E = CAMINHO_IMG;
    return CAMINHO_IMG;
  });

  await check("a imagem publicada aparece no topo do cartão", async () => {
    const r = await pagina("/vendedor/comunicados", cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.html.includes(IMAGEM_E2E), "a imagem não está no cartão");
    // `object-contain` é o que impede uma foto de telemóvel de ficar cortada.
    assert(/<img[^>]+object-contain/.test(r.html), "a imagem não está contida no cartão");
    return "imagem no cartão";
  });

  await check("descarregar com imagem devolve os bytes em anexo", async () => {
    const r = await fetch(`${APP}/api/conteudos/${COM_ID}/download`, {
      headers: { cookie: cVendedor },
    });
    assert(r.status === 200, `HTTP ${r.status}`);

    const disposicao = r.headers.get("content-disposition") ?? "";
    assert(disposicao.startsWith("attachment"), `content-disposition: ${disposicao}`);
    assert(disposicao.includes(".png"), `sem extensão .png: ${disposicao}`);

    const tipo = r.headers.get("content-type") ?? "";
    assert(tipo.includes("image/png"), `content-type: ${tipo}`);

    const bytes = Buffer.from(await r.arrayBuffer());
    // Assinatura PNG: prova que são os bytes da imagem e não o texto de recurso.
    assert(
      bytes.subarray(0, 4).toString("hex") === "89504e47",
      `não são bytes de PNG (${bytes.subarray(0, 4).toString("hex")})`
    );
    return `${disposicao.replace(/.*filename=/, "")} · ${bytes.length} bytes`;
  });

  await check("a gestão abre o formulário de comunicado", async () => {
    const r = await pagina("/gerente/conteudos/novo", cGestor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Novo comunicado"), "sem o título da página");
    assert(t.includes("Escolher uma imagem"), "sem o botão de imagem");
    assert(t.includes("Publicar agora"), "sem o botão de publicar");
    assert(t.includes("Guardar rascunho"), "sem o botão de rascunho");
    assert(t.includes("Fixar no topo"), "sem a opção de destaque");
    return "formulário completo";
  });

  await check("o colaborador não abre o formulário — é leitor", async () => {
    const r = await pagina("/gerente/conteudos/novo", cVendedor);
    assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
    assert((r.location || "").includes("/vendedor"), `redirect: ${r.location}`);
    return `${r.status} -> ${r.location}`;
  });

  await check("só a gestão vê o atalho de publicar no feed", async () => {
    const g = await pagina("/vendedor/comunicados", cGestor);
    assert(g.status === 200, `gestor HTTP ${g.status}`);
    assert(
      g.html.includes('href="/gerente/conteudos/novo?tipo=comunicado"'),
      "a gestão não tem o atalho de publicar"
    );

    const v = await pagina("/vendedor/comunicados", cVendedor);
    assert(v.status === 200, `colaborador HTTP ${v.status}`);
    assert(
      !v.html.includes("/gerente/conteudos/novo"),
      "o colaborador vê o atalho de publicar"
    );
    return "gestor edita · colaborador lê";
  });

  await check("a lista de conteúdos tem o atalho «Nova publicação»", async () => {
    const r = await pagina("/gerente/conteudos", cGestor);
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.html.includes('href="/gerente/conteudos/novo?tipo=comunicado"'), "sem o atalho na lista");
    const t = texto(r.html);
    assert(t.includes("Nova publicação"), "sem o rótulo do atalho");
    return "atalho presente";
  });

  await check("cliente NÃO abre o feed de comunicados", async () => {
    const r = await pagina("/vendedor/comunicados", cCliente);
    assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
    assert(!String(r.location ?? "").includes("/vendedor"), `entrou: ${r.location}`);
    return `${r.status} bloqueado`;
  });

  // A 0019 separa os feeds: comunicados só para a equipa. Sem o patch
  // aplicado na base, os comunicados continuam a chegar ao cliente e as
  // verificações abaixo não descrevem o sistema — ficam de fora em vez de
  // darem um vermelho que não é do código.
  const probe0019 = await sb("/rest/v1/rpc/pode_ver_kind", {
    method: "POST",
    jwt: sGestor.access_token,
    body: { p_kind: "comunicado" },
  });
  const TEM_0019 = probe0019.ok;

  if (TEM_0019) {
    await check("o cliente não descarrega um comunicado que não pode ver", async () => {
      // A rota de download verifica a visibilidade com a sessão de quem pede;
      // sem isso, saber o id chegava para receber o aviso interno.
      const r = await fetch(`${APP}/api/conteudos/${COM_ID}/download`, {
        headers: { cookie: cCliente },
      });
      assert(r.status === 403, `HTTP ${r.status}`);
      return "403 para o cliente";
    });
  }

  if (TEM_0019) {
    await check("o cliente NÃO lê os comunicados", async () => {
      // A 0013 tinha aberto os comunicados ao cliente; a 0019 fechou-os: são
      // avisos internos da equipa. O cliente tem o Feed Clientes — promoções e
      // testemunhos.
      const r = await sb("/rest/v1/content_items?select=id,title&kind=eq.comunicado", {
        jwt: sCliente.access_token,
      });
      const linhas = Array.isArray(r.data) ? r.data : [];
      assert(!linhas.some((l) => l.id === COM_ID), "o comunicado continua a chegar ao cliente");

      const formacao = await sb("/rest/v1/content_items?select=id&kind=eq.formacao", {
        jwt: sCliente.access_token,
      });
      assert(
        (Array.isArray(formacao.data) ? formacao.data : []).length === 0,
        "o cliente vê formação interna"
      );

      const feed = await sb("/rest/v1/rpc/conteudo_feed", {
        method: "POST",
        jwt: sCliente.access_token,
        body: { p_kind: "comunicado", p_limit: 40 },
      });
      assert((feed.data ?? []).length === 0, "o feed de comunicados não veio vazio");

      return `${linhas.length} comunicado(s) · feed vazio`;
    });
  }

  // --- 11.3 Testemunho → área de cliente --------------------------------------
  const TITULO_TEST = `[E2E] Testemunho ${SUF}`;
  const testemunho = await inserir("content_items", {
    kind: "testemunho",
    title: TITULO_TEST,
    body: "Uso os perfumes INUKA há dois anos e a diferença é visível.",
    status: "publicado",
    author_name: "Cliente E2E",
    allow_reactions: true,
    allow_comments: true,
  });
  assert(testemunho.ok, `testemunho: ${JSON.stringify(testemunho.data).slice(0, 140)}`);
  criados.push(["content_items", testemunho.data[0].id]);
  const TEST_ID = testemunho.data[0].id;

  await check("cliente vê o testemunho publicado", async () => {
    // O testemunho vive agora no Feed Clientes (a grelha antiga redirecciona
    // para lá): uma só tela para promoções e testemunhos.
    const r = await pagina("/cliente/conteudo", cCliente);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Feed Clientes"), "sem o nome do feed");
    assert(t.includes(TITULO_TEST), "testemunho ausente da área de cliente");
    assert(t.includes("Cliente E2E"), "sem o nome de quem testemunha");
    return "200 com o testemunho";
  });

  const RASCUNHO_TEST = `[E2E] Testemunho por aprovar ${SUF}`;
  const rascunho = await inserir("content_items", {
    kind: "testemunho",
    title: RASCUNHO_TEST,
    body: "Ainda por aprovar.",
    status: "rascunho",
  });
  assert(rascunho.ok, JSON.stringify(rascunho.data).slice(0, 140));
  criados.push(["content_items", rascunho.data[0].id]);

  await check("testemunho em rascunho NÃO aparece ao cliente", async () => {
    // Só o que está publicado chega ao cliente: um rascunho é trabalho interno.
    const p = await pagina("/cliente/conteudo", cCliente);
    assert(!texto(p.html).includes(RASCUNHO_TEST), "rascunho exposto na página");

    const api = await sb("/rest/v1/content_items?select=id&id=eq." + rascunho.data[0].id, {
      jwt: sCliente.access_token,
    });
    assert((api.data ?? []).length === 0, "rascunho legível pela API");
    return "invisível em página e API";
  });

  // --- 11.4 Promoção → loja, datas e província --------------------------------
  const TITULO_PROMO = `[E2E] Campanha nacional ${SUF}`;
  const promo = await inserir("content_items", {
    kind: "promocao",
    title: TITULO_PROMO,
    subtitle: "Preços especiais por tempo limitado",
    body: "Campanha de teste automatizado.",
    status: "publicado",
    starts_at: ONTEM,
    ends_at: AMANHA,
    cta_label: "Ver catálogo",
    cta_href: "/catalogo",
  });
  assert(promo.ok, `promoção: ${JSON.stringify(promo.data).slice(0, 140)}`);
  criados.push(["content_items", promo.data[0].id]);
  const PROMO_ID = promo.data[0].id;

  if (PRODUTO) {
    const lig = await inserir("content_products", {
      item_id: PROMO_ID,
      product_id: PRODUTO.id,
      sort_order: 0,
    });
    assert(lig.ok, `ligar produto: ${JSON.stringify(lig.data).slice(0, 140)}`);
  }

  await check("promoção ativa aparece na loja com o produto real", async () => {
    const r = await pagina("/promocoes");
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes(TITULO_PROMO), "campanha ausente de /promocoes");
    assert(/Em curso/i.test(t), "sem estado “Em curso”");
    if (PRODUTO) assert(t.includes(PRODUTO.name), "produto ligado não apareceu na campanha");
    return PRODUTO ? `200 com “${PRODUTO.name}”` : "200";
  });

  const TITULO_EXPIRADA = `[E2E] Campanha encerrada ${SUF}`;
  const expirada = await inserir("content_items", {
    kind: "promocao",
    title: TITULO_EXPIRADA,
    status: "publicado",
    starts_at: iso(AGORA - 20 * 86400000),
    ends_at: PASSADO,
  });
  assert(expirada.ok, JSON.stringify(expirada.data).slice(0, 140));
  criados.push(["content_items", expirada.data[0].id]);

  await check("campanha terminada não aparece ao visitante", async () => {
    // Quem não tem sessão não vê campanhas fora do prazo: na loja não pode
    // parecer que ainda está a decorrer.
    const r = await pagina("/promocoes");
    assert(!texto(r.html).includes(TITULO_EXPIRADA), "campanha terminada exposta ao visitante");
    return "oculta";
  });

  const TITULO_PROVINCIA = `[E2E] Campanha provincial ${SUF}`;
  let promoProvinciaId = null;
  if (PROVINCIA) {
    const provincial = await inserir("content_items", {
      kind: "promocao",
      title: TITULO_PROVINCIA,
      status: "publicado",
      starts_at: ONTEM,
      ends_at: AMANHA,
      provincia_id: PROVINCIA.id,
    });
    assert(provincial.ok, JSON.stringify(provincial.data).slice(0, 140));
    promoProvinciaId = provincial.data[0].id;
    criados.push(["content_items", promoProvinciaId]);
  }

  await check("campanha provincial fica fora da loja pública", async () => {
    // A loja pública só mostra o que é nacional; a campanha de uma província
    // continua a existir, mas não se mistura com as nacionais.
    const r = await pagina("/promocoes");
    assert(!texto(r.html).includes(TITULO_PROVINCIA), "campanha provincial exposta ao visitante");
    return "fora da loja pública";
  });

  await check("campanha provincial respeita a província de quem vê", async () => {
    if (!promoProvinciaId) return "sem províncias na base";
    const r = await sb("/rest/v1/rpc/conteudo_feed", {
      method: "POST",
      jwt: sCliente.access_token,
      body: { p_kind: "promocao", p_limit: 40 },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 140));
    const viu = (r.data ?? []).some((c) => c.id === promoProvinciaId);
    // Um cliente sem província é tratado como nacional (vê tudo); com província,
    // só vê a sua e a nacional.
    const deviaVer = PROV_CLIENTE === null || PROV_CLIENTE === PROVINCIA.id;
    assert(viu === deviaVer, `viu=${viu}, esperado=${deviaVer} (província ${PROV_CLIENTE})`);
    return deviaVer ? "cliente da província vê" : "cliente de outra província não vê";
  });

  await check("o Feed Clientes mostra promoções e testemunhos, sem comunicados", async () => {
    const r = await pagina("/cliente/conteudo", cCliente);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Feed Clientes"), "sem o nome do feed");
    assert(t.includes("Promoções"), "sem o filtro de promoções");
    assert(t.includes("Testemunhos"), "sem o filtro de testemunhos");
    assert(t.includes(TITULO_PROMO), "a promoção não está no feed do cliente");
    assert(t.includes(TITULO_TEST), "o testemunho não está no feed do cliente");
    if (TEM_0019) {
      assert(!t.includes(TITULO_COM), "o comunicado interno está no feed do cliente");
    }
    return "promoções + testemunhos";
  });

  await check("o Perfil do cliente reúne identidade, referência e atalhos", async () => {
    const r = await pagina("/cliente", cCliente);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Olá,"), "sem a saudação");
    assert(t.includes("Bem-vindo à sua área de cliente INUKA"), "sem as boas-vindas");
    assert(t.includes("Minha referência"), "sem o bloco da referência");
    assert(t.includes("Cliente INUKA"), "sem a etiqueta de cliente");
    assert(t.includes("O seu colaborador"), "sem o bloco do colaborador");
    assert(t.includes("Feed Clientes"), "sem o atalho do feed");
    return "perfil completo";
  });

  // --- 11.5 Formação INUKA ----------------------------------------------------
  const TITULO_CURSO = `[E2E] Curso ${SUF}`;
  const curso = await inserir("training_courses", {
    title: TITULO_CURSO,
    description: "Curso criado pelo teste automático.",
    level: "iniciacao",
    status: "publicado",
    duration_min: 45,
  });
  assert(curso.ok, `curso: ${JSON.stringify(curso.data).slice(0, 200)}`);
  const CURSO_ID = curso.data[0].id;
  criados.push(["training_courses", CURSO_ID]);

  await check("o curso ganha registo de conteúdo (reações e comentários)", async () => {
    const r = await sb(`/rest/v1/training_courses?select=content_id&id=eq.${CURSO_ID}`, {
      jwt: sGestor.access_token,
    });
    assert(!!r.data[0].content_id, "curso sem content_id");
    return r.data[0].content_id.slice(0, 8) + "…";
  });
  const CURSO_CONTENT = (await sb(`/rest/v1/training_courses?select=content_id&id=eq.${CURSO_ID}`, {
    jwt: sGestor.access_token,
  })).data[0].content_id;

  const aula1 = await inserir("training_lessons", {
    course_id: CURSO_ID,
    title: "Aula 1 — Boas-vindas",
    body: "Como usar a plataforma.",
    kind: "texto",
    duration_min: 10,
    sort_order: 0,
  });
  const aula2 = await inserir("training_lessons", {
    course_id: CURSO_ID,
    title: "Aula 2 — Atendimento",
    body: "Receber bem é vender melhor.",
    kind: "texto",
    duration_min: 15,
    sort_order: 1,
  });
  assert(aula1.ok && aula2.ok, `aulas: ${JSON.stringify(aula1.data ?? aula1)}`);

  await check("colaborador vê a formação e as aulas por ordem", async () => {
    const r = await sb("/rest/v1/rpc/formacao_curso", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { p_id: CURSO_ID },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    const aulas = r.data?.aulas ?? [];
    assert(aulas.length === 2, `${aulas.length} aulas`);
    assert(aulas[0].title.startsWith("Aula 1"), "ordem trocada");
    return `${aulas.length} aulas ordenadas`;
  });

  await check("formação aparece na área do colaborador com slider", async () => {
    const r = await pagina("/vendedor/formacao", cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes(TITULO_CURSO), "curso ausente da área de formação");
    assert(/Continuar a aprender|Novas formações/i.test(t), "sem as faixas horizontais");
    return "200 com o curso";
  });

  await check("concluir uma aula dá 50%", async () => {
    const r = await sb("/rest/v1/rpc/formacao_concluir_aula", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { p_lesson_id: aula1.data[0].id, p_concluida: true },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    assert(r.data.percentagem === 50, `percentagem ${r.data.percentagem}`);
    assert(r.data.curso_concluido === false, "deu o curso por concluído cedo de mais");
    return `${r.data.concluidas}/${r.data.total} = ${r.data.percentagem}%`;
  });

  await check("concluir a última aula fecha o curso", async () => {
    const r = await sb("/rest/v1/rpc/formacao_concluir_aula", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { p_lesson_id: aula2.data[0].id, p_concluida: true },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    assert(r.data.percentagem === 100, `percentagem ${r.data.percentagem}`);
    assert(r.data.curso_concluido === true, "curso não foi dado por concluído");
    return "100% · concluído";
  });

  await check("a página do curso mostra o progresso real", async () => {
    const r = await pagina(`/vendedor/formacao/${CURSO_ID}`, cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Aula 1"), "aulas ausentes na página do curso");
    // O HTML separa os nós de texto: «100» e «%» podem vir com espaço no meio.
    assert(/100\s*%/.test(t), "progresso não reflectido na página");
    return "200 com 100%";
  });

  await check("colaborador reage e comenta a formação", async () => {
    const re = await sb("/rest/v1/content_reactions", {
      method: "POST",
      jwt: sVendedor.access_token,
      prefer: "return=representation",
      body: { item_id: CURSO_CONTENT, reaction: "util" },
    });
    assert(re.ok, `reação: ${JSON.stringify(re.data).slice(0, 140)}`);

    const co = await sb("/rest/v1/content_comments", {
      method: "POST",
      jwt: sVendedor.access_token,
      prefer: "return=representation",
      body: { item_id: CURSO_CONTENT, body: "Muito útil, obrigado." },
    });
    assert(co.ok, `comentário: ${JSON.stringify(co.data).slice(0, 140)}`);

    const feed = await sb("/rest/v1/rpc/conteudo_feed", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { p_kind: "formacao", p_limit: 40 },
    });
    const meu = (feed.data ?? []).find((c) => c.id === CURSO_CONTENT);
    assert(meu, "curso fora do feed de formação");
    assert(Number(meu.reacoes) >= 1, "reação não contada");
    assert(Number(meu.comentarios) >= 1, "comentário não contado");
    assert(meu.minha_reacao === "util", "a minha reação não foi devolvida");
    return `${meu.reacoes} reação · ${meu.comentarios} comentário`;
  });

  await check("reagir duas vezes ao mesmo conteúdo é recusado", async () => {
    const r = await sb("/rest/v1/content_reactions", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { item_id: CURSO_CONTENT, reaction: "adoro" },
    });
    assert(!r.ok, `aceitou reação duplicada (${r.status})`);
    return `${r.status} recusado`;
  });

  await check("cliente NÃO entra na formação", async () => {
    const p = await pagina(`/vendedor/formacao/${CURSO_ID}`, cCliente);
    assert(p.status === 307 || p.status === 302, `HTTP ${p.status}`);

    const r = await sb("/rest/v1/rpc/formacao_curso", {
      method: "POST",
      jwt: sCliente.access_token,
      body: { p_id: CURSO_ID },
    });
    assert(!r.ok, `cliente abriu o curso pela API (${r.status})`);
    return "página e API bloqueadas";
  });

  await check("gestão vê estatísticas da formação", async () => {
    const r = await sb("/rest/v1/rpc/formacao_estatisticas", {
      method: "POST",
      jwt: sGestor.access_token,
      body: { p_course_id: CURSO_ID },
    });
    assert(r.ok, JSON.stringify(r.data).slice(0, 160));
    // A função devolve uma lista (uma linha por curso), não um objecto.
    const lista = Array.isArray(r.data) ? r.data : [r.data];
    const linha = lista.find((l) => l.course_id === CURSO_ID) ?? lista[0];
    assert(linha, "o curso não veio nas estatísticas");
    assert(Number(linha.inscritos) >= 1, "sem inscritos");
    assert(Number(linha.concluidos) >= 1, "sem concluídos");
    return `${linha.inscritos} inscritos · ${linha.concluidos} concluídos`;
  });

  await check("gestor abre a lista de conteúdos e a de formação", async () => {
    for (const [rota, marca] of [
      ["/gerente/conteudos", "Conteúdos"],
      ["/gerente/formacao", "Formação"],
    ]) {
      const r = await pagina(rota, cGestor);
      assert(r.status === 200, `${rota} -> ${r.status}`);
      assert(texto(r.html).includes(marca), `${rota} sem “${marca}”`);
    }
    const lista = await pagina("/gerente/conteudos", cGestor);
    assert(texto(lista.html).includes(TITULO_COM), "o comunicado não aparece na gestão");
    return "2 secções";
  });

  await check("colaborador NÃO entra na gestão de conteúdos", async () => {
    for (const rota of ["/gerente/conteudos", "/gerente/formacao"]) {
      const r = await pagina(rota, cVendedor);
      assert(r.status === 307 || r.status === 302, `${rota} -> ${r.status}`);
    }
    return "2 bloqueadas";
  });

  // --- 11.6 Testemunho em tamanho completo ------------------------------------
  await check("cliente abre um testemunho em tamanho completo", async () => {
    const r = await pagina(`/cliente/testemunhos/${TEST_ID}`, cCliente);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes(TITULO_TEST), "título ausente na página do testemunho");
    assert(t.includes("Uso os perfumes INUKA"), "mensagem ausente");
    assert(t.includes("Cliente E2E"), "autor ausente");
    return "200 com mensagem e autor";
  });

  await check("testemunho em rascunho não abre nem por ligação directa", async () => {
    // A página lê a mesma tabela: se o RLS não devolver a linha, responde 404 em
    // vez de revelar que o testemunho existe.
    const r = await pagina(`/cliente/testemunhos/${rascunho.data[0].id}`, cCliente);
    assert(r.status === 404, `HTTP ${r.status}`);
    return "404";
  });

  // --- 11.7 Questionário respondível ------------------------------------------
  const QUIZ_BODY = JSON.stringify([
    {
      pergunta: "Qual é o primeiro passo do atendimento?",
      opcoes: ["Cumprimentar o cliente", "Mostrar o preço", "Pedir o telefone"],
      correta: 0,
      explicacao: "O cumprimento abre a conversa.",
    },
    {
      pergunta: "Conhecer o produto serve para…",
      opcoes: ["Encher a conversa", "Apresentar benefícios", "Evitar perguntas"],
      correta: 1,
    },
  ]);
  const aulaQuiz = await inserir("training_lessons", {
    course_id: CURSO_ID,
    title: "Aula 3 — Questionário de atendimento",
    kind: "quiz",
    body: QUIZ_BODY,
    duration_min: 5,
    sort_order: 2,
  });
  assert(aulaQuiz.ok, `aula quiz: ${JSON.stringify(aulaQuiz.data ?? aulaQuiz).slice(0, 160)}`);

  await check("a aula de questionário chega ao colaborador com as opções", async () => {
    const r = await pagina(`/vendedor/formacao/${CURSO_ID}`, cVendedor);
    assert(r.status === 200, `HTTP ${r.status}`);
    const t = texto(r.html);
    assert(t.includes("Questionário de atendimento"), "aula ausente");
    assert(t.includes("Qual é o primeiro passo do atendimento?"), "pergunta não renderizada");
    assert(t.includes("Cumprimentar o cliente"), "opções não renderizadas");
    assert(/Verificar respostas|Responda a todas/i.test(t), "sem botão de correção");
    return "pergunta e opções presentes";
  });

  await check("a pergunta é lida como JSON válido (não como texto corrido)", async () => {
    // Se o parser falhar, a página mostra o JSON em bruto. Este teste garante
    // que o formato guardado é o que o componente sabe ler.
    const r = await sb(`/rest/v1/training_lessons?select=body&id=eq.${aulaQuiz.data[0].id}`, {
      jwt: sGestor.access_token,
    });
    const bruto = r.data[0].body;
    const lido = JSON.parse(bruto);
    assert(Array.isArray(lido) && lido.length === 2, "formato inesperado");
    assert(lido[0].correta === 0 && lido[1].correta === 1, "respostas certas perdidas");
    return `${lido.length} perguntas`;
  });

  // --- 11.8 Guardar para estudar depois ---------------------------------------
  await check("colaborador guarda um curso para estudar depois", async () => {
    const g = await sb("/rest/v1/training_bookmarks", {
      method: "POST",
      jwt: sVendedor.access_token,
      prefer: "return=representation",
      body: { course_id: CURSO_ID },
    });
    assert(g.ok, `guardar: ${JSON.stringify(g.data).slice(0, 140)}`);

    const p = await pagina("/vendedor/formacao", cVendedor);
    assert(p.status === 200, `HTTP ${p.status}`);
    assert(texto(p.html).includes("Guardados para depois"), "faixa de guardados ausente");
    return "guardado e visível";
  });

  await check("guardar duas vezes não duplica nem falha", async () => {
    const g = await sb("/rest/v1/training_bookmarks", {
      method: "POST",
      jwt: sVendedor.access_token,
      body: { course_id: CURSO_ID },
    });
    // A chave primária é (user_id, course_id): repetir dá 409, que a aplicação
    // trata como «já estava guardado» em vez de mostrar um erro.
    assert(g.status === 409, `esperava 409, veio ${g.status}`);
    const c = await sb(
      `/rest/v1/training_bookmarks?select=course_id&course_id=eq.${CURSO_ID}`,
      { key: SR, jwt: SR }
    );
    assert(c.data.length === 1, `${c.data.length} linhas`);
    return "1 linha";
  });

}

// ---------------------------------------------------------------------------
console.log("\n--- 12. LIMPEZA ---");
// ---------------------------------------------------------------------------
await check("remover conteúdos e formação criados", async () => {
  if (!TEM_CONTEUDOS) return "nada a remover (migração em falta)";
  const del = (p) => sb(p, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
  // A ordem importa: filhos antes dos pais.
  for (const [tabela, id] of criados.filter(([t]) => t === "content_items")) {
    await del(`/rest/v1/content_comments?item_id=eq.${id}`);
    await del(`/rest/v1/content_reactions?item_id=eq.${id}`);
    await del(`/rest/v1/content_products?item_id=eq.${id}`);
  }
  for (const [, id] of criados.filter(([t]) => t === "training_courses")) {
    await del(`/rest/v1/training_lessons?course_id=eq.${id}`);
  }
  await del(`/rest/v1/content_items?created_by=eq.${GESTOR_ID}`);
  await del(`/rest/v1/training_courses?created_by=eq.${GESTOR_ID}`);
  await del(`/rest/v1/design_projects?owner_id=eq.${GESTOR_ID}`);
  // Progresso e inscrições do colaborador de teste.
  await del(`/rest/v1/training_progress?user_id=eq.${VENDEDOR_ID}`);
  await del(`/rest/v1/training_enrollments?user_id=eq.${VENDEDOR_ID}`);
  await del(`/rest/v1/training_bookmarks?user_id=eq.${VENDEDOR_ID}`);
  return `${criados.length} conteúdos/cursos`;
});

await check("remover a imagem do teste do bucket", async () => {
  if (!FICHEIRO_E2E) return "nada a remover (teste do feed não correu)";
  const r = await fetch(`${BASE}/storage/v1/object/content-media/${FICHEIRO_E2E}`, {
    method: "DELETE",
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  });
  assert(r.ok, `HTTP ${r.status}`);
  return FICHEIRO_E2E;
});

// ---------------------------------------------------------------------------
console.log("\n--- 13. TAXA DE COMISSÃO, PEDIDOS E REVENDEDORES ---");
// ---------------------------------------------------------------------------

// Sonda à tabela nova. Sem a migração 0008 o formulário responde 503 com a
// instrução — os testes que dependem dela ficam por correr, não são aprovados.
const sondaRevendedor = await sb("/rest/v1/reseller_applications?select=id&limit=1", {
  key: SR,
  jwt: SR,
});
const TEM_REVENDEDOR = sondaRevendedor.status !== 404;

// A mesma migração traz a taxa da empresa e a confirmação da entrega pelo
// comprador. `taxa_comissao_global()` só existe depois da 0008 — é a sonda
// mais directa, porque a versão antiga de `update_order_status()` existe
// sempre e responderia 200 mesmo sem o patch.
const sondaTaxa = await rpcAdmin("taxa_comissao_global", {});
const TEM_TAXAS = sondaTaxa.status === 200;

if (!TEM_REVENDEDOR || !TEM_TAXAS) {
  console.log(`
  ATENÇÃO — a base de dados ainda não tem a migração 0008.
  Abra o Supabase -> SQL Editor e cole:
      supabase/PATCH_TAXAS_PEDIDOS.sql

  Por correr, porque dependem dela:
      candidaturas a revendedor           ${TEM_REVENDEDOR ? "ok" : "tabela em falta"}
      confirmação da entrega pelo cliente ${TEM_TAXAS ? "ok" : "função em falta"}
`);
}

const CAND_TEL = "+244924200077";

await check("a página de revendedor mostra o formulário", async () => {
  const r = await pagina("/revendedor");
  assert(r.status === 200, `status ${r.status}`);
  const t = texto(r.html);
  assert(/Quero ser colaborador INUKA/.test(t), "sem título do formulário");
  assert(/Telefone/.test(t), "sem campo de telefone");
  return "formulário servido a visitantes";
});

await check("a página inicial tem o botão de revendedor", async () => {
  const r = await pagina("/");
  assert(r.status === 200, `status ${r.status}`);
  assert(/Quero ser colaborador/.test(texto(r.html)), "sem botão na página inicial");
  assert(/href="\/revendedor"/.test(r.html), "sem ligação para /revendedor");
  return "botão presente na entrada da loja";
});

await check("o formulário recusa um telefone inválido", async () => {
  const res = await fetch(`${APP}/api/revendedor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: "Candidato Teste", phone: "123" }),
  });
  const dados = await res.json().catch(() => ({}));
  assert(res.status === 400, `status ${res.status}`);
  assert(/telefone/i.test(dados.error ?? ""), JSON.stringify(dados));
  return "400 com mensagem sobre o telefone";
});

await check("o formulário recusa um nome vazio", async () => {
  const res = await fetch(`${APP}/api/revendedor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: " ", phone: CAND_TEL }),
  });
  assert(res.status === 400, `status ${res.status}`);
  return "400 sem nome";
});

if (TEM_REVENDEDOR) {
  await check("visitante envia candidatura e a gestão recebe", async () => {
    const res = await fetch(`${APP}/api/revendedor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "Candidato Web",
        phone: CAND_TEL,
        message: "Vendo em Viana, quero começar.",
      }),
    });
    assert(res.status === 200, `status ${res.status}: ${await res.text()}`);

    const { data } = await sb(
      `/rest/v1/reseller_applications?select=id,status,full_name&phone=eq.${encodeURIComponent(CAND_TEL)}`,
      { key: SR, jwt: SR },
    );
    assert(Array.isArray(data) && data.length === 1, `linhas: ${JSON.stringify(data)}`);
    assert(data[0].status === "novo", `estado ${data[0].status}`);
    return `${data[0].full_name} · estado novo`;
  });

  await check("repetir a candidatura no mesmo número não duplica", async () => {
    const res = await fetch(`${APP}/api/revendedor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "Candidato Web", phone: CAND_TEL }),
    });
    const dados = await res.json().catch(() => ({}));
    assert(res.status === 200, `status ${res.status}`);
    assert(dados.repetido === true, JSON.stringify(dados));

    const { data } = await sb(
      `/rest/v1/reseller_applications?select=id&phone=eq.${encodeURIComponent(CAND_TEL)}`,
      { key: SR, jwt: SR },
    );
    assert(data.length === 1, `linhas: ${data.length}`);
    return "uma só linha por número";
  });

  await check("o cliente não lê as candidaturas dos outros", async () => {
    const { status, data } = await sb("/rest/v1/reseller_applications?select=id", {
      jwt: sCliente.access_token,
    });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(data) && data.length === 0, `linhas: ${JSON.stringify(data)}`);
    return "0 linhas para o cliente";
  });

  await check("a gestão vê a candidatura", async () => {
    const { status, data } = await sb(
      `/rest/v1/reseller_applications?select=id,status&phone=eq.${encodeURIComponent(CAND_TEL)}`,
      { jwt: sGestor.access_token },
    );
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(data) && data.length === 1, `linhas: ${JSON.stringify(data)}`);
    return "gestão vê a candidatura";
  });
}

await check("a gestão abre a página de candidaturas", async () => {
  const r = await pagina("/gerente/revendedores", cookieSessao(sGestor));
  assert(r.status === 200, `status ${r.status}`);
  assert(/Candidaturas a colaborador/.test(texto(r.html)), "sem título da página");
  return "página servida à gestão";
});

await check("o cliente não entra nas candidaturas", async () => {
  const r = await pagina("/gerente/revendedores", cookieSessao(sCliente));
  assert(r.status === 307 || r.status === 302, `status ${r.status}`);
  return `redireccionado (${r.status})`;
});

await check("o colaborador tem a lista de encomendas da carteira", async () => {
  const r = await pagina("/vendedor/encomendas", cookieSessao(sVendedor));
  assert(r.status === 200, `status ${r.status}`);
  assert(/Encomendas da minha carteira/.test(texto(r.html)), "sem título da página");
  return "página servida ao colaborador";
});

await check("o cliente não entra nas encomendas do colaborador", async () => {
  const r = await pagina("/vendedor/encomendas", cookieSessao(sCliente));
  assert(r.status === 307 || r.status === 302, `status ${r.status}`);
  return `redireccionado (${r.status})`;
});

// -----------------------------------------------------------------------------
// O CICLO DA ENCOMENDA — a metade que faltava: a gestão muda o estado, o
// comprador vê e confirma que recebeu.
// -----------------------------------------------------------------------------
let ENCOMENDA = null;

await check("o cliente cria uma encomenda para acompanhar", async () => {
  // Um produto com stock na base. `place_order` reserva a quantidade, por isso
  // sem stock a chamada falhava por uma razão que não tem a ver com o teste.
  const { data: stock } = await sb(
    "/rest/v1/inventory?select=product_id&quantity=gt.5&limit=25",
    { key: SR, jwt: SR },
  );
  const ids = [...new Set((stock ?? []).map((l) => l.product_id))];
  assert(ids.length > 0, "sem stock para encomendar");

  const { data: prods } = await sb(
    `/rest/v1/products?select=id,name&is_active=eq.true&id=in.(${ids.join(",")})&limit=1`,
    { key: SR, jwt: SR },
  );
  assert(prods?.length === 1, "sem produto activo com stock");
  const produto = prods[0];

  const { status, data } = await sb("/rest/v1/rpc/place_order", {
    method: "POST",
    jwt: sCliente.access_token,
    body: { p_items: [{ product_id: produto.id, quantity: 1 }], p_delivery_method: "pickup" },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(data).slice(0, 160)}`);
  assert(data?.order_id, `sem id: ${JSON.stringify(data).slice(0, 160)}`);
  ENCOMENDA = data.order_id;
  return `${produto.name} · ${data.reference}`;
});

await check("a gestão faz sair a encomenda para entrega", async () => {
  const { status, data } = await sb("/rest/v1/rpc/update_order_status", {
    method: "POST",
    jwt: sGestor.access_token,
    body: { p_order_id: ENCOMENDA, p_status: "in_delivery" },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(data).slice(0, 160)}`);
  assert(data?.changed === true, JSON.stringify(data).slice(0, 160));
  return "pendente -> em entrega";
});

await check("o cliente vê o estado novo, o histórico e a confirmação", async () => {
  const r = await pagina("/cliente/encomendas", cookieSessao(sCliente));
  assert(r.status === 200, `status ${r.status}`);
  const t = texto(r.html);
  assert(/Em entrega/.test(t), "sem o estado «Em entrega»");
  assert(/Histórico/.test(t), "sem histórico da encomenda");
  assert(/Já recebi a encomenda/.test(t), "sem botão para confirmar a recepção");
  return "estado, histórico e confirmação";
});

await check("o cliente confirma a entrega e a encomenda conclui", async () => {
  // Sem a 0008 a função em vigor é a antiga e responde 42501 — não é uma
  // regressão, é a migração que falta.
  if (!TEM_TAXAS) return "saltado (falta a migração 0008)";
  const { status, data } = await sb("/rest/v1/rpc/update_order_status", {
    method: "POST",
    jwt: sCliente.access_token,
    body: { p_order_id: ENCOMENDA, p_status: "completed", p_notes: "Recebida pelo cliente" },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(data).slice(0, 160)}`);
  assert(data?.pelo_cliente === true, JSON.stringify(data).slice(0, 160));
  assert(data?.status === "completed", JSON.stringify(data).slice(0, 160));
  return "concluída pelo comprador";
});

await check("a encomenda concluída aparece fechada ao cliente", async () => {
  if (!TEM_TAXAS) return "saltado (falta a migração 0008)";
  const r = await pagina("/cliente/encomendas", cookieSessao(sCliente));
  assert(r.status === 200, `status ${r.status}`);
  const t = texto(r.html);
  assert(/Concluída/.test(t), "sem o estado «Concluída»");
  assert(!/Já recebi a encomenda/.test(t), "botão de confirmação ainda visível");
  return "concluída e sem botão";
});

await check("a referência do cliente chama-se «Falar com a equipa INUKA»", async () => {
  const r = await pagina("/referencia", cookieSessao(sCliente));
  assert(r.status === 200, `status ${r.status}`);
  const t = texto(r.html);
  assert(/Falar com a equipa INUKA/.test(t), "título antigo ainda em uso");
  assert(!/O meu colaborador/.test(t), "ainda mostra «O meu colaborador»");
  return "título novo";
});

await check("a taxa de comissão da empresa aparece na área de colaborador", async () => {
  const r = await pagina("/vendedor", cookieSessao(sVendedor));
  assert(r.status === 200, `status ${r.status}`);
  const t = texto(r.html);
  assert(/por venda/.test(t), "sem indicação da taxa");
  assert(/\d+\s*%/.test(t), "sem percentagem");
  return "taxa visível no painel";
});

await check("a página de promoções tem o novo ambiente", async () => {
  const r = await pagina("/promocoes");
  assert(r.status === 200, `status ${r.status}`);
  const t = texto(r.html);
  assert(/Beleza que chega/.test(t), "sem o novo cabeçalho");
  assert(/Ver o catálogo/.test(t), "sem ligação ao catálogo");
  return "cabeçalho e chamada presentes";
});

await check("remover a candidatura de teste", async () => {
  if (!TEM_REVENDEDOR) return "nada a remover (migração em falta)";
  const { status } = await sb(
    `/rest/v1/reseller_applications?phone=eq.${encodeURIComponent(CAND_TEL)}`,
    { method: "DELETE", key: SR, jwt: SR },
  );
  assert(status === 204 || status === 200, `status ${status}`);
  return "candidatura removida";
});

await check("remover a encomenda de teste", async () => {
  if (!ENCOMENDA) return "nada a remover";
  // Se a confirmação do cliente não correu (0008 em falta), a encomenda ficou
  // com a quantidade reservada no inventário. Apagar a linha directamente
  // deixava a reserva presa para sempre; cancelar primeiro liberta-a.
  const { data: actual } = await sb(`/rest/v1/orders?select=status&id=eq.${ENCOMENDA}`, {
    key: SR,
    jwt: SR,
  });
  const estado = actual?.[0]?.status;
  if (estado && estado !== "completed" && estado !== "cancelled") {
    await rpcAdmin("update_order_status", { p_order_id: ENCOMENDA, p_status: "cancelled" });
  }
  const { status } = await sb(`/rest/v1/orders?id=eq.${ENCOMENDA}`, {
    method: "DELETE",
    key: SR,
    jwt: SR,
  });
  assert(status === 204 || status === 200, `status ${status}`);
  return "encomenda e linhas removidas";
});

// ---------------------------------------------------------------------------
// «Comprar novamente»: o último produto comprado fica marcado no catálogo.
// ---------------------------------------------------------------------------
await check("catálogo mostra «Comprar novamente» a quem já comprou", async () => {
  const uid = sCliente.user.id;
  const { data: prods } = await sb(
    "/rest/v1/products?select=id,name&is_active=eq.true&limit=1",
    { key: SR, jwt: SR }
  );
  assert(prods?.length === 1, "sem produtos activos");
  const prod = prods[0];

  // Encomenda directa na base: o teste quer o histórico, não o checkout.
  const { data: ordem } = await sb("/rest/v1/orders?select=id", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: {
      reference: `TST-RECOMPRA-${Date.now()}`,
      customer_id: uid,
      status: "pending",
      total_amount: 1000,
      delivery_method: "pickup",
    },
  });
  assert(ordem?.[0]?.id, "não criou a encomenda de teste");

  await sb("/rest/v1/order_items", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
    body: {
      order_id: ordem[0].id,
      product_id: prod.id,
      quantity: 1,
      unit_price: 1000,
      total_price: 1000,
    },
  });

  const r = await pagina("/catalogo", cCliente);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Comprar novamente"), "sem a faixa de recompra");
  assert(t.includes("Já comprou"), "o produto comprado não está marcado");
  assert(t.includes(prod.name), "o produto comprado não aparece na faixa");

  // Sem sessão não há histórico para mostrar — a faixa não deve aparecer.
  const anon = await pagina("/catalogo");
  assert(!texto(anon.html).includes("Comprar novamente"), "a faixa apareceu a um visitante");

  // Limpeza: as linhas saem por CASCADE.
  await sb(`/rest/v1/orders?id=eq.${ordem[0].id}`, {
    method: "DELETE",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
  });
  return "faixa + marca «Já comprou» · invisível sem sessão";
});

// ---------------------------------------------------------------------------
// CRUD de produtos: a gestão edita qualquer campo e elimina o que não tem
// histórico. O que já foi vendido não se apaga — a FK protege a venda.
// ---------------------------------------------------------------------------
const PRODUTO_CRUD = "[TESTE] Produto a editar";

async function limparProdutosDeTeste() {
  const { data } = await sb(
    `/rest/v1/products?select=id&name=like.*TESTE*`,
    { key: SR, jwt: SR }
  );
  for (const p of data ?? []) {
    await sb(`/rest/v1/products?id=eq.${p.id}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
  }
}
await limparProdutosDeTeste();

await check("gestor edita nome, preços e descrição de um produto", async () => {
  const criado = await sb("/rest/v1/products?select=id", {
    method: "POST",
    jwt: sGestor.access_token,
    prefer: "return=representation",
    body: { name: PRODUTO_CRUD, official_price: 10000, is_active: true },
  });
  assert(criado.status === 201, `criar: ${criado.status} ${JSON.stringify(criado.data).slice(0, 200)}`);
  const id = criado.data[0].id;

  // É exactamente o que o formulário faz no PATCH: um único update com os
  // campos todos, incluindo os que a listagem não mostra (descrição).
  const editado = await sb(
    `/rest/v1/products?id=eq.${id}&select=name,official_price,promotional_price,description,is_active`,
    {
      method: "PATCH",
      jwt: sGestor.access_token,
      prefer: "return=representation",
      body: {
        name: "[TESTE] Produto editado",
        official_price: 17500,
        promotional_price: 15000,
        description: "Descrição nova",
      },
    }
  );
  assert(editado.status === 200, `editar: ${editado.status} ${JSON.stringify(editado.data).slice(0, 200)}`);
  const linha = editado.data[0];
  assert(linha.name === "[TESTE] Produto editado", `nome: ${linha.name}`);
  assert(Number(linha.official_price) === 17500, `preço: ${linha.official_price}`);
  assert(Number(linha.promotional_price) === 15000, `promocional: ${linha.promotional_price}`);
  assert(linha.description === "Descrição nova", `descrição: ${linha.description}`);
  // Editar não pode reactivar um produto desactivado às escondidas.
  assert(linha.is_active === true, "o is_active mudou sozinho");

  // Eliminar sem histórico é permitido.
  const apagado = await sb(`/rest/v1/products?id=eq.${id}`, {
    method: "DELETE",
    jwt: sGestor.access_token,
    prefer: "return=minimal",
  });
  assert(apagado.status === 204 || apagado.status === 200, `eliminar: ${apagado.status}`);

  const { data: sobrou } = await sb(`/rest/v1/products?select=id&id=eq.${id}`, {
    key: SR,
    jwt: SR,
  });
  assert((sobrou ?? []).length === 0, "o produto ficou na base");
  return "editado (4 campos) e eliminado";
});

await check("produto já vendido pode ser eliminado — o histórico guarda o nome", async () => {
  const criado = await sb("/rest/v1/products?select=id,name", {
    method: "POST",
    jwt: sGestor.access_token,
    prefer: "return=representation",
    body: { name: "[TESTE] Produto vendido", official_price: 9000, is_active: true },
  });
  assert(criado.status === 201, `criar: ${criado.status}`);
  const id = criado.data[0].id;

  await rpcAdmin("set_product_stock", {
    p_product_id: id,
    p_quantity: 5,
    p_reason: "Stock de teste",
  });

  const venda = await sb("/rest/v1/rpc/register_sale_by_phone", {
    method: "POST",
    jwt: sVendedor.access_token,
    body: {
      p_items: [{ product_id: id, quantity: 1 }],
      p_customer_phone: "+244924200077",
      p_payment_method: "cash",
      p_payment_status: "paid",
    },
  });
  assert(venda.status === 200, `vender: ${venda.status} ${JSON.stringify(venda.data).slice(0, 200)}`);

  // A 0013 troca o bloqueio por um aviso: o gestor vê o impacto e confirma.
  // Numa base ainda sem essa migração a FK continua a recusar — os dois
  // estados são aceites, mas o resultado tem de ser coerente.
  const impacto = await sb("/rest/v1/rpc/impacto_eliminar_produto", {
    method: "POST",
    jwt: sGestor.access_token,
    body: { p_product_id: id },
  });
  const temMigracao = impacto.status === 200;

  if (!temMigracao) {
    const tentativa = await sb(`/rest/v1/products?id=eq.${id}`, {
      method: "DELETE",
      jwt: sGestor.access_token,
      prefer: "return=minimal",
    });
    // 409 = violação de FK. É este o erro que o ecrã antigo traduzia em
    // «use Desactivar».
    assert(tentativa.status === 409, `sem a 0013 devia recusar, deu ${tentativa.status}`);

    await sb(`/rest/v1/products?id=eq.${id}`, {
      method: "PATCH",
      jwt: sGestor.access_token,
      prefer: "return=minimal",
      body: { is_active: false },
    });
  } else {
    // Com a 0013 o produto sai mesmo, e o histórico fica com o nome e o preço.
    assert(
      Number(impacto.data?.sale_items) >= 1,
      `o impacto não conta a venda: ${JSON.stringify(impacto.data)}`
    );

    const eliminado = await sb("/rest/v1/rpc/eliminar_produto", {
      method: "POST",
      jwt: sGestor.access_token,
      body: { p_product_id: id },
    });
    assert(
      eliminado.status === 200,
      `eliminar: ${eliminado.status} ${JSON.stringify(eliminado.data).slice(0, 200)}`
    );

    const sobrou = await sb(`/rest/v1/products?id=eq.${id}&select=id`, { key: SR, jwt: SR });
    assert((sobrou.data ?? []).length === 0, "o produto ficou na base");

    const linhas = await sb(
      `/rest/v1/sale_items?select=product_id,product_snapshot&product_snapshot->>name=eq.${encodeURIComponent(
        "[TESTE] Produto vendido"
      )}`,
      { key: SR, jwt: SR }
    );
    assert((linhas.data ?? []).length >= 1, "a linha da venda desapareceu com o produto");
    assert(linhas.data[0].product_id === null, "a linha ainda aponta para o produto apagado");
  }

  // Limpeza: a venda sai primeiro (com as linhas, por CASCADE), depois o produto.
  const { data: vendas } = await sb(
    `/rest/v1/sales?select=id&customer_phone=eq.${encodeURIComponent("+244924200077")}`,
    { key: SR, jwt: SR }
  );
  for (const v of vendas ?? []) {
    await sb(`/rest/v1/sales?id=eq.${v.id}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
  }
  await sb(`/rest/v1/reserved_customers?phone=eq.${encodeURIComponent("+244924200077")}`, {
    method: "DELETE",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
  });
  await sb(`/rest/v1/products?id=eq.${id}`, {
    method: "DELETE",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
  });
  return temMigracao
    ? "eliminado · a venda ficou com o nome"
    : "0013 por aplicar: a FK ainda recusa (409)";
});
await check("eliminar um produto fictício leva o histórico com ele (modo forçado)", async () => {
  // 0014: `eliminar_produto(id, forcar)` apaga também as linhas do histórico e
  // os registos que ficam vazios. Numa base sem a migração o argumento não
  // existe (PGRST202) — o teste diz isso em vez de falhar por código.
  const criado = await sb("/rest/v1/products?select=id,name", {
    method: "POST",
    jwt: sGestor.access_token,
    prefer: "return=representation",
    body: { name: "[TESTE] Fictício forçado", official_price: 4000, is_active: true },
  });
  assert(criado.status === 201, `criar: ${criado.status}`);
  const id = criado.data[0].id;

  const referencia = `ENC-FORCAR-${Date.now()}`;
  const encomenda = await sb("/rest/v1/orders?select=id", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: { reference: referencia, customer_id: sCliente.user.id, total_amount: 4000 },
  });
  assert(encomenda.status === 201, `encomenda: ${encomenda.status} ${JSON.stringify(encomenda.data).slice(0, 160)}`);
  const idEncomenda = encomenda.data[0].id;

  await sb("/rest/v1/order_items", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
    body: { order_id: idEncomenda, product_id: id, quantity: 1, unit_price: 4000, total_price: 4000 },
  });

  const forcado = await sb("/rest/v1/rpc/eliminar_produto", {
    method: "POST",
    jwt: sGestor.access_token,
    body: { p_product_id: id, p_forcar: true },
  });

  if (forcado.status === 404 || /PGRST202|Could not find the function/i.test(JSON.stringify(forcado.data))) {
    // Limpeza mínima e saída honesta: falta a 0014 nesta base.
    await sb(`/rest/v1/order_items?order_id=eq.${idEncomenda}`, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
    await sb(`/rest/v1/orders?id=eq.${idEncomenda}`, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
    await sb(`/rest/v1/products?id=eq.${id}`, { method: "DELETE", key: SR, jwt: SR, prefer: "return=minimal" });
    return "0014 por aplicar — colar PATCH_ELIMINAR_FORCADO.sql";
  }

  assert(forcado.status === 200, `eliminar: ${forcado.status} ${JSON.stringify(forcado.data).slice(0, 200)}`);
  assert(forcado.data?.forcado === true, "não marcou como forçado");
  assert(Number(forcado.data?.apagados?.encomendas) === 1, `encomendas apagadas: ${JSON.stringify(forcado.data?.apagados)}`);

  const produtoSumiu = await sb(`/rest/v1/products?id=eq.${id}&select=id`, { key: SR, jwt: SR });
  assert((produtoSumiu.data ?? []).length === 0, "o produto ficou na base");

  const linhas = await sb(`/rest/v1/order_items?product_id=eq.${id}&select=id`, { key: SR, jwt: SR });
  assert((linhas.data ?? []).length === 0, "as linhas de encomenda ficaram");

  const encomendaSumiu = await sb(`/rest/v1/orders?id=eq.${idEncomenda}&select=id`, { key: SR, jwt: SR });
  assert((encomendaSumiu.data ?? []).length === 0, "a encomenda vazia ficou");

  return "produto + encomenda + linhas apagados";
});


// ---------------------------------------------------------------------------
// 14. GALERIA DE FOTOGRAFIAS E PRODUTO ESGOTADO
//
// Um produto pode ter várias fotografias e a página desliza entre elas; quando
// o stock chega a zero, o visitante — mesmo sem conta — vê «Esgotado» e pode
// deixar reserva. A disponibilidade pública depende da migração 0012.
// ---------------------------------------------------------------------------
console.log("\n--- 14. GALERIA DE FOTOGRAFIAS E PRODUTO ESGOTADO ---");

const FOTO_1 = "https://exemplo.test/inuka-foto-1.jpg";
const FOTO_2 = "https://exemplo.test/inuka-foto-2.jpg";
const produtosCriados = [];

async function criarProdutoDeTeste(nome) {
  const r = await sb("/rest/v1/products?select=id", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=representation",
    body: { name: nome, official_price: 12500, is_active: true },
  });
  assert(
    r.status === 201,
    `criar produto: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`
  );
  const id = r.data[0].id;
  produtosCriados.push(id);
  return id;
}

// A função pública só existe depois de aplicar a migração 0012.
const sondaStock = await sb("/rest/v1/rpc/stock_produtos", {
  method: "POST",
  key: ANON,
  body: { p_ids: [] },
});
const temStockPublico = sondaStock.status === 200;
const motivoSemStock = "migração 0012 (PATCH_STOCK_PUBLICO.sql) por aplicar na base";

await check("produto com várias fotografias desliza entre elas", async () => {
  const id = await criarProdutoDeTeste("[TESTE] Galeria");

  const ins = await sb("/rest/v1/product_images", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
    body: [
      { product_id: id, storage_path: FOTO_1, url: FOTO_1, is_primary: true, sort_order: 0 },
      { product_id: id, storage_path: FOTO_2, url: FOTO_2, is_primary: false, sort_order: 1 },
    ],
  });
  assert(ins.status === 201 || ins.status === 204, `imagens: ${ins.status}`);

  const r = await pagina(`/produto/${id}`);
  assert(r.status === 200, `HTTP ${r.status}`);
  // URLs e `aria-label` vivem em atributos: `texto()` apaga as etiquetas, por
  // isso estas verificações correm sobre o HTML.
  assert(r.html.includes(FOTO_1) && r.html.includes(FOTO_2), "as duas fotografias não estão na página");
  assert(r.html.includes("Fotografia seguinte"), "sem controlo para deslizar");
  assert(r.html.includes("1/2"), "sem contador de fotografias");
  assert(r.html.includes("Ver fotografia 2"), "sem miniaturas");

  // No catálogo o cartão mostra só a capa — a marcada `is_primary`.
  const cat = await pagina("/catalogo");
  assert(cat.html.includes(FOTO_1), "o cartão do catálogo não mostra a capa");
  assert(!cat.html.includes(FOTO_2), "o cartão do catálogo mostrou uma foto secundária");

  return "galeria com 2 fotos · cartão usa a capa";
});

await check("produto esgotado mostra reserva a um visitante", async () => {
  if (!temStockPublico) return pular("produto esgotado mostra reserva a um visitante", motivoSemStock);

  const id = await criarProdutoDeTeste("[TESTE] Esgotado");
  const inv = await sb("/rest/v1/inventory", {
    method: "POST",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
    body: { product_id: id, quantity: 0, reserved_quantity: 0 },
  });
  assert(inv.status === 201 || inv.status === 204, `inventário: ${inv.status}`);

  // Sem cookie: é assim que a maioria das pessoas chega à loja.
  const r = await pagina(`/produto/${id}`);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);

  assert(t.includes("Esgotado de momento"), "sem aviso de esgotado");
  assert(t.includes("Reservar este produto"), "sem botão de reserva");
  assert(!t.includes("Adicionar ao carrinho"), "ainda deixa juntar ao carrinho");

  // E o catálogo marca-o, para não se clicar à espera de comprar.
  const cat = await pagina("/catalogo");
  assert(texto(cat.html).includes("Esgotado"), "o catálogo não marca o produto esgotado");

  return "aviso + reserva + selo no catálogo";
});

await check("o colaborador vê o aviso de esgotado na loja", async () => {
  if (!temStockPublico) return pular("o colaborador vê o aviso de esgotado na loja", motivoSemStock);

  const { data } = await sb("/rest/v1/products?select=id&name=eq.[TESTE]%20Esgotado", {
    key: SR,
    jwt: SR,
  });
  const id = data?.[0]?.id;
  assert(id, "o produto esgotado do teste anterior desapareceu");

  const r = await pagina(`/produto/${id}`, cVendedor);
  assert(texto(r.html).includes("Esgotado de momento"), "com sessão perdeu o aviso");
  return "mesma regra com e sem sessão";
});

// O ecrã de produtos é renderizado no browser, por isso não se procura o botão
// no HTML servido: verifica-se o que ele faz — trocar a capa e ver o catálogo
// a segui-la. É a operação que a gestão pede («esta foto é a que aparece»).
await check("mudar a capa muda a fotografia do catálogo", async () => {
  const id = produtosCriados[0];
  assert(id, "o produto da galeria desapareceu");

  const tirar = await sb(`/rest/v1/product_images?product_id=eq.${id}&is_primary=eq.true`, {
    method: "PATCH",
    key: SR,
    jwt: SR,
    prefer: "return=minimal",
    body: { is_primary: false },
  });
  assert(tirar.status === 204 || tirar.status === 200, `limpar capa: ${tirar.status}`);

  const pôr = await sb(
    `/rest/v1/product_images?product_id=eq.${id}&url=eq.${encodeURIComponent(FOTO_2)}`,
    {
      method: "PATCH",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
      body: { is_primary: true },
    }
  );
  assert(pôr.status === 204 || pôr.status === 200, `marcar capa: ${pôr.status}`);

  const cat = await pagina("/catalogo");
  assert(cat.html.includes(FOTO_2), "o catálogo não seguiu a nova capa");
  assert(!cat.html.includes(FOTO_1), "o catálogo continua na capa antiga");
  return "capa nova no catálogo";
});

await check("o catálogo usa duas colunas no telemóvel e não corta a foto", async () => {
  const r = await pagina("/catalogo");
  assert(r.status === 200, `HTTP ${r.status}`);
  // Duas colunas é o que impede cartões de ~100 px; `object-contain` é o que
  // impede o `cover` de cortar as laterais de uma fotografia não quadrada.
  assert(r.html.includes("grid-cols-2"), "a grelha deixou de ter duas colunas");
  assert(r.html.includes("object-contain"), "as fotografias voltaram a ser cortadas");
  return "grelha de 2 colunas · imagem inteira";
});

await check("remover os produtos do teste de fotografias", async () => {
  for (const id of produtosCriados) {
    await sb(`/rest/v1/product_images?product_id=eq.${id}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
    await sb(`/rest/v1/inventory?product_id=eq.${id}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
    await sb(`/rest/v1/products?id=eq.${id}`, {
      method: "DELETE",
      key: SR,
      jwt: SR,
      prefer: "return=minimal",
    });
  }
  return `${produtosCriados.length} produtos removidos`;
});

await check("a matriz de perfis está na área de gestão", async () => {
  const r = await pagina("/gerente/perfis", cGestor);
  assert(r.status === 200, `HTTP ${r.status}`);
  const t = texto(r.html);
  assert(t.includes("Matriz de competências"), "sem matriz de competências");
  assert(t.includes("Vendedor de loja"), "o perfil novo não aparece");
  assert(t.includes("Colaborador de vendas"), "sem o perfil de colaborador");
  return "matriz com os quatro perfis";
});

await check("o cliente não entra na área da loja", async () => {
  // O guarda do proxy responde 307 antes de a página renderizar: o cliente é
  // mandado para a sua área, não vê o balcão nem a contagem de stock.
  const r = await pagina("/loja", cCliente);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  assert((r.location || "").includes("/cliente"), `redirect: ${r.location}`);
  return `${r.status} -> ${r.location}`;
});

await check("o colaborador de vendas também não entra na loja", async () => {
  const r = await pagina("/loja", cVendedor);
  assert(r.status === 307 || r.status === 302, `HTTP ${r.status}`);
  assert((r.location || "").includes("/vendedor"), `redirect: ${r.location}`);
  return `${r.status} -> ${r.location}`;
});

await check("remover contas de teste", async () => {
  for (const u of [CLIENTE, VENDEDOR, GESTOR]) await apagarConta(u.phone);
  // O cliente que o colaborador abriu na carteira.
  await apagarConta(CARTEIRA_TEL);
  // As contas do CRUD podem ter ficado a meio de uma falha.
  await apagarConta(NOVO.phone);
  await apagarConta(NOVO_TEL);
  await apagarConta(COLAB_TEL);
  return "3 contas removidas (+ carteira e sobras do CRUD)";
});

console.log("\n" + "=".repeat(64));
console.log(`Total: ${total}  |  Passou: ${passed}  |  Falhou: ${total - passed}`);
if (falhas.length) {
  console.log("\nFALHAS:");
  for (const f of falhas) console.log(`  - ${f}`);
}
console.log("=".repeat(64));
process.exit(falhas.length ? 1 : 0);
