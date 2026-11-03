"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientBrowser } from "@/lib/supabase-browser";

const ESTADOS = [
  { valor: "novo", rotulo: "Novo" },
  { valor: "em_contacto", rotulo: "Em contacto" },
  { valor: "aprovado", rotulo: "Aprovado" },
  { valor: "recusado", rotulo: "Recusado" },
] as const;

/**
 * Estado de uma candidatura a revendedor.
 *
 * Ao sair de "novo" grava-se quem tratou e quando — sem isso não se sabe se
 * alguém já falou com a pessoa, e duas pessoas da gestão ligam duas vezes.
 */
export default function AcoesCandidatura({
  id,
  estado,
  tratado,
}: {
  id: string;
  estado: string;
  tratado: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function mudar(novo: string) {
    setErro("");
    setOcupado(true);

    const supabase = createClientBrowser();
    const { data: eu } = await supabase.auth.getUser();

    const { error } = await supabase
      .from("reseller_applications")
      .update({
        status: novo,
        handled_by: novo === "novo" ? null : (eu.user?.id ?? null),
        handled_at: novo === "novo" ? null : new Date().toISOString(),
      })
      .eq("id", id);

    setOcupado(false);
    if (error) {
      setErro(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={estado}
        disabled={ocupado}
        onChange={(e) => mudar(e.target.value)}
        className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-1.5 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-50"
      >
        {ESTADOS.map((e) => (
          <option key={e.valor} value={e.valor}>
            {e.rotulo}
          </option>
        ))}
      </select>
      {tratado && <span className="text-[10px] text-[#525252]">já tratada</span>}
      {erro && <span className="max-w-[180px] text-right text-[10px] text-[#F87171]">{erro}</span>}
    </div>
  );
}
