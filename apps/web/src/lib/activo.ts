/**
 * Activo da província — quanto sobra depois das despesas.
 *
 * O cálculo vive todo na base de dados (`activo_provincia()`); aqui só se
 * normaliza o jsonb para o ecrã nunca mostrar `undefined` nem `NaN`.
 *
 *   activo_calculado = vendas + investimento pago
 *   activo_total     = saldo contabilístico do gestor, ou o calculado se não houver
 *   despesas_total   = pagas + investimento + já coberto + por pagar
 *   activo_liquido   = activo_total − despesas_total
 *   progresso        = activo_liquido / meta (só quando há saldo definido)
 *
 * O saldo contabilístico é escrito pelo gestor a partir da análise ao stock:
 * não é automático. O automático continua a ser devolvido em
 * `activo_calculado`, para comparação.
 */

export type OrigemActivo = "gestor" | "automatico";

export interface LinhaActivo {
  id: string;
  nome: string;
  codigo: string | null;
  /** Vendas não canceladas, desde sempre. */
  vendas: number;
  vendas_count: number;
  /** Despesas correntes já pagas. */
  despesas_pagas: number;
  /** Investimento já pago — bens que ficam para a empresa. */
  investimento_pago: number;
  /** Tudo o que falta pagar (despesa corrente e investimento). */
  por_pagar: number;
  /** Parte de despesas por pagar já coberta por comissões da equipa. */
  ja_coberto: number;
  pendentes_count: number;
  /** Unidades em stock na província. */
  stock_unidades: number;
  /** Stock a preço oficial — a base da análise do gestor. */
  stock_valor: number;
  /** Bens + stock + investimento: o activo contabilístico do gestor. */
  activo_contabilistico: number;
  /** Pagas + investimento + já coberto + por pagar. Nunca inclui anuladas. */
  despesas_total: number;
  /** Vendas + investimento pago: o que a máquina calcula sozinha. */
  activo_calculado: number;
  /** Saldo escrito pelo gestor. `null` = ainda não definido. */
  saldo_manual: number | null;
  /** A meta é o saldo do gestor (igual a `saldo_manual`). */
  meta: number | null;
  origem: OrigemActivo;
  activo_total: number;
  activo_liquido: number;
  /** Percentagem da meta que ainda resta. `null` sem saldo definido. */
  progresso: number | null;
  /** As despesas já ultrapassaram o activo total. */
  excedido: boolean;
  /** Activo total em percentagem das despesas. 100 = empatado. */
  cobertura: number;
}

export interface TotalActivo {
  vendas: number;
  vendas_count: number;
  despesas_pagas: number;
  investimento_pago: number;
  por_pagar: number;
  ja_coberto: number;
  pendentes_count: number;
  stock_unidades: number;
  stock_valor: number;
  activo_contabilistico: number;
  despesas_total: number;
  activo_calculado: number;
  saldo_manual: number | null;
  meta: number | null;
  origem: OrigemActivo;
  activo_total: number;
  activo_liquido: number;
  progresso: number | null;
  excedido: boolean;
  cobertura: number;
}

export interface ActivoProvincia {
  scope: "nacional" | "provincial";
  provincia_id: string | null;
  provincia: string | null;
  linhas: LinhaActivo[];
  total: TotalActivo;
  /** Província com o activo total mais alto do país. */
  maximo: LinhaActivo | null;
  /** Quantas províncias já gastaram mais do que geraram. */
  em_risco: number;
}

function num(valor: unknown, omissao = 0): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : omissao;
}

/** Números que podem ser nulos (saldo, meta, progresso). */
function numOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function texto(valor: unknown, omissao = ""): string {
  return typeof valor === "string" && valor.trim() !== "" ? valor : omissao;
}

function booleano(valor: unknown): boolean {
  return valor === true || valor === "true" || valor === 1;
}

function origemDe(valor: unknown): OrigemActivo {
  return valor === "gestor" ? "gestor" : "automatico";
}

function normalizarLinha(bruto: unknown): LinhaActivo {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return {
    id: texto(r.id),
    nome: texto(r.nome, "Sem província"),
    codigo: (r.codigo as string | null) ?? null,
    vendas: num(r.vendas),
    vendas_count: num(r.vendas_count),
    despesas_pagas: num(r.despesas_pagas),
    investimento_pago: num(r.investimento_pago),
    por_pagar: num(r.por_pagar),
    ja_coberto: num(r.ja_coberto),
    pendentes_count: num(r.pendentes_count),
    stock_unidades: num(r.stock_unidades),
    stock_valor: num(r.stock_valor),
    activo_contabilistico: num(r.activo_contabilistico),
    despesas_total: num(r.despesas_total),
    activo_calculado: num(r.activo_calculado, num(r.activo_total)),
    saldo_manual: numOuNulo(r.saldo_manual),
    meta: numOuNulo(r.meta ?? r.saldo_manual),
    origem: origemDe(r.origem),
    activo_total: num(r.activo_total),
    activo_liquido: num(r.activo_liquido),
    progresso: numOuNulo(r.progresso),
    excedido: booleano(r.excedido),
    cobertura: num(r.cobertura, 100),
  };
}

function normalizarTotal(bruto: unknown): TotalActivo {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return {
    vendas: num(r.vendas),
    vendas_count: num(r.vendas_count),
    despesas_pagas: num(r.despesas_pagas),
    investimento_pago: num(r.investimento_pago),
    por_pagar: num(r.por_pagar),
    ja_coberto: num(r.ja_coberto),
    pendentes_count: num(r.pendentes_count),
    stock_unidades: num(r.stock_unidades),
    stock_valor: num(r.stock_valor),
    activo_contabilistico: num(r.activo_contabilistico),
    despesas_total: num(r.despesas_total),
    activo_calculado: num(r.activo_calculado, num(r.activo_total)),
    saldo_manual: numOuNulo(r.saldo_manual),
    meta: numOuNulo(r.meta ?? r.saldo_manual),
    origem: origemDe(r.origem),
    activo_total: num(r.activo_total),
    activo_liquido: num(r.activo_liquido),
    progresso: numOuNulo(r.progresso),
    excedido: booleano(r.excedido),
    cobertura: num(r.cobertura, 100),
  };
}

const ZERO: TotalActivo = normalizarTotal(null);

/** Normaliza a resposta de `activo_provincia()`. Nunca lança. */
export function normalizarActivo(bruto: unknown): ActivoProvincia {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const scope = r.scope === "provincial" ? "provincial" : "nacional";

  return {
    scope,
    provincia_id: (r.provincia_id as string | null) ?? null,
    provincia: (r.provincia as string | null) ?? null,
    linhas: Array.isArray(r.linhas) ? r.linhas.map(normalizarLinha) : [],
    total: r.total ? normalizarTotal(r.total) : { ...ZERO },
    maximo: r.maximo ? normalizarLinha(r.maximo) : null,
    em_risco: num(r.em_risco),
  };
}

/** «Nacional» ou «Província do Uíge» — o âmbito que está a ser lido. */
export function rotuloAmbito(a: ActivoProvincia): string {
  if (a.scope === "nacional") return "Nacional (todas as províncias)";
  return `Província do ${a.provincia ?? "—"}`;
}

export type TomActivo = "positivo" | "negativo" | "neutro";

export function tomActivo(a: { excedido: boolean; activo_liquido: number }): TomActivo {
  if (a.excedido || a.activo_liquido < 0) return "negativo";
  if (a.activo_liquido > 0) return "positivo";
  return "neutro";
}

export const COR_TOM: Record<TomActivo, string> = {
  positivo: "text-[#22C55E]",
  negativo: "text-[#F87171]",
  neutro: "text-[#C9A962]",
};

export const ROTULO_TOM: Record<TomActivo, string> = {
  positivo: "Com activo",
  negativo: "Despesas acima do activo",
  neutro: "No limite",
};

/** «As despesas ultrapassam o activo em X Kz.» */
export function quantoExcedeu(a: { despesas_total: number; activo_total: number }): number {
  return Math.max(a.despesas_total - a.activo_total, 0);
}

/** O gestor já escreveu algum valor à mão (activo, vendas, despesas…)? */
export function temSaldoDoGestor(a: { origem: OrigemActivo }): boolean {
  return a.origem === "gestor";
}

/** Diferença entre o que o gestor declarou e o que o sistema calcula. */
export function desvioDoCalculado(a: {
  origem: OrigemActivo;
  meta: number | null;
  activo_calculado: number;
}): number | null {
  if (!temSaldoDoGestor(a) || a.meta === null) return null;
  return a.meta - a.activo_calculado;
}
