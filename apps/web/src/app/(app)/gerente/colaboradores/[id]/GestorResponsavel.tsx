"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { mensagemDeErro } from "@/lib/erros";

export interface CandidatoGestor {
  id: string;
  nome: string;
  provincia: string | null;
  nacional: boolean;
  eu: boolean;
}

/**
 * Gestor responsável de um colaborador.
 *
 * A ficha mostrava «Gestor: não definido» e não havia forma de o definir — a
 * coluna `seller_profiles.manager_id` existia desde a primeira migração, sem
 * interface nenhuma.
 *
 * A lista vem da RPC `gestores_para_colaborador`: o gestor máximo (serve
 * qualquer província) e os gestores da província do colaborador. Atribuir
 * alguém de outra província daria a essa pessoa um acesso que ela não tem sobre
 * o território — por isso não aparece na lista e a RPC também recusa.
 */
export function GestorResponsavel({
  sellerId,
  gestorId,
  gestorNome,
  candidatos,
  falhaLista,
}: {
  sellerId: string;
  gestorId: string | null;
  gestorNome: string | null;
  candidatos: CandidatoGestor[];
  falhaLista?: string | null;
}) {
  const router = useRouter();
  const [escolhido, setEscolhido] = useState(gestorId ?? "");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  async function guardar() {
    setErro("");
    setAviso("");
    setAGuardar(true);

    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("definir_gestor_colaborador", {
      p_seller: sellerId,
      p_manager: escolhido || null,
    });

    setAGuardar(false);
    if (error) {
      setErro(mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql"));
      return;
    }

    const nome = (data as { gestor_nome?: string | null } | null)?.gestor_nome ?? null;
    setAviso(nome ? `Gestor responsável: ${nome}.` : "Ficou sem gestor responsável.");
    router.refresh();
  }

  const mudou = (gestorId ?? "") !== escolhido;

  return (
    <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
        <UserCheck className="h-4 w-4 text-[#C9A962]" />
        Gestor responsável
      </h2>
      <p className="mb-3 text-[11px] text-[#6F6F6F]">
        Quem acompanha esta pessoa. A lista mostra o gestor máximo e os gestores da
        província dela.
      </p>

      <p className="mb-2 text-sm">
        <span className="text-[#6F6F6F]">Actual: </span>
        <span className={gestorNome ? "text-[#E5E5E5]" : "text-[#F87171]"}>
          {gestorNome ?? "não definido"}
        </span>
      </p>

      {falhaLista ? (
        <p className="rounded-lg border border-[#4A3F1A] bg-[#2A2410] px-3 py-2 text-xs text-[#E3D5A7]">
          {falhaLista}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
            disabled={aGuardar}
            className="min-w-0 flex-1 rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-50"
          >
            <option value="">Sem gestor</option>
            {candidatos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.nacional ? " · gestão nacional" : c.provincia ? ` · ${c.provincia}` : ""}
                {c.eu ? " (eu)" : ""}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={guardar}
            disabled={aGuardar || !mudou}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:cursor-not-allowed disabled:bg-[#262626] disabled:text-[#6F6F6F]"
          >
            {aGuardar && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {aGuardar ? "A guardar…" : "Guardar"}
          </button>
        </div>
      )}

      {erro && (
        <p className="mt-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mt-3 rounded-lg border border-[#1F4D2E] bg-[#0F2A18] px-3 py-2 text-xs text-[#4ADE80]">
          {aviso}
        </p>
      )}
    </section>
  );
}
