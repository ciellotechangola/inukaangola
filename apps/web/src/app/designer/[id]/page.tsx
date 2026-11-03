import { notFound, redirect } from "next/navigation";
import { DesignerEditor } from "@/components/designer/Editor";
import { createClientServer } from "@/lib/supabase-server";
import { normalizarPaginas } from "@/lib/designer/types";
import type { DesignProject, DesignTemplate } from "@/lib/designer/types";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClientServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/designer/${id}`);

  const { data: perfil } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // Segunda barreira: o proxy já bloqueia, mas uma página não deve depender só
  // dele. Sem este teste, um colaborador com sessão abria o editor por URL.
  if (perfil?.role !== "manager") redirect("/");

  const { data, error } = await supabase
    .from("design_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // O RLS esconde projetos de outros donos, por isso "não encontrado" cobre
  // tanto o id inexistente como o acesso indevido — e é o que deve acontecer.
  if (error || !data) notFound();

  const { data: modelos } = await supabase
    .from("design_templates")
    .select("id, title, description, category, format_key, width, height, pages, thumbnail")
    .order("sort_order", { ascending: true })
    .limit(40);

  const projeto = {
    ...(data as DesignProject),
    pages: normalizarPaginas((data as { pages: unknown }).pages),
  };

  const modelosIniciais = ((modelos ?? []) as (DesignTemplate & { pages: unknown })[]).map(
    (t) => ({ ...t, pages: normalizarPaginas(t.pages) })
  );

  return (
    <DesignerEditor
      projeto={projeto}
      modelosIniciais={modelosIniciais}
      podePublicar={perfil.role === "manager"}
    />
  );
}
