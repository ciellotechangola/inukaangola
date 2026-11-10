/**
 * Levantamento de comissões.
 *
 * O dinheiro nunca é calculado aqui: `levantamento_resumo()` devolve o saldo já
 * derivado (ganho − pago − reservado) e `solicitar_levantamento()` é a única
 * porta que reserva. Este ficheiro só descreve as formas, normaliza as
 * respostas das RPC e valida os dados de recebimento antes de os enviar — para
 * o colaborador ver o erro à frente do campo e não depois de submeter.
 */

export const ESTADOS_LEVANTAMENTO = [
  "pendente",
  "aprovado",
  "em_processamento",
  "pago",
  "rejeitado",
] as const;

export type EstadoLevantamento = (typeof ESTADOS_LEVANTAMENTO)[number];

export const ROTULO_ESTADO: Record<EstadoLevantamento, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  em_processamento: "Em processamento",
  pago: "Pago",
  rejeitado: "Rejeitado",
};

/** Selo por estado — dourado para o que está em curso, verde só quando pago. */
export const COR_ESTADO: Record<EstadoLevantamento, string> = {
  pendente: "border-[#4A3F1F] bg-[#241E0E] text-[#C9A962]",
  aprovado: "border-[#4A3F1F] bg-[#241E0E] text-[#E3D5A7]",
  em_processamento: "border-[#2A3F4A] bg-[#0E1E24] text-[#7DD3FC]",
  pago: "border-[#1F4D2E] bg-[#0E2417] text-[#22C55E]",
  rejeitado: "border-[#4A2020] bg-[#2A1010] text-[#F87171]",
};

/** Estados que ainda reservam saldo. Um pedido fechado já não conta. */
export const ESTADOS_ABERTOS: EstadoLevantamento[] = ["pendente", "aprovado", "em_processamento"];

export type MetodoRecebimento = "xpress" | "transferencia";

export const ROTULO_METODO: Record<MetodoRecebimento, string> = {
  xpress: "XPRESS",
  transferencia: "Transferência bancária",
};

/** O que `levantamento_resumo()` devolve, já em números. */
export interface ResumoLevantamento {
  seller_id: string;
  /** Vendas concluídas e pagas — as únicas que contam para desbloquear. */
  vendas_pagas: number;
  vendas_minimas: number;
  vendas_faltam: number;
  habilitado: boolean;
  /** Comissões de vendas confirmadas e pagas. */
  comissoes_ganhas: number;
  /** Comissões de vendas ainda por confirmar/pagar — não levantáveis. */
  comissoes_pendentes: number;
  total_pago: number;
  /** Pedidos em curso, presos até à decisão da gestão. */
  reservado: number;
  disponivel: number;
  taxa: number;
}

const ZERO_RESUMO: ResumoLevantamento = {
  seller_id: "",
  vendas_pagas: 0,
  vendas_minimas: 5,
  vendas_faltam: 5,
  habilitado: false,
  comissoes_ganhas: 0,
  comissoes_pendentes: 0,
  total_pago: 0,
  reservado: 0,
  disponivel: 0,
  taxa: 0.1,
};

function num(valor: unknown, omissao = 0): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : omissao;
}

/** Normaliza a resposta de `levantamento_resumo()`. */
export function normalizarResumo(bruto: unknown): ResumoLevantamento {
  if (!bruto || typeof bruto !== "object") return { ...ZERO_RESUMO };
  const r = bruto as Record<string, unknown>;
  const minimas = num(r.vendas_minimas, 5);
  const pagas = num(r.vendas_pagas);

  return {
    seller_id: String(r.seller_id ?? ""),
    vendas_pagas: pagas,
    vendas_minimas: minimas,
    vendas_faltam: Math.max(num(r.vendas_faltam, minimas - pagas), 0),
    habilitado: r.habilitado === true,
    comissoes_ganhas: num(r.comissoes_ganhas),
    comissoes_pendentes: num(r.comissoes_pendentes),
    total_pago: num(r.total_pago),
    reservado: num(r.reservado),
    disponivel: num(r.disponivel),
    taxa: num(r.taxa, 0.1),
  };
}

/** 0 → 0 %, 3 de 5 → 60 %, 7 de 5 → 100 %. */
export function progressoVendas(resumo: ResumoLevantamento): number {
  if (resumo.vendas_minimas <= 0) return 100;
  return Math.min(Math.round((resumo.vendas_pagas / resumo.vendas_minimas) * 100), 100);
}

export type EstadoComissao = "cancelada" | "pendente" | "paga" | "disponivel";

export const ROTULO_COMISSAO: Record<EstadoComissao, string> = {
  cancelada: "Cancelada",
  pendente: "Por pagar",
  paga: "Paga",
  disponivel: "Disponível",
};

export const COR_COMISSAO: Record<EstadoComissao, string> = {
  cancelada: "text-[#F87171]",
  pendente: "text-[#8A8A8A]",
  paga: "text-[#22C55E]",
  disponivel: "text-[#C9A962]",
};

/** Uma linha de `minhas_comissoes()`: a comissão de uma venda. */
export interface ComissaoLinha {
  sale_id: string;
  referencia: string;
  criada_em: string;
  total: number;
  taxa: number;
  comissao: number;
  estado: EstadoComissao;
  provincia: string | null;
  metodo: string | null;
}

function estadoComissao(bruto: unknown): EstadoComissao {
  return bruto === "cancelada" || bruto === "paga" || bruto === "disponivel"
    ? bruto
    : "pendente";
}

export function normalizarComissoes(bruto: unknown): ComissaoLinha[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((r) => {
    const c = r as Record<string, unknown>;
    return {
      sale_id: String(c.sale_id ?? ""),
      referencia: String(c.referencia ?? "—"),
      criada_em: String(c.criada_em ?? ""),
      total: num(c.total),
      taxa: num(c.taxa),
      comissao: num(c.comissao),
      estado: estadoComissao(c.estado),
      provincia: (c.provincia as string | null) ?? null,
      metodo: (c.metodo as string | null) ?? null,
    };
  });
}

/** Um pedido de levantamento. */
export interface Levantamento {
  id: string;
  referencia: string | null;
  valor: number;
  metodo: MetodoRecebimento;
  estado: EstadoLevantamento;
  solicitado_em: string;
  pago_em: string | null;
  motivo: string | null;
}

/** O mesmo pedido, mas do lado da gestão: com quem pediu e para onde vai. */
export interface LevantamentoEquipa extends Levantamento {
  dados: Record<string, string> | null;
  notas: string | null;
  seller_id: string;
  seller_nome: string;
  seller_ref: string | null;
  seller_phone: string | null;
  provincia: string | null;
}

function metodoRecebimento(bruto: unknown): MetodoRecebimento {
  return bruto === "transferencia" ? "transferencia" : "xpress";
}

function estadoLevantamento(bruto: unknown): EstadoLevantamento {
  return (ESTADOS_LEVANTAMENTO as readonly string[]).includes(String(bruto))
    ? (bruto as EstadoLevantamento)
    : "pendente";
}

function objectoOuNulo(bruto: unknown): Record<string, string> | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const entradas = Object.entries(bruto as Record<string, unknown>);
  if (entradas.length === 0) return null;
  return Object.fromEntries(entradas.map(([k, v]) => [k, v == null ? "" : String(v)]));
}

/** Normaliza `meus_levantamentos()`. */
export function normalizarMeusLevantamentos(bruto: unknown): Levantamento[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((r) => {
    const l = r as Record<string, unknown>;
    return {
      id: String(l.id ?? ""),
      referencia: (l.referencia as string | null) ?? null,
      valor: num(l.valor),
      metodo: metodoRecebimento(l.metodo),
      estado: estadoLevantamento(l.estado),
      solicitado_em: String(l.solicitado_em ?? ""),
      pago_em: (l.pago_em as string | null) ?? null,
      motivo: (l.motivo as string | null) ?? null,
    };
  });
}

/** Normaliza `levantamentos_equipa()`, que devolve um array jsonb. */
export function normalizarLevantamentosEquipa(bruto: unknown): LevantamentoEquipa[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((r) => {
    const l = r as Record<string, unknown>;
    return {
      id: String(l.id ?? ""),
      referencia: (l.referencia as string | null) ?? null,
      valor: num(l.valor),
      metodo: metodoRecebimento(l.metodo),
      estado: estadoLevantamento(l.estado),
      solicitado_em: String(l.solicitado_em ?? ""),
      pago_em: (l.pago_em as string | null) ?? null,
      motivo: (l.motivo as string | null) ?? null,
      dados: objectoOuNulo(l.dados),
      notas: (l.notas as string | null) ?? null,
      seller_id: String(l.seller_id ?? ""),
      seller_nome: String(l.seller_nome ?? "Colaborador"),
      seller_ref: (l.seller_ref as string | null) ?? null,
      seller_phone: (l.seller_phone as string | null) ?? null,
      provincia: (l.provincia as string | null) ?? null,
    };
  });
}

/** Dados de recebimento guardados no perfil (`dados_recebimento()`). */
export interface DadosRecebimento {
  xpress: Record<string, string> | null;
  banco: Record<string, string> | null;
}

export function normalizarDadosRecebimento(bruto: unknown): DadosRecebimento {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return {
    xpress: objectoOuNulo(r.xpress),
    banco: objectoOuNulo(r.banco),
  };
}

/** Formulário XPRESS. `conta` ou `telefone` chegam — a base aceita qualquer um. */
export interface DadosXpress {
  titular: string;
  telefone: string;
  conta: string;
}

/** Formulário bancário. Titular, banco e conta são obrigatórios na base. */
export interface DadosBanco {
  titular: string;
  banco: string;
  conta: string;
  iban: string;
  agencia: string;
}

export const XPRESS_VAZIO: DadosXpress = { titular: "", telefone: "", conta: "" };
export const BANCO_VAZIO: DadosBanco = { titular: "", banco: "", conta: "", iban: "", agencia: "" };

export function xpressDe(dados: Record<string, string> | null): DadosXpress {
  if (!dados) return { ...XPRESS_VAZIO };
  return {
    titular: dados.titular ?? "",
    telefone: dados.telefone ?? "",
    conta: dados.conta ?? "",
  };
}

export function bancoDe(dados: Record<string, string> | null): DadosBanco {
  if (!dados) return { ...BANCO_VAZIO };
  return {
    titular: dados.titular ?? "",
    banco: dados.banco ?? "",
    conta: dados.conta ?? "",
    iban: dados.iban ?? "",
    agencia: dados.agencia ?? "",
  };
}

/** Devolve a mensagem de erro, ou `null` se estiver tudo bem. */
export function validarXpress(d: DadosXpress): string | null {
  if (!d.titular.trim()) return "Indique o nome do titular da conta XPRESS.";
  if (!d.telefone.trim() && !d.conta.trim()) {
    return "Indique o número XPRESS ou o telefone associado à conta.";
  }
  return null;
}

export function validarBanco(d: DadosBanco): string | null {
  if (!d.titular.trim()) return "Indique o nome do titular da conta bancária.";
  if (!d.banco.trim()) return "Indique o banco.";
  if (!d.conta.trim()) return "Indique o número de conta (ou o IBAN).";
  const iban = d.iban.replace(/\s+/g, "").toUpperCase();
  if (iban && !/^AO\d{23}$/.test(iban) && iban.length < 15) {
    return "O IBAN não parece válido. Confirme os 25 caracteres (AO + 23 dígitos).";
  }
  return null;
}

/** Tira os campos vazios para não guardar lixo no perfil. */
export function limparDados(d: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(d as Record<string, unknown>)
      .map(([k, v]) => [k, String(v ?? "").trim()] as const)
      .filter(([, v]) => v !== "")
  );
}

/**
 * Uma linha legível com o destino do dinheiro — é o que a gestão lê antes de
 * aprovar. Nunca esconde campos: se o colaborador escreveu, aparece.
 */
export function resumoDestino(
  metodo: MetodoRecebimento,
  dados: Record<string, string> | null
): string {
  if (!dados) return "Sem dados de recebimento";
  const campos =
    metodo === "xpress"
      ? (["titular", "telefone", "conta"] as const)
      : (["titular", "banco", "conta", "iban", "agencia"] as const);
  const partes = campos
    .map((campo) => {
      const valor = dados[campo];
      if (!valor) return null;
      const etiqueta = campo.charAt(0).toUpperCase() + campo.slice(1);
      return `${etiqueta}: ${valor}`;
    })
    .filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : "Sem dados de recebimento";
}

/** O próximo passo que a gestão pode dar a partir do estado actual. */
export function accoesDisponiveis(estado: EstadoLevantamento): EstadoLevantamento[] {
  switch (estado) {
    case "pendente":
      return ["aprovado", "rejeitado"];
    case "aprovado":
      return ["em_processamento", "rejeitado"];
    case "em_processamento":
      return ["pago", "rejeitado"];
    default:
      return [];
  }
}

/** «Aprovar», «Marcar como pago»… — o texto do botão. */
export const ROTULO_ACCAO: Record<EstadoLevantamento, string> = {
  pendente: "Voltar a pendente",
  aprovado: "Aprovar",
  em_processamento: "Em processamento",
  pago: "Marcar como pago",
  rejeitado: "Rejeitar",
};
