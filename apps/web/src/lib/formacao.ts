/**
 * Formação INUKA — tipos e chamadas.
 *
 * A leitura passa pelas funções `formacao_*` (uma chamada por ecrã, com o
 * progresso de quem está a ver). A escrita de cursos é direta à tabela, com
 * RLS de gestor; o progresso é escrito pela função, que também fecha o curso.
 */

import { createClientBrowser } from "@/lib/supabase-browser";

export type NivelFormacao = "iniciacao" | "intermedio" | "avancado";

export const NIVEIS: { key: NivelFormacao; label: string }[] = [
  { key: "iniciacao", label: "Iniciação" },
  { key: "intermedio", label: "Intermédio" },
  { key: "avancado", label: "Avançado" },
];

export function rotuloNivel(nivel: string): string {
  return NIVEIS.find((n) => n.key === nivel)?.label ?? nivel;
}

export interface CategoriaFormacao {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

export interface CursoFormacao {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  level: NivelFormacao;
  status: string;
  duration_min: number;
  category_id: string | null;
  categoria: string | null;
  categoria_slug: string | null;
  provincia_nome: string | null;
  aulas: number | string;
  concluidas: number | string;
  inscrito: boolean;
  guardado: boolean;
  publicado: string | null;
}

export type TipoAula = "texto" | "video" | "pdf" | "link" | "quiz";

export const TIPOS_AULA: { key: TipoAula; label: string }[] = [
  { key: "texto", label: "Texto" },
  { key: "video", label: "Vídeo" },
  { key: "pdf", label: "Documento (PDF)" },
  { key: "link", label: "Ligação externa" },
  { key: "quiz", label: "Pergunta / atividade" },
];

export interface AulaFormacao {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  kind: TipoAula;
  video_url: string | null;
  file_path: string | null;
  file_name: string | null;
  duration_min: number;
  concluida: boolean;
}

export interface CursoDetalhe {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  level: NivelFormacao;
  status: string;
  duration_min: number;
  project_id: string | null;
  categoria: string | null;
  aulas_total: number;
  aulas_feitas: number;
  percentagem: number;
  inscrito: boolean;
  guardado: boolean;
  content_id: string | null;
  reacoes: number | string;
  comentarios: number | string;
  minha_reacao: string | null;
  aulas: AulaFormacao[];
}

export async function listarCursos(categoria?: string | null): Promise<CursoFormacao[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("formacao_cursos", {
    p_categoria: categoria ?? null,
    p_limit: 80,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CursoFormacao[];
}

export async function obterCurso(id: string): Promise<CursoDetalhe> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("formacao_curso", { p_id: id });
  if (error) throw new Error(error.message);
  return data as CursoDetalhe;
}

export interface ResultadoAula {
  concluidas: number;
  total: number;
  percentagem: number;
  curso_concluido: boolean;
}

export async function concluirAula(
  lessonId: string,
  concluida: boolean
): Promise<ResultadoAula> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("formacao_concluir_aula", {
    p_lesson_id: lessonId,
    p_concluida: concluida,
  });
  if (error) throw new Error(error.message);
  return data as ResultadoAula;
}

// ---------------------------------------------------------------------------
// Guardar para estudar depois
// ---------------------------------------------------------------------------

/**
 * Marca ou desmarca um curso como «guardado».
 *
 * `user_id` tem `DEFAULT auth.uid()` e a política exige `user_id = auth.uid()`,
 * por isso a linha nunca pode apontar para outra pessoa — o id do utilizador
 * não vem do cliente. Repetir a marcação não é erro: é o mesmo estado.
 */
export async function alternarGuardado(cursoId: string, guardar: boolean): Promise<void> {
  const supabase = createClientBrowser();

  if (!guardar) {
    const { error } = await supabase
      .from("training_bookmarks")
      .delete()
      .eq("course_id", cursoId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("training_bookmarks")
    .insert({ course_id: cursoId });
  // 23505 = já estava guardado.
  if (error && error.code !== "23505") throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Gestão
// ---------------------------------------------------------------------------

export interface EntradaCurso {
  title: string;
  description?: string | null;
  category_id?: string | null;
  level?: NivelFormacao;
  status?: "rascunho" | "publicado" | "suspenso" | "arquivado";
  provincia_id?: string | null;
  cover_url?: string | null;
  duration_min?: number;
}

export async function guardarCurso(
  id: string | null,
  entrada: EntradaCurso
): Promise<string> {
  const supabase = createClientBrowser();
  const campos = {
    title: entrada.title.trim(),
    description: entrada.description?.trim() || null,
    category_id: entrada.category_id || null,
    level: entrada.level ?? "iniciacao",
    status: entrada.status ?? "rascunho",
    provincia_id: entrada.provincia_id || null,
    cover_url: entrada.cover_url?.trim() || null,
    duration_min: entrada.duration_min ?? 0,
  };

  if (id) {
    const { error } = await supabase.from("training_courses").update(campos).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  const { data, error } = await supabase
    .from("training_courses")
    .insert(campos)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function apagarCurso(id: string): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.from("training_courses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface EntradaAula {
  title: string;
  summary?: string | null;
  body?: string | null;
  kind?: TipoAula;
  video_url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  duration_min?: number;
  sort_order?: number;
}

export async function guardarAula(
  cursoId: string,
  id: string | null,
  entrada: EntradaAula
): Promise<string> {
  const supabase = createClientBrowser();
  const campos = {
    course_id: cursoId,
    title: entrada.title.trim(),
    summary: entrada.summary?.trim() || null,
    body: entrada.body?.trim() || null,
    kind: entrada.kind ?? "texto",
    video_url: entrada.video_url?.trim() || null,
    file_path: entrada.file_path?.trim() || null,
    file_name: entrada.file_name?.trim() || null,
    duration_min: entrada.duration_min ?? 0,
    sort_order: entrada.sort_order ?? 0,
  };

  if (id) {
    const { error } = await supabase.from("training_lessons").update(campos).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  const { data, error } = await supabase
    .from("training_lessons")
    .insert(campos)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function apagarAula(id: string): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.from("training_lessons").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Limite do material de apoio. O bucket aceita mais, mas 25 MB cobre vídeo curto e PDF. */
export const LIMITE_MATERIAL = 25 * 1024 * 1024;

/**
 * Carrega um ficheiro de apoio (PDF, vídeo, apresentação) para `content-media`.
 *
 * O bucket é público na leitura porque o colaborador abre o material por
 * ligação direta; a escrita continua restrita ao gestor pela política de
 * Storage. Devolve o URL público e o nome original, para a lista de aulas
 * mostrar o nome do ficheiro em vez do caminho.
 */
export async function carregarMaterial(
  ficheiro: File
): Promise<{ url: string; nome: string }> {
  if (ficheiro.size > LIMITE_MATERIAL) {
    throw new Error("O ficheiro tem mais de 25 MB. Comprima-o antes de carregar.");
  }

  const supabase = createClientBrowser();
  const extensao = ficheiro.name.split(".").pop()?.toLowerCase() || "bin";
  const caminho = `formacao/${crypto.randomUUID()}.${extensao}`;

  const { error } = await supabase.storage.from("content-media").upload(caminho, ficheiro, {
    upsert: false,
    contentType: ficheiro.type || undefined,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("content-media").getPublicUrl(caminho);
  return { url: data.publicUrl, nome: ficheiro.name };
}

export interface EstatisticaCurso {
  course_id: string;
  titulo: string;
  status: string;
  aulas: number | string;
  inscritos: number | string;
  concluidos: number | string;
  media_pct: number | string;
}

export async function estatisticasFormacao(): Promise<EstatisticaCurso[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("formacao_estatisticas", {
    p_course_id: null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EstatisticaCurso[];
}
