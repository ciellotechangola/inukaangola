"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { lerQuiz, NOTA_MINIMA } from "@/lib/quiz";

/**
 * Questionário de uma aula.
 *
 * A correção é feita no browser de propósito: as respostas certas já seguem
 * no documento da aula, por isso não há nada a proteger no servidor. O que
 * fica guardado na base é só a conclusão da aula (`formacao_concluir_aula`),
 * que é o que conta para o progresso e para as estatísticas do gestor.
 */
export function Quiz({
  body,
  concluida,
  onAprovado,
}: {
  body: string;
  concluida: boolean;
  onAprovado: () => void;
}) {
  const perguntas = lerQuiz(body);
  const [escolhas, setEscolhas] = useState<Record<number, number>>({});
  const [corrigido, setCorrigido] = useState(false);

  if (perguntas.length === 0) {
    return (
      <p className="text-xs text-[#6F6F6F]">
        Esta atividade ainda não tem perguntas configuradas.
      </p>
    );
  }

  const certas = perguntas.reduce(
    (n, p, i) => (escolhas[i] === p.correta ? n + 1 : n),
    0
  );
  const nota = Math.round((certas / perguntas.length) * 100);
  const respondidas = Object.keys(escolhas).length;
  const completo = respondidas === perguntas.length;

  function corrigir() {
    setCorrigido(true);
    if (nota >= NOTA_MINIMA && !concluida) onAprovado();
  }

  function repetir() {
    setEscolhas({});
    setCorrigido(false);
  }

  return (
    <div className="mt-3 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] p-3">
      <ol className="space-y-4">
        {perguntas.map((p, i) => {
          const escolhida = escolhas[i];
          return (
            <li key={i}>
              <p className="mb-2 text-sm text-[#F5F5F5]">
                <span className="mr-1.5 text-[#C9A962]">{i + 1}.</span>
                {p.pergunta}
              </p>
              <div className="space-y-1.5">
                {p.opcoes.map((o, j) => {
                  const ativa = escolhida === j;
                  const certa = corrigido && j === p.correta;
                  const errada = corrigido && ativa && j !== p.correta;

                  return (
                    <label
                      key={j}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                        certa
                          ? "border-[#1F4D2E] bg-[#12291B] text-[#B9E6C8]"
                          : errada
                            ? "border-[#4D1F1F] bg-[#2A1414] text-[#F0B9B9]"
                            : ativa
                              ? "border-[#C9A962]/60 bg-[#1A1710] text-[#F5F5F5]"
                              : "border-[#2A2A2A] text-[#B4B4B4] hover:border-[#3A3A3A]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q-${i}`}
                        checked={ativa}
                        disabled={corrigido}
                        onChange={() => setEscolhas((e) => ({ ...e, [i]: j }))}
                        className="mt-0.5 accent-[#C9A962]"
                      />
                      <span>{o}</span>
                      {certa && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0" />}
                      {errada && <XCircle className="ml-auto h-3.5 w-3.5 shrink-0" />}
                    </label>
                  );
                })}
              </div>
              {corrigido && p.explicacao && (
                <p className="mt-1.5 text-[11px] text-[#8A8A8A]">{p.explicacao}</p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!corrigido ? (
          <button
            type="button"
            onClick={corrigir}
            disabled={!completo}
            className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-semibold text-[#0A0A0A] disabled:opacity-40"
          >
            {completo ? "Verificar respostas" : `Responda a todas (${respondidas}/${perguntas.length})`}
          </button>
        ) : (
          <>
            <span
              className={`text-xs font-medium ${nota >= NOTA_MINIMA ? "text-[#4ADE80]" : "text-[#F87171]"}`}
            >
              {certas} de {perguntas.length} certas · {nota}%
              {nota >= NOTA_MINIMA ? " · aprovado" : ` · precisa de ${NOTA_MINIMA}%`}
            </span>
            <button
              type="button"
              onClick={repetir}
              className="inline-flex items-center gap-1 rounded-lg border border-[#333] px-2.5 py-1 text-[11px] text-[#A3A3A3] hover:text-[#C9A962]"
            >
              <RotateCcw className="h-3 w-3" /> Repetir
            </button>
          </>
        )}
      </div>
    </div>
  );
}
