# Central de pedidos da gestão

`/gerente/pedidos` — a porta única de atendimento. Antes, um pedido podia estar em
quatro ecrãs diferentes e quem atendia tinha de saber qual abrir.

## As quatro categorias

| Categoria | Origem | Estados |
|---|---|---|
| **Pedidos de produtos** | `orders` (cliente final) + `revendedor_pedidos` (grosso) | os de cada tabela |
| **Pedidos de mensagens** | conversas em que o gestor figura, com a última mensagem por responder | — |
| **Adesão de revendedores** | `revendedor_candidaturas` | novo · em_contacto · aprovado · recusado |
| **Solicitações de colaboradores** | `reseller_applications` | novo · em_contacto · aprovado · recusado |

Cada cartão mostra **pendentes** e **total**. Pendente é: encomenda `pending`, pedido de
grosso `novo`/`em_analise`, candidatura `novo`, ou conversa à espera de resposta.

## O que se faz em cada pedido

- **Detalhes e dados do solicitante** — nome, telefone (link directo), província, e-mail,
  NIF, mensagem e as linhas do pedido.
- **Responder** — grava a resposta onde a base a guarda:
  - grosso → `responder_pedido_revendedor(p_pedido, p_status, p_resposta)` (grava
    `resposta`, `respondido_por`, `respondido_at`);
  - encomenda de loja → `update_order_status(p_order_id, p_status, p_notes)` (a nota fica
    no `order_status_history`, com autor e data);
  - revendedor → `decidir_candidatura_revendedor(p_id, p_estado, p_resposta)`;
  - mensagem → mensageiro (`enviarMensagem`), na própria conversa;
  - colaborador → contacto telefónico + estado (a tabela não tem campo de resposta; fica
    registado **quem** tratou e **quando**).
- **Histórico** — data, hora, estado e responsável, por baixo dos dados.

## Quem vê o quê

Não há filtro em código: as políticas da base decidem. `can_see_province` nas
candidaturas de revendedor e nos pedidos de grosso; `is_manager` nas candidaturas de
colaborador; a administração nacional (`is_national_admin`) vê todas as províncias.
Repetir o filtro na página só arriscava esconder linhas que a base já tinha autorizado.

## Nada foi desligado

`/gerente/encomendas`, `/gerente/candidaturas` e `/gerente/revendedores` continuam a
existir e a funcionar. A central lê as mesmas tabelas — não copia, não duplica e não cria
registos.

# Ordem dos produtos nos catálogos

`lib/ordenacao-catalogo.ts` — **perfumes → cremes → restantes**, nos dois catálogos
(`/catalogo` e `/revenda/catalogo`).

A base não tem uma categoria «Cremes»: os cremes estão dentro de «Perfumaria Feminina»,
«Perfumaria Masculina» e «Cuidado da Pele». Por isso a classificação olha primeiro para o
**nome do produto** («Creme …» é creme onde quer que esteja; «Perfume …» é perfume) e só
depois para a categoria. A comparação é por palavra e sem acentos — «Envelope Perfumado»
não sobe para o topo por causa do adjectivo.

Dentro de cada grupo a ordem existente mantém-se (no grosso, o último submetido primeiro).
A prioridade só se aplica à ordem de abertura («Relevância»); «Preço ↑», «Preço ↓» e
«Novidades» continuam a ser escolhas explícitas do visitante.
