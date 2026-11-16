/**
 * Despesas e investimento da empresa.
 *
 * Uma despesa pode ser paga de duas maneiras: pela tesouraria (dinheiro da
 * empresa) ou com o saldo de comissões de um colaborador. Nos dois casos o
 * registo é o mesmo — o que muda é quem paga.
 *
 * Quanto já está coberto **não** vem guardado: `despesas_equipa()` devolve
 * `coberto` e `restante` já calculados a partir dos levantamentos pagos. Aqui
 * só se normaliza, para o ecrã nunca mostrar `undefined`.
 */

export const TIPOS_DESPESA = ["despesa", "investimento"] as const;
export type TipoDespesa = (typeof TIPOS_DESPESA)[number];

export const ROTULO_TIPO: Record<TipoDespesa, string> = {
  despesa: "Despesa",
  investimento: "Investimento",
};

export const DESCRICAO_TIPO: Record<TipoDespesa, string> = {
  despesa: "Custo corrente: rendas, salários, transporte, marketing.",
  investimento: "Compra que fica para a empresa: stock, equipamento, obra.",
};

/** Selo do tipo — dourado para investimento, cinza para despesa corrente. */
export const COR_TIPO: Record<TipoDespesa, string> = {
  despesa: "border-[#333333] bg-[#161616] text-[#A3A3A3]",
  investimento: "border-[#4A3F1F] bg-[#241E0E] text-[#C9A962]",
};

export const CATEGORIAS = [
  "investimento_produto",
  "equipamento",
  "marketing",
  "logistica",
  "instalacoes",
  "salarios",
  "formacao",
  "tecnologia",
  "outros",
] as const;

export type CategoriaDespesa = (typeof CATEGORIAS)[number];

export const ROTULO_CATEGORIA: Record<CategoriaDespesa, string> = {
  investimento_produto: "Compra de produto / stock",
  equipamento: "Equipamento",
  marketing: "Marketing e publicidade",
  logistica: "Logística e transporte",
  instalacoes: "Instalações e rendas",
  salarios: "Salários e ajudas de custo",
  formacao: "Formação",
  tecnologia: "Tecnologia e software",
  outros: "Outros",
};

export const ESTADOS_DESPESA = ["pendente", "paga", "anulada"] as const;
export type EstadoDespesa = (typeof ESTADOS_DESPESA)[number];

export const ROTULO_ESTADO_DESPESA: Record<EstadoDespesa, string> = {
  pendente: "Por pagar",
  paga: "Paga",
  anulada: "Anulada",
};

export const COR_ESTADO_DESPESA: Record<EstadoDespesa, string> = {
  pendente: "border-[#4A3F1F] bg-[#241E0E] text-[#C9A962]",
  paga: "border-[#1F4D2E] bg-[#0E2417] text-[#22C55E]",
  anulada: "border-[#333333] bg-[#161616] text-[#6F6F6F]",
};

function num(valor: unknown, omissao = 0): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : omissao;
}

function texto(valor: unknown, omissao = ""): string {
  return typeof valor === "string" && valor.trim() !== "" ? valor : omissao;
}

function tipoDe(bruto: unknown): TipoDespesa {
  return bruto === "investimento" ? "investimento" : "despesa";
}

function estadoDe(bruto: unknown): EstadoDespesa {
  return bruto === "paga" || bruto === "anulada" ? bruto : "pendente";
}

function categoriaDe(bruto: unknown): CategoriaDespesa {
  return (CATEGORIAS as readonly string[]).includes(String(bruto))
    ? (bruto as CategoriaDespesa)
    : "outros";
}

/** Uma despesa, como a gestão a vê. */
export interface Despesa {
  id: string;
  referencia: string | null;
  tipo: TipoDespesa;
  categoria: CategoriaDespesa;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  /** Já pago por comissões de colaboradores (levantamentos pagos). */
  coberto: number;
  /** `valor − coberto`, nunca negativo. */
  restante: number;
  estado: EstadoDespesa;
  notas: string | null;
  comprovativo: string | null;
  provincia: string | null;
  provincia_id: string | null;
  criada_em: string;
  pago_em: string | null;
  /** Nomes de quem pagou com a comissão — pode ser mais do que um. */
  financiadores: string[];
}

/** A mesma despesa, mas só o que o colaborador precisa para escolher. */
export interface DespesaParaColaborador {
  id: string;
  referencia: string | null;
  tipo: TipoDespesa;
  categoria: CategoriaDespesa;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  coberto: number;
  restante: number;
  provincia: string | null;
}

function normalizarBase(r: Record<string, unknown>) {
  return {
    id: texto(r.id),
    referencia: (r.referencia as string | null) ?? null,
    tipo: tipoDe(r.tipo),
    categoria: categoriaDe(r.categoria),
    descricao: texto(r.descricao, "Despesa"),
    fornecedor: (r.fornecedor as string | null) ?? null,
    valor: num(r.valor),
    coberto: num(r.coberto),
    restante: Math.max(num(r.restante, num(r.valor) - num(r.coberto)), 0),
    provincia: (r.provincia as string | null) ?? null,
  };
}

/** Normaliza `despesas_equipa()`, que devolve um array jsonb. */
export function normalizarDespesas(bruto: unknown): Despesa[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((x) => {
    const r = x as Record<string, unknown>;
    const base = normalizarBase(r);
    return {
      ...base,
      estado: estadoDe(r.estado),
      notas: (r.notas as string | null) ?? null,
      comprovativo: (r.comprovativo as string | null) ?? null,
      provincia_id: (r.provincia_id as string | null) ?? null,
      criada_em: texto(r.created_at),
      pago_em: (r.pago_em as string | null) ?? null,
      financiadores: Array.isArray(r.financiadores)
        ? r.financiadores.filter((n): n is string => typeof n === "string")
        : [],
    };
  });
}

/** Normaliza `despesas_para_colaborador()`. */
export function normalizarDespesasParaColaborador(bruto: unknown): DespesaParaColaborador[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((x) => normalizarBase(x as Record<string, unknown>));
}

/** Totais de `despesas_resumo()`. */
export interface ResumoDespesas {
  pendente_valor: number;
  pendente_count: number;
  despesa_total: number;
  investimento_total: number;
  mes_valor: number;
  pago_com_comissoes: number;
}

const ZERO_RESUMO: ResumoDespesas = {
  pendente_valor: 0,
  pendente_count: 0,
  despesa_total: 0,
  investimento_total: 0,
  mes_valor: 0,
  pago_com_comissoes: 0,
};

export function normalizarResumoDespesas(bruto: unknown): ResumoDespesas {
  if (!bruto || typeof bruto !== "object") return { ...ZERO_RESUMO };
  const r = bruto as Record<string, unknown>;
  return {
    pendente_valor: num(r.pendente_valor),
    pendente_count: num(r.pendente_count),
    despesa_total: num(r.despesa_total),
    investimento_total: num(r.investimento_total),
    mes_valor: num(r.mes_valor),
    pago_com_comissoes: num(r.pago_com_comissoes),
  };
}

/** Quanto do valor da despesa já está pago, em percentagem inteira. */
export function progressoDespesa(d: { valor: number; coberto: number }): number {
  if (d.valor <= 0) return 0;
  return Math.min(Math.round((d.coberto / d.valor) * 100), 100);
}

/** Uma linha legível com quem pagou — é o que a gestão lê na lista. */
export function quemPagou(d: Despesa): string {
  if (d.financiadores.length === 0) {
    return d.estado === "paga" ? "Paga pela empresa" : "Sem pagamentos ainda";
  }
  if (d.financiadores.length === 1) return `Comissão de ${d.financiadores[0]}`;
  return `Comissões de ${d.financiadores.slice(0, 2).join(", ")}${
    d.financiadores.length > 2 ? ` e mais ${d.financiadores.length - 2}` : ""
  }`;
}
