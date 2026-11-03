import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap, Pencil } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import TabelaResponsiva, { type ColunaTabela } from "@/components/TabelaResponsiva";
import { NovoCurso } from "./NovoCurso";
import type { CategoriaFormacao, CursoFormacao, EstatisticaCurso } from "@/lib/formacao";

export const dynamic = "force-dynamic";

interface Linha extends CursoFormacao {
  inscritos: number;
  concluidos: number;
  media_pct: number;
}

const COR: Record<string, string> = {
  publicado: "border-[#1F4D2E] bg-[#0F2A18] text-[#4ADE80]",
  rascunho: "border-[#333] bg-[#161616] text-[#A3A3A3]",
  suspenso: "border-[#4A2020] bg-[#2A1010] text-[#F87171]",
  arquivado: "border-[#2A2A2A] bg-[#141414] text-[#6F6F6F]",
};

export default async function GestaoFormacaoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const [{ data: cursosData, error }, { data: statsData }, { data: cats }] = await Promise.all([
    supabase.rpc("formacao_cursos", { p_categoria: null, p_limit: 120 }),
    supabase.rpc("formacao_estatisticas", { p_course_id: null }),
    supabase
      .from("training_categories")
      .select("id, name, slug, description, icon, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const cursos = (cursosData ?? []) as CursoFormacao[];
  const stats = (statsData ?? []) as EstatisticaCurso[];
  const categorias = (cats ?? []) as CategoriaFormacao[];

  const linhas: Linha[] = cursos.map((c) => {
    const s = stats.find((x) => x.course_id === c.id);
    return {
      ...c,
      inscritos: Number(s?.inscritos ?? 0),
      concluidos: Number(s?.concluidos ?? 0),
      media_pct: Number(s?.media_pct ?? 0),
    };
  });

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "curso",
      rotulo: "Curso",
      titulo: true,
      largura: "min-w-[240px]",
      celula: (l) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-[#F5F5F5]">{l.title}</p>
          <p className="text-[10px] text-[#5F5F5F]">{l.categoria ?? "Sem categoria"}</p>
        </div>
      ),
    },
    {
      chave: "estado",
      rotulo: "Estado",
      celula: (l) => (
        <span
          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${
            COR[l.status] ?? COR.rascunho
          }`}
        >
          {l.status}
        </span>
      ),
    },
    {
      chave: "aulas",
      rotulo: "Aulas",
      alinhar: "direita",
      celula: (l) => <span className="text-xs text-[#A3A3A3]">{Number(l.aulas)}</span>,
    },
    {
      chave: "inscritos",
      rotulo: "Inscritos",
      alinhar: "direita",
      celula: (l) => <span className="text-xs text-[#A3A3A3]">{l.inscritos}</span>,
    },
    {
      chave: "concluidos",
      rotulo: "Concluídos",
      alinhar: "direita",
      celula: (l) => (
        <span className="text-xs text-[#4ADE80]">{l.concluidos}</span>
      ),
    },
    {
      chave: "media",
      rotulo: "Progresso médio",
      alinhar: "direita",
      celula: (l) => <span className="text-xs text-[#C9A962]">{l.media_pct}%</span>,
    },
    {
      chave: "acoes",
      rotulo: "Ações",
      alinhar: "direita",
      celula: (l) => (
        <Link
          href={`/gerente/formacao/${l.id}`}
          className="inline-flex items-center gap-1 rounded border border-[#2A2A2A] px-2 py-1 text-[10px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
        >
          <Pencil className="h-3 w-3" /> Editar
        </Link>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">Gestão</p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Formação INUKA</h1>
        <NovoCurso categorias={categorias} />
      </div>
      <p className="mb-6 text-sm text-[#A3A3A3]">
        Cursos, aulas e materiais de apoio dos colaboradores. Cada curso tem a sua própria área de
        comentários.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar a formação: {error.message}. Se falar de tabela inexistente,
          falta colar <code>supabase/PATCH_CONTEUDOS.sql</code> no SQL Editor.
        </div>
      )}

      {linhas.length === 0 && !error && (
        <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
          <GraduationCap className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há cursos.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            Crie o primeiro curso e acrescente as aulas. Só aparece aos colaboradores depois de
            publicado.
          </p>
        </div>
      )}

      <TabelaResponsiva
        itens={linhas}
        colunas={colunas}
        chaveDe={(l) => l.id}
        minimo={800}
        vazio={null}
      />
    </main>
  );
}
