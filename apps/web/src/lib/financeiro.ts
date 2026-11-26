/**
 * Painel financeiro — os oito indicadores que o gestor pode escrever.
 *
 * A regra é sempre a mesma: `manual` (o que o gestor escreveu) vence; quando é
 * `null`, conta o `automatico` que a base de dados calculou. Nada aqui inventa
 * valores: só normaliza o jsonb de `painel_financeiro()` para o ecrã.
 */

export type CampoFinanceiro =
  | "activo_total"
  | "activo_contabilistico"
  | "investimentos"
  | "valores_a_pagar"
  | "meta_financeira"
  | "vendas"
  | "despesas_reais"
  | "activo_liquido";

export type OrigemIndicador = "gestor" | "automatico" | "vazio";

export interface Indicador {
  /** O que a máquina calcula. `null` quando não há cálculo possível. */
  automatico: number | null;
  /** O que o gestor escreveu. `null` = está no automático. */
  manual: number | null;
  /** O que conta: o manual, ou o automático quando não há manual. */
  valor: number | null;
  origem: OrigemIndicador;
}

export interface LinhaFinanceira {
  id: string;
  nome: string;
  codigo: string | null;
  stock_unidades: number;
  stock_valor: number;
  vendas_count: number;
  pendentes_count: number;
  comissoes_pendentes: number;
  despesas_pagas: number;
  ja_coberto: number;
  nota: string | null;
  definido_por: string | null;
  updated_at: string | null;
  indicadores: Record<CampoFinanceiro, Indicador>;
}

export interface TotalFinanceiro {
  indicadores: Record<CampoFinanceiro, Indicador>;
  activo_bruto: number;
  excedido: boolean;
  progresso: number | null;
  vendas_count: number;
  pendentes_count: number;
  stock_valor: number;
  stock_unidades: number;
}

export interface AlteracaoFinanceira {
  id: number;
  provincia_id: string | null;
  provincia: string | null;
  campo: string;
  valor_anterior: number | null;
  valor_novo: number | null;
  nota: string | null;
  quem: string | null;
  quando: string;
}

export interface PainelFinanceiro {
  scope: "nacional" | "provincial";
  provincia_id: string | null;
  provincia: string | null;
  pode_editar: boolean;
  linhas: LinhaFinanceira[];
  total: TotalFinanceiro;
  historico: AlteracaoFinanceira[];
}

export interface CampoMeta {
  chave: CampoFinanceiro;
  rotulo: string;
  curto: string;
  descricao: string;
  /** De onde vem o automático. `null` quando não há cálculo. */
  notaAuto: string | null;
  /** Aceita valores negativos (só o activo líquido). */
  negativo?: boolean;
}

export const CAMPOS_FINANCEIROS: readonly CampoMeta[] = [
  {
    chave: "activo_total",
    rotulo: "Activo total (caixa)",
    curto: "Caixa",
    descricao: "Dinheiro efectivamente disponível em caixa.",
    notaAuto: "Referência: vendas + investimento pago",
  },
  {
    chave: "activo_contabilistico",
    rotulo: "Activo contabilístico",
    curto: "Bens",
    descricao: "Valor total dos bens, do stock e dos investimentos.",
    notaAuto: "Stock a preço oficial + investimento pago",
  },
  {
    chave: "investimentos",
    rotulo: "Investimentos",
    curto: "Investimento",
    descricao: "Valores investidos pelo gestor em equipamento e estrutura.",
    notaAuto: "Despesas de investimento já pagas",
  },
  {
    chave: "valores_a_pagar",
    rotulo: "Valores a pagar",
    curto: "A pagar",
    descricao: "Dívidas e pagamentos pendentes.",
    notaAuto: "Despesas por pagar + comissões pendentes",
  },
  {
    chave: "meta_financeira",
    rotulo: "Meta financeira",
    curto: "Meta",
    descricao: "Objectivo definido manualmente. Não há cálculo automático.",
    notaAuto: null,
  },
  {
    chave: "vendas",
    rotulo: "Vendas",
    curto: "Vendas",
    descricao: "Total de vendas registadas, ou o valor ajustado à mão.",
    notaAuto: "Vendas não canceladas",
  },
  {
    chave: "despesas_reais",
    rotulo: "Despesas reais",
    curto: "Despesas",
    descricao: "Despesas tal como as vê: pagas, cobertas e por pagar.",
    notaAuto: "Pagas + investimento + cobertas + por pagar",
  },
  {
    chave: "activo_liquido",
    rotulo: "Activo líquido",
    curto: "Líquido",
    descricao: "O que sobra depois das despesas. Pode ser negativo.",
    notaAuto: "Activo total − despesas reais",
    negativo: true,
  },
];

const ZERO_INDICADOR: Indicador = {
  automatico: null,
  manual: null,
  valor: null,
  origem: "vazio",
};

function numOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function num(valor: unknown, omissao = 0): number {
  return numOuNulo(valor) ?? omissao;
}

function origemDe(valor: unknown): OrigemIndicador {
  if (valor === "gestor") return "gestor";
  if (valor === "automatico") return "automatico";
  return "vazio";
}

function normalizarIndicador(bruto: unknown): Indicador {
  if (!bruto || typeof bruto !== "object") return { ...ZERO_INDICADOR };
  const r = bruto as Record<string, unknown>;
  return {
    automatico: numOuNulo(r.automatico),
    manual: numOuNulo(r.manual),
    valor: numOuNulo(r.valor),
    origem: origemDe(r.origem),
  };
}

function normalizarIndicadores(bruto: unknown): Record<CampoFinanceiro, Indicador> {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const saida = {} as Record<CampoFinanceiro, Indicador>;
  for (const c of CAMPOS_FINANCEIROS) {
    saida[c.chave] = normalizarIndicador(r[c.chave]);
  }
  return saida;
}

function normalizarLinha(bruto: unknown): LinhaFinanceira {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    nome: typeof r.nome === "string" ? r.nome : "—",
    codigo: (r.codigo as string | null) ?? null,
    stock_unidades: num(r.stock_unidades),
    stock_valor: num(r.stock_valor),
    vendas_count: num(r.vendas_count),
    pendentes_count: num(r.pendentes_count),
    comissoes_pendentes: num(r.comissoes_pendentes),
    despesas_pagas: num(r.despesas_pagas),
    ja_coberto: num(r.ja_coberto),
    nota: (r.nota as string | null) ?? null,
    definido_por: (r.definido_por as string | null) ?? null,
    updated_at: (r.updated_at as string | null) ?? null,
    indicadores: normalizarIndicadores(r.indicadores),
  };
}

/** Normaliza a resposta de `painel_financeiro()`. Nunca lança. */
export function normalizarPainel(bruto: unknown): PainelFinanceiro {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const total = (r.total ?? {}) as Record<string, unknown>;

  return {
    scope: r.scope === "provincial" ? "provincial" : "nacional",
    provincia_id: (r.provincia_id as string | null) ?? null,
    provincia: (r.provincia as string | null) ?? null,
    pode_editar: r.pode_editar === true,
    linhas: Array.isArray(r.linhas) ? r.linhas.map(normalizarLinha) : [],
    total: {
      indicadores: normalizarIndicadores(total.indicadores),
      activo_bruto: num(total.activo_bruto),
      excedido: total.excedido === true,
      progresso: numOuNulo(total.progresso),
      vendas_count: num(total.vendas_count),
      pendentes_count: num(total.pendentes_count),
      stock_valor: num(total.stock_valor),
      stock_unidades: num(total.stock_unidades),
    },
    historico: Array.isArray(r.historico)
      ? r.historico.map((x) => {
          const h = (x ?? {}) as Record<string, unknown>;
          return {
            id: num(h.id),
            provincia_id: (h.provincia_id as string | null) ?? null,
            provincia: (h.provincia as string | null) ?? null,
            campo: typeof h.campo === "string" ? h.campo : "",
            valor_anterior: numOuNulo(h.valor_anterior),
            valor_novo: numOuNulo(h.valor_novo),
            nota: (h.nota as string | null) ?? null,
            quem: (h.quem as string | null) ?? null,
            quando: typeof h.quando === "string" ? h.quando : "",
          };
        })
      : [],
  };
}

/**
 * Os indicadores do âmbito que está a ser editado: a empresa toda (linha
 * nacional), uma província, ou a única linha de um gestor provincial.
 */
export function indicadoresDoAmbito(
  painel: PainelFinanceiro,
  provinciaId: string | null
): Record<CampoFinanceiro, Indicador> {
  if (painel.scope === "provincial") {
    return painel.linhas[0]?.indicadores ?? painel.total.indicadores;
  }
  if (!provinciaId) return painel.total.indicadores;
  return (
    painel.linhas.find((l) => l.id === provinciaId)?.indicadores ??
    painel.total.indicadores
  );
}

/** Nome legível de um campo do histórico (inclui o pseudo-campo «todos»). */
export function rotuloDoCampo(campo: string): string {
  if (campo === "todos") return "Todos os indicadores";
  return CAMPOS_FINANCEIROS.find((c) => c.chave === campo)?.rotulo ?? campo;
}

/** Lê um número escrito à mão: aceita espaços, pontos de milhar e vírgula. */
export function lerNumero(texto: string): number | null {
  const limpo = texto
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Data curta para o histórico. */
export function quandoFinanceiro(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
