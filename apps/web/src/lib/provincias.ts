/**
 * Províncias e delegações da INUKA.
 *
 * A lista vive na base de dados (`public.provincias`) e não aqui: a gerência
 * pode acrescentar províncias sem uma nova versão do site. Este módulo só
 * tem os tipos e os rótulos partilhados.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Provincia {
  id: string;
  nome: string;
  codigo: string;
  slug: string;
  delegacao_nome: string | null;
  is_default: boolean;
  is_active: boolean;
}

/** Rótulo do produto/registo que não pertence a nenhuma província. */
export const NACIONAL = "Nacional (todas as províncias)";
export const SEDE = "Armazém-sede";

export const SELECT_PROVINCIA =
  "id, nome, codigo, slug, delegacao_nome, is_default, is_active";

/** Cliente Supabase mínimo — evita acoplar este módulo a um tipo concreto. */
export async function listarProvincias(cliente: SupabaseClient): Promise<Provincia[]> {
  const { data, error } = await cliente
    .from("provincias")
    .select(SELECT_PROVINCIA)
    .order("nome", { ascending: true });

  if (error) return [];
  return (data ?? []) as Provincia[];
}

export function nomeDaProvincia(provincias: Provincia[], id: string | null | undefined): string {
  if (!id) return NACIONAL;
  return provincias.find((p) => p.id === id)?.nome ?? "—";
}

export function codigoDaProvincia(provincias: Provincia[], id: string | null | undefined): string {
  if (!id) return "NAC";
  return provincias.find((p) => p.id === id)?.codigo ?? "—";
}

export function delegacaoDaProvincia(
  provincias: Provincia[],
  id: string | null | undefined
): string {
  if (!id) return "Administração nacional";
  const p = provincias.find((x) => x.id === id);
  return p?.delegacao_nome ?? (p ? `Delegação de ${p.nome}` : "—");
}

/**
 * O PostgREST responde `PGRST205` quando falta uma TABELA e `42703` quando
 * falta uma COLUNA. Detetar os dois evita ecrãs que fingem estar tudo bem.
 */
export function faltaPatchProvincial(mensagem: string | null | undefined): boolean {
  if (!mensagem) return false;
  return /provincia|provincias|PGRST205|42703|schema cache|does not exist/i.test(mensagem);
}

export const AVISO_PATCH_PROVINCIAL =
  "Falta aplicar a migração provincial no Supabase: cole supabase/PATCH_PROVINCIAS.sql no SQL Editor.";

