# INUKA Angola — app Android

A loja INUKA em Flutter, para Android. Fala diretamente com o Supabase (Auth,
PostgREST, Storage); o servidor web do Next.js só é usado para **criar conta**,
porque a Admin API exige a `service_role`, que nunca pode estar no binário.

## O que a app faz

| Separador | Conteúdo |
|---|---|
| Catálogo | grelha de produtos, pesquisa por nome, filtro por categoria, "ver mais" |
| Carrinho | persistido no telemóvel, `place_order` idempotente por `client_ref` |
| Mensagens | conversas e chat em tempo real (Realtime do Supabase) |
| Perfil | fotografia (upload para o bucket `avatars`), encomendas, favoritos, servidor, sair |

Quem tem papel `seller` vê ainda **O meu painel** (`colaborador_painel()`):
vendas do mês, comissões por receber, clientes, posição na equipa e meta.

A gestão (produtos, colaboradores, relatórios, estúdio de design) continua no
site — a app é a loja, não o back office.

## Compilar

```bash
# a partir de apps/mobile
flutter build apk --release \
  --dart-define=INUKA_API_BASE_URL=http://192.168.8.34:3000
```

O APK fica em `build/app/outputs/flutter-apk/app-release.apk`.

O `--dart-define` é apenas o **endereço sugerido**: o valor real pode ser
mudado na app, em **Perfil → Servidor**, e fica guardado no telemóvel. É o que
permite instalar o APK num telemóvel da loja sem recompilar quando o IP do
portátil muda.

### Assinatura

`android/key.properties` + `android/app/inuka-release.jks` assinam o release.
Nenhum dos dois vai para o git. **Guardar os dois**: sem eles não é possível
publicar uma actualização que o Android aceite por cima da versão instalada
(o Android recusa trocar a chave de assinatura de uma app já instalada).

Sem `key.properties` o build continua a funcionar, mas assinado com as chaves
de debug — serve para testar, não para distribuir.

### Endereço do servidor no telemóvel

O servidor de registo é o computador onde o site está a correr. Ao arrancar, o
Next.js imprime:

```
- Network: http://192.168.1.5:3000
```

Esse é o endereço a escrever em **Perfil → Servidor → Testar ligação**. O
telemóvel e o computador têm de estar na mesma rede Wi-Fi, e o servidor tem de
estar a aceitar ligações da rede (o `next dev` já aceita).

## Requisitos

- Flutter 3.29+ (`C:\develop\flutter\bin\flutter-dev.bat` nesta máquina)
- JDK 17
- Android SDK

> Nesta máquina `flutter.bat` não existe — usar `flutter-dev.bat`. A primeira
> invocação falha com "Resident Frontend Compiler could not be established" e
> passa à segunda; é um problema do toolchain, não do projeto.

## Testes

```bash
flutter analyze
flutter test
```

`test/live_integration_test.dart` fala com o Supabase real e só corre quando as
variáveis de ambiente das contas de teste estão definidas.
