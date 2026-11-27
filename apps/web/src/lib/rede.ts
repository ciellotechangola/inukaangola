/**
 * Rede de vendedores (revendedores) — tipos e normalização.
 *
 * As duas funções da migração 0029 devolvem `jsonb`. O PostgREST entrega-o já
 * convertido, mas os `numeric` podem chegar como texto nalguns percursos, e um
 * `null` nunca pode virar `0` por acidente (um revendedor sem pedidos não é um
 * revendedor com zero kwanzas facturados — é a mesma coisa, mas o `null` diz
 * «nunca comprou»). Por isso há normalizadores explícitos.
 */

export interface RedeTotais {
  revendedores: number;
  activos: number;
  suspensos: number;
  pedidos: number;
  unidades: number;
  valor: number;
  em_curso: number;
  valor_em_curso: number;
  entregues: number;
  candidaturas: number;
  ultimo_pedido: string | null;
}

export interface RedeProvincia {
  id: string;
  nome: string;
  codigo: string;
  revendedores: number;
  activos: number;
  pedidos: number;
  valor: number;
}

export interface RedeRevendedor {
  id: string;
  nome: string;
  tipo: string;
  telefone: string;
  email: string | null;
  nif: string | null;
  status: string;
  desconto: number | null;
  minimo_unidades: number;
  desde: string;
  provincia: string | null;
  provincia_codigo: string | null;
  loja_codigo: string | null;
  loja_nome: string | null;
  pedidos: number;
  unidades: number;
  valor: number;
  em_curso: number;
  ultimo_pedido: string | null;
}

export interface RedeRanking {
  id: string;
  nome: string;
  provincia: string | null;
  valor: number;
  pedidos: number;
}

export interface Rede {
  period_from: string;
  period_to: string;
  scope: "nacional" | "provincial";
  provincia_id: string | null;
  totais: RedeTotais;
  provincias: RedeProvincia[];
  revendedores: RedeRevendedor[];
  ranking: RedeRanking[];
}

export interface FichaIdentidade {
  id: string;
  user_id: string | null;
  tipo: string;
  nome: string;
  nif: string | null;
  telefone: string;
  email: string | null;
  status: string;
  desconto: number | null;
  minimo_unidades: number;
  nota: string | null;
  desde: string;
  provincia_id: string | null;
  provincia: string | null;
  provincia_codigo: string | null;
  loja_id: string | null;
  loja: string | null;
  loja_codigo: string | null;
  manager_id: string | null;
  gestor: string | null;
  conta_activa: boolean | null;
}

export interface FichaStats {
  pedidos: number;
  unidades: number;
  valor: number;
  entregues: number;
  cancelados: number;
  em_curso: number;
  valor_em_curso: number;
  ticket_medio: number;
  primeiro_pedido: string | null;
  ultimo_pedido: string | null;
}

export interface FichaMes {
  pedidos: number;
  unidades: number;
  valor: number;
}

export interface FichaHistorico {
  mes: string;
  pedidos: number;
  unidades: number;
  valor: number;
}

export interface FichaItem {
  nome: string;
  sku: string | null;
  quantidade: number;
  preco: number;
  subtotal: number;
}

export interface FichaPedido {
  id: string;
  numero: string;
  status: string;
  unidades: number;
  valor: number;
  mensagem: string | null;
  resposta: string | null;
  created_at: string;
  itens: FichaItem[];
}

export interface FichaCandidatura {
  id: string;
  tipo: string;
  nome: string;
  telefone: string;
  email: string | null;
  nif: string | null;
  area_atuacao: string | null;
  representante: string | null;
  mensagem: string | null;
  status: string;
  resposta: string | null;
  created_at: string;
}

export interface Ficha {
  revendedor: FichaIdentidade;
  stats: FichaStats;
  mes: FichaMes;
  historico: FichaHistorico[];
  pedidos: FichaPedido[];
  candidatura: FichaCandidatura | null;
}

function n(valor: unknown): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const x = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(x) ? x : 0;
}

function nOuNull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const x = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(x) ? x : null;
}

/** `jsonb` vazio ou em falta nunca deve partir a página. */
export function normalizarRede(bruto: unknown): Rede | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const totais = (r.totais ?? {}) as Record<string, unknown>;

  return {
    period_from: String(r.period_from ?? ""),
    period_to: String(r.period_to ?? ""),
    scope: r.scope === "provincial" ? "provincial" : "nacional",
    provincia_id: (r.provincia_id as string | null) ?? null,
    totais: {
      revendedores: n(totais.revendedores),
      activos: n(totais.activos),
      suspensos: n(totais.suspensos),
      pedidos: n(totais.pedidos),
      unidades: n(totais.unidades),
      valor: n(totais.valor),
      em_curso: n(totais.em_curso),
      valor_em_curso: n(totais.valor_em_curso),
      entregues: n(totais.entregues),
      candidaturas: n(totais.candidaturas),
      ultimo_pedido: (totais.ultimo_pedido as string | null) ?? null,
    },
    provincias: ((r.provincias ?? []) as Record<string, unknown>[]).map((p) => ({
      id: String(p.id),
      nome: String(p.nome ?? ""),
      codigo: String(p.codigo ?? ""),
      revendedores: n(p.revendedores),
      activos: n(p.activos),
      pedidos: n(p.pedidos),
      valor: n(p.valor),
    })),
    revendedores: ((r.revendedores ?? []) as Record<string, unknown>[]).map((v) => ({
      id: String(v.id),
      nome: String(v.nome ?? ""),
      tipo: String(v.tipo ?? "pessoa"),
      telefone: String(v.telefone ?? ""),
      email: (v.email as string | null) ?? null,
      nif: (v.nif as string | null) ?? null,
      status: String(v.status ?? "activo"),
      desconto: nOuNull(v.desconto),
      minimo_unidades: n(v.minimo_unidades),
      desde: String(v.desde ?? ""),
      provincia: (v.provincia as string | null) ?? null,
      provincia_codigo: (v.provincia_codigo as string | null) ?? null,
      loja_codigo: (v.loja_codigo as string | null) ?? null,
      loja_nome: (v.loja_nome as string | null) ?? null,
      pedidos: n(v.pedidos),
      unidades: n(v.unidades),
      valor: n(v.valor),
      em_curso: n(v.em_curso),
      ultimo_pedido: (v.ultimo_pedido as string | null) ?? null,
    })),
    ranking: ((r.ranking ?? []) as Record<string, unknown>[]).map((v) => ({
      id: String(v.id),
      nome: String(v.nome ?? ""),
      provincia: (v.provincia as string | null) ?? null,
      valor: n(v.valor),
      pedidos: n(v.pedidos),
    })),
  };
}

export function normalizarFicha(bruto: unknown): Ficha | null {
  if (!bruto || typeof bruto !== "object") return null;
  const f = bruto as Record<string, unknown>;
  const rev = f.revendedor as Record<string, unknown> | null;
  if (!rev) return null;

  const stats = (f.stats ?? {}) as Record<string, unknown>;
  const mes = (f.mes ?? {}) as Record<string, unknown>;
  const cand = f.candidatura as Record<string, unknown> | null;

  return {
    revendedor: {
      id: String(rev.id),
      user_id: (rev.user_id as string | null) ?? null,
      tipo: String(rev.tipo ?? "pessoa"),
      nome: String(rev.nome ?? ""),
      nif: (rev.nif as string | null) ?? null,
      telefone: String(rev.telefone ?? ""),
      email: (rev.email as string | null) ?? null,
      status: String(rev.status ?? "activo"),
      desconto: nOuNull(rev.desconto),
      minimo_unidades: n(rev.minimo_unidades),
      nota: (rev.nota as string | null) ?? null,
      desde: String(rev.desde ?? ""),
      provincia_id: (rev.provincia_id as string | null) ?? null,
      provincia: (rev.provincia as string | null) ?? null,
      provincia_codigo: (rev.provincia_codigo as string | null) ?? null,
      loja_id: (rev.loja_id as string | null) ?? null,
      loja: (rev.loja as string | null) ?? null,
      loja_codigo: (rev.loja_codigo as string | null) ?? null,
      manager_id: (rev.manager_id as string | null) ?? null,
      gestor: (rev.gestor as string | null) ?? null,
      conta_activa: (rev.conta_activa as boolean | null) ?? null,
    },
    stats: {
      pedidos: n(stats.pedidos),
      unidades: n(stats.unidades),
      valor: n(stats.valor),
      entregues: n(stats.entregues),
      cancelados: n(stats.cancelados),
      em_curso: n(stats.em_curso),
      valor_em_curso: n(stats.valor_em_curso),
      ticket_medio: n(stats.ticket_medio),
      primeiro_pedido: (stats.primeiro_pedido as string | null) ?? null,
      ultimo_pedido: (stats.ultimo_pedido as string | null) ?? null,
    },
    mes: { pedidos: n(mes.pedidos), unidades: n(mes.unidades), valor: n(mes.valor) },
    historico: ((f.historico ?? []) as Record<string, unknown>[]).map((h) => ({
      mes: String(h.mes ?? ""),
      pedidos: n(h.pedidos),
      unidades: n(h.unidades),
      valor: n(h.valor),
    })),
    pedidos: ((f.pedidos ?? []) as Record<string, unknown>[]).map((p) => ({
      id: String(p.id),
      numero: String(p.numero ?? ""),
      status: String(p.status ?? "novo"),
      unidades: n(p.unidades),
      valor: n(p.valor),
      mensagem: (p.mensagem as string | null) ?? null,
      resposta: (p.resposta as string | null) ?? null,
      created_at: String(p.created_at ?? ""),
      itens: ((p.itens ?? []) as Record<string, unknown>[]).map((i) => ({
        nome: String(i.nome ?? ""),
        sku: (i.sku as string | null) ?? null,
        quantidade: n(i.quantidade),
        preco: n(i.preco),
        subtotal: n(i.subtotal),
      })),
    })),
    candidatura: cand
      ? {
          id: String(cand.id),
          tipo: String(cand.tipo ?? "pessoa"),
          nome: String(cand.nome ?? ""),
          telefone: String(cand.telefone ?? ""),
          email: (cand.email as string | null) ?? null,
          nif: (cand.nif as string | null) ?? null,
          area_atuacao: (cand.area_atuacao as string | null) ?? null,
          representante: (cand.representante as string | null) ?? null,
          mensagem: (cand.mensagem as string | null) ?? null,
          status: String(cand.status ?? "novo"),
          resposta: (cand.resposta as string | null) ?? null,
          created_at: String(cand.created_at ?? ""),
        }
      : null,
  };
}

/** Rótulo do estado de um pedido de grosso (reutiliza o mapa da área de revenda). */
export const ROTULO_TIPO: Record<string, string> = {
  empresa: "Empresarial",
  pessoa: "Individual",
};

export const ROTULO_ESTADO_REVENDEDOR: Record<string, string> = {
  activo: "activo",
  suspenso: "suspenso",
  encerrado: "encerrado",
};

export const COR_ESTADO_REVENDEDOR: Record<string, string> = {
  activo: "bg-green-950/60 text-green-200",
  suspenso: "bg-[#2A2410] text-[#E3D5A7]",
  encerrado: "bg-red-950/60 text-red-200",
};

/** «há 3 dias», «hoje» — para a coluna do último pedido. */
export function desdeQuando(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}
