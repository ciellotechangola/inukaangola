# Mensagens, conversas de pedido e notificações

> Migração **0036** (`supabase/migrations/0036_conversas_de_pedidos.sql`,
> versão para o SQL Editor em `supabase/PATCH_CONVERSAS_PEDIDOS.sql`).
> Requer a 0001 a 0035 aplicadas.

## O que mudou

Antes, o revendedor escrevia uma mensagem no pedido e a gestão respondia
**uma vez** (`revendedor_pedidos.resposta`). A segunda pergunta não tinha onde
cair. O cliente normal não tinha canal nenhum dentro da encomenda.

Agora cada pedido tem **a sua conversa**, com histórico completo, e o
cabeçalho mostra contadores.

| Antes | Agora |
|---|---|
| uma resposta por pedido | conversa contínua, sem limite de mensagens |
| «mensagem» e «resposta» em campos do pedido | `conversations` + `messages` (as mesmas do chat da equipa) |
| sem contadores | `mensagens` e `pedidos` no cabeçalho, em tempo real |
| ✓ em todas as mensagens | ✓ enviada · ✓✓ lida |

## Como a conversa fica ligada ao pedido

`conversations` ganhou duas colunas:

- `pedido_grosso_id` → `revendedor_pedidos(id)`
- `order_id` → `orders(id)`

Com índices **únicos parciais** (`WHERE ... IS NOT NULL`): um pedido tem uma
só conversa. É a base que garante a regra — não a interface.

### Criação

1. **Pedido de grosso novo** — o gatilho `trg_pedido_cria_conversa` cria a
   conversa e guarda a mensagem que o revendedor escreveu ao encomendar como
   primeira mensagem. A gestão vê-a na caixa de entrada sem abrir o pedido.
   Se algo falhar, o pedido segue na mesma (a conversa é recriada na primeira
   abertura).
2. **Abrir conversa** — `abrir_conversa_pedido(pedido)` /
   `abrir_conversa_encomenda(encomenda)` devolvem sempre a mesma conversa.
   Usam `pg_advisory_xact_lock` para que dois cliques ao mesmo tempo não criem
   duas.
3. **Encomenda de loja** — criada à primeira abertura (o cliente não escreve
   nada ao comprar; não faz sentido encher a caixa de entrada da gestão).

### Quem entra na conversa

`gestor_do_utilizador(pessoa)` decide, por esta ordem:

1. o gestor atribuído ao revendedor (`revendedores.manager_id`);
2. o gestor da província da pessoa;
3. a administração nacional;
4. o gestor activo mais antigo.

O revendedor/cliente é `member`; o gestor é `admin`. Um gestor de outra
província que abra o pedido **entra** na conversa (senão ficava em modo de
observação e não podia responder — `messages_insert` exige ser membro).

## Contadores (`contadores_nao_lidas()`)

Uma chamada devolve `{ mensagens, pedidos }`:

- **mensagens** — mensagens de outras pessoas, nas minhas conversas, depois do
  meu `last_read_at`. A mesma regra do `carregarInbox`.
- **pedidos** — depende do papel:
  - **gestão**: pedidos de grosso `novo`/`em_analise` (dentro das províncias
    que pode ver) + encomendas `pending`. É uma fila de trabalho, não uma
    novidade — não zera ao abrir.
  - **revendedor**: pedidos dele que mudaram depois do último
    `profiles.pedidos_visto_em`. Um pedido ainda `novo` não conta (foi ele que
    o criou).
  - **cliente**: encomendas dele que mudaram desde a mesma marca.

`marcar_pedidos_vistos()` grava a marca. É chamada por
`components/MarcarPedidosVistos.tsx`, montado no fundo das páginas de pedidos
— **depois** de a lista estar no ecrã, porque o servidor não sabe o que o
browser mostrou.

## Estado de leitura (✓ / ✓✓)

`lida_ate_conversa(conversa)` devolve o **mínimo** `last_read_at` dos outros
membros (num grupo, só fica lida quando todos leram).

- `null` ou mensagem mais recente que esse instante → **✓ enviada**
- mensagem anterior ou igual → **✓✓ lida**

Não há «entregue»: sem push não há como saber que o aparelho recebeu. Inventar
um terceiro estado seria mentira.

## Tempo real

Publicadas em `supabase_realtime` (0036): `conversation_members` e
`revendedor_pedidos`. Já estavam: `messages`, `conversations`, `orders`.

`lib/notificacoes.ts` junta três caminhos:

1. realtime (mensagem, lido, estado do pedido);
2. eventos da própria aplicação — `inuka:mensagens`, `inuka:pedidos`;
3. ciclo de 30 s e o voltar ao separador (websocket caído em segundo plano).

## Ecrãs

| Ecrã | O que tem |
|---|---|
| `/revenda/pedidos` | «Abrir conversa →» por pedido + quantas mensagens por ler |
| `/cliente/encomendas` | o mesmo, por encomenda |
| `/gerente/pedidos` | «Abrir conversa» dentro de cada pedido |
| `/gerente/conversas` | central com filtros **Todas / Clientes / Revendedores / Pedidos** |
| `/conversas` | mensageiro comum (todos os perfis) |
| cabeçalho | dois ícones com contador (mensagens e pedidos), no computador e no telemóvel |

O selo do pedido no cabeçalho da conversa leva de volta à lista de pedidos de
quem está a ver (`pedidoHref`).

## Regras que não mudaram

- Preços, produtos, stock, carrinho e regras de compra: intocados.
- `revendedor_pedidos.resposta` continua a ser escrita por
  `responder_pedido_revendedor` — a conversa é um canal **a mais**, não
  substitui a resposta formal que fica no pedido.
- Nada foi apagado: as colunas novas nascem vazias e as conversas antigas
  ficam como estão.
- O âmbito continua a ser o **RLS**; as RPCs só acrescentam a verificação de
  dono do pedido.

## Aplicar

1. Supabase → SQL Editor → colar `supabase/PATCH_CONVERSAS_PEDIDOS.sql` → RUN.
2. Sem este passo a interface funciona, mas sem conversas por pedido e sem
   contadores (as RPCs não existem e a UI degrada em silêncio, por opção).
