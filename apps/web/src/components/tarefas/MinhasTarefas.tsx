"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ListTodo, Loader2 } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { mensagemDeErro } from "@/lib/erros";
import { corPrioridade, dataTarefa, resumoPrazo, rotuloPrioridade, type Tarefa } from "@/lib/tarefas";

/**
 * Tarefas que a gestão atribuiu, no perfil do colaborador.
 *
 * Só se muda o estado: o título e o prazo são da gestão e o trigger
 * `trg_tarefa_so_estado` recusa qualquer outra alteração. Uma tarefa feita
 * desaparece da lista depois de marcada — a confirmação fica visível uns
 * segundos, para não parecer que o clique não fez nada.
 */
export function MinhasTarefas({ tarefas }: { tarefas: Tarefa[] }) {
  const router = useRouter();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [feitasAgora, setFeitasAgora] = useState<string[]>([]);

  async function concluir(t: Tarefa) {
    setErro("");
    setOcupada(t.id);
    const supabase = createClientBrowser();
    const { error } = await supabase
      .from("colaborador_tarefas")
      .update({ estado: "concluida" })
      .eq("id", t.id);
    setOcupada(null);

    if (error) {
      setErro(mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql"));
      return;
    }

    setFeitasAgora((antes) => [...antes, t.id]);
    router.refresh();
  }

  const porFazer = tarefas.filter((t) => t.estado === "pendente");
  const feitas = tarefas.filter((t) => t.estado === "concluida").slice(0, 3);
  const visiveis = [...porFazer, ...feitas];

  if (visiveis.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
          <ListTodo className="h-4 w-4 text-[#C9A962]" />
          As minhas tarefas
        </h2>
        {porFazer.length > 0 && (
          <span className="rounded-full border border-[#C9A962]/40 bg-[#1D1A12] px-2 py-0.5 text-[10px] text-[#C9A962]">
            {porFazer.length} por fazer
          </span>
        )}
      </div>
      <p className="mb-4 text-[11px] text-[#6F6F6F]">
        Pedidos da gestão. Marque o que já está feito — a gestão vê aqui mesmo.
      </p>

      {erro && (
        <p className="mb-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}

      <ul className="space-y-2">
        {visiveis.map((t) => {
          const prazo = resumoPrazo(t);
          const feita = t.estado === "concluida";
          return (
            <li
              key={t.id}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                feita ? "border-[#1F3D29] bg-[#0F1A14]" : "border-[#2A2A2A] bg-[#141414]"
              }`}
            >
              {feita ? (
                <span className="mt-0.5 shrink-0 text-[#4ADE80]">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => concluir(t)}
                  disabled={ocupada === t.id}
                  title="Marcar como concluída"
                  className="mt-0.5 shrink-0 text-[#4A4A4A] transition hover:text-[#C9A962] disabled:opacity-40"
                >
                  {ocupada === t.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </button>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm ${
                    feita ? "text-[#6F6F6F] line-through" : "text-[#F5F5F5]"
                  }`}
                >
                  {t.titulo}
                </p>
                {t.descricao && (
                  <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-[#8A8A8A]">
                    {t.descricao}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[#6F6F6F]">
                  <span className={`rounded border px-1.5 py-0.5 ${corPrioridade(t.prioridade)}`}>
                    {rotuloPrioridade(t.prioridade)}
                  </span>
                  {feita ? (
                    <span className="text-[#4ADE80]">
                      Feita em {dataTarefa(t.concluida_em)}
                    </span>
                  ) : (
                    t.prazo && (
                      <span className={prazo.atrasada ? "text-[#F87171]" : ""}>{prazo.texto}</span>
                    )
                  )}
                  {!feita && !t.prazo && <span>Sem prazo</span>}
                </div>
              </div>

              {!feita && (
                <button
                  type="button"
                  onClick={() => concluir(t)}
                  disabled={ocupada === t.id}
                  className="shrink-0 rounded-lg border border-[#C9A962]/40 px-2.5 py-1.5 text-[10px] text-[#C9A962] transition hover:bg-[#C9A962]/10 disabled:opacity-40"
                >
                  Concluir
                </button>
              )}
              {feita && feitasAgora.includes(t.id) && (
                <span className="shrink-0 text-[10px] text-[#4ADE80]">feito</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
