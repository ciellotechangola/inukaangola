# Publicar na Vercel

A app web é a pasta **`apps/web`** — não a raiz do repositório. A raiz
(`INUKA APP/`) é um monorepo: o `package.json` de lá não tem Next.js, apenas
delega em `npm --prefix apps/web run build`. Se a Vercel apontar para a raiz,
o build falha.

```
INUKA APP/                 ← raiz do Git (monorepo) — NÃO é a app
├─ apps/web/               ← ✅ é isto que se publica
│   ├─ package.json        ("web", build: "next build")
│   ├─ next.config.ts
│   ├─ src/proxy.ts        middleware (Next 16)
│   ├─ public/
│   ├─ .env.local          segredos — fica na máquina
│   └─ .vercelignore       protege o upload da CLI
├─ apps/capacitor/         shell iOS
├─ apps/mobile/            Flutter / Android
└─ supabase/  packages/  docs/
```

## Porque não se arrasta a pasta

`.next/` não contém **um único `.html`** — só `BUILD_ID`, `server/`,
`routes-manifest.json` e `required-server-files.json`. A app tem Server
Components, rotas `/api/*`, middleware e sessão em cookie: precisa de um
servidor Node. Não existe pasta estática para publicar, em lado nenhum.

## Caminho A — importar pelo GitHub (recomendado)

1. **vercel.com → Add New… → Project → Import Git Repository**
2. Escolher `ciellotechangola/inukaangola`.
3. Em **Root Directory**, `Edit` → escrever **`apps/web`**.
   - Framework detecta `Next.js` sozinho.
   - **Não** alterar Build Command nem Output Directory.
4. **Environment Variables** → adicionar as três da tabela abaixo, marcando
   **Production** *e* **Preview**.
5. **Deploy**.

Vantagens sobre a CLI: o `.env.local` nunca sai da máquina (só sobe o que está
no repositório), o Root Directory fica explícito e cada `git push` para `main`
volta a publicar.

## Caminho B — CLI, a partir de `apps/web`

Correr **dentro de `apps/web`**, nunca na raiz:

```powershell
cd "C:\agentes\mimo\projectos\PROJECTOS\INUKA APP\apps\web"
npx vercel login
npx vercel link
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel --prod
```

`npx` em vez de `npm install -g vercel`: a instalação global falhou neste
ambiente com `command not found`, e o `npx` faz o mesmo sem tocar no sistema.

O `.vercelignore` existe porque a CLI **não lê o `.gitignore`** — envia a pasta
tal como está. Sem ele, o `.env.local` (que tem a `SUPABASE_SERVICE_ROLE_KEY`)
ia dentro do upload e o `.next/` tornava cada envio lentíssimo.

## Variáveis de ambiente

Só **três** são lidas pelo código:

| Variável | Onde está o valor | Vai para o browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | sim (pública por desenho) |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` | **não** — só servidor |

Para as copiar sem as expor:

```powershell
cd "C:\agentes\mimo\projectos\PROJECTOS\INUKA APP\apps\web"
Get-Content .env.local | Select-String '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)='
```

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` também aparecem
no `.env.local`, mas **não são usadas** (grep confirmado em `src/`) — não as
adicionar, para não confundir.

As duas `NEXT_PUBLIC_*` são embutidas no bundle **quando existem no momento do
build**; mudá-las obriga a um novo deploy, não basta reiniciar. Se não existirem,
o código lê-as em runtime — e a app falha ao arrancar com a mensagem explícita
descrita abaixo.

## Confirmar que ficou funcional

Build verde **não** significa aplicação funcional. Testar as quatro rotas:

```powershell
curl.exe -s -o NUL -w "%{http_code} /\n"          https://SEU-PROJETO.vercel.app/
curl.exe -s -o NUL -w "%{http_code} /catalogo\n"  https://SEU-PROJETO.vercel.app/catalogo
curl.exe -s -o NUL -w "%{http_code} /login\n"     https://SEU-PROJETO.vercel.app/login
curl.exe -s -o NUL -w "%{http_code} /api/saude\n" https://SEU-PROJETO.vercel.app/api/saude
```

Todas devem devolver **200**. `/api/saude` a 200 com as páginas a 500 indica
variável de ambiente em falta.

## Resolução de problemas

**500 com build verde.** Foi o que aconteceu no primeiro deploy: o
`src/proxy.ts` chamava `createServerClient` com `process.env.X!` e, sem as
variáveis, o `@supabase/ssr` lançava
`Your project's URL and Key are required to create a Supabase client!` em todas
as páginas. O `/api/saude` respondia 200 porque as rotas `/api/*` passam antes do
proxy. A correcção actualiza o erro para algo legível:

```
[INUKA] Variáveis de ambiente em falta: NEXT_PUBLIC_SUPABASE_URL, …
```

Reproduzido localmente (com as variáveis removidas) antes de ser corrigido:
`/`, `/catalogo` e `/login` davam 500, `/api/saude` dava 200.

**`Cookies can only be modified in a Server Action or Route Handler`.** Acontecia
sempre que o `@supabase/ssr` refrescava um token dentro de um Server Component.
O `setAll` em `src/lib/supabase-server.ts` está agora em `try/catch`; o proxy
persiste os cookies refrescados.

**`/manifest.json` a 307 para `/login`.** O `matcher` do proxy excluía imagens
por extensão mas não o manifest, e o telemóvel ficava sem `start_url` nem ícones.
Corrigido no `matcher`; há um teste E2E que verifica o manifest servido.

**O que não fazer.** Não apontar a Vercel para `INUKA APP/`. Não deixar o Root
Directory vazio. Não publicar antes de as variáveis estarem definidas.

## Depois do primeiro deploy

Colar os patches SQL que faltarem (ver [Base de dados](../README.md#base-de-dados))
e promover o primeiro gestor:

```sql
SELECT public.promote_to_manager('+2449xxxxxxxx');
```

## Netlify

Continua bloqueado por um bug de runtime do `@netlify/plugin-nextjs` 5.16.6 —
ver a secção [Publicar na web](../README.md#publicar-na-web) do README. Não é
configuração do projecto e não há nada a corrigir deste lado.
