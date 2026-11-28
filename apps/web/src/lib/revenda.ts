/**
 * Tipos e leitores do lado do revendedor.
 *
 * O que vem da base é `jsonb` e `numeric`: números chegam como string em
 * algumas respostas do PostgREST e como number noutras. Normaliza-se tudo à
 * entrada para os ecrãs não terem de saber de onde veio.
 */

export type EstadoPedido =
  | "novo"
  | "em_analise"
  | "cotado"
  | "aprovado"
  | "enviado"
  | "entregue"
  | "cancelado";

export const ESTADOS: Record<EstadoPedido, { rotulo: string; cor: string }> = {
  novo: { rotulo: "Novo", cor: "bg-[#2A2410] text-[#E3D5A7]" },
  em_analise: { rotulo: "Em análise", cor: "bg-blue-950/60 text-blue-200" },
  cotado: { rotulo: "Cotado", cor: "bg-indigo-950/60 text-indigo-200" },
  aprovado: { rotulo: "Aprovado", cor: "bg-emerald-950/60 text-emerald-200" },
  enviado: { rotulo: "Enviado", cor: "bg-cyan-950/60 text-cyan-200" },
  entregue: { rotulo: "Entregue", cor: "bg-green-950/60 text-green-200" },
  cancelado: { rotulo: "Cancelado", cor: "bg-red-950/60 text-red-200" },
};

export function estadoDe(valor: string | null | undefined): EstadoPedido {
  return (valor && valor in ESTADOS ? valor : "novo") as EstadoPedido;
}

export interface Revendedor {
  id: string;
  tipo: "pessoa" | "empresa";
  nome: string;
  nif: string | null;
  telefone: string;
  email: string | null;
  provincia_id: string | null;
  provincia: string | null;
  loja_id: string | null;
  /**
   * Desconto negociado em percentagem. `null` = sem acordo próprio: o preço
   * vem da tabela de reduções do grosso (0032).
   */
  desconto: number | null;
  minimo_unidades: number;
  status: "activo" | "suspenso" | "encerrado";
  nota: string | null;
}

export interface MinhaRevenda {
  revendedor: Revendedor | null;
  /**
   * As regras do grosso, calculadas na base.
   *
   * `minimo_unidades` é por linha; `minimo_produtos` é por pedido. São duas
   * regras diferentes e o ecrã mostra as duas — um pedido de grosso com uma
   * linha só não é um pedido de grosso.
   *
   * `reducoes` são as alavancas em Kwanza (3.500 / 4.000 / 5.000) e
   * `margem_alvo` / `margem_max` a banda que a base usa para escolher uma.
   */
  regras: {
    minimo_unidades: number;
    minimo_produtos: number;
    reducoes: number[];
    margem_alvo: number;
    margem_max: number;
  };
  stats: {
    pedidos: number;
    em_curso: number;
    entregues: number;
    valor_total: number;
    valor_em_curso: number;
  };
  gestores: {
    provincia: { id: string; nome: string } | null;
    nacional: { id: string; nome: string } | null;
  };
}

export interface ProdutoGrosso {
  product_id: string;
  nome: string;
  sku: string | null;
  categoria: string | null;
  imagem: string | null;
  /** Preço normal para o cliente final. Não se mostra no catálogo do revendedor. */
  preco_loja: number;
  /** Preço de revenda oficial (tabela 2026) — o que o revendedor paga. */
  preco_grosso: number;
  /**
   * Diferença entre a tabela de loja e o preço escrito. É informação interna
   * da base: o ecrã do revendedor não a mostra, e nada é calculado a partir
   * dela para decidir preços.
   */
  reducao: number;
  lucro_unidade: number;
  margem_pct: number;
  desconto_pct: number;
  minimo: number;
  stock: number | null;
}

export interface ItemPedido {
  id: string;
  nome_produto: string;
  sku: string | null;
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
}

export interface PedidoGrosso {
  id: string;
  numero: string;
  status: string;
  mensagem: string | null;
  total_unidades: number;
  valor_estimado: number;
  resposta: string | null;
  respondido_at: string | null;
  created_at: string;
  itens?: ItemPedido[];
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function normalizarMinhaRevenda(bruto: unknown): MinhaRevenda {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const rev = (r.revendedor ?? null) as Record<string, unknown> | null;
  const stats = (r.stats ?? {}) as Record<string, unknown>;
  const gestores = (r.gestores ?? {}) as Record<string, unknown>;
  const regras = (r.regras ?? {}) as Record<string, unknown>;

  return {
    revendedor: rev
      ? {
          id: String(rev.id),
          tipo: rev.tipo === "pessoa" ? "pessoa" : "empresa",
          nome: String(rev.nome ?? ""),
          nif: (rev.nif as string | null) ?? null,
          telefone: String(rev.telefone ?? ""),
          email: (rev.email as string | null) ?? null,
          provincia_id: (rev.provincia_id as string | null) ?? null,
          provincia: (rev.provincia as string | null) ?? null,
          loja_id: (rev.loja_id as string | null) ?? null,
          // `null` é informação: sem acordo próprio, manda a tabela.
          desconto: rev.desconto === null || rev.desconto === undefined ? null : numero(rev.desconto),
          minimo_unidades: numero(rev.minimo_unidades) || 5,
          status:
            rev.status === "suspenso" || rev.status === "encerrado" ? rev.status : "activo",
          nota: (rev.nota as string | null) ?? null,
        }
      : null,
    // Sem `regras` (migração 0031/0032 por aplicar) ficam os valores antigos:
    // só o mínimo de unidades, sem mínimo de produtos nem tabela.
    regras: {
      minimo_unidades: numero(regras.minimo_unidades) || numero(rev?.minimo_unidades) || 5,
      minimo_produtos: numero(regras.minimo_produtos) || 1,
      reducoes: Array.isArray(regras.reducoes)
        ? (regras.reducoes as unknown[]).map(numero).filter((n) => n > 0)
        : [],
      margem_alvo: numero(regras.margem_alvo) || 0.2,
      margem_max: numero(regras.margem_max) || 0.3,
    },
    stats: {
      pedidos: numero(stats.pedidos),
      em_curso: numero(stats.em_curso),
      entregues: numero(stats.entregues),
      valor_total: numero(stats.valor_total),
      valor_em_curso: numero(stats.valor_em_curso),
    },
    gestores: {
      provincia: (gestores.provincia as { id: string; nome: string } | null) ?? null,
      nacional: (gestores.nacional as { id: string; nome: string } | null) ?? null,
    },
  };
}

export function normalizarCatalogo(linhas: unknown[]): ProdutoGrosso[] {
  return (linhas ?? []).map((linha) => {
    const l = linha as Record<string, unknown>;
    return {
      product_id: String(l.product_id),
      nome: String(l.nome ?? ""),
      sku: (l.sku as string | null) ?? null,
      categoria: (l.categoria as string | null) ?? null,
      imagem: (l.imagem as string | null) ?? null,
      preco_loja: numero(l.preco_loja),
      preco_grosso: numero(l.preco_grosso),
      reducao: numero(l.reducao),
      lucro_unidade:
        l.lucro_unidade === null || l.lucro_unidade === undefined
          ? numero(l.preco_loja) - numero(l.preco_grosso)
          : numero(l.lucro_unidade),
      margem_pct: numero(l.margem_pct),
      desconto_pct: numero(l.desconto_pct),
      minimo: numero(l.minimo) || 5,
      stock: l.stock === null || l.stock === undefined ? null : numero(l.stock),
    };
  });
}

export function normalizarPedido(bruto: unknown): PedidoGrosso {
  const p = bruto as Record<string, unknown>;
  const itens = (p.itens ?? []) as Record<string, unknown>[];

  return {
    id: String(p.id),
    numero: String(p.numero ?? ""),
    status: String(p.status ?? "novo"),
    mensagem: (p.mensagem as string | null) ?? null,
    total_unidades: numero(p.total_unidades),
    valor_estimado: numero(p.valor_estimado),
    resposta: (p.resposta as string | null) ?? null,
    respondido_at: (p.respondido_at as string | null) ?? null,
    created_at: String(p.created_at ?? ""),
    itens: itens.map((i) => ({
      id: String(i.id),
      nome_produto: String(i.nome_produto ?? ""),
      sku: (i.sku as string | null) ?? null,
      quantidade: numero(i.quantidade),
      preco_unitario: numero(i.preco_unitario),
      subtotal: numero(i.subtotal),
    })),
  };
}
