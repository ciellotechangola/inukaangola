# Configuração do Supabase — INUKA Angola

> **Estado atual**: o projeto `kvfovbdiaofgtaqopgeh` já está provisionado,
> com o esquema aplicado (56 tabelas, 123 políticas, 95 funções, 5 buckets),
> catálogo semeado e a conta de gestão criada.
> Este documento serve para reproduzir a configuração de raiz ou num novo projeto.

---

## 1. Criar o projeto

1. https://supabase.com → **New project**.
2. Região próxima de Angola (ex.: `eu-central-1`, Frankfurt).
3. Guardar a palavra-passe da base de dados num gestor de segredos.

## 2. Criar a base de dados

1. **SQL Editor → New query**.
2. Abrir `supabase/SETUP_COMPLETO.sql`.
3. Copiar **tudo**, colar e **RUN**.

Resultado esperado: `Success. No rows returned`.

| Objeto | Quantidade |
|---|---|
| Tabelas | 34 |
| Políticas RLS | 74 |
| Funções / RPC | 40 |
| Buckets de Storage | 4 |

O script é **idempotente**: pode ser executado outra vez (por exemplo depois de
uma atualização) sem duplicar nada nem perder dados.

## 3. Obter credenciais

Em **Settings → API**:

| Campo no painel | Variável | Onde usar |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | web + mobile |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web + mobile |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` | **apenas servidor web** |
| Project ID | `SUPABASE_PROJECT_REF` | referência |

> A `service_role` **nunca** pode ir para o browser nem para o binário da app.
> É usada exclusivamente na rota de servidor `/api/auth/registo` e nos scripts.

## 4. Variáveis de ambiente

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_NAME=INUKA Angola
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

No mobile, `apps/mobile/lib/config/app_config.dart`:

```dart
static const String supabaseUrl = 'https://SEU-PROJETO.supabase.co';
static const String supabaseAnonKey = '...';      // chave pública
static const String apiBaseUrl = 'http://10.0.2.2:3000'; // registo (ver §6)
```

## 5. Autenticação — como funciona (importante)

O INUKA Angola autentica por **telefone**, mas o Supabase Auth exige um email.
A solução é um email interno **determinístico**:

```
+244 923 456 789  →  u244923456789@inuka.ao
```

Como é determinístico, o login reconstrói o email a partir do telefone, sem
consultar `profiles` (que o RLS esconde a utilizadores anónimos — e essa
consulta revelaria que telefones estão registados).

**O registo é feito no servidor**, em `POST /api/auth/registo`, através da
Admin API (`auth.admin.createUser` com `email_confirm: true`). Motivos:

1. `signUp` envia email de confirmação — com emails sintéticos a conta ficaria
   inutilizável.
2. O Supabase rejeita domínios sem MX (`email_address_invalid`); `inuka.ao` não
   tem registo MX.
3. O limite de envio de emails (2/hora no plano gratuito) bloquearia registos.
4. A verificação de telefone duplicado precisa de ler `profiles`, o que o RLS
   impede — e não deve ser exposto.

Consequências práticas:

- **Não é necessário** mexer em "Confirm email" nas definições de Auth: a Admin
  API cria contas já confirmadas e não envia emails.
- **Recuperação de palavra-passe por email não é possível** com emails
  sintéticos. O gestor repõe a palavra-passe pela Admin API (ver §9).
- O rate limit de emails deixa de ser um problema.

## 6. Base da API para o registo no mobile

O registo mobile chama a API web. Configurar `apiBaseUrl`:

| Ambiente | Valor |
|---|---|
| Emulador Android | `http://10.0.2.2:3000` |
| Simulador iOS | `http://localhost:3000` |
| Telemóvel físico | `http://IP-DO-PC-NA-REDE:3000` |
| Produção | `https://dominio-do-web` |

Pode ser sobreposto sem editar código:

```bash
flutter run --dart-define=INUKA_API_BASE_URL=https://app.inuka.ao
```

## 7. Semear o catálogo

```bash
node supabase/seed.mjs            # 11 categorias + 6 produtos [DEMO]
node supabase/seed.mjs --cats     # apenas categorias
node supabase/seed.mjs --limpar   # remove os produtos [DEMO]
```

> Os produtos têm prefixo `[DEMO]` e SKU `DEMO-*` porque **os preços oficiais da
> INUKA não são conhecidos**. São placeholders para validar o sistema, não
> catálogo real. Antes de publicar, corra `--limpar` e registe os produtos
> verdadeiros em `/gerente/produtos`.

## 8. Criar o primeiro gestor

1. Registar uma conta normal em `/registo` (ex.: telefone `+244 900 000 001`).
2. No **SQL Editor**:

```sql
SELECT public.promote_to_manager('+244900000001');
```

3. Vendedores:

```sql
SELECT public.promote_to_seller('+244923000003', 'Uíge');
```

Estas funções têm execução revogada para `anon` e `authenticated`: só correm no
SQL Editor ou com `service_role`.

## 9. Repor a palavra-passe de um utilizador

```sql
-- 1) Descobrir o id
SELECT id, phone FROM public.profiles WHERE phone = '+244923456789';
```

Depois, com `service_role`, chamar a Admin API:

```bash
curl -X PUT "https://SEU-PROJETO.supabase.co/auth/v1/admin/users/<ID>" \
  -H "apikey: <SERVICE_ROLE>" -H "Authorization: Bearer <SERVICE_ROLE>" \
  -H "Content-Type: application/json" \
  -d '{"password":"NovaPalavraPasse123"}'
```

## 10. Realtime

Configurado pelo script para `messages`, `conversations`, `notifications`,
`orders`, `posts`, `discount_requests`.

Se o painel não as mostrar: **Database → Replication** e ativar as tabelas.

## 11. Storage

| Bucket | Público | Uso |
|---|---|---|
| `product-images` | sim | fotografias de produtos |
| `avatars` | sim | fotos de perfil |
| `post-attachments` | sim | anexos de publicações |
| `message-attachments` | **não** | anexos privados de chat (URLs assinados) |

## 12. Verificação

```sql
-- Deve devolver 34
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';

-- Deve devolver 74
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';

-- Deve devolver 4
SELECT id, public FROM storage.buckets ORDER BY id;

-- Configuração comercial
SELECT key, value FROM public.platform_settings;
```

Via HTTP (substituir as chaves):

```bash
curl -s "https://SEU-PROJETO.supabase.co/rest/v1/categories?select=slug" \
  -H "apikey: <ANON>"
```

## 13. Patch de 2026-10-26 (obrigatório em bases criadas antes desta data)

`supabase/PATCH_desconto_promocional.sql` corrige `decide_discount`: o limite de
desconto passa a ser calculado sobre o **preço atual** (promocional, se existir)
e não sobre o preço oficial. Sem ele, qualquer desconto num produto já em
promoção é recusado indevidamente.

Colar no SQL Editor. É idempotente.

## 13b. Patch de 2026-10-31 (obrigatório em bases criadas antes desta data)

`supabase/PATCH_2026-10-31_correcoes.sql` corrige cinco problemas encontrados
nos testes ao vivo:

| # | Problema | Efeito |
|---|---|---|
| 1 | `update_order_status` / `cancel_reservation` com `seller_id` NULL | `NOT (false OR NULL OR false)` avaliava a NULL: **qualquer autenticado alterava encomendas e cancelava reservas de terceiros** |
| 2 | `place_order` não registava o estado inicial | O histórico da encomenda começava no segundo estado |
| 3 | `request_discount` não validava o limite | O cliente submetia valores impossíveis e só descobria na decisão |
| 4 | `products.created_by` / `inventory_movements.created_by` sem `ON DELETE SET NULL` | Contas que criaram produtos nunca podiam ser apagadas |
| 5 | `profiles_select` escondia o interlocutor | O chat mostrava conversas sem nome |

Colar no SQL Editor. É idempotente e não apaga dados.

## 14. Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `email_address_invalid` no registo | `signUp` no cliente com email sintético | Usar `POST /api/auth/registo` |
| Registo devolve 307 | proxy a redirecionar `/api/*` | `/api/` está excluído no `proxy.ts` |
| "Telefone não encontrado" no login | login antigo consultava `profiles` | Login deriva o email do telefone |
| `permission denied for table profiles` | RLS sem sessão | O pedido tem de estar autenticado |
| `Apenas gestores podem alterar papéis` | Trigger de proteção | Usar `promote_to_manager` |
| Catálogo vazio | Sem produtos ativos | `node supabase/seed.mjs` ou `/gerente/produtos` |
| Chat não atualiza | Realtime desativado | §10 |
| `Stock insuficiente` | Reservas de outras encomendas | Ver `inventory.reserved_quantity` |
| Não consigo apagar um utilizador | `audit_logs` / `orders` sem `CASCADE` | Integridade intencional: tratar primeiro os registos |
