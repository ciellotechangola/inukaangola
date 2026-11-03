"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { alternarGuardado } from "@/lib/formacao";

/**
 * «Guardar para estudar depois».
 *
 * O estado é otimista (o botão responde de imediato) mas volta atrás se o
 * servidor recusar — sem isso o colaborador ficava a achar que tinha guardado
 * um curso que não está em lado nenhum.
 */
export function GuardarCurso({
  cursoId,
  guardadoInicial,
}: {
  cursoId: string;
  guardadoInicial: boolean;
}) {
  const [guardado, setGuardado] = useState(guardadoInicial);
  const [aProcessar, setAProcessar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    if (aProcessar) return;
    const novo = !guardado;
    setGuardado(novo);
    setAProcessar(true);
    setErro(null);
    try {
      await alternarGuardado(cursoId, novo);
    } catch (e) {
      setGuardado(!novo);
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAProcessar(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void alternar()}
        disabled={aProcessar}
        aria-pressed={guardado}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition disabled:opacity-60 ${
          guardado
            ? "border-[#C9A962]/60 bg-[#1A1710] text-[#C9A962]"
            : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
        }`}
      >
        {aProcessar ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : guardado ? (
          <BookmarkCheck className="h-3.5 w-3.5" />
        ) : (
          <Bookmark className="h-3.5 w-3.5" />
        )}
        {guardado ? "Guardado para estudar depois" : "Guardar para estudar depois"}
      </button>
      {erro && <p className="mt-1.5 text-[11px] text-[#F87171]">{erro}</p>}
    </div>
  );
}
