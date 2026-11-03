/**
 * Taxa de comissão.
 *
 * Há uma só taxa da empresa (10% por omissão) e, opcionalmente, uma taxa
 * pessoal por colaborador. A regra vive na base de dados — `taxa_comissao()`
 * devolve o que se aplica e `definir_taxa_comissao()` só aceita gestão. Aqui
 * não se calcula nada: só se lê e formata.
 */

import { createClientBrowser } from "@/lib/supabase-browser";

export interface TaxaComissao {
  /** Taxa da empresa. Nunca nula. */
  global: number;
  /** Taxa pessoal, quando a gestão definiu uma. */
  pessoal: number | null;
  /** A que se aplica a esta pessoa. */
  efetiva: number;
  origem: "empresa" | "pessoal";
}

/** 0.1 -> "10 %". Uma casa decimal só quando é precisa: 0.125 -> "12,5 %". */
export function formatarTaxa(taxa: number): string {
  const pct = taxa * 100;
  const casas = Number.isInteger(Math.round(pct * 10) / 10) ? 0 : 1;
  return `${pct.toFixed(casas).replace(".", ",")} %`;
}

/** Normaliza a resposta da RPC. Vive aqui para o servidor e o browser lerem igual. */
export function normalizarTaxa(bruto: unknown): TaxaComissao {
  const r = (bruto ?? {}) as {
    global?: number | string;
    pessoal?: number | string | null;
    efetiva?: number | string;
    origem?: string;
  };

  return {
    global: Number(r.global ?? 0.1),
    pessoal: r.pessoal === null || r.pessoal === undefined ? null : Number(r.pessoal),
    efetiva: Number(r.efetiva ?? r.global ?? 0.1),
    origem: r.origem === "pessoal" ? "pessoal" : "empresa",
  };
}

export async function taxaComissao(): Promise<TaxaComissao> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("taxa_comissao");
  if (error) throw new Error(error.message);
  return normalizarTaxa(data);
}

export interface ResultadoTaxa {
  rate: number;
  anterior: number;
  recalculadas: number;
}

export async function definirTaxaComissao(
  taxa: number,
  recalcularPendentes = false
): Promise<ResultadoTaxa> {
  if (!Number.isFinite(taxa) || taxa < 0 || taxa > 1) {
    throw new Error("A taxa tem de estar entre 0 % e 100 %.");
  }

  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("definir_taxa_comissao", {
    p_rate: taxa,
    p_recalcular_pendentes: recalcularPendentes,
  });
  if (error) throw new Error(error.message);

  return data as ResultadoTaxa;
}

/**
 * Avisa quando a taxa muda.
 *
 * O colaborador pode estar com a página aberta quando a gestão muda a taxa.
 * Sem isto teria de recarregar para ver o número certo — e um número de
 * comissão desactualizado é pior do que nenhum.
 *
 * Devolve a função que cancela a subscrição.
 */
export function assinarTaxa(aoMudar: () => void): () => void {
  const supabase = createClientBrowser();

  const canal = supabase
    .channel("taxa-comissao")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "platform_settings" },
      (payload) => {
        const linha = payload.new as { key?: string } | null;
        // Só a chave da taxa interessa; outras definições não mexem no número.
        if (!linha || linha.key === "commission_rate") aoMudar();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(canal);
  };
}
