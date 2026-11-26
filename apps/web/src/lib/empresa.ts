/**
 * Saldo contabilístico e visão da empresa.
 *
 * O saldo não é calculado por ninguém: é escrito pela gestão. Aqui só se
 * normaliza o que vem de `saldo_contabilistico()` e `stock_valor()`, e se
 * agrupam as despesas por categoria para o painel da empresa.
 */

import {
  ROTULO_CATEGORIA,
  type CategoriaDespesa,
  type Despesa,
} from "@/lib/despesas";

export interface SaldoContabilistico {
  id: string;
  /** `null` = saldo da empresa toda. */
  provincia_id: string | null;
  provincia: string | null;
  valor: number;
  nota: string | null;
  definido_por: string | null;
  updated_at: string;
}

function num(valor: unknown, omissao = 0): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : omissao;
}

export function normalizarSaldos(bruto: unknown): SaldoContabilistico[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return {
      id: typeof r.id === "string" ? r.id : "",
      provincia_id: (r.provincia_id as string | null) ?? null,
      provincia: (r.provincia as string | null) ?? null,
      valor: num(r.valor),
      nota: (r.nota as string | null) ?? null,
      definido_por: (r.definido_por as string | null) ?? null,
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
    };
  });
}

export interface StockValor {
  unidades: number;
  valor: number;
  produtos: number;
  sem_stock: number;
  baixo: number;
  top: { nome: string; unidades: number; valor: number }[];
}

const ZERO_STOCK: StockValor = {
  unidades: 0,
  valor: 0,
  produtos: 0,
  sem_stock: 0,
  baixo: 0,
  top: [],
};

export function normalizarStockValor(bruto: unknown): StockValor {
  if (!bruto || typeof bruto !== "object") return { ...ZERO_STOCK };
  const r = bruto as Record<string, unknown>;
  return {
    unidades: num(r.unidades),
    valor: num(r.valor),
    produtos: num(r.produtos),
    sem_stock: num(r.sem_stock),
    baixo: num(r.baixo),
    top: Array.isArray(r.top)
      ? r.top.map((t) => {
          const x = (t ?? {}) as Record<string, unknown>;
          return {
            nome: typeof x.nome === "string" ? x.nome : "—",
            unidades: num(x.unidades),
            valor: num(x.valor),
          };
        })
      : [],
  };
}

export interface LinhaCategoria {
  categoria: CategoriaDespesa;
  rotulo: string;
  valor: number;
  count: number;
}

/** Onde vai o dinheiro: despesas não anuladas, somadas por categoria. */
export function despesasPorCategoria(despesas: Despesa[]): LinhaCategoria[] {
  const mapa = new Map<CategoriaDespesa, LinhaCategoria>();

  for (const d of despesas) {
    if (d.estado === "anulada") continue;
    const atual = mapa.get(d.categoria) ?? {
      categoria: d.categoria,
      rotulo: ROTULO_CATEGORIA[d.categoria] ?? d.categoria,
      valor: 0,
      count: 0,
    };
    atual.valor += d.valor;
    atual.count += 1;
    mapa.set(d.categoria, atual);
  }

  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

/** Data curta para o histórico do saldo. */
export function quando(iso: string | null): string {
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
