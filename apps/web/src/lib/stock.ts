import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Unidades disponíveis por produto, para a loja pública.
 *
 * Porque não se lê `inventory` directamente? Porque a tabela só é legível por
 * contas autenticadas — é a política certa, o stock é informação da empresa —
 * e a loja precisa de mostrar «Esgotado» a quem nem sessão tem. A função
 * `stock_produtos` (migração 0012) é a porta estreita: devolve apenas o número
 * de unidades, em bloco.
 *
 * Devolve um mapa `id → unidades`:
 *  - número  → há inventário registado; é o valor a mostrar;
 *  - ausente → produto sem controlo de stock (`null` para o chamador).
 *
 * Falha em silêncio: sem stock conhecido o cartão mostra «Disponibilidade
 * confirmada ao finalizar», que é a mesma frase de sempre. Uma página de
 * catálogo não deve rebentar por causa de uma leitura acessória.
 */
export async function stockDosProdutos(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (ids.length === 0) return mapa;

  const { data, error } = await supabase.rpc("stock_produtos", { p_ids: ids });
  if (error || !data) return mapa;

  for (const linha of data as { product_id: string; disponivel: number | null }[]) {
    if (linha.disponivel !== null) mapa.set(linha.product_id, linha.disponivel);
  }
  return mapa;
}
