"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { PageThumb } from "@/components/designer/ElementView";
import {
  apagarProjeto,
  criarProjeto,
  duplicarProjeto,
  guardarPreferencias,
  obterPreferencias,
} from "@/lib/designer/api";
import { FORMATS, getFormat } from "@/lib/designer/formats";
import { instanciarTemplate, TEMPLATES } from "@/lib/designer/templates";
import type { DesignProjectSummary, DesignTemplate } from "@/lib/designer/types";

function dataCurta(iso: string): string {
  const d = new Date(iso);
  const agora = Date.now();
  const minutos = Math.round((agora - d.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return `há ${dias} d`;
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

export function DesignerGallery({
  projetos,
  modelos,
}: {
  projetos: DesignProjectSummary[];
  modelos: DesignTemplate[];
}) {
  const router = useRouter();
  const [criarAberto, setCriarAberto] = useState(false);
  const [formato, setFormato] = useState(FORMATS[0].key);
  const [titulo, setTitulo] = useState("");
  const [aCriar, setACriar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const todosModelos = useMemo(() => [...TEMPLATES, ...modelos], [modelos]);

  // O último formato usado é a escolha por omissão da próxima vez.
  useEffect(() => {
    let vivo = true;
    obterPreferencias()
      .then((p) => {
        if (vivo && getFormat(p.last_format_key)) setFormato(p.last_format_key);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const criar = async (opcoes?: { template?: DesignTemplate }) => {
    setACriar(true);
    setErro(null);
    try {
      const tpl = opcoes?.template;
      const f = tpl ? getFormat(tpl.format_key) : getFormat(formato);
      const projeto = await criarProjeto({
        title: titulo.trim() || tpl?.title || "Novo design",
        formatKey: tpl?.format_key ?? formato,
        width: tpl?.width ?? f.width,
        height: tpl?.height ?? f.height,
        pages: tpl ? instanciarTemplate(tpl) : [],
        templateId: tpl && /^[0-9a-f-]{36}$/i.test(tpl.id) ? tpl.id : null,
      });
      void guardarPreferencias({ last_format_key: projeto.format_key }).catch(() => undefined);
      router.push(`/designer/${projeto.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o projeto.");
      setACriar(false);
    }
  };

  const duplicar = async (id: string) => {
    setOcupado(id);
    setErro(null);
    try {
      const novo = await duplicarProjeto(id);
      router.push(`/designer/${novo}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível duplicar.");
      setOcupado(null);
    }
  };

  const apagar = async (id: string) => {
    if (!window.confirm("Apagar este projeto definitivamente?")) return;
    setOcupado(id);
    try {
      await apagarProjeto(id);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar.");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5] sm:text-3xl">
            Estúdio de design
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-[#8A8A8A]">
            Crie publicações, stories e flyers com a identidade INUKA. Os seus projetos ficam
            guardados na sua conta e sincronizam entre dispositivos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCriarAberto(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
        >
          <Plus className="h-4 w-4" /> Criar design
        </button>
      </div>

      {erro && (
        <p className="mt-4 rounded-lg border border-[#4A1D1D] bg-[#2A1414] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}

      {/* Formatos rápidos */}
      <section className="mt-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
          Começar em branco
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFormato(f.key);
                setCriarAberto(true);
              }}
              className="group flex flex-col items-center gap-2 rounded-xl border border-[#232323] bg-[#101010] p-3 transition hover:border-[#C9A962]"
            >
              <div className="flex h-14 items-center justify-center">
                <div
                  className="rounded border border-[#3A3A3A] bg-[#1A1A1A] transition group-hover:border-[#C9A962]/60"
                  style={{
                    width: f.ratio >= 1 ? 48 : Math.round(48 * f.ratio),
                    height: f.ratio >= 1 ? Math.round(48 / f.ratio) : 48,
                  }}
                />
              </div>
              <span className="text-[11px] font-medium text-[#E5E5E5]">{f.label}</span>
              <span className="text-[10px] text-[#5F5F5F]">{f.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Modelos */}
      <section className="mt-10">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#C9A962]" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
            Modelos
          </h2>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {todosModelos.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => void criar({ template: tpl })}
              disabled={aCriar}
              className="group text-left disabled:opacity-60"
            >
              <div className="overflow-hidden rounded-xl border border-[#232323] bg-[#101010] transition group-hover:border-[#C9A962]">
                <PageThumb
                  pagina={tpl.pages[0]}
                  largura={tpl.width}
                  altura={tpl.height}
                  larguraMax={280}
                  className="!w-full"
                />
              </div>
              <p className="mt-2 truncate text-xs font-medium text-[#E5E5E5] group-hover:text-[#C9A962]">
                {tpl.title}
              </p>
              <p className="truncate text-[10px] text-[#5F5F5F]">
                {tpl.width}×{tpl.height} · {tpl.category}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Projetos */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
            Os meus projetos
          </h2>
          <span className="text-[11px] text-[#5F5F5F]">{projetos.length}</span>
        </div>

        {projetos.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-[#232323] py-14 text-center">
            <p className="text-sm text-[#8A8A8A]">Ainda não tem projetos.</p>
            <p className="mt-1 text-xs text-[#5F5F5F]">
              Escolha um formato acima ou comece a partir de um modelo.
            </p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {projetos.map((p) => (
              <div key={p.id} className="group relative">
                <Link href={`/designer/${p.id}`} className="block">
                  <div className="overflow-hidden rounded-xl border border-[#232323] bg-[#101010] transition group-hover:border-[#C9A962]">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbnail}
                        alt={p.title}
                        className="aspect-[4/3] w-full object-cover"
                      />
                    ) : (
                      <div
                        className="grid aspect-[4/3] w-full place-items-center bg-[#151515] text-[10px] text-[#5F5F5F]"
                        style={{ aspectRatio: `${p.width} / ${p.height}` }}
                      >
                        {p.width}×{p.height}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-xs font-medium text-[#E5E5E5] group-hover:text-[#C9A962]">
                    {p.title}
                  </p>
                  <p className="text-[10px] text-[#5F5F5F]">
                    {dataCurta(p.updated_at)} · v{p.version}
                  </p>
                </Link>

                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => void duplicar(p.id)}
                    disabled={ocupado === p.id}
                    className="rounded-lg bg-black/70 p-1.5 text-[#E5E5E5] backdrop-blur hover:text-[#C9A962]"
                    aria-label={`Duplicar ${p.title}`}
                  >
                    {ocupado === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void apagar(p.id)}
                    disabled={ocupado === p.id}
                    className="rounded-lg bg-black/70 p-1.5 text-[#E5E5E5] backdrop-blur hover:text-[#F87171]"
                    aria-label={`Apagar ${p.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Diálogo de criação */}
      {criarAberto && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => !aCriar && setCriarAberto(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-[#242424] bg-[#101010] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#1F1F1F] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#F5F5F5]">Novo design</h2>
              <button
                type="button"
                onClick={() => setCriarAberto(false)}
                className="flex h-8 w-8 items-center justify-center rounded text-[#A3A3A3] hover:bg-white/5"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#8A8A8A]">
                  Nome
                </span>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex.: Promoção de setembro"
                  className="mt-1.5 w-full rounded-lg border border-[#2A2A2A] bg-[#131313] px-3 py-2.5 text-sm text-[#F5F5F5] outline-none focus:border-[#C9A962]"
                />
              </label>

              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#8A8A8A]">
                  Formato
                </span>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {FORMATS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFormato(f.key)}
                      className={`rounded-lg border px-2 py-2 text-[11px] transition ${
                        formato === f.key
                          ? "border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
                          : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#444]"
                      }`}
                    >
                      {f.label}
                      <span className="mt-0.5 block text-[9px] text-[#5F5F5F]">{f.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void criar()}
                disabled={aCriar}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-60"
              >
                {aCriar ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> A criar...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Criar e abrir
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
