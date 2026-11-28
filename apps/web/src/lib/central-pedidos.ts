/**
 * A CENTRAL DE PEDIDOS DA GESTÃO — os tipos que os dois lados partilham.
 *
 * O gerente recebe quatro coisas diferentes, que sempre viveram em quatro
 * ecrãs diferentes: encomendas de produtos, conversas à espera de resposta,
 * candidaturas de revendedores e candidaturas de colaboradores. Aqui estão as
 * quatro à mesma mesa, com um formato comum — o que muda é a origem, não a
 * maneira de as tratar.
 *
 * Este ficheiro é **só** tipos e rótulos: pode ser importado pelo browser sem
 * arrastar o cliente de servidor. Quem vai buscar os dados é
 * `central-pedidos-server.ts`.
 */

export type TipoCentral = "produtos" | "mensagens" | "revendedores" | "colaboradores";

export interface LinhaProduto {
  nome: string;
  quantidade: number;
  preco: number;
}

/** Um passo do percurso de um pedido: quem, quando, o que mudou. */
export interface EventoHistorico {
  em: string;
  estado: string;
  por: string | null;
  nota: string | null;
}

export interface PedidoProduto {
  /** `site` = encomenda de cliente final; `grosso` = pedido de revendedor. */
  origem: "site" | "grosso";
  id: string;
  referencia: string;
  estado: string;
  valor: number;
  unidades: number | null;
  criadoEm: string;
  cliente: string;
  telefone: string | null;
  provincia: string | null;
  mensagem: string | null;
  resposta: string | null;
  itens: LinhaProduto[];
  historico: EventoHistorico[];
}

export interface PedidoMensagem {
  id: string;
  titulo: string;
  de: string;
  papel: string | null;
  ultima: string;
  quando: string;
  naoLidas: number;
}

export interface SolicitacaoRevendedor {
  id: string;
  tipo: "pessoa" | "empresa";
  nome: string;
  telefone: string;
  email: string | null;
  nif: string | null;
  provincia: string | null;
  mensagem: string | null;
  estado: string;
  resposta: string | null;
  criadoEm: string;
  tratadoEm: string | null;
  tratadoPor: string | null;
}

export interface SolicitacaoColaborador {
  id: string;
  nome: string;
  telefone: string;
  provincia: string | null;
  mensagem: string | null;
  origem: string | null;
  estado: string;
  criadoEm: string;
  tratadoEm: string | null;
  tratadoPor: string | null;
}

export interface Central {
  produtos: PedidoProduto[];
  mensagens: PedidoMensagem[];
  revendedores: SolicitacaoRevendedor[];
  colaboradores: SolicitacaoColaborador[];
  /** O que não se conseguiu ler (migração em falta, tabela ausente…). */
  avisos: string[];
}

export interface OpcaoEstado {
  valor: string;
  rotulo: string;
}

/**
 * Estados por tipo de pedido. São os da base, com o nome que a gestão usa —
 * não se inventa um estado que a tabela não conheça.
 */
export const ESTADOS_ENCOMENDA: OpcaoEstado[] = [
  { valor: "pending", rotulo: "Pendente" },
  { valor: "confirmed", rotulo: "Confirmada" },
  { valor: "preparing", rotulo: "Em preparação" },
  { valor: "ready_pickup", rotulo: "Pronta para levantamento" },
  { valor: "in_delivery", rotulo: "Em entrega" },
  { valor: "completed", rotulo: "Concluída" },
  { valor: "cancelled", rotulo: "Cancelada" },
];

export const ESTADOS_GROSSO: OpcaoEstado[] = [
  { valor: "novo", rotulo: "Pendente" },
  { valor: "em_analise", rotulo: "Em análise" },
  { valor: "cotado", rotulo: "Respondido (cotado)" },
  { valor: "aprovado", rotulo: "Aprovado" },
  { valor: "enviado", rotulo: "Enviado" },
  { valor: "entregue", rotulo: "Entregue" },
  { valor: "cancelado", rotulo: "Rejeitado" },
];

export const ESTADOS_CANDIDATURA: OpcaoEstado[] = [
  { valor: "novo", rotulo: "Pendente" },
  { valor: "em_contacto", rotulo: "Em análise" },
  { valor: "aprovado", rotulo: "Aprovado" },
  { valor: "recusado", rotulo: "Rejeitado" },
];

/** A cor de cada estado, igual à que o resto da gestão usa. */
export function corEstado(estado: string): string {
  switch (estado) {
    case "novo":
    case "pending":
      return "bg-[#2A2410] text-[#E3D5A7]";
    case "em_contacto":
    case "em_analise":
    case "confirmed":
      return "bg-blue-950/60 text-blue-200";
    case "cotado":
    case "preparing":
      return "bg-indigo-950/60 text-indigo-200";
    case "aprovado":
    case "ready_pickup":
      return "bg-emerald-950/60 text-emerald-200";
    case "enviado":
    case "in_delivery":
      return "bg-cyan-950/60 text-cyan-200";
    case "entregue":
    case "completed":
      return "bg-green-950/60 text-green-200";
    case "cancelado":
    case "cancelled":
    case "recusado":
      return "bg-red-950/60 text-red-200";
    default:
      return "bg-[#262626] text-[#A3A3A3]";
  }
}

/** O nome do estado no ecrã, sem depender de o chamador saber a tabela. */
export function rotuloEstado(estado: string): string {
  const todas = [...ESTADOS_ENCOMENDA, ...ESTADOS_GROSSO, ...ESTADOS_CANDIDATURA];
  return todas.find((e) => e.valor === estado)?.rotulo ?? estado;
}

/** Está à espera de alguém? É isto que conta no badge de cada categoria. */
export function estaPendente(tipo: TipoCentral, estado: string): boolean {
  if (tipo === "mensagens") return true;
  if (tipo === "produtos") return estado === "pending" || estado === "novo" || estado === "em_analise";
  return estado === "novo";
}
