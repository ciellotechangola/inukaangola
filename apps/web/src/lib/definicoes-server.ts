import { supabaseAdmin } from "@/lib/supabase-server";
import {
  CHAVE_DEFINICOES,
  DEFINICOES_PADRAO,
  normalizarDefinicoes,
  type DefinicoesLoja,
} from "@/lib/definicoes";

/**
 * Leitura das definições da loja, do lado do servidor.
 *
 * Usa a chave de serviço de propósito: a política `platform_settings_read` só
 * abre a tabela a sessões autenticadas, e a área de download é pública — um
 * visitante sem conta tem de ver os links que o gestor configurou.
 *
 * Só se expõem os campos de `DefinicoesLoja`; nada de `service_role` chega ao
 * browser por aqui, porque isto nunca é importado por um componente cliente.
 */
export async function lerDefinicoes(): Promise<DefinicoesLoja> {
  try {
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select("value, updated_at")
      .eq("key", CHAVE_DEFINICOES)
      .maybeSingle();

    if (!data) return DEFINICOES_PADRAO;

    const linha = data as { value: unknown; updated_at: string | null };
    return normalizarDefinicoes({
      ...(typeof linha.value === "object" && linha.value ? linha.value : {}),
      actualizadoEm: linha.updated_at ?? null,
    });
  } catch {
    // Base indisponível ou sem a tabela: a loja não pode ficar sem contactos.
    return DEFINICOES_PADRAO;
  }
}
