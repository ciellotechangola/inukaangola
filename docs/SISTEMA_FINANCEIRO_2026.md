# Sistema financeiro e saldos por colaborador — 2026

> Refinamento do registo de vendas, da confirmação de pagamentos e dos saldos.
> Migração **0034**, suite funcional **732/732**, sem alterações a preços,
> stock, comissões ou regras de levantamento.

---

## 1. O que mudou, em uma frase

A venda passou a ter uma **situação que muda** — `PENDENTE` ou `PAGO` —, a
gestão passou a poder **confirmar que o dinheiro entrou**, e cada colaborador
passou a ver **três saldos separados** em vez de um número que se confundia com
dinheiro disponível.

Antes: a venda nascia «paga» (era o valor por omissão do formulário) e ficava
assim para sempre. Não havia como confirmar nada, nem quem confirmou, nem
quando. E o painel mostrava o volume vendido ao lado da comissão, sem dizer qual
deles se podia levantar.

---

## 2. A regra dos três saldos

São duas leituras do mesmo dinheiro, de propósito separadas.

| Saldo | O que soma | Para que serve | Pode levantar? |
|---|---|---|---|
| **Contabilístico** | todas as vendas não anuladas | desempenho e meta | **Não** |
| **Pendente** | vendas ainda não confirmadas | dinheiro possível | **Não** |
| **Activo (recebido)** | vendas confirmadas como pagas | dinheiro que entrou | — |

Ao lado, a **comissão** — que é o que o colaborador realmente recebe:

| Comissão | O que é |
|---|---|
| `por_pagar` | comissões de vendas por confirmar |
| `ganho` | comissões de vendas confirmadas |
| `pago` | o que já lhe foi entregue |
| `reservado` | levantamentos em curso |
| `disponivel` | `ganho − pago − reservado` → **é isto que se levanta** |

O volume vendido **não** é dinheiro do colaborador. Foi esta confusão que fazia
alguém ver 30.000 Kz e pensar que tinha 30.000 Kz para levantar.

### O cenário obrigatório, verificado

Venda de 30.000 Kz, colaborador com taxa de 10 %:

| | Contabilístico | Pendente | Activo | Disponível para levantar |
|---|---|---|---|---|
| **PENDENTE** | 30.000 | 30.000 | 0 | **0** |
| **PAGO** (gestão confirmou) | 30.000 | 0 | 30.000 | **3.000** (a comissão) |

O contabilístico **não muda** ao confirmar: a confirmação move o mesmo valor de
«pendente» para «activo», não soma uma venda nova. A comissão de 3.000 Kz passa
de `por_pagar` para `ganho` e fica disponível.

---

## 3. Base de dados — migração `0034_situacao_da_venda.sql`

Ficheiro: `supabase/migrations/0034_situacao_da_venda.sql`
Espelho para o SQL Editor: `supabase/PATCH_SITUACAO_DA_VENDA.sql`
Incluída no `SETUP_COMPLETO.sql` (34 partes).

### 3.1 Colunas novas em `sales`

```sql
payment_confirmed_at timestamptz
payment_confirmed_by uuid REFERENCES profiles(id) ON DELETE SET NULL
```

Uma venda paga antes desta migração recebe `COALESCE(updated_at, created_at)`
como data de confirmação — é uma aproximação honesta; usar `now()` faria
parecer que todas foram confirmadas hoje.

Dois índices para o que a gestão filtra: `(seller_id, payment_status,
created_at DESC)` e o parcial `(provincia_id, payment_status, created_at DESC)
WHERE payment_status <> 'paid'`.

### 3.2 `sale_events` — o livro de alterações

| Coluna | |
|---|---|
| `sale_id` | a venda |
| `tipo` | `registo`, `pagamento_confirmado`, `pagamento_reaberto`, `correcao`, `anulacao`, `reabertura` |
| `de` / `para` | estado anterior e novo |
| `detalhe` | motivo escrito por quem agiu |
| `por` | autor |
| `em` | data |
| `ordem` | `bigserial` — ordem real de escrita |

`ordem` existe porque `em` não ordena sozinho: o registo e o cálculo do total
acontecem no mesmo instante, e sem uma sequência a interface mostrava o
histórico baralhado.

**Quem escreve:** só o gatilho `trg_sale_evento` (`AFTER INSERT OR UPDATE ON
sales`), que é `SECURITY DEFINER`. Não há política de `INSERT`/`UPDATE`/`DELETE`
— um histórico que o próprio pode editar não é um histórico. A leitura é
`is_manager()` ou o dono da venda.

O gatilho regista também a **correcção de valor**, mas só quando a venda já
tinha valor (`OLD.total_amount <> 0`): uma venda nasce a zero e é o totalizador
dos itens que lhe põe o valor — isso não é uma correcção, é o parto da venda.
Sem essa condição, todas as vendas traziam uma «correcção 0 → valor» que
ninguém fez (foi apanhado pelo teste).

### 3.3 `confirmar_pagamento_venda(uuid)`

- exige `is_manager()` e `can_see_province()` — um gerente de outra província
  recebe `Esta venda é de outra província.`;
- tranca a linha (`FOR UPDATE`) — dois cliques ao mesmo tempo não confirmam
  duas vezes;
- recusa venda anulada e recusa venda já paga com
  `Esta venda já está confirmada como paga.` (erro explícito, não um «ok»
  silencioso que faria crer que se somou outra vez);
- devolve o saldo já actualizado, para a interface não ter de perguntar de novo.

### 3.4 `reabrir_pagamento_venda(uuid, text)`

O contrário, e é operação de risco: se a comissão já foi paga ao colaborador, o
dinheiro saiu duas vezes — a base recusa nesse caso. O motivo viaja por
`inuka.evento_detalhe`, é lido pelo gatilho e fica escrito no histórico.

### 3.5 `saldo_colaborador(uuid)`

Devolve `vendas` (contabilístico / pendente / activo + contagens),
`comissoes` (por pagar / ganho / pago / reservado / disponível / taxa) e
`levantamento` (habilitado / faltam / mínimo). A parte do dinheiro que se
levanta vem de `levantamento_resumo()` — **não há um segundo livro**.

### 3.6 `vendas_gestao(p_estado, p_seller, p_limite)`

Uma chamada devolve os totais do âmbito **e** as linhas já filtradas: a página
não soma nada no cliente. Âmbito: `nacional` para a administração, `provincial`
para o resto. Traz `seller_nome`, `confirmado_por`, número de linhas e número de
alterações.

### 3.7 `saldos_equipa(p_provincia)`

Uma linha por colaborador com os três saldos, a comissão e o disponível — a
lista que a gestão abre primeiro, numa chamada em vez de uma por pessoa.
Quem entra: tem o papel `seller`, tem ficha de vendedor, **ou já vendeu** — o
último critério apanha o gestor que também vende, senão o dinheiro dele
desaparecia da lista por causa do papel.

---

## 4. Interface

### 4.1 `/gerente/vendas` — vendas e saldos

Nova área (o menu «Vendas e saldos» no painel de gestão).

1. **Quatro números**: volume vendido · por confirmar · confirmado · disponível
   para levantar. Cada um diz o que é («desempenho, não dinheiro»,
   «comissões — é este o dinheiro que sai»).
2. **Por colaborador**: nome, telefone, província e os três saldos alinhados;
   em baixo, «pode levantar X», o reservado e a comissão ganha/paga. Clicar
   filtra as vendas a essa pessoa.
3. **Vendas**: filtro `Todas / Pendentes / Pagas` com contagens, procura por
   referência ou colaborador, e por linha o selo de situação, quem confirmou e
   quando, o valor e o botão **Confirmar**.
4. **Detalhe** ao abrir: produtos e histórico (autor, motivo, data), e
   «reabrir o pagamento» com campo de motivo.

### 4.2 Painel do colaborador (`/vendedor`)

Novo bloco **Saldos** com três cartões distintos:

- cinza — *Saldo contabilístico*: «Não é dinheiro para levantar.»
- dourado — *Saldo pendente*: «Dinheiro possível — ainda não entrou.»
- verde — *Saldo activo (recebido)*: «confirmada(s) pela gestão.»

O cartão dourado **Retirar dinheiro** continua a mostrar o disponível e o botão
de levantamento — agora sabendo-se que é a comissão, não o volume vendido.
O cartão «Comissão disponível / já paga», que dizia duas coisas contrárias,
passou a «Comissão já paga · entregue».

### 4.3 Histórico de vendas do colaborador (`/vendedor/vendas`)

Selos em vez de texto técnico (`pending` → «Pendente»), data de confirmação
quando existe, e três totais no topo: volume vendido, por confirmar, confirmado.
O colaborador **vê** o estado e **não o muda** — quem confirma é a gestão.

### 4.4 Formulário de venda

**Situação da venda** passou a ser obrigatória e **sem valor por omissão**: dois
cartões (Pendente / Pago) com uma frase a explicar cada um, e o botão recusa
submeter sem escolha. O select de três valores (`Pago / Pendente / Parcial`) foi
substituído — «Parcial» não tinha significado financeiro em nenhum lado.

---

## 5. Segurança e integridade

| Regra | Onde está garantida |
|---|---|
| Sem confirmação duplicada | `FOR UPDATE` + recusa explícita em `confirmar_pagamento_venda` |
| Sem saldo negativo por alteração indevida | `disponivel = GREATEST(ganho − pago − reservado, 0)` |
| Cálculos consistentes | uma só fórmula, em `levantamento_resumo` e em `saldos_equipa` |
| Registo de todas as alterações financeiras | `sale_events`, escrito só por gatilho |
| Colaborador não altera vendas alheias | `sales_update_manager` (já existia) + gatilho |
| Isolamento provincial | `can_see_province` / `my_province` nas três RPC de leitura e escrita |
| Histórico não se apaga | sem política de `DELETE` em `sale_events` |
| Confirmação não cria venda | a RPC faz `UPDATE`, nunca `INSERT` |

`GRANT EXECUTE` apenas a `authenticated` nas cinco funções novas; `GRANT SELECT`
em `sale_events`.

---

## 6. Testes

`node supabase/tests/functional.test.mjs supabase` → **732 / 732 PASS**
(676 antes desta missão; **56 novas verificações** na secção 35).

Cobrem, entre outros:

- o cenário obrigatório dos 30.000 Kz nos dois estados, incluindo o
  contabilístico que **não** muda ao confirmar;
- confirmar duas vezes → recusa, e o saldo não mexe;
- venda anulada → recusa;
- colaborador a tentar confirmar → `Só a gestão confirma pagamentos.`;
- gerente de outra província → `Esta venda é de outra província.` e
  `Sem permissão para ver este saldo`;
- histórico: `registo` + `pagamento_confirmado` com autor, e o colaborador vê o
  da sua venda mas não o dos outros;
- reabrir: volta a pendente, bloqueia o levantamento, acrescenta ao histórico
  (não apaga) e guarda o motivo;
- `vendas_gestao`: âmbito provincial, filtros, totais que fecham, colaborador
  sem acesso;
- `saldos_equipa`: três saldos por pessoa, totais que somam as linhas, e um
  gerente provincial que não vê a província vizinha.

---

## 7. Como aplicar

```
Supabase → SQL Editor → New query → colar supabase/PATCH_SITUACAO_DA_VENDA.sql → RUN
```

Idempotente — pode correr mais do que uma vez. Depois:

```sql
SELECT public.saldo_colaborador('<uuid do colaborador>');
SELECT public.vendas_gestao(NULL, NULL, 50);
SELECT public.saldos_equipa(NULL);
```

**Importante:** a migração ainda **não está aplicada** na base de produção. Até
estar, `/gerente/vendas` mostra um aviso a dizer exactamente isto e o bloco de
saldos do painel do colaborador não aparece (a página abre normalmente, sem
erro). O cenário dos 30.000 Kz foi provado sobre o esquema real, com as
migrações verdadeiras, em PGlite — mas o teste ponta-a-ponta na aplicação fica
a depender deste passo.

---

## 8. Ficheiros

**Novos**

- `supabase/migrations/0034_situacao_da_venda.sql`
- `supabase/PATCH_SITUACAO_DA_VENDA.sql`
- `apps/web/src/lib/vendas.ts` — formas, normalizadores e selos
- `apps/web/src/app/(app)/gerente/vendas/page.tsx`
- `apps/web/src/app/(app)/gerente/vendas/GestaoVendas.tsx`
- `apps/web/src/components/saldos/TresSaldos.tsx`
- `scripts/foto.mjs`, `scripts/medir.mjs` — fotografia e medição de largura para validar o desenho

**Alterados**

- `apps/web/src/app/(app)/vendedor/page.tsx` — bloco dos três saldos
- `apps/web/src/app/(app)/vendedor/vendas/page.tsx` — selos e totais
- `apps/web/src/components/vendas/FormularioVenda.tsx` — situação obrigatória
- `apps/web/src/app/(app)/gerente/page.tsx` — ligação «Vendas e saldos»
- `supabase/tests/functional.test.mjs` — secção 35
- `supabase/build-setup.mjs` — parte 0034
- `supabase/SETUP_COMPLETO.sql` — 34 partes, 22.540 linhas

**Não alterado, de propósito:** preços, stock, comissões, regras de
levantamento, catálogo, revenda, perfis e o commit `41dd2b1`.
