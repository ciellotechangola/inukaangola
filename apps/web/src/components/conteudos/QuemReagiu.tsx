"use client";

import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { reacoesDoConteudo, type ReacaoResumo } from "@/lib/conteudos";

/**
 * Quem reagiu a uma publicação — só a gestão vê isto.
 *
 * A contagem já aparece nas interacções; o que faltava era o nome de quem
 * reagiu, para a gestão saber a que clientes a publicação chegou. A lista vem
 * de `conteudo_reacoes` (a função recusa todos os papéis que não sejam de
 * gestão), por isso é pedida no clique e não com o feed: são N chamadas que a
 * maioria das visitas não precisa.
 */

const ROTULO: Record<string, string> = {
  gosto: "Gosto",
  adoro: "Adoro",
  util: "Útil",
};

const PAPEL: Record<string, string> = {
  customer: "Cliente",
  seller: "Colaborador",
  store_seller: "Loja",
  manager: "Gestão",
};

export function QuemReagiu({ itemId, total }: { itemId: string; total: number | string }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<ReacaoResumo | null>(null);
  const [erro, setErro] = useState("");

  async function alternar() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && dados === null) {
      try {
        setDados(await reacoesDoConteudo(itemId));
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível carregar as reacções.");
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void alternar()}
        aria-expanded={aberto}
        title="Ver quem reagiu"
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] text-[#A3A3A3] transition hover:bg-[#1D1D1D] hover:text-[#C9A962]"
      >
        <Users className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{Number(total) > 0 ? "Quem reagiu" : "Reações"}</span>
      </button>

      {aberto && (
        <div className="w-full border-t border-[#1F1F1F] px-2 pb-2 pt-2">
          {erro ? (
            <p className="text-[11px] text-[#F87171]">{erro}</p>
          ) : dados === null ? (
            <p className="flex items-center gap-2 text-[11px] text-[#6F6F6F]">
              <Loader2 className="h-3 w-3 animate-spin" /> A carregar…
            </p>
          ) : dados.total === 0 ? (
            <p className="text-[11px] text-[#5F5F5F]">Ainda ninguém reagiu.</p>
          ) : (
            <>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
                {dados.total} {dados.total === 1 ? "reacção" : "reações"} ·{" "}
                <span className="text-[#C9A962]">
                  {dados.clientes} {dados.clientes === 1 ? "cliente" : "clientes"}
                </span>
                {dados.equipa > 0 && ` · ${dados.equipa} da equipa`}
              </p>

              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {dados.gente.map((g) => (
                  <li
                    key={g.user_id}
                    className="flex items-center gap-2 rounded-lg bg-[#111] px-2.5 py-1.5"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#333] text-[9px] text-[#C9A962]">
                      {iniciais(g.nome)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-[#E5E5E5]">{g.nome}</span>
                      <span className="block truncate text-[10px] text-[#5F5F5F]">
                        {PAPEL[g.papel] ?? g.papel}
                        {g.provincia ? ` · ${g.provincia}` : ""}
                        {g.telefone ? ` · ${g.telefone}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-[#1D1A12] px-1.5 py-0.5 text-[9px] text-[#C9A962]">
                      {ROTULO[g.reacao] ?? g.reacao}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[partes.length - 1]?.[0] ?? "")).toUpperCase();
}
