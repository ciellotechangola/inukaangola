import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, TrendingUp } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { CartaoCurso } from "@/components/formacao/CartaoCurso";
import { Slider } from "@/components/formacao/Slider";
import type { CategoriaFormacao, CursoFormacao } from "@/lib/formacao";

export const dynamic = "force-dynamic";

/**
 * Área de formação do colaborador.
 *
 * A ordem responde ao que interessa a quem entra: primeiro o que ficou a meio,
 * depois o que é novo, depois o catálogo por área.
 */
export default async function FormacaoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const [{ data: cursosData, error }, { data: cats }] = await Promise.all([
    supabase.rpc("formacao_cursos", { p_categoria: null, p_limit: 80 }),
    supabase
      .from("training_categories")
      .select("id, name, slug, description, icon, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const cursos = (cursosData ?? []) as CursoFormacao[];
  const categorias = (cats ?? []) as CategoriaFormacao[];

  const emCurso = cursos.filter((c) => {
    const total = Number(c.aulas) || 0;
    const feitas = Number(c.concluidas) || 0;
    return c.inscrito && (total === 0 || feitas < total);
  });
  const concluidos = cursos.filter((c) => {
    const total = Number(c.aulas) || 0;
    return total > 0 && Number(c.concluidas) >= total;
  });
  // Guardados pelo próprio colaborador (tabela `training_bookmarks`).
  const guardados = cursos.filter((c) => c.guardado);
  // Recomendados = ainda não começados. Não há algoritmo: é o que está
  // publicado e ficou para trás, do mais recente para o mais antigo.
  const recomendados = cursos
    .filter((c) => !c.inscrito && Number(c.concluidas) === 0)
    .slice(0, 12);

  const porCategoria = categorias
    .map((cat) => ({
      cat,
      lista: cursos.filter((c) => c.category_id === cat.id),
    }))
    .filter((g) => g.lista.length > 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Área de colaborador
      </p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Formação INUKA</h1>
        <nav className="flex gap-2 text-xs">
          <Link
            href="/vendedor/comunicados"
            className="rounded-lg border border-[#333] px-3 py-1.5 text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            Feed Inuka
          </Link>
          <Link
            href="/vendedor/formacao"
            className="rounded-lg border border-[#C9A962] px-3 py-1.5 text-[#C9A962]"
          >
            Formação
          </Link>
        </nav>
      </div>
      <p className="mb-6 text-sm text-[#A3A3A3]">
        Conhecer o produto, saber apresentar benefícios e construir relações que duram.
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Mini rotulo="Cursos disponíveis" valor={cursos.length} />
        <Mini rotulo="Em andamento" valor={emCurso.length} cor="#E3D5A7" />
        <Mini rotulo="Concluídos" valor={concluidos.length} cor="#4ADE80" />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar a formação: {error.message}. Se falar de tabela inexistente,
          falta colar <code>supabase/PATCH_CONTEUDOS.sql</code> no SQL Editor.
        </div>
      )}

      {!error && cursos.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <GraduationCap className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há formações publicadas.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            Quando a gestão publicar um curso, ele aparece aqui com as aulas e o seu progresso.
          </p>
        </div>
      )}

      {emCurso.length > 0 && (
        <Slider titulo="Continuar a aprender" descricao="Cursos que já começou">
          {emCurso.map((c) => (
            <CartaoCurso key={c.id} curso={c} />
          ))}
        </Slider>
      )}

      {guardados.length > 0 && (
        <Slider titulo="Guardados para depois" descricao="O que marcou para estudar">
          {guardados.map((c) => (
            <CartaoCurso key={c.id} curso={c} />
          ))}
        </Slider>
      )}

      {cursos.length > 0 && (
        <Slider titulo="Novas formações" descricao="Tudo o que está disponível">
          {cursos.slice(0, 12).map((c) => (
            <CartaoCurso key={c.id} curso={c} />
          ))}
        </Slider>
      )}

      {recomendados.length > 0 && (
        <Slider titulo="Materiais recomendados" descricao="Ainda não começou">
          {recomendados.map((c) => (
            <CartaoCurso key={c.id} curso={c} />
          ))}
        </Slider>
      )}

      {porCategoria.map(({ cat, lista }) => (
        <Slider key={cat.id} titulo={cat.name} descricao={cat.description ?? undefined}>
          {lista.map((c) => (
            <CartaoCurso key={c.id} curso={c} />
          ))}
        </Slider>
      ))}

      {concluidos.length > 0 && (
        <Slider titulo="Concluídos" descricao="Para revisitar quando precisar">
          {concluidos.map((c) => (
            <CartaoCurso key={c.id} curso={c} />
          ))}
        </Slider>
      )}

      {cursos.length > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-[#262626] bg-[#141414] p-4">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A962]" />
          <p className="text-xs leading-relaxed text-[#8A8A8A]">
            O progresso é individual e fica guardado na sua conta: pode começar no telemóvel e
            continuar no computador.
          </p>
        </div>
      )}
    </main>
  );
}

function Mini({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="text-lg font-medium" style={{ color: cor ?? "#C9A962" }}>
        {valor}
      </p>
    </div>
  );
}
