import { createClientServer } from "./supabase-server";
import type {
  Central,
  LinhaProduto,
  PedidoProduto,
  SolicitacaoColaborador,
  SolicitacaoRevendedor,
} from "./central-pedidos";

/**
 * VAI BUSCAR OS QUATRO TIPOS DE PEDIDO — do lado do servidor, com a sessão do
 * gerente, para o RLS decidir o que ele pode ver.
 *
 * Quem vê o quê **não** é decidido aqui: as políticas já o fazem
 * (`can_see_province` nas candidaturas de revendedor e nos pedidos de grosso;
 * `is_manager` nas candidaturas de colaborador; administração nacional vê
 * tudo). Repetir o filtro em código só criava o risco de esconder linhas que a
 * base já tinha deixado passar — e «não perder solicitações» é uma regra.
 *
 * Cada bloco falha em separado: se uma tabela não existir nesta base, a
 * categoria fica vazia com um aviso, em vez de derrubar a central inteira.
 */

const LIMITE = 60;

type Linha = Record<string, unknown>;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** `profiles.id` é o mesmo id de `auth.users` — junta-se por id, nunca por embed. */
async function nomesDe(
  supabase: Awaited<ReturnType<typeof createClientServer>>,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const lista = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const nomes = new Map<string, string>();
  if (lista.length === 0) return nomes;

  const { data } = await supabase.from("profiles").select("id, full_name").in("id", lista);
  for (const p of (data ?? []) as Linha[]) {
    nomes.set(String(p.id), String(p.full_name ?? ""));
  }
  return nomes;
}

function embed(valor: unknown): Linha | null {
  if (Array.isArray(valor)) return (valor[0] as Linha) ?? null;
  return (valor as Linha) ?? null;
}

export async function carregarCentral(): Promise<Central> {
  const supabase = await createClientServer();
  const avisos: string[] = [];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const eu = user?.id ?? null;

  // ---------------------------------------------------------- 1. PRODUTOS
  const produtos: PedidoProduto[] = [];

  const encomendasRes = await supabase
    .from("orders")
    .select(
      "id, reference, status, total_amount, created_at, contact_phone, customer_id, notes, itens:order_items(quantity, unit_price, product:products(name))"
    )
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  const grossoRes = await supabase
    .from("revendedor_pedidos")
    .select(
      "id, numero, status, total_unidades, valor_estimado, created_at, mensagem, resposta, respondido_at, respondido_por, revendedor:revendedores(nome, telefone), provincia:provincias(nome), itens:revendedor_pedido_itens(nome_produto, quantidade, preco_unitario)"
    )
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  if (encomendasRes.error) avisos.push(`Encomendas: ${encomendasRes.error.message}`);
  if (grossoRes.error) avisos.push(`Pedidos de grosso: ${grossoRes.error.message}`);

  const encomendas = (encomendasRes.data ?? []) as unknown as Linha[];
  const grosso = (grossoRes.data ?? []) as unknown as Linha[];

  // Nomes dos clientes das encomendas (customer_id → auth.users → profiles).
  const nomesClientes = await nomesDe(
    supabase,
    encomendas.map((o) => texto(o.customer_id))
  );

  // Histórico das encomendas: uma consulta para todas, não uma por pedido.
  const idsEncomendas = encomendas.map((o) => String(o.id));
  const historicoPorEncomenda = new Map<string, PedidoProduto["historico"]>();
  if (idsEncomendas.length > 0) {
    const { data: hist } = await supabase
      .from("order_status_history")
      .select("order_id, status, changed_by, notes, created_at")
      .in("order_id", idsEncomendas)
      .order("created_at", { ascending: true });

    const linhas = (hist ?? []) as unknown as Linha[];
    const nomesAutores = await nomesDe(
      supabase,
      linhas.map((h) => texto(h.changed_by))
    );

    for (const h of linhas) {
      const id = String(h.order_id);
      const lista = historicoPorEncomenda.get(id) ?? [];
      lista.push({
        em: String(h.created_at),
        estado: String(h.status),
        por: nomesAutores.get(String(h.changed_by)) ?? null,
        nota: texto(h.notes),
      });
      historicoPorEncomenda.set(id, lista);
    }
  }

  for (const o of encomendas) {
    const itens = ((o.itens ?? []) as Linha[]).map<LinhaProduto>((i) => ({
      nome: texto(embed(i.product)?.name) ?? "Produto",
      quantidade: numero(i.quantity),
      preco: numero(i.unit_price),
    }));
    const id = String(o.id);
    produtos.push({
      origem: "site",
      id,
      referencia: String(o.reference ?? ""),
      estado: String(o.status ?? "pending"),
      valor: numero(o.total_amount),
      unidades: itens.reduce((s, i) => s + i.quantidade, 0) || null,
      criadoEm: String(o.created_at),
      cliente: nomesClientes.get(String(o.customer_id)) ?? "Cliente",
      telefone: texto(o.contact_phone),
      provincia: null,
      mensagem: texto(o.notes),
      resposta: null,
      itens,
      historico: historicoPorEncomenda.get(id) ?? [],
    });
  }

  // Pedidos de grosso: quem respondeu (respondido_por → profiles).
  const nomesGrosso = await nomesDe(
    supabase,
    grosso.map((p) => texto(p.respondido_por))
  );

  for (const p of grosso) {
    const itens = ((p.itens ?? []) as Linha[]).map<LinhaProduto>((i) => ({
      nome: texto(i.nome_produto) ?? "Produto",
      quantidade: numero(i.quantidade),
      preco: numero(i.preco_unitario),
    }));
    const rev = embed(p.revendedor);
    const historico: PedidoProduto["historico"] = [
      { em: String(p.created_at), estado: "novo", por: null, nota: texto(p.mensagem) },
    ];
    if (p.respondido_at) {
      historico.push({
        em: String(p.respondido_at),
        estado: String(p.status),
        por: nomesGrosso.get(String(p.respondido_por)) ?? null,
        nota: texto(p.resposta),
      });
    }

    produtos.push({
      origem: "grosso",
      id: String(p.id),
      referencia: String(p.numero ?? ""),
      estado: String(p.status ?? "novo"),
      valor: numero(p.valor_estimado),
      unidades: numero(p.total_unidades) || null,
      criadoEm: String(p.created_at),
      cliente: texto(rev?.nome) ?? "Revendedor",
      telefone: texto(rev?.telefone),
      provincia: texto(embed(p.provincia)?.nome),
      mensagem: texto(p.mensagem),
      resposta: texto(p.resposta),
      itens,
      historico,
    });
  }

  produtos.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));

  // --------------------------------------------------------- 2. MENSAGENS
  // «Pedido de mensagem» = conversa em que eu estou e cuja última mensagem é
  // de outra pessoa, depois da última vez que a li. É o que está à minha
  // espera — uma conversa que eu respondi por último não é um pedido.
  const mensagens: Central["mensagens"] = [];

  if (eu) {
    const { data: minhas } = await supabase
      .from("conversation_members")
      .select("conversation_id, last_read_at")
      .eq("user_id", eu);

    const participacoes = (minhas ?? []) as unknown as Linha[];
    const lidoEm = new Map<string, string | null>();
    for (const m of participacoes) {
      lidoEm.set(String(m.conversation_id), texto(m.last_read_at));
    }

    const idsConversas = [...lidoEm.keys()];
    if (idsConversas.length > 0) {
      const { data: conversasRaw, error: erroConversas } = await supabase
        .from("conversations")
        .select("id, type, title, members:conversation_members(user_id)")
        .in("id", idsConversas)
        .limit(80);

      if (erroConversas) avisos.push(`Conversas: ${erroConversas.message}`);

      const conversas = (conversasRaw ?? []) as unknown as Linha[];

      // As últimas mensagens de todas as conversas de uma vez: ordenadas do
      // mais recente para o mais antigo, a primeira de cada id é a última.
      const { data: msgsRaw } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, created_at")
        .in("conversation_id", idsConversas)
        .order("created_at", { ascending: false })
        .limit(400);

      const msgs = (msgsRaw ?? []) as unknown as Linha[];

      const ultimaPorConversa = new Map<string, Linha>();
      for (const m of msgs) {
        const id = String(m.conversation_id);
        if (!ultimaPorConversa.has(id)) ultimaPorConversa.set(id, m);
      }

      // Autores das últimas mensagens e nomes dos membros.
      const idsAutores = [...new Set(msgs.map((m) => String(m.sender_id)))];
      const idsMembros = [
        ...new Set(conversas.flatMap((c) => ((c.members ?? []) as Linha[]).map((m) => String(m.user_id)))),
      ];
      const nomes = await nomesDe(supabase, [...idsAutores, ...idsMembros]);

      const { data: perfisPapeis } = await supabase
        .from("profiles")
        .select("id, role")
        .in("id", idsAutores.length > 0 ? idsAutores : ["00000000-0000-0000-0000-000000000000"]);
      const papelPorId = new Map<string, string>();
      for (const p of (perfisPapeis ?? []) as Linha[]) {
        papelPorId.set(String(p.id), String(p.role));
      }

      for (const c of conversas) {
        const id = String(c.id);
        const ultima = ultimaPorConversa.get(id);
        if (!ultima) continue;
        if (String(ultima.sender_id) === eu) continue; // já respondi

        const desde = lidoEm.get(id);
        const depoisDeLer =
          !desde || new Date(String(ultima.created_at)) > new Date(desde);
        if (!depoisDeLer) continue; // já li e não respondi: não é pedido novo

        const naoLidas = msgs.filter(
          (m) =>
            String(m.conversation_id) === id &&
            String(m.sender_id) !== eu &&
            (!desde || new Date(String(m.created_at)) > new Date(desde))
        ).length;

        const outros = ((c.members ?? []) as Linha[])
          .map((m) => String(m.user_id))
          .filter((uid) => uid !== eu)
          .map((uid) => nomes.get(uid) ?? "")
          .filter(Boolean);

        mensagens.push({
          id,
          titulo: texto(c.title) ?? (outros.join(", ") || "Conversa"),
          de: nomes.get(String(ultima.sender_id)) ?? "—",
          papel: papelPorId.get(String(ultima.sender_id)) ?? null,
          ultima: String(ultima.content ?? ""),
          quando: String(ultima.created_at),
          naoLidas,
        });
      }

      mensagens.sort((a, b) => b.quando.localeCompare(a.quando));
    }
  }

  // -------------------------------------------- 3. CANDIDATURAS REVENDEDOR
  const revendedores: SolicitacaoRevendedor[] = [];

  const revRes = await supabase
    .from("revendedor_candidaturas")
    .select(
      "id, tipo, nome, telefone, email, nif, mensagem, status, resposta, created_at, handled_at, handled_by, provincia:provincias(nome)"
    )
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  if (revRes.error) avisos.push(`Candidaturas de revendedor: ${revRes.error.message}`);

  const candidaturasRev = (revRes.data ?? []) as unknown as Linha[];
  const nomesGestoresRev = await nomesDe(
    supabase,
    candidaturasRev.map((c) => texto(c.handled_by))
  );

  for (const c of candidaturasRev) {
    revendedores.push({
      id: String(c.id),
      tipo: c.tipo === "empresa" ? "empresa" : "pessoa",
      nome: String(c.nome ?? ""),
      telefone: String(c.telefone ?? ""),
      email: texto(c.email),
      nif: texto(c.nif),
      provincia: texto(embed(c.provincia)?.nome),
      mensagem: texto(c.mensagem),
      estado: String(c.status ?? "novo"),
      resposta: texto(c.resposta),
      criadoEm: String(c.created_at),
      tratadoEm: texto(c.handled_at),
      tratadoPor: nomesGestoresRev.get(String(c.handled_by)) ?? null,
    });
  }

  // ------------------------------------------- 4. CANDIDATURAS COLABORADOR
  const colaboradores: SolicitacaoColaborador[] = [];

  const colabRes = await supabase
    .from("reseller_applications")
    .select(
      "id, full_name, phone, message, source, status, created_at, handled_at, handled_by, provincia:provincias(nome)"
    )
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  if (colabRes.error) avisos.push(`Candidaturas de colaborador: ${colabRes.error.message}`);

  const candidaturasColab = (colabRes.data ?? []) as unknown as Linha[];
  const nomesGestoresColab = await nomesDe(
    supabase,
    candidaturasColab.map((c) => texto(c.handled_by))
  );

  for (const c of candidaturasColab) {
    colaboradores.push({
      id: String(c.id),
      nome: String(c.full_name ?? ""),
      telefone: String(c.phone ?? ""),
      provincia: texto(embed(c.provincia)?.nome),
      mensagem: texto(c.message),
      origem: texto(c.source),
      estado: String(c.status ?? "novo"),
      criadoEm: String(c.created_at),
      tratadoEm: texto(c.handled_at),
      tratadoPor: nomesGestoresColab.get(String(c.handled_by)) ?? null,
    });
  }

  return { produtos, mensagens, revendedores, colaboradores, avisos };
}
