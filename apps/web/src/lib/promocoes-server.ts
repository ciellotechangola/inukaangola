import { createClientServer } from "@/lib/supabase-server";

/**
 * Preços de campanha para a montra.
 *
 * A regra do preço vive na base de dados (`preco_efetivo`). Aqui só se pergunta
 * «quanto custa isto para a província de quem está a ver» — em bloco, porque a
 * página inicial mostra 24 cartões de uma vez.
 *
 * Se a migração das promoções ainda não estiver aplicada, a RPC falha e o mapa
 * volta vazio: a loja mostra o preço do produto, como sempre mostrou. Uma
 * campanha em falta não pode deixar a montra em branco.
 */

export interface PrecoCampanha {
  /** Preço do produto sem campanha (`promotional_price ?? official_price`). */
  base: number;
  /** Preço que a encomenda vai cobrar nesta província. */
  final: number;
  /** Campanha que se aplicou; `null` quando o preço é o do produto. */
  promocaoId: string | null;
  promocaoNome: string | null;
}

/**
 * Província de quem está autenticado, a partir do perfil.
 *
 * Devolve `null` sem sessão ou sem província — e nesse caso só valem as
 * campanhas nacionais, que é o que `promocoes_vigentes` faz com `NULL`.
 * A província nunca vem da URL: senão qualquer visitante se declarava do Uíge.
 */
export async function provinciaDoVisitante(): Promise<string | null> {
  try {
    const supabase = await createClientServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: perfil } = await supabase
      .from("profiles")
      .select("provincia_id")
      .eq("id", user.id)
      .maybeSingle();

    return (perfil as { provincia_id: string | null } | null)?.provincia_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Preço de cada produto para a província indicada.
 *
 * Devolve um mapa por `product_id`. Produtos sem campanha também vêm, com
 * `promocaoId` a `null` — assim a loja sabe sempre o preço final.
 */
export async function precosDeCampanha(
  ids: string[],
  provinciaId: string | null
): Promise<Map<string, PrecoCampanha>> {
  const mapa = new Map<string, PrecoCampanha>();
  if (ids.length === 0) return mapa;

  try {
    const supabase = await createClientServer();
    const { data, error } = await supabase.rpc("precos_efetivos", {
      p_produtos: ids,
      p_provincia: provinciaId,
    });

    if (error || !Array.isArray(data)) return mapa;

    for (const linha of data as Record<string, unknown>[]) {
      const id = String(linha.product_id ?? "");
      if (!id) continue;
      mapa.set(id, {
        base: Number(linha.preco_base ?? 0),
        final: Number(linha.preco_final ?? linha.preco_base ?? 0),
        promocaoId: (linha.promocao_id as string | null) ?? null,
        promocaoNome: (linha.promocao_nome as string | null) ?? null,
      });
    }
  } catch {
    return new Map();
  }

  return mapa;
}

/** Preço de um produto só. Atalho para a página do produto. */
export async function precoDeCampanha(
  id: string,
  provinciaId: string | null
): Promise<PrecoCampanha | null> {
  const mapa = await precosDeCampanha([id], provinciaId);
  return mapa.get(id) ?? null;
}
