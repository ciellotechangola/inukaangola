/**
 * Tipos e leituras do colaborador.
 *
 * Toda a informação vem de RPCs (`colaborador_painel`, `colaborador_ficha`,
 * `pesquisar_colaboradores`, `colaboradores_overview`) e não de consultas
 * directas: as regras de quem vê o quê vivem na base de dados, não aqui.
 */

export interface IdentidadeColaborador {
  id: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  referencia: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  job_title: string | null;
  category: string | null;
  hired_at: string | null;
  provincia_id: string | null;
  provincia_nome: string | null;
  provincia_codigo: string | null;
  delegacao_nome: string | null;
  delegacao_telefone: string | null;
}

export interface CartoesColaborador {
  clientes_total: number;
  clientes_ativos: number;
  vendas_count: number;
  vendas_valor: number;
  comissao_total: number;
  comissao_paga: number;
  comissao_pendente: number;
  meta_valor: number;
  meta_pct: number;
  meta_origem: "individual" | "provincia" | null;
  posicao: number | null;
  equipa: number | null;
}

export interface VendaHistorico {
  id: string;
  reference: string;
  total_amount: number;
  status: "completed" | "cancelled";
  created_at: string;
  comissao: number;
}

export interface ClienteHistorico {
  full_name: string;
  phone: string | null;
  is_active: boolean;
  assigned_at: string;
}

export interface PagamentoHistorico {
  id: string;
  amount: number;
  paid_at: string;
  method: string | null;
  notes: string | null;
}

export interface AlertaColaborador {
  tipo: string;
  texto: string;
}

export interface PainelColaborador {
  identidade: IdentidadeColaborador;
  cartoes: CartoesColaborador;
  series: { meses: string[]; vendas: number[]; comissoes: number[] };
  historico: {
    vendas: VendaHistorico[];
    clientes: ClienteHistorico[];
    pagamentos: PagamentoHistorico[];
  };
  alertas: AlertaColaborador[];
}

export interface FichaColaborador extends IdentidadeColaborador {
  bi_number: string | null;
  birth_date: string | null;
  address: string | null;
  municipio: string | null;
  commission_rate: number;
  manager_id: string | null;
  manager_name: string | null;
  region: string | null;
  code: string | null;
}

export interface ColaboradorPesquisa {
  id: string;
  nome: string;
  referencia: string | null;
  avatar_url: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  provincia_id: string | null;
  provincia: string | null;
  provincia_codigo: string | null;
  municipio: string | null;
  bi_number: string | null;
  job_title: string | null;
  category: string | null;
  commission_rate: number;
  clientes: number;
  clientes_ativos: number;
  vendas_count: number;
  vendas_valor: number;
  comissao_total: number;
  comissao_pendente: number;
  meta_valor: number;
  meta_pct: number;
}

export interface ProvinciaResumo {
  id: string;
  nome: string;
  codigo: string;
  colaboradores: number;
  colaboradores_ativos: number;
  clientes: number;
  vendas_count: number;
  vendas_valor: number;
  comissao: number;
  comissao_pendente: number;
}

export interface RankingItem {
  id: string;
  nome: string;
  referencia: string | null;
  avatar_url: string | null;
  provincia: string | null;
  vendas_valor: number;
  vendas_count: number;
  comissao: number;
}

export interface OverviewColaboradores {
  period_from: string;
  period_to: string;
  scope: "nacional" | "provincial";
  totais: {
    colaboradores: number;
    colaboradores_ativos: number;
    colaboradores_inativos: number;
    clientes: number;
    vendas_count: number;
    vendas_valor: number;
    comissao_gerada: number;
    comissao_paga: number;
    comissao_pendente: number;
    metas_atingidas: number;
    metas_em_curso: number;
  };
  provincias: ProvinciaResumo[];
  ranking: RankingItem[];
}

/** Números vindos do PostgREST chegam como string quando são `numeric`. */
export function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** `2026-11` → `nov.` (rótulo curto para o eixo dos gráficos). */
export function rotuloMes(chave: string): string {
  const [ano, mes] = chave.split("-");
  const data = new Date(Number(ano), Number(mes) - 1, 1);
  return data
    .toLocaleDateString("pt-PT", { month: "short" })
    .replace(".", "")
    .slice(0, 3);
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "IN";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Mensagem legível para um erro devolvido por uma RPC. */
export function mensagemErro(erro: unknown): string {
  // O PostgREST devolve um objecto `{ message, code, details, hint }`, não um
  // `Error`. Sem esta distinção a interface mostrava "[object Object]".
  let texto = "";
  if (typeof erro === "string") {
    texto = erro;
  } else if (erro instanceof Error) {
    texto = erro.message;
  } else if (erro && typeof erro === "object" && "message" in erro) {
    texto = String((erro as { message: unknown }).message ?? "");
  }

  if (texto.includes("Sem permissão")) return "Não tem permissão para ver esta informação.";
  if (texto.includes("Apenas a gestão")) return "Esta acção é reservada à gestão.";
  if (texto.includes("província que gere")) return "Só pode agir na província que gere.";
  if (texto.includes("Não há comissões pendentes")) return "Não há comissões pendentes para pagar.";
  if (texto.includes("Could not find the function") || texto.includes("PGRST202")) {
    return "Falta aplicar a migração de colaboradores no Supabase (PATCH_COLABORADORES.sql).";
  }
  if (texto.includes("Could not find the table") || texto.includes("PGRST205")) {
    return "Falta aplicar a migração de colaboradores no Supabase (PATCH_COLABORADORES.sql).";
  }
  return texto || "Ocorreu um erro inesperado.";
}
