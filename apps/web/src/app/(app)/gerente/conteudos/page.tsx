import Link from "next/link";
import { redirect } from "next/navigation";
import { PenLine, Plus } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias, nomeDaProvincia, type Provincia } from "@/lib/provincias";
import TabelaResponsiva, { type ColunaTabela } from "@/components/TabelaResponsiva";
import {
  corEstado,
  dataCurtaConteudo,
  ESTADOS,
  rotuloEstado,
  rotuloTipo,
  TIPOS,
  type EstadoConteudo,
  type TipoConteudo,
} from "@/lib/conteudos";
import { AcoesConteudo } from "./AcoesConteudo";

export const dynamic = "force-dynamic";

interface Linha {
  id: string;
  kind: TipoConteudo;
  title: string;
  status: EstadoConteudo;
  provincia_id: string | null;
  published_at: string | null;
  updated_at: string;
  image_url: string | null;
  project_id: string | null;
  is_pinned: boolean;
}

/**
 * Gestão de conteúdos: tudo o que saiu do estúdio, num sítio só.
 *
 * Os filtros são links (não selects com JavaScript): funcionam no telemóvel,
 * sem hidratação e sem perder o scroll.
 */
export default async function ConteudosPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; estado?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  const { kind, estado } = await searchParams;

  const supabase = await createClientServer();

  let consulta = supabase
    .from("content_items")
    .select("id, kind, title, status, provincia_id, published_at, updated_at, image_url, project_id, is_pinned")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (kind && TIPOS.some((t) => t.key === kind)) consulta = consulta.eq("kind", kind);
  if (estado && ESTADOS.some((e) => e.key === estado)) consulta = consulta.eq("status", estado);

  const [{ data, error }, provincias, { data: todos }] = await Promise.all([
    consulta,
    listarProvincias(supabase),
    supabase.from("content_items").select("status"),
  ]);

  const linhas = (data ?? []) as Linha[];
  const contagens = (todos ?? []) as { status: EstadoConteudo }[];
  const total = contagens.length;
  const publicados = contagens.filter((c) => c.status === "publicado").length;
  const rascunhos = contagens.filter((c) => c.status === "rascunho").length;
  const suspensos = contagens.filter((c) => c.status === "suspenso").length;

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "titulo",
      rotulo: "Conteúdo",
      titulo: true,
      largura: "min-w-[220px]",
      celula: (l) => (
        <div className="flex items-center gap-2.5">
          {l.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.image_url}
              alt=""
              className="h-9 w-9 shrink-0 rounded object-cover"
              loading="lazy"
            />
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[#1F1F1F] text-[9px] text-[#5F5F5F]">
              sem
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm text-[#F5F5F5]">{l.title}</p>
            <p className="text-[10px] text-[#5F5F5F]">
              {l.is_pinned ? "Importante · " : ""}
              {rotuloTipo(l.kind)}
            </p>
          </div>
        </div>
      ),
    },
    {
      chave: "tipo",
      rotulo: "Tipo",
      ocultarNoCartao: true,
      celula: (l) => <span className="text-xs text-[#A3A3A3]">{rotuloTipo(l.kind)}</span>,
    },
    {
      chave: "estado",
      rotulo: "Estado",
      celula: (l) => (
        <span
          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${corEstado(l.status)}`}
        >
          {rotuloEstado(l.status)}
        </span>
      ),
    },
    {
      chave: "provincia",
      rotulo: "Província",
      celula: (l) => (
        <span className="text-xs text-[#A3A3A3]">
          {nomeDaProvincia(provincias as Provincia[], l.provincia_id)}
        </span>
      ),
    },
    {
      chave: "publicado",
      rotulo: "Publicado",
      alinhar: "direita",
      celula: (l) => (
        <span className="text-xs text-[#6F6F6F]">
          {l.published_at ? dataCurtaConteudo(l.published_at) : "—"}
        </span>
      ),
    },
    {
      chave: "acoes",
      rotulo: "Ações",
      alinhar: "direita",
      largura: "min-w-[220px]",
      celula: (l) => <AcoesConteudo id={l.id} status={l.status} projectId={l.project_id} />,
    },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">Gestão</p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Conteúdos</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/gerente/conteudos/novo"
            className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
          >
            <Plus className="h-3.5 w-3.5" /> Novo comunicado
          </Link>
          <Link
            href="/designer"
            className="flex items-center gap-1.5 rounded-lg border border-[#404040] px-3 py-2 text-xs font-semibold text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
          >
            <PenLine className="h-3.5 w-3.5" /> Criar no estúdio
          </Link>
        </div>
      </div>
      <p className="mb-6 text-sm text-[#A3A3A3]">
        Comunicados, testemunhos, promoções e capas de formação produzidos no estúdio.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini rotulo="Total" valor={total} />
        <Mini rotulo="Publicados" valor={publicados} cor="#4ADE80" />
        <Mini rotulo="Rascunhos" valor={rascunhos} />
        <Mini rotulo="Suspensos" valor={suspensos} cor="#F87171" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Filtro href="/gerente/conteudos" ativo={!kind && !estado} etiqueta="Tudo" />
        {TIPOS.map((t) => (
          <Filtro
            key={t.key}
            href={`/gerente/conteudos?kind=${t.key}${estado ? `&estado=${estado}` : ""}`}
            ativo={kind === t.key}
            etiqueta={t.label}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {ESTADOS.map((e) => (
          <Filtro
            key={e.key}
            href={`/gerente/conteudos?estado=${e.key}${kind ? `&kind=${kind}` : ""}`}
            ativo={estado === e.key}
            etiqueta={e.label}
            pequeno
          />
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível ler os conteúdos: {error.message}. Se a mensagem falar de tabela
          inexistente, falta colar <code>supabase/PATCH_CONTEUDOS.sql</code> no SQL Editor.
        </div>
      )}

      <TabelaResponsiva
        itens={linhas}
        colunas={colunas}
        chaveDe={(l) => l.id}
        minimo={860}
        vazio={
          <p className="px-6 py-12 text-center text-sm text-[#6F6F6F]">
            Ainda não há conteúdos. Crie um no estúdio e publique-o.
          </p>
        }
      />
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

function Filtro({
  href,
  ativo,
  etiqueta,
  pequeno,
}: {
  href: string;
  ativo: boolean;
  etiqueta: string;
  pequeno?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border px-2.5 py-1.5 transition ${
        pequeno ? "text-[10px]" : "text-xs"
      } ${
        ativo
          ? "border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
          : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#C9A962]/40 hover:text-[#C9A962]"
      }`}
    >
      {etiqueta}
    </Link>
  );
}
