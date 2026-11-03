"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { listarProvincias, type Provincia } from "@/lib/provincias";
import { createClientBrowser } from "@/lib/supabase-browser";
import { guardarCurso, NIVEIS, type CategoriaFormacao, type NivelFormacao } from "@/lib/formacao";

/** Criar um curso novo. As aulas acrescentam-se depois, na página do curso. */
export function NovoCurso({ categorias }: { categorias: CategoriaFormacao[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [nivel, setNivel] = useState<NivelFormacao>("iniciacao");
  const [provincia, setProvincia] = useState("");
  const [capa, setCapa] = useState("");
  const [publicar, setPublicar] = useState(false);
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir() {
    setAberto(true);
    setErro(null);
    if (provincias.length === 0) {
      setProvincias(await listarProvincias(createClientBrowser()));
    }
  }

  async function submeter() {
    if (!titulo.trim() || aGuardar) return;
    setAGuardar(true);
    setErro(null);
    try {
      const id = await guardarCurso(null, {
        title: titulo,
        description: descricao,
        category_id: categoria,
        level: nivel,
        provincia_id: provincia,
        cover_url: capa,
        status: publicar ? "publicado" : "rascunho",
      });
      router.push(`/gerente/formacao/${id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o curso.");
    } finally {
      setAGuardar(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => void abrir()}
        className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
      >
        <Plus className="h-3.5 w-3.5" /> Novo curso
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[#2A2A2A] bg-[#0D0D0D] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#1F1F1F] px-4 py-3">
          <h2 className="text-sm font-medium text-[#F5F5F5]">Novo curso</h2>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="rounded p-1.5 text-[#8A8A8A] hover:bg-[#1A1A1A] hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <Campo rotulo="Título">
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={160}
              className={ENTRADA}
              placeholder="Ex.: Atendimento de excelência"
            />
          </Campo>

          <Campo rotulo="Descrição">
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              className={ENTRADA}
              placeholder="O que o colaborador vai saber fazer no fim."
            />
          </Campo>

          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Categoria">
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className={ENTRADA}
              >
                <option value="">Sem categoria</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Nível">
              <select
                value={nivel}
                onChange={(e) => setNivel(e.target.value as NivelFormacao)}
                className={ENTRADA}
              >
                {NIVEIS.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.label}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <Campo rotulo="Província">
            <select
              value={provincia}
              onChange={(e) => setProvincia(e.target.value)}
              className={ENTRADA}
            >
              <option value="">Nacional — todos os colaboradores</option>
              {provincias.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Imagem de capa (URL)">
            <input
              value={capa}
              onChange={(e) => setCapa(e.target.value)}
              className={ENTRADA}
              placeholder="https://… ou deixe vazio"
            />
          </Campo>

          <label className="flex items-center gap-2 text-[11px] text-[#A3A3A3]">
            <input
              type="checkbox"
              checked={publicar}
              onChange={(e) => setPublicar(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#C9A962]"
            />
            Publicar já (sem aulas, aparece vazio aos colaboradores)
          </label>

          {erro && <p className="text-[11px] text-[#F87171]">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#1F1F1F] px-4 py-3">
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#D4D4D4] hover:border-[#C9A962]/50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submeter()}
            disabled={!titulo.trim() || aGuardar}
            className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] disabled:opacity-40"
          >
            {aGuardar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Criar curso
          </button>
        </div>
      </div>
    </div>
  );
}

const ENTRADA =
  "w-full rounded-lg border border-[#2A2A2A] bg-[#111] px-2.5 py-2 text-xs text-[#E5E5E5] outline-none placeholder:text-[#5F5F5F] focus:border-[#C9A962]";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]">{rotulo}</span>
      {children}
    </label>
  );
}
