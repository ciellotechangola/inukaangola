/**
 * Conteúdos publicados (comunicados, testemunhos, promoções) e formação.
 *
 * Este módulo é a única definição dos rótulos e do formato dos dados que o
 * estúdio escreve e as áreas de cliente/colaborador leem. Se um rótulo mudar,
 * muda aqui — não em seis páginas.
 */

import { createClientBrowser } from "@/lib/supabase-browser";

export type TipoConteudo = "comunicado" | "testemunho" | "promocao" | "formacao";

export type EstadoConteudo =
  | "rascunho"
  | "em_edicao"
  | "publicado"
  | "agendado"
  | "suspenso"
  | "arquivado";

export interface ConteudoProduto {
  id: string;
  name: string;
  sku: string | null;
  preco: number | string;
  oficial: number | string;
  imagem: string | null;
}

export interface Conteudo {
  id: string;
  kind: TipoConteudo;
  title: string;
  subtitle: string | null;
  body: string | null;
  image_url: string | null;
  status: EstadoConteudo;
  is_pinned: boolean;
  allow_reactions: boolean;
  allow_comments: boolean;
  author_name: string | null;
  author_photo: string | null;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  cta_label: string | null;
  cta_href: string | null;
  metadata: Record<string, unknown>;
  provincia_id: string | null;
  provincia_nome: string | null;
  project_id: string | null;
  reacoes: number | string;
  comentarios: number | string;
  minha_reacao: string | null;
  produtos: ConteudoProduto[];
}

export const TIPOS: { key: TipoConteudo; label: string; descricao: string; destino: string }[] = [
  {
    key: "comunicado",
    label: "Comunicado da gestão",
    descricao: "Aparece no feed dos colaboradores.",
    destino: "/vendedor/comunicados",
  },
  {
    key: "testemunho",
    label: "Testemunho de cliente",
    descricao: "Aparece na área de testemunhos dos clientes.",
    destino: "/cliente/testemunhos",
  },
  {
    key: "promocao",
    label: "Promoção / anúncio",
    descricao: "Aparece nas promoções da loja, com as datas que definir.",
    destino: "/promocoes",
  },
  {
    key: "formacao",
    label: "Formação",
    descricao: "Fica disponível na área de formação dos colaboradores.",
    destino: "/vendedor/formacao",
  },
];

export const ESTADOS: { key: EstadoConteudo; label: string }[] = [
  { key: "rascunho", label: "Rascunho" },
  { key: "em_edicao", label: "Em edição" },
  { key: "publicado", label: "Publicado" },
  { key: "agendado", label: "Agendado" },
  { key: "suspenso", label: "Suspenso" },
  { key: "arquivado", label: "Arquivado" },
];

export function rotuloTipo(kind: TipoConteudo | string): string {
  return TIPOS.find((t) => t.key === kind)?.label ?? String(kind);
}

export function rotuloEstado(estado: EstadoConteudo | string): string {
  return ESTADOS.find((e) => e.key === estado)?.label ?? String(estado);
}

/** Cor do selo de estado — usada na listagem de gestão. */
export function corEstado(estado: EstadoConteudo | string): string {
  switch (estado) {
    case "publicado":
      return "border-[#1F4D2E] bg-[#0F2A18] text-[#4ADE80]";
    case "suspenso":
      return "border-[#4A2020] bg-[#2A1010] text-[#F87171]";
    case "agendado":
      return "border-[#4A3F1A] bg-[#2A2410] text-[#E3D5A7]";
    case "arquivado":
      return "border-[#2A2A2A] bg-[#141414] text-[#6F6F6F]";
    default:
      return "border-[#333] bg-[#161616] text-[#A3A3A3]";
  }
}

export function dataConteudo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" });
}

export function dataCurtaConteudo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Estado temporal de uma promoção, para o cartão da loja. */
export function estadoDaPromocao(c: Pick<Conteudo, "starts_at" | "ends_at">):
  | "breve"
  | "ativa"
  | "terminada" {
  const agora = Date.now();
  if (c.starts_at && new Date(c.starts_at).getTime() > agora) return "breve";
  if (c.ends_at && new Date(c.ends_at).getTime() < agora) return "terminada";
  return "ativa";
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function listarConteudos(
  kind: TipoConteudo | null,
  limite = 40
): Promise<Conteudo[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: kind,
    p_limit: limite,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Conteudo[];
}

export interface Comentario {
  id: string;
  item_id: string;
  user_id: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
  autor?: string | null;
}

export async function listarComentarios(itemId: string): Promise<Comentario[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase
    .from("content_comments")
    .select("id, item_id, user_id, body, is_hidden, created_at")
    .eq("item_id", itemId)
    .order("created_at", { ascending: true })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data ?? []) as Comentario[];
}

// ---------------------------------------------------------------------------
// Interação
// ---------------------------------------------------------------------------

/**
 * Reagir é alternar. Se já existe a mesma reação, remove; se existe outra,
 * troca. A tabela tem UNIQUE(item_id, user_id) — uma pessoa, uma reação.
 */
export async function reagir(itemId: string, reaction: string): Promise<void> {
  const supabase = createClientBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Sessão expirada. Volte a entrar.");

  const { data: atual, error: erroLeitura } = await supabase
    .from("content_reactions")
    .select("id, reaction")
    .eq("item_id", itemId)
    .eq("user_id", uid)
    .maybeSingle();
  if (erroLeitura) throw new Error(erroLeitura.message);

  if (atual && atual.reaction === reaction) {
    const { error } = await supabase.from("content_reactions").delete().eq("id", atual.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("content_reactions")
    .upsert(
      { item_id: itemId, user_id: uid, reaction },
      { onConflict: "item_id,user_id" }
    );
  if (error) throw new Error(error.message);
}

export async function comentar(itemId: string, body: string): Promise<void> {
  const texto = body.trim();
  if (!texto) return;

  const supabase = createClientBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Sessão expirada. Volte a entrar.");

  const { error } = await supabase
    .from("content_comments")
    .insert({ item_id: itemId, user_id: uid, body: texto.slice(0, 2000) });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Publicação (gestor)
// ---------------------------------------------------------------------------

const BUCKET = "content-media";

export interface EntradaPublicacao {
  kind: TipoConteudo;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  status: EstadoConteudo;
  provincia_id?: string | null;
  is_pinned?: boolean;
  allow_reactions?: boolean;
  allow_comments?: boolean;
  author_name?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
  project_id?: string | null;
  produtos?: string[];
  /** Imagem da página atual, em data URL. */
  imagem?: string | null;
}

function dataUrlParaBlob(dataUrl: string): Blob {
  const [cabecalho, base64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(cabecalho)?.[1] ?? "image/jpeg";
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Carrega a imagem da composição para o bucket público e devolve o URL.
 * Público de propósito: a loja mostra promoções a visitantes sem sessão.
 */
export async function carregarImagemConteudo(
  dataUrl: string,
  kind: TipoConteudo
): Promise<{ url: string; path: string }> {
  const supabase = createClientBrowser();
  const blob = dataUrlParaBlob(dataUrl);
  const path = `${kind}/${crypto.randomUUID()}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`Falha ao carregar a imagem: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Publica (ou atualiza) o conteúdo ligado a um projeto.
 *
 * O índice único em `project_id` garante uma publicação por projeto. Aqui
 * procura-se primeiro para decidir entre INSERT e UPDATE — é isto que impede
 * que republicar crie um duplicado na loja.
 */
export async function publicarConteudo(
  entrada: EntradaPublicacao
): Promise<{ id: string; criado: boolean }> {
  const supabase = createClientBrowser();

  let imagem = entrada.imagem ?? null;
  let imagePath: string | null = null;

  if (imagem && imagem.startsWith("data:")) {
    const carregada = await carregarImagemConteudo(imagem, entrada.kind);
    imagem = carregada.url;
    imagePath = carregada.path;
  }

  const campos: Record<string, unknown> = {
    kind: entrada.kind,
    title: entrada.title.trim(),
    subtitle: entrada.subtitle?.trim() || null,
    body: entrada.body?.trim() || null,
    status: entrada.status,
    provincia_id: entrada.provincia_id || null,
    is_pinned: entrada.is_pinned ?? false,
    allow_reactions: entrada.allow_reactions ?? true,
    allow_comments: entrada.allow_comments ?? true,
    author_name: entrada.author_name?.trim() || null,
    starts_at: entrada.starts_at || null,
    ends_at: entrada.ends_at || null,
    cta_label: entrada.cta_label?.trim() || null,
    cta_href: entrada.cta_href?.trim() || null,
  };

  if (imagem) campos.image_url = imagem;
  if (imagePath) campos.image_path = imagePath;

  let id: string;
  let criado = false;

  if (entrada.project_id) {
    const { data: existente } = await supabase
      .from("content_items")
      .select("id, image_path")
      .eq("project_id", entrada.project_id)
      .maybeSingle();

    if (existente?.id) {
      const { error } = await supabase
        .from("content_items")
        .update(campos)
        .eq("id", existente.id);
      if (error) throw new Error(error.message);
      id = existente.id;

      // Substituiu a imagem: o ficheiro antigo deixa de ser servido.
      if (imagePath && existente.image_path && existente.image_path !== imagePath) {
        await supabase.storage.from(BUCKET).remove([existente.image_path]);
      }
    } else {
      const { data, error } = await supabase
        .from("content_items")
        .insert({ ...campos, project_id: entrada.project_id })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = data.id;
      criado = true;
    }
  } else {
    const { data, error } = await supabase
      .from("content_items")
      .insert(campos)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
    criado = true;
  }

  // Produtos anunciados: substitui a lista inteira (é pequena).
  await supabase.from("content_products").delete().eq("item_id", id);
  const produtos = (entrada.produtos ?? []).filter(Boolean);
  if (produtos.length) {
    const { error } = await supabase.from("content_products").insert(
      produtos.map((product_id, i) => ({ item_id: id, product_id, sort_order: i }))
    );
    if (error) throw new Error(error.message);
  }

  return { id, criado };
}

export async function mudarEstadoConteudo(
  id: string,
  status: EstadoConteudo
): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.from("content_items").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function duplicarConteudo(id: string): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("content_duplicate", { p_id: id });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function apagarConteudo(id: string): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.from("content_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
