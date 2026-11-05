# INUKA Angola

Plataforma de comercialização de produtos INUKA: catálogo, encomendas, reservas,
gestão de vendedores e clientes, comunicação em tempo real e gestão centralizada.

> **Estado**: base de dados provisionada e validada ao vivo; autenticação,
> catálogo, encomendas, vendas, descontos, chat e sincronização offline
> verificados contra o projeto Supabase real. Ver
> [`docs/ROADMAP.md`](docs/ROADMAP.md) para o que falta.

## Começar

```bash
# 1. Credenciais
cp apps/web/.env.local.example apps/web/.env.local   # URL + anon key + service_role

# 2. Dependências e servidor
npm --prefix apps/web install
npm run dev            # http://localhost:3000

# 3. Catálogo (11 categorias + 6 produtos de demonstração)
npm run seed
```

Base de dados nova? Colar `supabase/SETUP_COMPLETO.sql` no **SQL Editor** antes
do passo 1 — ver [`docs/SUPABASE_CONFIG.md`](docs/SUPABASE_CONFIG.md).

Primeiro gestor (depois de registar a conta na app):

```sql
SELECT public.promote_to_manager('+2449xxxxxxxx');
```

## Publicar na web

**Arrastar a pasta para o Netlify Drop não funciona e nunca vai funcionar.** O
Drop só aceita ficheiros estáticos e exige um `index.html` na raiz; esta
aplicação tem Server Components, rotas `/api/*`, middleware (`src/proxy.ts`) e
sessão em cookie — precisa de um servidor Node. Daí o *"We couldn't deploy the
files you dropped"* e, à segunda tentativa, *"Access Denied"*.

### Vercel — caminho recomendado

A app publica-se a partir de **`apps/web`**, não da raiz: `INUKA APP/` é um
monorepo e o `package.json` de lá não tem Next.js, só delega em
`npm --prefix apps/web run build`.

No painel da Vercel: **Add New… → Project → Import Git Repository** →
`ciellotechangola/inukaangola` → **Root Directory = `apps/web`** → definir as
três variáveis de ambiente abaixo → **Deploy**. Cada `git push` para `main`
volta a publicar.

O guia completo — comandos da CLI, verificação das rotas e resolução de
problemas — está em [`docs/VERCEL.md`](docs/VERCEL.md).

> **Build verde não significa aplicação funcional.** Sem as variáveis, o build
> passa e o site devolve 500. Testar sempre `/`, `/catalogo`, `/login` e
> `/api/saude`: as quatro têm de dar 200.

### Netlify — bloqueado por um bug do runtime

A configuração está pronta em [`apps/web/netlify.toml`](apps/web/netlify.toml)
(site `inuka-angola`, já criado), mas o deploy falha **por um bug do runtime**,
não por configuração:

> `@netlify/plugin-nextjs` 5.16.6 gera um handler de edge para embrulhar o
> middleware Node e esse bundle faz `require('next/dist/server/…')`, enquanto o
> `deno.json` que o plugin escreve não tem **um único** mapeamento `next`.
> Resultado: `Could not load edge function`. Um build por Git falha no mesmo
> ponto — não há nada a corrigir do lado do projecto.

Testado sem resultado: `next build --webpack` (o bundle continua a externalizar
`next/dist/server/…`, 13 requires) e a versão mais recente do plugin (5.16.6 é
a última publicada). Não há flag para desactivar o handler de middleware.

Enquanto não sair correcção no opennextjs-netlify, há duas alternativas: a
**Vercel** (acima) e o **WorkBuddy Sites**, que corre a app como servidor normal:

```bash
# build de produção + servidor, para provar que está são
npm --prefix apps/web run build
npm --prefix apps/web start        # http://localhost:3000
```

Depois: publicar a pasta `apps/web` como serviço HTTP (`npm ci && npm run build`
na instalação, `npm start` a arrancar). **Não uses `-p $PORT`** no comando de
arranque — a variável não é expandida nesse contexto e o `next start` aborta com
"option '-p, --port <port>' argument missing"; o Next já lê `PORT` sozinho.

### Variáveis de ambiente

Sem elas o build passa mas a app não fala com o Supabase:

| Variável | Onde faz falta |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build **e** runtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build **e** runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | só runtime (segredo — registo de contas) |

As duas `NEXT_PUBLIC_*` são **embutidas no bundle quando existem no momento do
build**: mudá-las obriga a um novo deploy, não basta reiniciar. Se não existirem,
o código lê-as em runtime e a app aborta com
`[INUKA] Variáveis de ambiente em falta: …` em vez de um 500 mudo.

Depois do primeiro deploy, colar os patches SQL que faltarem (ver
[Base de dados](#base-de-dados)) e promover o primeiro gestor.

## Comandos

| Comando | Efeito |
|---|---|
| `npm run dev` | servidor web em desenvolvimento |
| `npm run build` | build de produção |
| `npm run seed` | semeia categorias + produtos `[DEMO]` |
| `npm run seed:limpar` | remove os produtos `[DEMO]` |
| `npm run seed:chat` | cria o grupo da empresa e conversas directas de demonstração |
| `npm run seed:provincias` | atribui províncias às contas de demonstração, cria stock em Luanda e no Uíge e vendas no Uíge |
| `npm run seed:provincias:limpar` | repõe as contas em “sem província” |
| `npm run test:sql` | 243 testes sobre PostgreSQL real (PGlite) |
| `npm run test:live` | 30 testes de aceitação contra o Supabase real |
| `npm run test:crud` | 112 testes CRUD por perfil contra o Supabase real |
| `npm run test:web` | 153 testes E2E do cliente web |
| `npm run test:designer` | 29 testes do estúdio de design |
| `npm run test:mobile` | 13 testes do cliente Flutter |
| `npm run test:all` | toda a suite (exceto mobile) |
| `npm run setup:sql` | regenera `SETUP_COMPLETO.sql` a partir das migrações |

`test:live`, `test:crud` e `test:web` **arrancam o servidor web sozinhos** se ele
não estiver a responder, e fecham-no no fim. Se já tiver `npm run dev` aberto,
usam o seu e não lhe tocam (nenhum processo alheio é terminado).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `apps/web` | Next.js 16 + TypeScript + Tailwind (PWA) |
| `apps/mobile` | Flutter (Android) |
| `apps/capacitor` | embalagem iOS — gera o `.ipa` no Mac (ver [`docs/IOS.md`](docs/IOS.md)) |
| `supabase/SETUP_COMPLETO.sql` | base de dados completa, pronta a colar |
| `supabase/migrations` | as 7 partes do SQL, separadas |
| `supabase/PATCH_APLICAR_TUDO.sql` | **o ficheiro a colar**: correções + designer numa só execução |
| `supabase/PATCH_designer.sql` | só o designer, para colar sobre uma base já criada |
| `supabase/PATCH_PROVINCIAS.sql` | **obrigatório** para a gestão multiprovincial, numa base já criada |
| `supabase/PATCH_COLABORADORES.sql` | **obrigatório** para referências, comissões, metas e perfis de colaborador |
| `supabase/PATCH_CONTEUDOS.sql` | **obrigatório** para comunicados, testemunhos, promoções e formação |
| `supabase/PATCH_TAXAS_PEDIDOS.sql` | **obrigatório** para a taxa de comissão da empresa, confirmação de entrega e candidaturas a revendedor |
| `supabase/PATCH_RESERVAS.sql` | **obrigatório** para a carteira de clientes: reservar sem criar conta, e o cliente herdar as compras ao registar-se |
| `supabase/build-setup.mjs` | regenera o ficheiro único a partir das migrações |
| `supabase/seed.mjs` | povoamento idempotente do catálogo |
| `supabase/seed-provincias.mjs` | povoamento multiprovincial (províncias, stock por província, vendas) |
| `supabase/tests` | testes SQL (PGlite) e testes ao vivo |
| `docs` | arquitetura, RLS, modelo de dados, roadmap, deploy Vercel e iOS |
| `assets` | logótipo e recursos de marca |

## Funcionalidades

**Público** — catálogo com categorias e pesquisa, página de produto com stock
real, carrinho persistente, checkout.

**Cliente** — encomendas com estados e histórico, favoritos, pedido de desconto,
chat em tempo real. Em `/referencia` o cartão **Falar com a equipa INUKA** abre
uma conversa de grupo com o colaborador vinculado **e** a gestão, para uma
mensagem não ficar à espera de uma só pessoa.

**Colaborador** (o mesmo que vendedor) — cartão de identidade com a referência
INUKA (`INK-UIG-00005`), painel com clientes, vendas, comissões pagas e
pendentes, meta do mês e posição na equipa, gráficos de 6 meses, perfil completo
(BI, contactos, morada, função, categoria) e histórico de pagamentos. Registo de
venda com validação de stock e preço no servidor, clientes associados por
telefone, chat.

**Carteira do colaborador** (`/vendedor/clientes`) — o colaborador acrescenta
alguém à carteira de duas maneiras: **reserva** (nome, telefone, bairro) ou
**liga uma conta que já existe**. Reservar **não cria conta nenhuma**: grava
nome e telefone em `reserved_customers`, sem tocar em `auth.users` e sem
palavra-passe provisória. Quem abre a conta é o próprio cliente, em `/registo`,
com o número reservado; nesse momento `ligar_reserva_ao_cliente` fecha a reserva,
cria o vínculo e entrega-lhe as compras que já tenham sido registadas com esse
telefone — produto, quantidade, preço e o colaborador que vendeu. A província é
sempre a do colaborador (herdada da reserva) e o papel é sempre `customer`.

A venda a um telefone sem conta também funciona: `register_sale_by_phone` grava a
venda com `sales.customer_phone` e reserva o cliente automaticamente, em vez de
recusar a operação. Cada linha da carteira mostra o que o cliente já comprou
(total em Kz, número de compras, última compra); as reservas aparecem marcadas
**por activar**, com o valor que está à espera do registo, e só têm chamada e
WhatsApp — um reservado ainda não tem sessão para receber mensagens. O gestor vê
e muda tudo em `/gerente/clientes`: mudar de colaborador **desactiva** o vínculo
antigo em vez de o apagar, pelo que fica registado quem ligou o cliente e quando.

**As minhas compras** (`/cliente/compras`) — o cliente vê tudo o que foi
registado em seu nome, incluindo o que comprou a um colaborador **antes** de ter
conta. Lê de `minhas_compras()`, uma função que devolve só o que é do próprio
(com o nome do colaborador), sem abrir `sales` ou `sale_items` a mais ninguém.

**Taxa de comissão** — há **uma** taxa da empresa (10 % por omissão), mudada pela
gestão em `/gerente/colaboradores` com um campo e um botão. Quem não tem taxa
pessoal herda-a; a taxa pessoal continua a existir como excepção, por
colaborador. A alteração chega ao colaborador **em tempo real**: a área de
colaborador subscreve `platform_settings` no Realtime e actualiza o número sem
recarregar. `seller_profiles.commission_rate` passou a aceitar `NULL` = herda —
antes `0` significava ao mesmo tempo "sem comissão" e "ainda por definir", que
são coisas diferentes. O gestor pode, explicitamente, recalcular as comissões
**por pagar**; as já pagas nunca são tocadas.

**Pedidos e entregas** — o cliente acompanha os pedidos em `/cliente/encomendas`
e, quando a encomenda está **em entrega** ou **pronta para levantamento**, tem o
botão **Já recebi a encomenda**: a encomenda passa a *Concluída* e o stock sai do
inventário, com a nota "Entrega confirmada pelo cliente" no histórico. O cliente
não escolhe "em preparação" nem "em entrega" — isso é da loja. O colaborador
acompanha as encomendas da sua carteira em `/vendedor/encomendas`, e a gestão
muda qualquer estado em `/gerente/encomendas`. Uma encomenda nova notifica a
gestão **e** o colaborador responsável. A página do cliente mostra o **histórico**
de estados (aberto enquanto a encomenda está em curso) e actualiza-se sozinha por
Realtime quando a gestão muda o estado — sem recarregar.

**Quero ser revendedor** (`/revendedor`) — página pública, ligada no topo da
página inicial e no menu. Nome, telefone, província e mensagem; a candidatura cai
em `reseller_applications` e aparece em `/gerente/revendedores`, onde a gestão
contacta e marca o estado (*novo*, *em contacto*, *aprovado*, *recusado*). Aprovar
ali **não** cria conta — para isso usa-se Colaboradores, que já sabe promover um
cliente. Um telefone repetido dentro de 10 minutos devolve "já recebemos" em vez
de duplicar a linha.

**Gestão** — dashboard com dados reais e rede de colaboradores (totais, análise
por província, ranking), pesquisa de colaboradores por referência, nome, BI ou
telefone, ficha individual com edição de dados, metas e pagamento de comissões,
produtos e stock, encomendas com mudança de estado, aprovação de descontos com
limite configurável, auditoria.

**Contas e fotografias** — a gestão cria colaboradores (**conta nova** ou
**promover um cliente**), cria e edita clientes e apaga contas **sem histórico**
(as que têm vendas ou encomendas só se desativam). A fotografia de perfil pode
ser carregada pelo próprio ou por um gestor, para colaboradores e para clientes
(bucket público `avatars`, escrita limitada à pasta de cada um ou a quem gere).
Criar contas exige a Admin API, por isso passa por
`/api/gerente/utilizadores` — a chave `service_role` nunca chega ao browser. O
colaborador **já não cria contas de cliente**: reserva o cliente em
`/api/vendedor/clientes` e é o próprio que abre a conta (ver **Carteira do
colaborador**).

**Estúdio de design** (`/designer`) — **exclusivo da gestão**: colaboradores e
clientes não entram, e a base de dados recusa a escrita a quem não é gestor (não
basta esconder a rota). Editor de canvas com texto, imagens (upload para Storage
privado, com recorte e sanitização de SVG), formas, ícones, camadas, páginas
múltiplas, zoom, desfazer/refazer, guardar automático versionado e **histórico de
versões com restauro**. Exporta PNG, JPG e PDF (uma página por página). Modelos
prontos com a identidade INUKA.

O separador **Catálogo** traz os produtos reais para dentro do projeto — procura
por nome, referência ou categoria, filtra por categoria e província, e
**[ USAR IMAGEM DESTE PRODUTO ]** insere a fotografia, o nome e o preço sem sair
do editor nem perder o que estava feito. O botão **[ PUBLICAR CONTEÚDO ]** leva o
projeto para um dos quatro destinos: comunicado, testemunho, promoção ou capa de
formação.

Se a ligação cair a meio do trabalho, as alterações ficam num rascunho local e o
editor oferece a recuperação ao reabrir — mas um projeto só conta como guardado
depois de o servidor confirmar.

**Conteúdos publicados** — um único registo por conteúdo (`content_items`) serve
os quatro destinos, com estado (rascunho, em edição, publicado, agendado,
suspenso, arquivado), província, datas e produtos ligados. Publicar outra vez a
partir do mesmo projeto **actualiza** a publicação em vez de criar uma segunda
(índice único em `project_id`). Em `/gerente/conteudos` a gestão vê tudo o que
existe, com miniaturas e filtros por tipo e estado.

- **Comunicados** → feed em `/vendedor/comunicados`, com fixados no topo,
  reações e comentários. Clientes não os vêem, nem pedindo o id.
- **Testemunhos** → `/cliente/testemunhos`. Só aparecem os publicados; um
  rascunho é trabalho interno e não sai da gestão.
- **Promoções** → `/promocoes`, com o estado real da campanha (*em curso*, *em
  breve*, *terminada*). Uma campanha fora do prazo não aparece a quem não tem
  sessão; as encerradas ficam visivelmente marcadas. Campanhas provinciais não se
  misturam com as nacionais na loja pública.

**Formação INUKA** — a gestão cria cursos (`/gerente/formacao`) com categorias,
nível, província, capa, aulas ordenáveis (texto, vídeo, PDF, ligação, quiz) e
estado; vê inscritos, concluídos e progresso médio. O colaborador vê
`/vendedor/formacao` com faixas horizontais (*Continuar a aprender*, *Novas
formações*, uma por categoria, *Concluídos*), abre o curso, conclui aulas e
acompanha a percentagem; cada curso tem reações e comentários. Clientes não têm
acesso à formação.

## App Android

A app Flutter (`apps/mobile`) é a loja no telemóvel: catálogo com pesquisa e
filtro por categoria, ficha de produto com favoritos, carrinho persistente,
mensagens em tempo real e perfil com fotografia. Em **Perfil → As minhas
compras** o cliente vê o que comprou a um colaborador — incluindo o que foi
registado **antes** de ele ter conta, com produto, quantidade, preço e quem
vendeu (`minhas_compras()`). Quem é colaborador vê ainda **O meu painel**
(vendas, comissões, clientes, meta). A gestão continua no site.

Versão actual: **1.0.2** (`versionCode` 3 universal, 1003 / 2003 / 4003 por ABI).

```bash
cd apps/mobile
flutter build apk --release --split-per-abi   # 3 APKs, um por arquitectura
flutter build apk --release                   # universal
# → build/app/outputs/flutter-apk/
```

O endereço dado em `--dart-define` é só a sugestão inicial: pode ser mudado no
telemóvel em **Perfil → Servidor**, que é o que permite instalar o mesmo APK em
vários telemóveis sem recompilar. Detalhes, assinatura e requisitos em
[`apps/mobile/README.md`](apps/mobile/README.md).

O site responde em `/api/saude` para a app confirmar que o endereço está certo.

## App iPhone

Duas formas, e a primeira não precisa de Mac nem de conta Apple:

**1. Instalar no ecrã principal (PWA).** Abrir
`https://inuka-angola.apps.workbuddy.host/?sharecode=J27FVBMTIH` no **Safari** do
iPhone → Partilhar → **Adicionar ao Ecrã Principal**. Fica com ícone próprio,
ecrã de arranque próprio e sem barra de endereço. Actualiza sozinha, porque é o
site.

**2. Gerar um `.ipa` (Capacitor).** O projecto está em `apps/capacitor` e aponta
para o mesmo servidor Next.js — mesma base de dados, mesmas contas. Construir um
`.ipa` exige **macOS com Xcode**: não é possível gerá-lo a partir do Windows.

```bash
cd apps/capacitor
npm install
npx cap add ios
node scripts/pos-add.mjs        # Info.plist: nome, retrato, barra de estado
npx @capacitor/assets generate --ios
npx cap sync ios && npx cap open ios
```

Receita completa — assinatura, UDIDs, Ad Hoc, instalação nos telefones e o que
muda se um dia for para a App Store — em [`docs/IOS.md`](docs/IOS.md).

Os ícones e ecrãs de arranque do site (`public/ios/`, `apple-touch-icon.png`)
geram-se com `cd apps/web && node scripts/gerar-icones-ios.mjs`.

## Autenticação

Login por **telefone**. O Supabase Auth exige email, pelo que o telefone é
convertido num email interno determinístico (`u244923456789@inuka.ao`). O registo
é feito no servidor (`POST /api/auth/registo`) via Admin API, porque o `signUp`
do cliente envia email de confirmação — impossível com emails sintéticos.
Detalhes e consequências em [`docs/SUPABASE_CONFIG.md`](docs/SUPABASE_CONFIG.md) §5.

## Base de dados

56 tabelas · 123 políticas RLS · 95 funções · 5 buckets de Storage

```bash
npm run test:sql        # Total: 225 | Passou: 225 | Falhou: 0
npm run test:designer   # estúdio de design contra o Supabase real
npm run test:live       # arranca o servidor sozinho se for preciso
npm run test:crud       # arranca o servidor sozinho se for preciso
npm run test:web        # arranca o servidor sozinho se for preciso
```

**Se a base já existia antes**, colar no SQL Editor, por esta ordem:

1. `supabase/PATCH_APLICAR_TUDO.sql` — correções de 2026-10-31 + estúdio de design.
2. `supabase/PATCH_PROVINCIAS.sql` — gestão multiprovincial.
3. `supabase/PATCH_COLABORADORES.sql` — referências por província, comissões, metas e perfis.
4. `supabase/PATCH_CONTEUDOS.sql` — comunicados, testemunhos, promoções e formação INUKA.
5. `supabase/PATCH_designer.sql` — volta a colar: acrescenta a guarda que fecha o estúdio a quem não é gestão.
6. `supabase/PATCH_TAXAS_PEDIDOS.sql` — taxa de comissão da empresa, confirmação de entrega pelo cliente e candidaturas a revendedor.
7. `supabase/PATCH_RESERVAS.sql` — carteira de clientes sem criar contas: reserva, ligação no registo e compras herdadas.

Todos são idempotentes. Enquanto o segundo não for aplicado, `/referencia` e
`/gerente/produtos` mostram um aviso explícito ("falta aplicar a migração
provincial"), em vez de falharem em silêncio.

## Documentação

- [`docs/SUPABASE_CONFIG.md`](docs/SUPABASE_CONFIG.md) — configuração passo a passo
- [`docs/POLITICAS_RLS.md`](docs/POLITICAS_RLS.md) — matriz de acessos e proteções
- [`docs/MODELO_DADOS.md`](docs/MODELO_DADOS.md) — entidades e regras de consistência
- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — visão técnica
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — estado por fase
