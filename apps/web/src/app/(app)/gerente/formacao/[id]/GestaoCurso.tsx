"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import type { Provincia } from "@/lib/provincias";
import { ConstrutorQuiz } from "@/components/formacao/ConstrutorQuiz";
import {
  apagarAula,
  carregarMaterial,
  guardarAula,
  guardarCurso,
  NIVEIS,
  TIPOS_AULA,
  type AulaFormacao,
  type CategoriaFormacao,
  type NivelFormacao,
  type TipoAula,
} from "@/lib/formacao";

interface CursoBase {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  level: NivelFormacao;
  status: "rascunho" | "publicado" | "suspenso" | "arquivado";
  provincia_id: string | null;
  cover_url: string | null;
  duration_min: number;
}

const ENTRADA =
  "w-full rounded-lg border border-[#2A2A2A] bg-[#111] px-2.5 py-2 text-xs text-[#E5E5E5] outline-none placeholder:text-[#5F5F5F] focus:border-[#C9A962]";

export function GestaoCurso({
  curso,
  aulasIniciais,
  categorias,
  provincias,
}: {
  curso: CursoBase;
  aulasIniciais: AulaFormacao[];
  categorias: CategoriaFormacao[];
  provincias: Provincia[];
}) {
  const router = useRouter();

  const [form, setForm] = useState(curso);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [aulas, setAulas] = useState(aulasIniciais);
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [aCarregarCapa, setACarregarCapa] = useState(false);

  function campo<K extends keyof CursoBase>(chave: K, valor: CursoBase[K]) {
    setForm((f) => ({ ...f, [chave]: valor }));
  }

  async function salvar() {
    setAGuardar(true);
    setErro(null);
    setOk(null);
    try {
      await guardarCurso(curso.id, {
        title: form.title,
        description: form.description,
        category_id: form.category_id,
        level: form.level,
        status: form.status,
        provincia_id: form.provincia_id,
        cover_url: form.cover_url,
        duration_min: Number(form.duration_min) || 0,
      });
      setOk("Curso guardado.");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAGuardar(false);
    }
  }

  async function mover(aula: AulaFormacao, direcao: -1 | 1) {
    const indice = aulas.findIndex((a) => a.id === aula.id);
    const destino = indice + direcao;
    if (destino < 0 || destino >= aulas.length) return;

    const lista = [...aulas];
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    setAulas(lista);

    // Grava a nova ordem (0..n) — é o que a área do colaborador lê.
    await Promise.all(
      lista.map((a, i) => guardarAula(curso.id, a.id, { ...a, sort_order: i }))
    );
    router.refresh();
  }

  async function remover(aula: AulaFormacao) {
    if (!window.confirm(`Apagar a aula “${aula.title}”?`)) return;
    try {
      await apagarAula(aula.id);
      setAulas((lista) => lista.filter((a) => a.id !== aula.id));
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a aula.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-medium text-[#F5F5F5]">Dados do curso</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Título
            </span>
            <input
              value={form.title}
              onChange={(e) => campo("title", e.target.value)}
              className={ENTRADA}
            />
          </label>

          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Descrição
            </span>
            <textarea
              value={form.description ?? ""}
              onChange={(e) => campo("description", e.target.value)}
              rows={3}
              className={ENTRADA}
            />
          </label>

          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Categoria
            </span>
            <select
              value={form.category_id ?? ""}
              onChange={(e) => campo("category_id", e.target.value || null)}
              className={ENTRADA}
            >
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Nível
            </span>
            <select
              value={form.level}
              onChange={(e) => campo("level", e.target.value as NivelFormacao)}
              className={ENTRADA}
            >
              {NIVEIS.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Estado
            </span>
            <select
              value={form.status}
              onChange={(e) => campo("status", e.target.value as CursoBase["status"])}
              className={ENTRADA}
            >
              <option value="rascunho">Rascunho</option>
              <option value="publicado">Publicado</option>
              <option value="suspenso">Suspenso</option>
              <option value="arquivado">Arquivado</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Província
            </span>
            <select
              value={form.provincia_id ?? ""}
              onChange={(e) => campo("provincia_id", e.target.value || null)}
              className={ENTRADA}
            >
              <option value="">Nacional — todos</option>
              {provincias.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Duração (min)
            </span>
            <input
              type="number"
              min={0}
              value={form.duration_min}
              onChange={(e) => campo("duration_min", Number(e.target.value))}
              className={ENTRADA}
            />
          </label>

          <div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
                Imagem de capa
              </span>
              <input
                value={form.cover_url ?? ""}
                onChange={(e) => campo("cover_url", e.target.value)}
                className={ENTRADA}
                placeholder="https://… ou carregue um ficheiro"
              />
            </label>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#C9A962] transition hover:border-[#C9A962]/50">
              {aCarregarCapa ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              {aCarregarCapa ? "A carregar…" : "Carregar capa"}
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp"
                disabled={aCarregarCapa}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setACarregarCapa(true);
                  setErro(null);
                  carregarMaterial(f)
                    .then(({ url }) => campo("cover_url", url))
                    .catch((x) =>
                      setErro(x instanceof Error ? x.message : "Falha ao carregar a capa.")
                    )
                    .finally(() => setACarregarCapa(false));
                }}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={aGuardar || !form.title.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] disabled:opacity-40"
          >
            {aGuardar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Guardar
          </button>
          {ok && <span className="text-[11px] text-[#4ADE80]">{ok}</span>}
          {erro && <span className="text-[11px] text-[#F87171]">{erro}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[#F5F5F5]">
            Aulas <span className="text-[#6F6F6F]">({aulas.length})</span>
          </h2>
          <button
            type="button"
            onClick={() => {
              setNova(true);
              setAberta(null);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-1.5 text-[11px] text-[#D4D4D4] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            <Plus className="h-3 w-3" /> Nova aula
          </button>
        </div>

        {nova && (
          <FormularioAula
            cursoId={curso.id}
            ordem={aulas.length}
            onFechar={() => setNova(false)}
            onGuardado={(aula) => {
              setAulas((lista) => [...lista, aula]);
              setNova(false);
              router.refresh();
            }}
          />
        )}

        <ul className="space-y-2">
          {aulas.map((aula, i) => (
            <li key={aula.id} className="overflow-hidden rounded-lg border border-[#262626]">
              <div className="flex items-center gap-2 bg-[#141414] px-3 py-2">
                <button
                  type="button"
                  onClick={() => setAberta(aberta === aula.id ? null : aula.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={aberta === aula.id}
                >
                  <span className="block text-[10px] uppercase tracking-wider text-[#5F5F5F]">
                    Aula {i + 1} · {aula.kind}
                  </span>
                  <span className="block truncate text-xs text-[#E5E5E5]">{aula.title}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void mover(aula, -1)}
                  disabled={i === 0}
                  className="p-1 text-[#6F6F6F] hover:text-[#C9A962] disabled:opacity-25"
                  aria-label="Subir"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void mover(aula, 1)}
                  disabled={i === aulas.length - 1}
                  className="p-1 text-[#6F6F6F] hover:text-[#C9A962] disabled:opacity-25"
                  aria-label="Descer"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void remover(aula)}
                  className="p-1 text-[#6F6F6F] hover:text-[#F87171]"
                  aria-label="Apagar aula"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[#5F5F5F] transition ${
                    aberta === aula.id ? "rotate-180" : ""
                  }`}
                />
              </div>

              {aberta === aula.id && (
                <FormularioAula
                  cursoId={curso.id}
                  ordem={i}
                  aula={aula}
                  onFechar={() => setAberta(null)}
                  onGuardado={(atualizada) => {
                    setAulas((lista) =>
                      lista.map((a) => (a.id === atualizada.id ? atualizada : a))
                    );
                    setAberta(null);
                    router.refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ul>

        {aulas.length === 0 && !nova && (
          <p className="px-3 py-6 text-center text-xs text-[#6F6F6F]">
            Sem aulas. Acrescente a primeira para o curso ter conteúdo.
          </p>
        )}
      </section>
    </div>
  );
}

function FormularioAula({
  cursoId,
  ordem,
  aula,
  onFechar,
  onGuardado,
}: {
  cursoId: string;
  ordem: number;
  aula?: AulaFormacao;
  onFechar: () => void;
  onGuardado: (aula: AulaFormacao) => void;
}) {
  const [titulo, setTitulo] = useState(aula?.title ?? "");
  const [resumo, setResumo] = useState(aula?.summary ?? "");
  const [corpo, setCorpo] = useState(aula?.body ?? "");
  const [tipo, setTipo] = useState<TipoAula>(aula?.kind ?? "texto");
  const [url, setUrl] = useState(aula?.video_url ?? aula?.file_path ?? "");
  const [nomeFicheiro, setNomeFicheiro] = useState(aula?.file_name ?? "");
  const [duracao, setDuracao] = useState(aula?.duration_min ?? 0);
  const [aGuardar, setAGuardar] = useState(false);
  const [aCarregar, setACarregar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar(ficheiro: File) {
    setACarregar(true);
    setErro(null);
    try {
      const { url: publico, nome } = await carregarMaterial(ficheiro);
      setUrl(publico);
      setNomeFicheiro(nome);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o ficheiro.");
    } finally {
      setACarregar(false);
    }
  }

  async function salvar() {
    if (!titulo.trim() || aGuardar) return;
    setAGuardar(true);
    setErro(null);
    try {
      // guardarAula devolve o id real (novo ou o que já existia) — sem ele a
      // aula nova ficava na lista com um id inventado e não voltava a gravar.
      const id = await guardarAula(cursoId, aula?.id ?? null, {
        title: titulo,
        summary: resumo,
        body: corpo,
        kind: tipo,
        video_url: tipo === "video" || tipo === "link" ? url : null,
        file_path: tipo === "pdf" ? url : null,
        file_name: tipo === "pdf" ? nomeFicheiro || (url.split("/").pop() ?? null) : null,
        duration_min: Number(duracao) || 0,
        sort_order: ordem,
      });
      onGuardado({
        id,
        title: titulo,
        summary: resumo || null,
        body: corpo || null,
        kind: tipo,
        video_url: tipo === "video" || tipo === "link" ? url || null : null,
        file_path: tipo === "pdf" ? url || null : null,
        file_name: tipo === "pdf" ? nomeFicheiro || (url.split("/").pop() ?? null) : null,
        duration_min: Number(duracao) || 0,
        concluida: aula?.concluida ?? false,
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar a aula.");
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <div className="border-t border-[#262626] bg-[#111] p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Título da aula
          </span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={ENTRADA} />
        </label>

        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Tipo
          </span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoAula)}
            className={ENTRADA}
          >
            {TIPOS_AULA.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Duração (min)
          </span>
          <input
            type="number"
            min={0}
            value={duracao}
            onChange={(e) => setDuracao(Number(e.target.value))}
            className={ENTRADA}
          />
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Resumo
          </span>
          <input value={resumo} onChange={(e) => setResumo(e.target.value)} className={ENTRADA} />
        </label>

        {tipo === "quiz" ? (
          <div className="sm:col-span-2">
            <ConstrutorQuiz valor={corpo} onChange={setCorpo} />
          </div>
        ) : (
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
              Conteúdo escrito
            </span>
            <textarea
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              rows={4}
              className={ENTRADA}
            />
          </label>
        )}

        {tipo !== "texto" && tipo !== "quiz" && (
          <div className="sm:col-span-2">
            <label>
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">
                {tipo === "pdf" ? "Ligação do documento" : "Ligação do vídeo ou recurso"}
              </span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={ENTRADA}
                placeholder="https://…"
              />
            </label>

            {tipo !== "link" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#C9A962] transition hover:border-[#C9A962]/50">
                  {aCarregar ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {aCarregar ? "A carregar…" : "Carregar ficheiro"}
                  <input
                    type="file"
                    className="hidden"
                    accept={
                      tipo === "video"
                        ? "video/mp4,video/webm,video/ogg"
                        : "application/pdf,.doc,.docx,.ppt,.pptx"
                    }
                    disabled={aCarregar}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void carregar(f);
                    }}
                  />
                </label>
                {nomeFicheiro && (
                  <span className="max-w-[240px] truncate text-[10px] text-[#8A8A8A]">
                    {nomeFicheiro}
                  </span>
                )}
                <span className="text-[10px] text-[#5F5F5F]">ou cole uma ligação · até 25 MB</span>
              </div>
            )}
          </div>
        )}
      </div>

      {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-[#333] px-3 py-1.5 text-[11px] text-[#A3A3A3]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={!titulo.trim() || aGuardar}
          className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-semibold text-[#0A0A0A] disabled:opacity-40"
        >
          {aGuardar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Guardar aula
        </button>
      </div>
    </div>
  );
}
