/**
 * Tarefas que a gestão atribui a um colaborador.
 *
 * A tabela é `colaborador_tarefas` (migração 0018) e a regra vive no RLS: a
 * gestão da província cria, edita e apaga; o colaborador só muda o estado. Não
 * há RPC para isto de propósito — são operações simples e a política já está na
 * base, por isso uma função a mais só acrescentaria um sítio onde a regra se
 * podia perder.
 */

export type EstadoTarefa = "pendente" | "concluida" | "cancelada";
export type PrioridadeTarefa = "baixa" | "normal" | "alta";

export interface Tarefa {
  id: string;
  seller_id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  prioridade: PrioridadeTarefa;
  estado: EstadoTarefa;
  criado_por: string | null;
  /** Nome de quem atribuiu, vindo do embed `profiles!criado_por`. */
  autor: { full_name: string } | null;
  criado_em: string;
  concluida_em: string | null;
}

export const PRIORIDADES: { key: PrioridadeTarefa; label: string }[] = [
  { key: "baixa", label: "Baixa" },
  { key: "normal", label: "Normal" },
  { key: "alta", label: "Alta" },
];

export function rotuloPrioridade(p: PrioridadeTarefa | string): string {
  return PRIORIDADES.find((x) => x.key === p)?.label ?? String(p);
}

export function corPrioridade(p: PrioridadeTarefa | string): string {
  switch (p) {
    case "alta":
      return "border-[#4A2020] bg-[#2A1010] text-[#F87171]";
    case "baixa":
      return "border-[#2A2A2A] bg-[#141414] text-[#6F6F6F]";
    default:
      return "border-[#4A3F1A] bg-[#2A2410] text-[#E3D5A7]";
  }
}

export function rotuloEstadoTarefa(e: EstadoTarefa | string): string {
  if (e === "concluida") return "Concluída";
  if (e === "cancelada") return "Cancelada";
  return "Por fazer";
}

/** Data curta (dd/mm/aaaa) a partir de um `date` do Postgres. */
export function dataTarefa(iso: string | null | undefined): string {
  if (!iso) return "";
  // `new Date("2026-11-13")` é meia-noite UTC — a oeste de Greenwich isso
  // mostrava o dia anterior. O `date` já é o dia; lê-se como texto.
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "";
  return `${dia}/${mes}/${ano}`;
}

/**
 * Quantos dias faltam (negativo = atrasada). `null` sem prazo ou já feita.
 *
 * Conta dias de calendário, não horas: uma tarefa para hoje não está atrasada
 * às 9 da manhã.
 */
export function diasParaPrazo(t: Pick<Tarefa, "prazo" | "estado">): number | null {
  if (!t.prazo || t.estado !== "pendente") return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${t.prazo.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(alvo.getTime())) return null;
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

/** Texto do prazo, com o aviso que interessa a quem tem a tarefa à frente. */
export function resumoPrazo(t: Tarefa): { texto: string; atrasada: boolean } {
  const dias = diasParaPrazo(t);
  if (dias === null) return { texto: t.prazo ? `Para ${dataTarefa(t.prazo)}` : "Sem prazo", atrasada: false };
  if (dias < 0) return { texto: `Atrasada ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}`, atrasada: true };
  if (dias === 0) return { texto: "Para hoje", atrasada: false };
  if (dias === 1) return { texto: "Para amanhã", atrasada: false };
  return { texto: `Faltam ${dias} dias`, atrasada: false };
}

/** Por fazer primeiro, depois o prazo mais próximo, sem prazo no fim. */
export function ordenarTarefas(lista: Tarefa[]): Tarefa[] {
  const peso = (t: Tarefa) => (t.estado === "pendente" ? 0 : t.estado === "concluida" ? 1 : 2);
  return [...lista].sort((a, b) => {
    const pa = peso(a);
    const pb = peso(b);
    if (pa !== pb) return pa - pb;
    if (!a.prazo && !b.prazo) return a.criado_em < b.criado_em ? 1 : -1;
    if (!a.prazo) return 1;
    if (!b.prazo) return -1;
    return a.prazo < b.prazo ? -1 : 1;
  });
}
