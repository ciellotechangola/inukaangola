/**
 * Tradução dos erros do PostgREST que, na prática, querem dizer «falta aplicar
 * uma migração».
 *
 * Sem isto o utilizador via «Could not find the function
 * public.registar_venda_loja(...)» e não tinha como saber que a correcção era
 * colar um ficheiro SQL no Supabase. A base de dados continua a ser a
 * autoridade: aqui só se explica o que aconteceu.
 */

/** Códigos e mensagens que o PostgREST usa quando falta uma função ou tabela. */
const FUNCAO_EM_FALTA = /PGRST202|Could not find the function/i;
const TABELA_EM_FALTA = /PGRST205|Could not find the table|relation .* does not exist/i;

function textoDoErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  const comMensagem = e as { message?: string } | null;
  return comMensagem?.message ?? "";
}

/**
 * Devolve uma mensagem legível. `patch` é o ficheiro SQL que resolve o caso
 * (por exemplo `supabase/PATCH_PERFIS_LOJA.sql`).
 */
export function mensagemDeErro(
  e: unknown,
  patch = "supabase/PATCH_PERFIS_LOJA.sql",
  alternativa = "Não foi possível concluir a operação."
): string {
  const mensagem = textoDoErro(e);

  if (FUNCAO_EM_FALTA.test(mensagem) || TABELA_EM_FALTA.test(mensagem)) {
    return (
      "Esta operação precisa de uma actualização da base de dados que ainda não foi aplicada. " +
      `Cole o ficheiro ${patch} no SQL Editor do Supabase e volte a tentar.`
    );
  }

  return mensagem || alternativa;
}
