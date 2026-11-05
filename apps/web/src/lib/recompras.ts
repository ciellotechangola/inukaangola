import { supabaseAdmin } from "@/lib/supabase-server";
import type { Product } from "@/types";

export type ProdutoComEstoque = Product & {
  inventory?: { quantity: number; reserved_quantity: number } | null;
};

interface ItemComprado {
  product_id: string | null;
}

interface CompraRecente {
  created_at: string | null;
  items: ItemComprado[] | null;
}

/**
 * Últimos produtos que este cliente comprou, do mais recente para o mais
 * antigo — junta as encomendas do site (`orders`) às vendas que um colaborador
 * registou em nome dele (`sales`).
 *
 * Lê-se no servidor com a chave de serviço porque o RLS esconde `sales` e
 * `sale_items` ao cliente (`sales_select` só deixa o vendedor e a gestão). O
 * filtro é sempre `customer_id = userId`, e o `userId` vem da sessão — nunca de
 * um parâmetro do pedido.
 *
 * Devolve `[]` sem sessão ou sem compras; nunca lança.
 */
export async function produtosComprados(
  userId: string | null | undefined,
  limite = 6
): Promise<ProdutoComEstoque[]> {
  if (!userId) return [];

  try {
    const [encomendas, vendas] = await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("id, created_at, items:order_items(product_id)")
        .eq("customer_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("sales")
        .select("id, created_at, items:sale_items(product_id)")
        .eq("customer_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const eventos: CompraRecente[] = [
      ...((encomendas.data ?? []) as unknown as CompraRecente[]),
      ...((vendas.data ?? []) as unknown as CompraRecente[]),
    ];

    eventos.sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    );

    // A ordem é a da compra: o que veio por último aparece primeiro.
    const ordem: string[] = [];
    for (const evento of eventos) {
      for (const item of evento.items ?? []) {
        const id = item?.product_id;
        if (id && !ordem.includes(id)) ordem.push(id);
      }
      if (ordem.length >= limite) break;
    }
    if (ordem.length === 0) return [];

    const ids = ordem.slice(0, limite);
    const { data } = await supabaseAdmin
      .from("products")
      .select(
        "*, category:categories(*), images:product_images(*), inventory(quantity, reserved_quantity)"
      )
      .in("id", ids)
      .eq("is_active", true);

    // Produto desactivado ou apagado desde a compra simplesmente não aparece.
    const porId = new Map(
      ((data ?? []) as ProdutoComEstoque[]).map((p) => [p.id, p])
    );
    return ids
      .map((id) => porId.get(id))
      .filter((p): p is ProdutoComEstoque => Boolean(p));
  } catch {
    return [];
  }
}
