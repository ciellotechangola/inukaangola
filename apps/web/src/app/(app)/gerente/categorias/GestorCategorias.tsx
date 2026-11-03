"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";

export interface Categoria {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  produtos: number;
}

function gerarSlug(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function GestorCategorias({ categorias }: { categorias: Categoria[] }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [editarId, setEditarId] = useState<string | null>(null);
  const [editarNome, setEditarNome] = useState("");

  async function criar() {
    setErro("");
    const limpo = nome.trim();
    if (!limpo) {
      setErro("Indique o nome da categoria.");
      return;
    }
    const slug = gerarSlug(limpo);
    if (!slug) {
      setErro("O nome não gera um slug válido.");
      return;
    }
    if (categorias.some((c) => c.slug === slug)) {
      setErro(`Já existe a categoria “${slug}”.`);
      return;
    }

    setOcupado(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.from("categories").insert({
      name: limpo,
      slug,
      sort_order: (categorias.at(-1)?.sort_order ?? 0) + 10,
      is_active: true,
    });
    setOcupado(false);

    if (error) {
      setErro(error.message);
      return;
    }
    setNome("");
    router.refresh();
  }

  async function renomear(id: string) {
    setErro("");
    const limpo = editarNome.trim();
    if (!limpo) {
      setErro("O nome não pode ficar vazio.");
      return;
    }
    setOcupado(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.from("categories").update({ name: limpo }).eq("id", id);
    setOcupado(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setEditarId(null);
    router.refresh();
  }

  async function alternarActiva(c: Categoria) {
    setErro("");
    setOcupado(true);
    const supabase = createClientBrowser();
    const { error } = await supabase
      .from("categories")
      .update({ is_active: !c.is_active })
      .eq("id", c.id);
    setOcupado(false);
    if (error) {
      setErro(error.message);
      return;
    }
    router.refresh();
  }

  async function apagar(c: Categoria) {
    if (c.produtos > 0) {
      setErro(`“${c.name}” tem ${c.produtos} produtos. Desactive em vez de apagar.`);
      return;
    }
    if (!window.confirm(`Apagar a categoria “${c.name}”?`)) return;

    setErro("");
    setOcupado(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.from("categories").delete().eq("id", c.id);
    setOcupado(false);
    if (error) {
      setErro(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border border-[#262626] bg-[#141414] p-4">
        <label className="flex-1 text-xs text-[#A3A3A3]">
          Nova categoria
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Perfumaria Árabe"
            className="mt-1 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </label>
        <button
          onClick={criar}
          disabled={ocupado}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Criar
        </button>
        <p className="w-full text-[11px] text-[#525252]">
          O endereço é gerado a partir do nome (sem acentos). Categorias com produtos não podem ser
          apagadas — desactive.
        </p>
      </div>

      {erro && <p className="mb-4 text-xs text-[#DC2626]">{erro}</p>}

      <div className="tabela-deslizante rounded-xl border border-[#262626]">
        <table className="w-full text-sm">
          <thead className="bg-[#141414] text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
            <tr>
              <th className="px-4 py-3 font-normal">Categoria</th>
              <th className="px-4 py-3 font-normal">Endereço</th>
              <th className="px-4 py-3 text-right font-normal">Produtos</th>
              <th className="px-4 py-3 text-right font-normal">Estado</th>
              <th className="px-4 py-3 text-right font-normal">Acções</th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <tr key={c.id} className="border-t border-[#1F1F1F] bg-[#1A1A1A]">
                <td className="px-4 py-3">
                  {editarId === c.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={editarNome}
                        onChange={(e) => setEditarNome(e.target.value)}
                        className="w-40 rounded-lg border border-[#404040] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
                      />
                      <button
                        onClick={() => renomear(c.id)}
                        aria-label="Guardar"
                        className="rounded border border-[#C9A962] p-1 text-[#C9A962]"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => setEditarId(null)}
                        aria-label="Cancelar"
                        className="rounded border border-[#333] p-1 text-[#8A8A8A]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <span className={c.is_active ? "text-[#F5F5F5]" : "text-[#6F6F6F]"}>{c.name}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-[#6F6F6F]">/{c.slug}</td>
                <td className="px-4 py-3 text-right text-[#A3A3A3]">{c.produtos}</td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      c.is_active
                        ? "bg-[#16A34A]/15 text-[#16A34A]"
                        : "bg-[#262626] text-[#8A8A8A]"
                    }`}
                  >
                    {c.is_active ? "activa" : "inactiva"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditarId(c.id);
                        setEditarNome(c.name);
                      }}
                      className="rounded-lg border border-[#333] px-3 py-1 text-xs text-[#A3A3A3] transition hover:border-[#C9A962] hover:text-[#C9A962]"
                    >
                      Renomear
                    </button>
                    <button
                      onClick={() => alternarActiva(c)}
                      disabled={ocupado}
                      className="rounded-lg border border-[#333] px-3 py-1 text-xs text-[#A3A3A3] transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:opacity-50"
                    >
                      {c.is_active ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      onClick={() => apagar(c)}
                      disabled={ocupado}
                      className="rounded-lg border border-[#333] px-3 py-1 text-xs text-[#8A8A8A] transition hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-50"
                    >
                      Apagar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
