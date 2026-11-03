"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClientBrowser } from "@/lib/supabase-browser";

interface ProvinciaResumo {
  id: string;
  nome: string;
}

/**
 * Atribuição da província a uma pessoa.
 *
 * A alteração passa pela RPC `assign_province` (e não por um UPDATE directo)
 * para que o servidor valide se quem atribui pode gerir aquela província.
 */
export default function ProvinciaSelect({
  userId,
  atual,
  provincias,
  desativado,
}: {
  userId: string;
  atual: string | null;
  provincias: ProvinciaResumo[];
  desativado?: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(atual ?? "");
  const [erro, setErro] = useState("");
  const [aGravar, setAGravar] = useState(false);

  async function mudar(novo: string) {
    const anterior = valor;
    setValor(novo);
    setErro("");
    setAGravar(true);

    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("assign_province", {
      p_user_id: userId,
      p_provincia_id: novo || null,
    });

    setAGravar(false);
    if (error) {
      setValor(anterior);
      setErro(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <select
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        disabled={desativado || aGravar}
        className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-50"
        aria-label="Província"
      >
        <option value="">Nacional</option>
        {provincias.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
      {erro && <p className="mt-1 max-w-[180px] text-[10px] text-[#DC2626]">{erro}</p>}
    </div>
  );
}
