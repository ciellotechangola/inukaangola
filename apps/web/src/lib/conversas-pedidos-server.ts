import { createClientServer } from "./supabase-server";

/**
 * «ESTE PEDIDO TEM MENSAGENS POR LER?» — respondido de uma vez para a lista.
 *
 * A página de pedidos é um Server Component: não tem o mensageiro montado nem
 * o realtime ligado. Para pôr um contador ao lado de cada pedido só há dois
 * caminhos — perguntar conversa a conversa (N+1 consultas numa lista de cem) ou
 * trazer tudo numa consulta e contar aqui. É o segundo.
 *
 * O RLS faz o resto: as conversas que vêm são só aquelas em que a pessoa entra.
 */

export type ConversaDePedido = {
  conversaId: string;
  /** Mensagens de outras pessoas depois da última vez que abri esta conversa. */
  naoLidas: number;
};

type Cliente = Awaited<ReturnType<typeof createClientServer>>;

const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Mapa `id do pedido → conversa e não lidas`.
 *
 * `tipo` escolhe a coluna: um pedido de grosso e uma encomenda de loja vivem
 * em tabelas diferentes e não podem ser confundidos — um `uuid` de um não
 * existe no outro, mas a coluna errada devolvia sempre vazio sem dar erro.
 */
export async function conversasDosPedidos(
  supabase: Cliente,
  userId: string,
  tipo: "grosso" | "encomenda"
): Promise<Map<string, ConversaDePedido>> {
  const coluna = tipo === "grosso" ? "pedido_grosso_id" : "order_id";
  const saida = new Map<string, ConversaDePedido>();

  const { data: conversas } = await supabase
    .from("conversations")
    .select(`id, pedido:${coluna}, members:conversation_members(user_id, last_read_at)`)
    .not(coluna, "is", null);

  const linhas = (conversas ?? []) as unknown as {
    id: string;
    pedido: string | null;
    members: { user_id: string; last_read_at: string | null }[];
  }[];
  if (linhas.length === 0) return saida;

  // O meu `last_read_at` em cada conversa. Sem linha minha não sou membro:
  // a conversa não é minha e não deve ter contador nenhum.
  const meuLido = new Map<string, string | null>();
  for (const c of linhas) {
    const meu = c.members.find((m) => m.user_id === userId);
    if (meu) meuLido.set(c.id, meu.last_read_at);
  }

  const minhas = linhas.filter((c) => c.pedido && meuLido.has(c.id));
  if (minhas.length === 0) return saida;

  // Uma consulta para todas: só mensagens de outras pessoas, e só depois da
  // leitura mais antiga entre as conversas (o resto não interessa).
  const desde = [...meuLido.values()].reduce<string>(
    (mais, valor) => (!valor ? EPOCH : valor < mais ? valor : mais),
    new Date().toISOString()
  );

  const { data: mensagens } = await supabase
    .from("messages")
    .select("conversation_id, created_at")
    .in(
      "conversation_id",
      minhas.map((c) => c.id)
    )
    .neq("sender_id", userId)
    .gt("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(2000);

  const porConversa = new Map<string, string[]>();
  for (const m of (mensagens ?? []) as { conversation_id: string; created_at: string }[]) {
    const lista = porConversa.get(m.conversation_id) ?? [];
    lista.push(m.created_at);
    porConversa.set(m.conversation_id, lista);
  }

  for (const c of minhas) {
    const lido = meuLido.get(c.id) ?? null;
    const datas = porConversa.get(c.id) ?? [];
    const naoLidas = lido ? datas.filter((d) => d > lido).length : datas.length;
    saida.set(c.pedido as string, { conversaId: c.id, naoLidas });
  }

  return saida;
}
