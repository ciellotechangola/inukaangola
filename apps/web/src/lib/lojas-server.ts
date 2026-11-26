import { createClientServer } from "./supabase-server";
import type { Loja } from "./lojas";

/**
 * A loja de quem está autenticado.
 *
 * `profiles.loja_id` é a fonte; quando está vazio (conta antiga, administração
 * nacional sem loja atribuída) pergunta-se à base qual é a loja principal da
 * província. Nunca inventa: sem loja devolve `null` e o ecrã mostra a versão
 * antiga, por província.
 */
export async function minhaLoja(lojaIdDoPerfil?: string | null): Promise<Loja | null> {
  const supabase = await createClientServer();

  let id = lojaIdDoPerfil ?? null;
  if (!id) {
    const { data } = await supabase.rpc("minha_loja");
    if (typeof data === "string" && data.length > 0) id = data;
  }
  if (!id) return null;

  const { data } = await supabase
    .from("lojas")
    .select("id, codigo, nome, provincia_id, is_default")
    .eq("id", id)
    .maybeSingle();

  return (data as Loja | null) ?? null;
}
