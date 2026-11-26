/**
 * Lojas — a unidade de gestão da INUKA.
 *
 * Cada loja tem código, nome, província e gerente. Stock, vendas, despesas e
 * investimento passam todos por `loja_id`, por isso cada loja calcula o seu
 * caixa e o seu saldo a partir dos próprios movimentos.
 *
 * A regra é a mesma do painel financeiro: o valor escrito pelo gerente vence;
 * quando é `null`, conta o `automatico`. Nada aqui inventa números — só
 * normaliza o jsonb de `lojas_overview()` para o ecrã.
 */

export type CampoLoja = "caixa" | "saldo" | "investimento" | "valores_a_pagar";

export interface ValorLoja {
  /** O que a base calcula a partir dos movimentos da loja. */
  automatico: number;
  /** O que o gerente escreveu. `null` = está no automático. */
  manual: number | null;
  /** O que conta: o manual, ou o automático quando não há manual. */
  valor: number;
  origem: "automatico" | "gestor";
}

export interface LinhaLoja {
  id: string;
  codigo: string;
  nome: string;
  provincia_id: string;
  provincia: string | null;
  manager_id: string | null;
  manager: string | null;
  is_default: boolean;
  is_active: boolean;
  stock_unidades: number;
  stock_valor: number;
  vendas: number;
  vendas_count: number;
  despesas_pagas: number;
  investimento_pago: number;
  por_pagar: number;
  ja_coberto: number;
  pendentes_count: number;
  comissoes_pendentes: number;
  caixa: ValorLoja;
  saldo: ValorLoja;
  investimento: ValorLoja;
  valores_a_pagar: ValorLoja;
  pode_editar: boolean;
  nota: string | null;
  updated_at: string | null;
}

export interface TotalLojas {
  lojas: number;
  stock_unidades: number;
  stock_valor: number;
  vendas: number;
  despesas_pagas: number;
  investimento_pago: number;
  por_pagar: number;
  caixa: number;
  saldo: number;
}

export interface VisaoLojas {
  scope: "nacional" | "provincial";
  provincia_id: string | null;
  provincia: string | null;
  lojas: LinhaLoja[];
  total: TotalLojas;
}

export interface Loja {
  id: string;
  codigo: string;
  nome: string;
  provincia_id: string;
  provincia?: string | null;
  manager_id?: string | null;
  is_default?: boolean;
}

/** Província para os seletores de loja. */
export interface ProvinciaOpcao {
  id: string;
  nome: string;
  codigo: string;
  is_default: boolean;
}

/** Gestor que pode ficar responsável por uma loja. */
export interface GerenteOpcao {
  id: string;
  full_name: string;
  provincia_id: string | null;
  is_national_admin: boolean;
}

/** Metadados dos quatro valores que o gerente da loja pode corrigir. */
export const CAMPOS_LOJA: {
  chave: CampoLoja;
  rotulo: string;
  descricao: string;
  notaAuto: string;
}[] = [
  {
    chave: "caixa",
    rotulo: "Caixa",
    descricao: "Dinheiro que está efectivamente na loja.",
    notaAuto: "Vendas − despesas pagas − investimento pago",
  },
  {
    chave: "saldo",
    rotulo: "Saldo",
    descricao: "O que sobra depois de tudo o que a loja deve.",
    notaAuto: "Vendas − (despesas + investimento + dívidas)",
  },
  {
    chave: "investimento",
    rotulo: "Investimento",
    descricao: "Valor investido na loja (obras, equipamento, stock inicial).",
    notaAuto: "Investimentos já pagos",
  },
  {
    chave: "valores_a_pagar",
    rotulo: "Valores a pagar",
    descricao: "Dívidas da loja por liquidar.",
    notaAuto: "Despesas pendentes + comissões por pagar",
  },
];

export function numeroSeguro(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function valorLoja(bruto: unknown): ValorLoja {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const automatico = numeroSeguro(o.automatico);
  const manual = o.manual === null || o.manual === undefined ? null : numeroSeguro(o.manual);
  const valor = o.valor === null || o.valor === undefined ? automatico : numeroSeguro(o.valor);
  return {
    automatico,
    manual,
    valor,
    origem: o.origem === "gestor" || manual !== null ? "gestor" : "automatico",
  };
}

function linhaLoja(bruto: unknown): LinhaLoja {
  const o = (bruto ?? {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    codigo: String(o.codigo ?? ""),
    nome: String(o.nome ?? "Loja"),
    provincia_id: String(o.provincia_id ?? ""),
    provincia: (o.provincia as string | null) ?? null,
    manager_id: (o.manager_id as string | null) ?? null,
    manager: (o.manager as string | null) ?? null,
    is_default: o.is_default === true,
    is_active: o.is_active !== false,
    stock_unidades: numeroSeguro(o.stock_unidades),
    stock_valor: numeroSeguro(o.stock_valor),
    vendas: numeroSeguro(o.vendas),
    vendas_count: numeroSeguro(o.vendas_count),
    despesas_pagas: numeroSeguro(o.despesas_pagas),
    investimento_pago: numeroSeguro(o.investimento_pago),
    por_pagar: numeroSeguro(o.por_pagar),
    ja_coberto: numeroSeguro(o.ja_coberto),
    pendentes_count: numeroSeguro(o.pendentes_count),
    comissoes_pendentes: numeroSeguro(o.comissoes_pendentes),
    caixa: valorLoja(o.caixa),
    saldo: valorLoja(o.saldo),
    investimento: valorLoja(o.investimento),
    valores_a_pagar: valorLoja(o.valores_a_pagar),
    pode_editar: o.pode_editar === true,
    nota: (o.nota as string | null) ?? null,
    updated_at: (o.updated_at as string | null) ?? null,
  };
}

/** `lojas_overview()` devolve jsonb; isto garante a forma esperada pelo ecrã. */
export function normalizarVisaoLojas(bruto: unknown): VisaoLojas {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(o.lojas) ? o.lojas : [];
  const t = (o.total ?? {}) as Record<string, unknown>;

  return {
    scope: o.scope === "nacional" ? "nacional" : "provincial",
    provincia_id: (o.provincia_id as string | null) ?? null,
    provincia: (o.provincia as string | null) ?? null,
    lojas: lista.map(linhaLoja).filter((l) => l.id !== ""),
    total: {
      lojas: numeroSeguro(t.lojas),
      stock_unidades: numeroSeguro(t.stock_unidades),
      stock_valor: numeroSeguro(t.stock_valor),
      vendas: numeroSeguro(t.vendas),
      despesas_pagas: numeroSeguro(t.despesas_pagas),
      investimento_pago: numeroSeguro(t.investimento_pago),
      por_pagar: numeroSeguro(t.por_pagar),
      caixa: numeroSeguro(t.caixa),
      saldo: numeroSeguro(t.saldo),
    },
  };
}

/** Data curta em português, tolerante a nulos. */
export function quandoLoja(iso: string | null): string {
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
