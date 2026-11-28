/**
 * Situação da venda e saldos por colaborador.
 *
 * A regra vive toda na base (`confirmar_pagamento_venda`, `saldo_colaborador`,
 * `saldos_equipa`, `vendas_gestao`). Este ficheiro só descreve as formas e
 * normaliza as respostas — porque o PostgREST devolve `numeric` como texto e
 * uma soma feita sobre `"30000.00"` daria `"30000.0030000.00"`.
 *
 * A distinção que importa e que a interface tem de mostrar sem ambiguidade:
 *
 *   VENDA (o que o colaborador vendeu)
 *     contabilistico → todas as vendas não anuladas. É desempenho e meta.
 *                      **Não é dinheiro disponível.**
 *     pendente       → vendas por confirmar. Dinheiro possível, ainda não
 *                      recebido: não se levanta.
 *     activo         → vendas confirmadas como pagas. Dinheiro recebido.
 *
 *   COMISSÃO (o que o colaborador tem a receber)
 *     por_pagar  → comissões de vendas por confirmar
 *     ganho      → comissões de vendas confirmadas
 *     pago       → o que já lhe foi entregue
 *     reservado  → levantamentos em curso
 *     disponivel → ganho − pago − reservado. **É isto que se levanta.**
 *
 * Confundir «volume vendido» com «dinheiro a receber» foi o que fez um
 * colaborador pensar que tinha 30.000 Kz disponíveis por uma venda de 30.000.
 */

export type EstadoPagamento = "pending" | "partial" | "paid" | "refunded";

/** Só estes dois interessam ao fluxo novo; os outros ficam como legado. */
export type SituacaoVenda = "pendente" | "pago";

export const ROTULO_PAGAMENTO: Record<EstadoPagamento, string> = {
  pending: "Pendente",
  partial: "Parcial",
  paid: "Pago",
  refunded: "Reembolsado",
};

/** Selo por situação: dourado = à espera, verde = dinheiro dentro. */
export const COR_PAGAMENTO: Record<EstadoPagamento, string> = {
  pending: "border-[#4A3F1F] bg-[#241E0E] text-[#C9A962]",
  partial: "border-[#2A3F4A] bg-[#0E1E24] text-[#7DD3FC]",
  paid: "border-[#1F4D2E] bg-[#0E2417] text-[#4ADE80]",
  refunded: "border-[#4A2020] bg-[#2A1010] text-[#F87171]",
};

export function situacaoDe(status: string | null | undefined): SituacaoVenda {
  return status === "paid" ? "pago" : "pendente";
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ vendas */

export interface VendaLinha {
  id: string;
  reference: string;
  total_amount: number;
  payment_status: EstadoPagamento;
  status: "completed" | "cancelled";
  created_at: string;
  payment_method: string | null;
  payment_confirmed_at: string | null;
  seller_id: string;
  seller_nome: string;
  seller_telefone: string | null;
  confirmado_por: string | null;
  linhas: number;
  eventos: number;
}

export interface TotaisVendas {
  vendas: number;
  valor: number;
  pendentes: number;
  valor_pendente: number;
  pagas: number;
  valor_pago: number;
}

export interface VendasGestao {
  scope: "nacional" | "provincial";
  totais: TotaisVendas;
  linhas: VendaLinha[];
}

export function normalizarVendasGestao(bruto: unknown): VendasGestao {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const t = (r.totais ?? {}) as Record<string, unknown>;
  const linhas = Array.isArray(r.linhas) ? (r.linhas as Record<string, unknown>[]) : [];
  return {
    scope: r.scope === "nacional" ? "nacional" : "provincial",
    totais: {
      vendas: num(t.vendas),
      valor: num(t.valor),
      pendentes: num(t.pendentes),
      valor_pendente: num(t.valor_pendente),
      pagas: num(t.pagas),
      valor_pago: num(t.valor_pago),
    },
    linhas: linhas.map((l) => ({
      id: String(l.id),
      reference: String(l.reference ?? ""),
      total_amount: num(l.total_amount),
      payment_status: (l.payment_status as EstadoPagamento) ?? "pending",
      status: l.status === "cancelled" ? "cancelled" : "completed",
      created_at: String(l.created_at ?? ""),
      payment_method: (l.payment_method as string | null) ?? null,
      payment_confirmed_at: (l.payment_confirmed_at as string | null) ?? null,
      seller_id: String(l.seller_id),
      seller_nome: String(l.seller_nome ?? ""),
      seller_telefone: (l.seller_telefone as string | null) ?? null,
      confirmado_por: (l.confirmado_por as string | null) ?? null,
      linhas: num(l.linhas),
      eventos: num(l.eventos),
    })),
  };
}

/* ------------------------------------------------------- saldo individual */

export interface SaldoColaborador {
  seller_id: string;
  nome: string;
  vendas: {
    contabilistico: number;
    pendente: number;
    activo: number;
    count: number;
    count_pendente: number;
    count_activo: number;
  };
  comissoes: {
    por_pagar: number;
    ganho: number;
    pago: number;
    reservado: number;
    disponivel: number;
    taxa: number;
  };
  levantamento: {
    habilitado: boolean;
    vendas_faltam: number;
    vendas_minimas: number;
  };
}

export function normalizarSaldo(bruto: unknown): SaldoColaborador | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const v = (r.vendas ?? {}) as Record<string, unknown>;
  const c = (r.comissoes ?? {}) as Record<string, unknown>;
  const l = (r.levantamento ?? {}) as Record<string, unknown>;
  return {
    seller_id: String(r.seller_id ?? ""),
    nome: String(r.nome ?? ""),
    vendas: {
      contabilistico: num(v.contabilistico),
      pendente: num(v.pendente),
      activo: num(v.activo),
      count: num(v.count),
      count_pendente: num(v.count_pendente),
      count_activo: num(v.count_activo),
    },
    comissoes: {
      por_pagar: num(c.por_pagar),
      ganho: num(c.ganho),
      pago: num(c.pago),
      reservado: num(c.reservado),
      disponivel: num(c.disponivel),
      taxa: num(c.taxa),
    },
    levantamento: {
      habilitado: l.habilitado === true,
      vendas_faltam: num(l.vendas_faltam),
      vendas_minimas: num(l.vendas_minimas),
    },
  };
}

/* ----------------------------------------------------------- equipa toda */

export interface SaldoEquipa {
  seller_id: string;
  nome: string;
  telefone: string | null;
  provincia_id: string | null;
  provincia_nome: string | null;
  provincia_codigo: string | null;
  ativo: boolean;
  vendas: number;
  contabilistico: number;
  pendente: number;
  activo: number;
  count_pendente: number;
  count_activo: number;
  comissao_ganha: number;
  comissao_por_pagar: number;
  comissao_paga: number;
  reservado: number;
  disponivel: number;
}

export interface SaldosEquipa {
  scope: "nacional" | "provincial";
  totais: {
    colaboradores: number;
    contabilistico: number;
    pendente: number;
    activo: number;
    disponivel: number;
    pago: number;
    por_confirmar: number;
  };
  linhas: SaldoEquipa[];
}

export function normalizarSaldosEquipa(bruto: unknown): SaldosEquipa {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const t = (r.totais ?? {}) as Record<string, unknown>;
  const linhas = Array.isArray(r.linhas) ? (r.linhas as Record<string, unknown>[]) : [];
  return {
    scope: r.scope === "nacional" ? "nacional" : "provincial",
    totais: {
      colaboradores: num(t.colaboradores),
      contabilistico: num(t.contabilistico),
      pendente: num(t.pendente),
      activo: num(t.activo),
      disponivel: num(t.disponivel),
      pago: num(t.pago),
      por_confirmar: num(t.por_confirmar),
    },
    linhas: linhas.map((l) => ({
      seller_id: String(l.seller_id),
      nome: String(l.nome ?? ""),
      telefone: (l.telefone as string | null) ?? null,
      provincia_id: (l.provincia_id as string | null) ?? null,
      provincia_nome: (l.provincia_nome as string | null) ?? null,
      provincia_codigo: (l.provincia_codigo as string | null) ?? null,
      ativo: l.ativo === true,
      vendas: num(l.vendas),
      contabilistico: num(l.contabilistico),
      pendente: num(l.pendente),
      activo: num(l.activo),
      count_pendente: num(l.count_pendente),
      count_activo: num(l.count_activo),
      comissao_ganha: num(l.comissao_ganha),
      comissao_por_pagar: num(l.comissao_por_pagar),
      comissao_paga: num(l.comissao_paga),
      reservado: num(l.reservado),
      disponivel: num(l.disponivel),
    })),
  };
}

/* ------------------------------------------------------------- histórico */

export interface EventoVenda {
  id: string;
  tipo: "registo" | "pagamento_confirmado" | "pagamento_reaberto" | "correcao" | "anulacao" | "reabertura";
  de: string | null;
  para: string | null;
  detalhe: string | null;
  por_nome: string | null;
  em: string;
}

export const ROTULO_EVENTO: Record<EventoVenda["tipo"], string> = {
  registo: "Venda registada",
  pagamento_confirmado: "Pagamento confirmado",
  pagamento_reaberto: "Pagamento reaberto",
  correcao: "Valor corrigido",
  anulacao: "Venda anulada",
  reabertura: "Venda reaberta",
};

export interface ItemVenda {
  id: string;
  quantidade: number;
  preco_unitario: number;
  total: number;
  nome: string;
  sku: string | null;
}

export function normalizarItens(bruto: unknown): ItemVenda[] {
  const linhas = Array.isArray(bruto) ? (bruto as Record<string, unknown>[]) : [];
  return linhas.map((l) => {
    const snap = (l.product_snapshot ?? {}) as Record<string, unknown>;
    return {
      id: String(l.id),
      quantidade: num(l.quantity),
      preco_unitario: num(l.unit_price),
      total: num(l.total_price),
      nome: String(snap.name ?? "Produto"),
      sku: (snap.sku as string | null) ?? null,
    };
  });
}
