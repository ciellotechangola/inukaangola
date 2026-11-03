import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { AulasCurso } from "./AulasCurso";
import { GuardarCurso } from "./GuardarCurso";
import { Interacoes } from "@/components/conteudos/Interacoes";
import { rotuloNivel, type CursoDetalhe } from "@/lib/formacao";

export const dynamic = "force-dynamic";

export default async function CursoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) redirect(`/login?redirect=/vendedor/formacao/${id}`);
  if (profile.role !== "seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("formacao_curso", { p_id: id });

  if (error || !data) notFound();
  const curso = data as CursoDetalhe;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/vendedor/formacao"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-[#8A8A8A] transition hover:text-[#C9A962]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Formação INUKA
      </Link>

      <div className="overflow-hidden rounded-2xl border border-[#262626] bg-[#141414]">
        {curso.cover_url && (
          <div className="aspect-[21/9] w-full bg-[#0A0A0A]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={curso.cover_url} alt={curso.title} className="h-full w-full object-cover" />
          </div>
        )}
        <div className="p-5 sm:p-6">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
            {curso.categoria && <span className="text-[#C9A962]">{curso.categoria}</span>}
            <span>· {rotuloNivel(curso.level)}</span>
            {Number(curso.duration_min) > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {curso.duration_min} min
              </span>
            )}
          </div>
          <h1 className="text-2xl font-light text-[#F5F5F5] sm:text-3xl">{curso.title}</h1>
          {curso.description && (
            <p className="mt-3 text-sm leading-relaxed text-[#A3A3A3]">{curso.description}</p>
          )}
          <GuardarCurso cursoId={curso.id} guardadoInicial={!!curso.guardado} />
        </div>
      </div>

      <div className="mt-6">
        <AulasCurso
          aulasIniciais={curso.aulas}
          percentagemInicial={Number(curso.percentagem) || 0}
          feitasIniciais={Number(curso.aulas_feitas) || 0}
        />
      </div>

      {curso.content_id && (
        <div className="mt-6 rounded-xl border border-[#262626] bg-[#141414] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
            Dúvidas e comentários
          </p>
          <Interacoes
            itemId={curso.content_id}
            permitirReacoes
            permitirComentarios
            reacoes={curso.reacoes}
            minhaReacao={curso.minha_reacao}
            comentarios={curso.comentarios}
          />
        </div>
      )}
    </main>
  );
}
