import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import {
  CHAVE_ENTREGA,
  ENTREGA_PADRAO,
  normalizarEntrega,
  provinciaGratis,
  taxaDeEntrega,
  type DefinicoesEntrega,
  type EstadoEntrega,
} from "@/lib/entrega";

/**
 * Leitura da regra de entrega, do lado do servidor.
 *
 * Usa a chave de serviço porque a regra é lida em páginas públicas (produto,
 * carrinho) e `platform_settings_read` só abre a tabela a sessões com conta.
 * Nunca é importado por um componente de browser.
 */
export async function lerEntrega(): Promise<DefinicoesEntrega> {
  try {
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", CHAVE_ENTREGA)
      .maybeSingle();

    if (!data) return ENTREGA_PADRAO;
    return normalizarEntrega((data as { value: unknown }).value);
  } catch {
    return ENTREGA_PADRAO;
  }
}

/** Nomes das províncias isentas, pela ordem em que estão gravadas. */
export async function nomesProvinciasGratis(defs: DefinicoesEntrega): Promise<string[]> {
  if (defs.gratis.length === 0) return [];
  try {
    const { data } = await supabaseAdmin
      .from("provincias")
      .select("slug, nome")
      .in("slug", defs.gratis);

    const linhas = (data ?? []) as { slug: string; nome: string }[];
    // Respeita a ordem de `defs.gratis`, não a que a base devolver.
    return defs.gratis
      .map((s) => linhas.find((l) => l.slug === s)?.nome)
      .filter((n): n is string => Boolean(n));
  } catch {
    return [];
  }
}

export type { EstadoEntrega };

/**
 * Província de quem está autenticado, a partir do perfil.
 *
 * Devolve `null` sem sessão. Nunca recebe a província de fora: é o perfil que
 * manda, senão qualquer cliente se declarava do Uíge para não pagar entrega.
 */
async function provinciaDoCliente(): Promise<{ slug: string; nome: string } | null> {
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

    const provinciaId = (perfil as { provincia_id: string | null } | null)?.provincia_id;
    if (!provinciaId) return null;

    const { data: prov } = await supabaseAdmin
      .from("provincias")
      .select("slug, nome")
      .eq("id", provinciaId)
      .maybeSingle();

    return (prov as { slug: string; nome: string } | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Estado da entrega para quem está a ver a página.
 *
 * As leituras que não dependem umas das outras correm em paralelo: esta rota
 * é chamada pelo carrinho a cada visita, e em série cada salto ao Supabase
 * somava meio segundo até o cliente ver a taxa.
 */
export async function estadoEntrega(): Promise<EstadoEntrega> {
  const [defs, provincia] = await Promise.all([lerEntrega(), provinciaDoCliente()]);
  const gratisNomes = await nomesProvinciasGratis(defs);

  const taxa = taxaDeEntrega(provincia?.slug ?? null, defs);

  return {
    provincia,
    taxa,
    gratis: provinciaGratis(provincia?.slug ?? null, defs),
    // Sem província conhecida não se promete grátis nem se inventa preço.
    porDefinir: taxa === null,
    taxaPadrao: defs.taxaPadrao,
    gratisNomes,
    nota: defs.nota,
  };
}
