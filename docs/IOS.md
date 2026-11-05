# INUKA no iPhone

Duas formas de ter a INUKA instalada num iPhone. A primeira funciona hoje, sem
Mac e sem conta Apple. A segunda produz um `.ipa` e exige macOS.

| | A. Ecrã principal (PWA) | B. `.ipa` (Capacitor) |
|---|---|---|
| Precisa de Mac | Não | **Sim** |
| Precisa de conta Apple | Não | Sim, 99 USD/ano |
| Fica instalada | Sim, ícone e ecrã inteiro | Sim, app nativa |
| Arranque sem barra de endereço | Sim | Sim |
| Notificações push | iOS 16.4+ | Sim |
| Actualização | Automática (é o site) | Reinstalar o `.ipa` |
| Tempo até funcionar | 30 segundos | 1 a 2 horas |

As duas mostram exactamente o mesmo sistema: a mesma base de dados Supabase, as
mesmas contas, as mesmas permissões. A diferença é só a embalagem.

---

## A. Instalar no ecrã principal (funciona em todos os modelos indicados)

Não é um atalho de browser: o iOS trata-a como aplicação — ícone próprio, ecrã
de arranque próprio, sem barra de endereço, e com o estado de sessão guardado.

1. Abrir **Safari** no iPhone (tem de ser o Safari; o Chrome no iOS não instala).
2. Ir a
   `https://inuka-angola.apps.workbuddy.host/?sharecode=J27FVBMTIH`
   O `?sharecode=` é obrigatório na primeira abertura.
3. Botão **Partilhar** (quadrado com a seta para cima).
4. **Adicionar ao Ecrã Principal**.
5. O nome já vem preenchido — **INUKA**. Tocar em **Adicionar**.

Fica com o logótipo dourado no ecrã principal. Ao abrir, aparece o ecrã de
arranque preto com a marca (não o flash branco) e entra directamente.

### O que já está feito para isto funcionar

- `public/apple-touch-icon.png` — 180×180, o único ícone que o iOS lê.
- `public/manifest.json` — `start_url` com o `?sharecode=`. Sem ele, o ícone
  abria uma sessão nova do iOS, sem o cookie de acesso, e dava **403**. Este era
  um defeito real: o iOS não partilha cookies entre o Safari e a app instalada.
- `src/app/layout.tsx` — `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`
  e sete `apple-touch-startup-image`, um por proporção de ecrã (XR/11, 12/13/14,
  14 Pro/15/16, 16 Pro, Pro Max, 17). O `metadata` do Next não expõe
  `apple-touch-startup-image`, por isso vão à mão no `<head>`.
- `viewportFit: "cover"` + `env(safe-area-inset-*)` — o conteúdo não fica debaixo
  do entalhe nem da barra de gestos.
- `public/ios/*.png` — ícones e ecrãs de arranque, gerados por
  `apps/web/scripts/gerar-icones.mjs` (o mesmo script que produz os ícones do
  site e do Android).

Regenerar os ícones (depois de mudar o logótipo):

```bash
cd apps/web && node scripts/gerar-icones.mjs
```

O script **recorta primeiro as margens pretas** do logótipo e só depois escala.
Sem isso a assinatura ficava a ~40% do ícone e lia-se mal no ecrã principal.

---

## B. Gerar o `.ipa`

### Porque não está já gerado

Um `.ipa` é um pacote assinado. Assinar exige o `codesign` da Apple, que só
existe no macOS, e um certificado emitido pela Apple. Isto não é uma limitação
de configuração: **não há forma de produzir um `.ipa` instalável a partir do
Windows.** Qualquer ficheiro com extensão `.ipa` gerado aqui seria um ZIP que o
iPhone recusa.

O que está pronto é tudo o resto: o projecto, o ícone, o ecrã de arranque, os
valores do `Info.plist` e o endereço do servidor. No Mac são cinco comandos.

### Passo 1 — no Mac

```bash
# Xcode (App Store) e as ferramentas de linha de comando
xcode-select --install

# CocoaPods — o Capacitor precisa para as dependências nativas
brew install cocoapods

cd "INUKA APP/apps/capacitor"
npm install
```

### Passo 2 — criar e preparar o projecto iOS

```bash
npx cap add ios                 # cria apps/capacitor/ios/
node scripts/pos-add.mjs        # Info.plist: nome, retrato, barra de estado
npx @capacitor/assets generate --ios   # ícone e ecrã de arranque
npx cap sync ios
npx cap open ios                # abre no Xcode
```

O `pos-add.mjs` usa o `plutil` do macOS e escreve:

| Chave | Valor | Porquê |
|---|---|---|
| `CFBundleDisplayName` | `INUKA` | senão o ícone diz "App" |
| `UISupportedInterfaceOrientations` | só retrato | as tabelas de gestão partem-se na horizontal |
| `UIStatusBarStyle` | `LightContent` | texto claro sobre o fundo preto |
| `ITSAppUsesNonExemptEncryption` | `false` | evita a pergunta de exportação em cada envio |
| `WKAppBoundDomains` | domínio da INUKA | o WKWebView partilha a sessão Supabase |

### Passo 3 — assinar

No Xcode, com o projecto aberto:

1. **App** (o target) → **Signing & Capabilities**.
2. **Team**: escolher a equipa. Sem conta paga, aparece "Personal Team" — serve
   para testar, mas a app expira em **7 dias** e não dá `.ipa` exportável.
3. **Bundle Identifier**: `ao.inuka.app`.
4. **Minimum Deployments**: `14.0`. É o mínimo do Capacitor 7 e cobre todos os
   modelos pedidos — do XR (que pára no iOS 18) ao mais recente.

Para instalar em iPhones que não estão ligados ao Mac, é preciso **Ad Hoc**:

1. developer.apple.com → **Certificates, Identifiers & Profiles** → **Devices**
   → registar o **UDID** de cada iPhone (até 100 por ano).
2. Criar um **Provisioning Profile** do tipo *Ad Hoc* com esses devices.
3. No Xcode: **Product → Archive**.
4. **Distribute App → Ad Hoc → Export**.

O UDID obtém-se ligando o iPhone ao Mac e abrindo **Finder → iPhone** (clicar no
nome do modelo alterna entre capacidade e UDID), ou em
`developer.apple.com/devices` depois de o registar.

### Passo 4 — gerar o `.ipa` pela linha de comandos

Equivalente ao passo 3, para automatizar. `ExportOptions.plist` (não versionar):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>            <string>ad-hoc</string>
  <key>teamID</key>            <string>O_TEU_TEAM_ID</string>
  <key>signingStyle</key>      <string>manual</string>
  <key>stripSwiftSymbols</key> <true/>
  <key>compileBitcode</key>    <false/>
</dict>
</plist>
```

```bash
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App -configuration Release \
  -archivePath build/INUKA.xcarchive archive

xcodebuild -exportArchive \
  -archivePath build/INUKA.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/ipa
```

O resultado é `build/ipa/INUKA.ipa`.

### Passo 5 — instalar nos iPhones

O `.ipa` não se instala por AirDrop. Três formas:

- **Apple Configurator** (Mac, gratuito): arrastar o `.ipa` para o iPhone ligado.
- **Diawi / Loadly / Firebase App Distribution**: carregar o `.ipa`, enviar o
  link; o iPhone abre-o no Safari e instala.
- **TestFlight**: em vez de `.ipa`, enviar para o App Store Connect. Os testers
  internos não passam por revisão; a build expira em 90 dias.

Depois de instalar, o iPhone pede para confiar no certificado em
**Definições → Geral → VPN e Gestão de Dispositivos**.

### Sem conta paga: o que acontece

Uma conta Apple gratuita assina a app para o próprio iPhone durante **7 dias**.
Passado esse prazo a app deixa de abrir e é preciso voltar a compilar pelo Xcode.
Para uso continuado em vários iPhones de colaboradores, a conta de 99 USD/ano é
o caminho — e o **Ad Hoc** resolve os 100 dispositivos.

---

## O que a app iOS é, e o que não é

A INUKA é Next.js com renderização no servidor: as páginas de gestão consultam o
Supabase no servidor com a chave `service_role`, há rotas de API e há o `proxy.ts`
a proteger as rotas privadas. **Não é possível exportar isto para HTML estático**
sem reescrever a autorização e expor a chave. Por isso a app iOS é uma janela
nativa sobre o mesmo servidor (`server.url` no `capacitor.config.ts`).

Consequências, ditas sem rodeios:

- **Precisa de rede.** Não há modo offline além da página `www/offline.html`, que
  explica a situação e tenta de novo.
- **É recusada na App Store.** A regra 4.2 da Apple rejeita apps que são só uma
  página web embrulhada. Como o objectivo é distribuir fora da loja, é aceitável
  — mas não vale a pena tentar submeter sem antes trazer funcionalidade nativa.
- **Actualizações são automáticas.** Como carrega o site, um deploy novo chega a
  todos os telefones no instante seguinte. É a grande vantagem desta abordagem.
  **Não é preciso voltar a gerar o `.ipa` quando muda o site** — as novidades
  (por exemplo `/cliente/compras`, as reservas da carteira) aparecem sem
  reinstalar nada.

### Versão do `.ipa`

`node scripts/pos-add.mjs` escreve `CFBundleShortVersionString` a partir do
`version` em `apps/capacitor/package.json` (actualmente **1.0.2**) e
`CFBundleVersion` a partir de `INUKA_BUILD` (por omissão `3`). Sem isto, todos
os envios saíam como `1.0` e o TestFlight recusava dois builds com o mesmo
número. Para um envio novo sem mudar a versão:

```bash
INUKA_BUILD=4 node scripts/pos-add.mjs
```

### Se um dia for para a App Store

O caminho é levar para dentro da app o que é nativo — notificações push, câmara
para ler códigos de barras, guardar a carteira offline — e só então empacotar.
Sem isso, a Apple recusa.

---

## Endereço do servidor

Está num só sítio: `apps/capacitor/capacitor.config.ts`.

```ts
const SITE = process.env.INUKA_URL ?? "https://inuka-angola.apps.workbuddy.host/?sharecode=J27FVBMTIH";
```

Para apontar a produção:

```bash
INUKA_URL="https://inuka.ao" npx cap sync ios
```

Quando o alojamento deixar de ter o portão `?sharecode=`, basta tirá-lo daqui e
do `start_url` em `apps/web/public/manifest.json`.
