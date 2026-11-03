import { createClientBrowser } from "@/lib/supabase-browser";
import { normalizarPaginas, PREFERENCIAS_PADRAO } from "./types";
import type {
  DesignAsset,
  DesignerPreferences,
  DesignPage,
  DesignProject,
  DesignProjectSummary,
  DesignTemplate,
  DesignVersionSummary,
} from "./types";

const BUCKET = "design-assets";

function falhar(error: { message: string } | null): never | void {
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Projetos
// ---------------------------------------------------------------------------

export async function listarProjetos(): Promise<DesignProjectSummary[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase
    .from("design_projects")
    .select("id, title, format_key, width, height, thumbnail, updated_at, version")
    .eq("is_archived", false)
    .order("updated_at", { ascending: false });
  falhar(error);
  return (data ?? []) as DesignProjectSummary[];
}

export async function obterProjeto(id: string): Promise<DesignProject | null> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase
    .from("design_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  falhar(error);
  if (!data) return null;

  const row = data as DesignProject & { pages: unknown };
  return { ...row, pages: normalizarPaginas(row.pages) };
}

export async function criarProjeto(input: {
  title: string;
  formatKey: string;
  width: number;
  height: number;
  pages: DesignPage[];
  templateId?: string | null;
}): Promise<DesignProject> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_create", {
    p_title: input.title,
    p_format_key: input.formatKey,
    p_width: input.width,
    p_height: input.height,
    p_pages: input.pages,
    p_template_id: input.templateId ?? null,
  });
  falhar(error);
  const row = data as DesignProject & { pages: unknown };
  return { ...row, pages: normalizarPaginas(row.pages) };
}

export interface ResultadoGuardar {
  conflict: boolean;
  version: number;
  updated_at: string;
  saved_at?: string;
  /** Só presente quando há conflito. */
  pages?: DesignPage[];
  title?: string;
}

export async function guardarProjeto(input: {
  id: string;
  pages: DesignPage[];
  title?: string | null;
  thumbnail?: string | null;
  expectedVersion?: number | null;
}): Promise<ResultadoGuardar> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_save", {
    p_id: input.id,
    p_pages: input.pages,
    p_title: input.title ?? null,
    p_thumbnail: input.thumbnail ?? null,
    p_expected_version: input.expectedVersion ?? null,
  });
  falhar(error);
  const res = data as ResultadoGuardar;
  if (res.conflict && res.pages) res.pages = normalizarPaginas(res.pages);
  return res;
}

export async function duplicarProjeto(id: string): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_duplicate", { p_id: id });
  falhar(error);
  return data as string;
}

export async function apagarProjeto(id: string): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.rpc("design_delete", { p_id: id });
  falhar(error);
}

export async function renomearProjeto(id: string, titulo: string): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.rpc("design_rename", { p_id: id, p_title: titulo });
  falhar(error);
}

export async function publicarModelo(
  projectId: string,
  titulo: string,
  categoria: string
): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_publish_template", {
    p_project_id: projectId,
    p_title: titulo,
    p_category: categoria,
  });
  falhar(error);
  return data as string;
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export async function listarModelos(): Promise<DesignTemplate[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase
    .from("design_templates")
    .select("id, title, description, category, format_key, width, height, pages, thumbnail")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  falhar(error);

  return ((data ?? []) as (DesignTemplate & { pages: unknown })[]).map((t) => ({
    ...t,
    pages: normalizarPaginas(t.pages),
  }));
}

// ---------------------------------------------------------------------------
// Ficheiros
// ---------------------------------------------------------------------------

export async function listarAssets(): Promise<DesignAsset[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase
    .from("design_assets")
    .select("id, name, storage_path, mime_type, size_bytes, width, height, created_at")
    .order("created_at", { ascending: false })
    .limit(60);
  falhar(error);

  const assets = (data ?? []) as DesignAsset[];
  return Promise.all(
    assets.map(async (a) => ({ ...a, url: await urlAssinada(a.storage_path) }))
  );
}

export async function urlAssinada(path: string, segundos = 60 * 60 * 12): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) return "";
  return data?.signedUrl ?? "";
}

export async function renovarUrl(path: string): Promise<string> {
  return urlAssinada(path);
}

/** Dimensões reais do ficheiro, para não deformar a imagem ao inseri-la. */
function medirImagem(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

const MIME_PERMITIDOS = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const TAMANHO_MAXIMO = 8 * 1024 * 1024;

export async function carregarAsset(file: File): Promise<DesignAsset> {
  if (!MIME_PERMITIDOS.includes(file.type)) {
    throw new Error("Formato não suportado. Use PNG, JPG, WEBP, GIF ou SVG.");
  }
  if (file.size > TAMANHO_MAXIMO) {
    throw new Error("O ficheiro excede 8 MB. Comprima a imagem antes de carregar.");
  }

  const supabase = createClientBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Sessão expirada. Volte a entrar.");

  // SVG passa por sanitização antes de chegar ao Storage.
  const ficheiro = await prepararFicheiro(file);
  if (ficheiro.size > TAMANHO_MAXIMO) {
    throw new Error("O ficheiro excede 8 MB. Comprima a imagem antes de carregar.");
  }

  const ext = (ficheiro.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${uid}/${crypto.randomUUID()}.${ext || "png"}`;

  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(path, ficheiro, { contentType: ficheiro.type, upsert: false, cacheControl: "31536000" });
  falhar(upError);

  const dim = await medirImagem(ficheiro);

  const { data, error } = await supabase
    .from("design_assets")
    .insert({
      owner_id: uid,
      name: ficheiro.name.slice(0, 120),
      storage_path: path,
      mime_type: ficheiro.type,
      size_bytes: ficheiro.size,
      width: dim.width || null,
      height: dim.height || null,
    })
    .select("id, name, storage_path, mime_type, size_bytes, width, height, created_at")
    .single();
  falhar(error);

  const asset = data as DesignAsset;
  return { ...asset, url: await urlAssinada(asset.storage_path) };
}

export async function apagarAsset(asset: DesignAsset): Promise<void> {
  const supabase = createClientBrowser();
  await supabase.storage.from(BUCKET).remove([asset.storage_path]);
  const { error } = await supabase.from("design_assets").delete().eq("id", asset.id);
  falhar(error);
}

/**
 * Os URLs assinados caducam. Ao abrir um projeto, renovamos os que apontam para
 * o Storage para as imagens não aparecerem quebradas dias depois.
 */
export async function renovarImagens(pages: DesignPage[]): Promise<DesignPage[]> {
  const caminhos = new Set<string>();
  pages.forEach((p) =>
    p.elements.forEach((el) => {
      if (el.type === "image" && el.storagePath) caminhos.add(el.storagePath);
    })
  );
  if (caminhos.size === 0) return pages;

  const mapa = new Map<string, string>();
  await Promise.all(
    [...caminhos].map(async (c) => {
      const url = await urlAssinada(c);
      if (url) mapa.set(c, url);
    })
  );

  return pages.map((p) => ({
    ...p,
    elements: p.elements.map((el) =>
      el.type === "image" && el.storagePath && mapa.has(el.storagePath)
        ? { ...el, src: mapa.get(el.storagePath)! }
        : el
    ),
  }));
}

// ---------------------------------------------------------------------------
// Histórico de versões
// ---------------------------------------------------------------------------

export async function listarVersoes(projectId: string): Promise<DesignVersionSummary[]> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_versions_list", { p_id: projectId });
  falhar(error);
  return (data ?? []) as DesignVersionSummary[];
}

export async function criarSnapshot(projectId: string, label: string | null): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_snapshot", {
    p_id: projectId,
    p_label: label,
  });
  falhar(error);
  return data as string;
}

export interface ResultadoRestauro {
  version: number;
  title: string;
  pages: DesignPage[];
  updated_at: string;
  restaurado_de: number;
}

export async function restaurarVersao(
  projectId: string,
  versionId: string
): Promise<ResultadoRestauro> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("design_restore_version", {
    p_id: projectId,
    p_version_id: versionId,
  });
  falhar(error);
  const res = data as ResultadoRestauro;
  return { ...res, pages: normalizarPaginas(res.pages) };
}

// ---------------------------------------------------------------------------
// Preferências do utilizador
// ---------------------------------------------------------------------------

export async function obterPreferencias(): Promise<DesignerPreferences> {
  const supabase = createClientBrowser();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ...PREFERENCIAS_PADRAO };

  const { data, error } = await supabase
    .from("designer_preferences")
    .select("last_format_key, last_font, snap_enabled, grid_size")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error || !data) return { ...PREFERENCIAS_PADRAO };
  return data as DesignerPreferences;
}

export async function guardarPreferencias(
  patch: Partial<DesignerPreferences>
): Promise<void> {
  const supabase = createClientBrowser();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  const { error } = await supabase
    .from("designer_preferences")
    .upsert(
      { user_id: auth.user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  falhar(error);
}

// ---------------------------------------------------------------------------
// Sanitização de SVG
// ---------------------------------------------------------------------------

/**
 * Um SVG carregado pelo utilizador é conteúdo executável: pode trazer
 * `<script>`, handlers `on*`, `javascript:` em atributos e `<foreignObject>`
 * com HTML arbitrário. Num `<img>` o browser não executa scripts, mas o
 * ficheiro fica no Storage e é servido por URL assinado — quem o abrir
 * diretamente corre o que lá estiver. Limpamos na entrada, não na saída.
 */
export function sanitizarSvg(texto: string): string {
  let out = texto;

  // Comentários e CDATA podem esconder marcadores.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

  // DTD / entidades (vetor clássico de XXE e de expansão).
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  out = out.replace(/<!ENTITY[\s\S]*?>/gi, "");

  // Elementos executáveis ou que carregam HTML/scripts externos.
  for (const tag of ["script", "foreignObject", "iframe", "object", "embed", "handler", "set"]) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
  }

  // Handlers inline: onload=, onclick=, onbegin=...
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // URLs executáveis ou recursos remotos.
  out = out.replace(/(href|xlink:href|src)\s*=\s*"\s*(javascript|data:text\/html|vbscript)[^"]*"/gi, '$1=""');
  out = out.replace(/(href|xlink:href|src)\s*=\s*'\s*(javascript|data:text\/html|vbscript)[^']*'/gi, "$1=''");
  out = out.replace(/(href|xlink:href)\s*=\s*"\s*https?:[^"]*"/gi, 'href=""');
  out = out.replace(/(href|xlink:href)\s*=\s*'\s*https?:[^']*'/gi, "href=''");

  // `style` com url() remoto também carrega recursos externos.
  out = out.replace(/url\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, "none");

  return out;
}

/** Devolve o ficheiro já limpo quando é SVG; nos restantes formatos não toca. */
async function prepararFicheiro(file: File): Promise<File> {
  if (file.type !== "image/svg+xml") return file;
  try {
    const texto = await file.text();
    const limpo = sanitizarSvg(texto);
    return new File([limpo], file.name, { type: "image/svg+xml" });
  } catch {
    throw new Error("Não foi possível ler o SVG.");
  }
}
