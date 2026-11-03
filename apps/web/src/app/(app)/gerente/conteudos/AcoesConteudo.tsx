"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Loader2, Trash2 } from "lucide-react";
import {
  apagarConteudo,
  duplicarConteudo,
  ESTADOS,
  mudarEstadoConteudo,
  type EstadoConteudo,
} from "@/lib/conteudos";

/** Ações de um conteúdo na listagem de gestão. */
export function AcoesConteudo({
  id,
  status,
  projectId,
}: {
  id: string;
  status: EstadoConteudo;
  projectId: string | null;
}) {
  const router = useRouter();
  const [aProcessar, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function mudar(novo: EstadoConteudo) {
    if (novo === status) return;
    iniciar(async () => {
      setErro(null);
      try {
        await mudarEstadoConteudo(id, novo);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao mudar o estado.");
      }
    });
  }

  function duplicar() {
    iniciar(async () => {
      setErro(null);
      try {
        await duplicarConteudo(id);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao duplicar.");
      }
    });
  }

  function apagar() {
    if (!window.confirm("Apagar este conteúdo? O projeto do designer não é apagado.")) return;
    iniciar(async () => {
      setErro(null);
      try {
        await apagarConteudo(id);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao apagar.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={status}
        onChange={(e) => mudar(e.target.value as EstadoConteudo)}
        disabled={aProcessar}
        aria-label="Estado do conteúdo"
        className="rounded border border-[#2A2A2A] bg-[#111] px-1.5 py-1 text-[10px] text-[#D4D4D4] outline-none focus:border-[#C9A962]"
      >
        {ESTADOS.map((e) => (
          <option key={e.key} value={e.key}>
            {e.label}
          </option>
        ))}
      </select>

      {projectId && (
        <a
          href={`/designer/${projectId}`}
          className="rounded border border-[#2A2A2A] p-1.5 text-[#8A8A8A] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          title="Abrir no estúdio"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <button
        type="button"
        onClick={duplicar}
        disabled={aProcessar}
        className="rounded border border-[#2A2A2A] p-1.5 text-[#8A8A8A] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
        title="Duplicar"
      >
        <Copy className="h-3 w-3" />
      </button>

      <button
        type="button"
        onClick={apagar}
        disabled={aProcessar}
        className="rounded border border-[#2A2A2A] p-1.5 text-[#8A8A8A] transition hover:border-[#4A2020] hover:text-[#F87171]"
        title="Apagar"
      >
        {aProcessar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      </button>

      {erro && <p className="w-full text-[10px] text-[#F87171]">{erro}</p>}
    </div>
  );
}
