"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { mensagemDeErro } from "@/lib/erros";
import {
  corPrioridade,
  dataTarefa,
  PRIORIDADES,
  resumoPrazo,
  rotuloPrioridade,
  type PrioridadeTarefa,
  type Tarefa,
} from "@/lib/tarefas";

/**
 * Tarefas de um colaborador, do lado da gestão.
 *
 * «Entregar o BI», «visitar a delegação do Negage», «ligar aos clientes que não
 * compram há um mês» — o que a gestão pede por telefone deixa de se perder.
 *
 * A regra de quem pode escrever está no RLS: a gestão da província cria, edita e
 * apaga; o colaborador só muda o estado. Aqui não há verificação de papel
 * porque a base já a faz e repeti-la só criaria duas versões da mesma regra.
 */
export function TarefasColaborador({
  sellerId,
  tarefas,
  falhaLeitura,
}: {
  sellerId: string;
  tarefas: Tarefa[];
  /** A tabela ainda não existe (patch por aplicar): mostra o aviso. */
  falhaLeitura?: string | null;
}) {
  const router = useRouter();
  const [aCriar, setACriar] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const [form, setForm] = useState({
    titulo: "",
    descricao: "",
    prazo: "",
    prioridade: "normal" as PrioridadeTarefa,
  });

  function limpar() {
    setErro("");
    setAviso("");
  }

  async function criar() {
    limpar();
    if (form.titulo.trim().length < 3) {
      setErro("Escreva o que é preciso fazer (mínimo 3 caracteres).");
      return;
    }

    setAGuardar(true);
    const supabase = createClientBrowser();

    // `criado_por` tem de ser quem está a criar: a política de INSERT exige-o,
    // e é o que dá o nome no cartão do colaborador.
    const { data: auth } = await supabase.auth.getUser();

    const { error } = await supabase.from("colaborador_tarefas").insert({
      seller_id: sellerId,
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim() || null,
      prazo: form.prazo || null,
      prioridade: form.prioridade,
      criado_por: auth.user?.id ?? null,
    });

    setAGuardar(false);
    if (error) {
      setErro(mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql"));
      return;
    }

    setForm({ titulo: "", descricao: "", prazo: "", prioridade: "normal" });
    setACriar(false);
    setAviso("Tarefa atribuída.");
    router.refresh();
  }

  async function mudarEstado(t: Tarefa, estado: Tarefa["estado"]) {
    limpar();
    setOcupada(t.id);
    const supabase = createClientBrowser();
    const { error } = await supabase
      .from("colaborador_tarefas")
      .update({ estado })
      .eq("id", t.id);
    setOcupada(null);
    if (error) {
      setErro(mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql"));
      return;
    }
    router.refresh();
  }

  async function apagar(t: Tarefa) {
    if (!window.confirm(`Apagar a tarefa «${t.titulo}»?`)) return;
    limpar();
    setOcupada(t.id);
    const supabase = createClientBrowser();
    const { error } = await supabase.from("colaborador_tarefas").delete().eq("id", t.id);
    setOcupada(null);
    if (error) {
      setErro(mensagemDeErro(error, "supabase/PATCH_TAREFAS_GESTOR.sql"));
      return;
    }
    router.refresh();
  }

  const porFazer = tarefas.filter((t) => t.estado === "pendente").length;

  return (
    <section className="mb-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[#F5F5F5]">Tarefas do colaborador</h2>
          <p className="mt-1 text-[11px] text-[#525252]">
            O que a gestão pede aparece no perfil dele, com prazo. Ele marca o que já fez.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setACriar((v) => !v);
            limpar();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/50 px-3 py-2 text-xs text-[#C9A962] transition hover:bg-[#C9A962]/10"
        >
          <Plus className="h-3.5 w-3.5" /> Atribuir tarefa
        </button>
      </div>

      {porFazer > 0 && (
        <p className="mt-2 text-[11px] text-[#6F6F6F]">
          {porFazer} por fazer · {tarefas.length} no total
        </p>
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
      {falhaLeitura && !erro && (
        <p className="mt-3 rounded-lg border border-[#4A3F1A] bg-[#2A2410] px-3 py-2 text-xs text-[#E3D5A7]">
          {falhaLeitura}
        </p>
      )}

      {aCriar && (
        <div className="mt-4 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[#6F6F6F]">O que é preciso fazer</span>
              <input
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                maxLength={140}
                placeholder="Ex.: Entregar o BI actualizado na delegação"
                className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[#6F6F6F]">Detalhes (opcional)</span>
              <textarea
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                rows={3}
                placeholder="O que conta como feito, onde, com quem…"
                className="w-full resize-y rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm leading-relaxed text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-[#6F6F6F]">Prazo</span>
              <input
                type="date"
                value={form.prazo}
                onChange={(e) => setForm({ ...form, prazo: e.target.value })}
                className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-[#6F6F6F]">Prioridade</span>
              <select
                value={form.prioridade}
                onChange={(e) =>
                  setForm({ ...form, prioridade: e.target.value as PrioridadeTarefa })
                }
                className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={criar}
              disabled={aGuardar}
              className="rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
            >
              {aGuardar ? "A atribuir…" : "Atribuir"}
            </button>
            <button
              type="button"
              onClick={() => setACriar(false)}
              className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:text-[#F5F5F5]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {tarefas.length === 0 ? (
        <p className="mt-4 text-sm text-[#525252]">
          Sem tarefas atribuídas. Use «Atribuir tarefa» para pedir alguma coisa concreta.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {tarefas.map((t) => {
            const prazo = resumoPrazo(t);
            const feita = t.estado === "concluida";
            const cancelada = t.estado === "cancelada";
            return (
              <li
                key={t.id}
                className={`rounded-lg border p-3 ${
                  cancelada
                    ? "border-[#232323] bg-[#131313] opacity-60"
                    : "border-[#2A2A2A] bg-[#141414]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => mudarEstado(t, feita ? "pendente" : "concluida")}
                    disabled={ocupada === t.id}
                    title={feita ? "Voltar a abrir" : "Marcar como concluída"}
                    className="mt-0.5 shrink-0 text-[#C9A962] transition hover:text-[#E3D5A7] disabled:opacity-40"
                  >
                    {ocupada === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : feita ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Circle className="h-4 w-4 text-[#4A4A4A]" />
                    )}
                  </button>

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
                      {t.prazo && (
                        <span className={prazo.atrasada ? "text-[#F87171]" : ""}>
                          {feita
                            ? `Feita em ${dataTarefa(t.concluida_em)}`
                            : prazo.texto}
                        </span>
                      )}
                      {!t.prazo && feita && <span>Feita em {dataTarefa(t.concluida_em)}</span>}
                      <span>· {dataTarefa(t.criado_em)}</span>
                      {t.autor?.full_name && <span>· por {t.autor.full_name}</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    {feita ? (
                      <button
                        type="button"
                        onClick={() => mudarEstado(t, "pendente")}
                        disabled={ocupada === t.id}
                        title="Reabrir"
                        className="rounded p-1.5 text-[#6F6F6F] transition hover:bg-[#1D1D1D] hover:text-[#C9A962] disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      !cancelada && (
                        <button
                          type="button"
                          onClick={() => mudarEstado(t, "cancelada")}
                          disabled={ocupada === t.id}
                          title="Cancelar tarefa"
                          className="rounded px-1.5 py-1 text-[10px] text-[#6F6F6F] transition hover:bg-[#1D1D1D] hover:text-[#F5F5F5] disabled:opacity-40"
                        >
                          cancelar
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => apagar(t)}
                      disabled={ocupada === t.id}
                      title="Apagar"
                      className="rounded p-1.5 text-[#6F6F6F] transition hover:bg-[#1D1D1D] hover:text-[#DC2626] disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
