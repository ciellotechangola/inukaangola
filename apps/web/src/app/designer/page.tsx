import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { DesignerGallery } from "@/components/designer/DesignerGallery";
import { createClientServer } from "@/lib/supabase-server";
import { normalizarPaginas } from "@/lib/designer/types";
import type { DesignProjectSummary, DesignTemplate } from "@/lib/designer/types";

export const dynamic = "force-dynamic";

export default async function DesignerPage() {
  const supabase = await createClientServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?redirect=/designer");

  // O estúdio é exclusivo da gestão (requisito de acesso). O proxy já
  // redirecciona, mas a página confirma — defesa em profundidade.
  const { data: perfil } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (perfil?.role !== "manager") redirect("/");

  const [projetosRes, modelosRes] = await Promise.all([
    supabase
      .from("design_projects")
      .select("id, title, format_key, width, height, thumbnail, updated_at, version")
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(60),
    supabase
      .from("design_templates")
      .select("id, title, description, category, format_key, width, height, pages, thumbnail")
      .order("sort_order", { ascending: true })
      .limit(40),
  ]);

  // Se a migração do designer ainda não foi aplicada, a tabela não existe.
  // Mais vale dizer isso do que mostrar uma galeria vazia sem explicação.
  // O PostgREST responde com PGRST205 / "Could not find the table" (não com o
  // clássico "does not exist" do Postgres), por isso os dois padrões contam.
  const mensagemErro = `${projetosRes.error?.message ?? ""} ${modelosRes.error?.message ?? ""}`;
  const esquemaEmFalta =
    /does not exist|relation|could not find the table|schema cache|pgrst20[0-9]/i.test(
      mensagemErro
    );

  const projetos = (projetosRes.data ?? []) as DesignProjectSummary[];
  const modelos = ((modelosRes.data ?? []) as (DesignTemplate & { pages: unknown })[]).map(
    (t) => ({ ...t, pages: normalizarPaginas(t.pages) })
  );

  return (
    <>
      <Header />
      <main className="flex-1">
        {esquemaEmFalta ? (
          <div className="mx-auto max-w-2xl px-4 py-16">
            <h1 className="text-xl font-semibold text-[#F5F5F5]">
              O estúdio de design ainda não está ativo
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#A3A3A3]">
              Falta criar as tabelas do designer na base de dados. Abra o SQL Editor do Supabase e
              execute o ficheiro{" "}
              <code className="text-[#C9A962]">supabase/PATCH_APLICAR_TUDO.sql</code> (é idempotente,
              não apaga nada). Depois recarregue esta página.
            </p>
            <p className="mt-4 rounded-lg border border-[#2A2A2A] bg-[#111] p-3 text-xs text-[#8A8A8A]">
              Detalhe técnico: {mensagemErro.trim()}
            </p>
            <Link
              href="/cliente"
              className="mt-6 inline-block rounded-lg border border-[#333] px-4 py-2 text-sm text-[#E5E5E5] hover:border-[#C9A962]"
            >
              Voltar à minha conta
            </Link>
          </div>
        ) : (
          <DesignerGallery projetos={projetos} modelos={modelos} />
        )}
      </main>
    </>
  );
}
