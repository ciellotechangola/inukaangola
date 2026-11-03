"use client";

import { Plus, Trash2 } from "lucide-react";
import { lerQuiz, QUIZ_VAZIO, type PerguntaQuiz } from "@/lib/quiz";

const ENTRADA =
  "w-full rounded-lg border border-[#333] bg-[#0F0F0F] px-2.5 py-1.5 text-xs text-[#F5F5F5] outline-none focus:border-[#C9A962]";

/**
 * Construtor de perguntas de uma aula do tipo `quiz`.
 *
 * Grava em JSON no `body` da aula. É editável pelo gestor sem escrever código:
 * acrescenta perguntas, opções e marca a resposta certa com um clique.
 */
export function ConstrutorQuiz({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (novo: string) => void;
}) {
  const perguntas = lerQuiz(valor);

  function atualizar(lista: PerguntaQuiz[]) {
    onChange(JSON.stringify(lista));
  }

  function mudarPergunta(i: number, campos: Partial<PerguntaQuiz>) {
    atualizar(perguntas.map((p, j) => (i === j ? { ...p, ...campos } : p)));
  }

  function mudarOpcao(i: number, j: number, texto: string) {
    atualizar(
      perguntas.map((p, k) =>
        i === k ? { ...p, opcoes: p.opcoes.map((o, l) => (l === j ? texto : o)) } : p
      )
    );
  }

  function acrescentarOpcao(i: number) {
    atualizar(
      perguntas.map((p, k) =>
        i === k && p.opcoes.length < 6 ? { ...p, opcoes: [...p.opcoes, ""] } : p
      )
    );
  }

  function removerOpcao(i: number, j: number) {
    atualizar(
      perguntas.map((p, k) => {
        if (i !== k || p.opcoes.length <= 2) return p;
        const opcoes = p.opcoes.filter((_, l) => l !== j);
        // Se apagou a opção certa, a resposta recua para a primeira.
        const correta = p.correta === j ? 0 : p.correta > j ? p.correta - 1 : p.correta;
        return { ...p, opcoes, correta };
      })
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[#8A8A8A]">
          Perguntas ({perguntas.length})
        </span>
        <button
          type="button"
          onClick={() => atualizar([...perguntas, { ...QUIZ_VAZIO, opcoes: ["", "", ""] }])}
          className="inline-flex items-center gap-1 rounded-lg border border-[#333] px-2 py-1 text-[10px] text-[#C9A962] hover:border-[#C9A962]/50"
        >
          <Plus className="h-3 w-3" /> Pergunta
        </button>
      </div>

      {perguntas.length === 0 && (
        <p className="rounded-lg border border-dashed border-[#2A2A2A] px-3 py-4 text-center text-[11px] text-[#6F6F6F]">
          Sem perguntas. A aula aparece aos colaboradores como texto simples até
          acrescentar pelo menos uma.
        </p>
      )}

      {perguntas.map((p, i) => (
        <div key={i} className="rounded-lg border border-[#2A2A2A] bg-[#131313] p-2.5">
          <div className="mb-2 flex items-start gap-2">
            <span className="mt-1.5 text-[10px] text-[#C9A962]">{i + 1}.</span>
            <input
              value={p.pergunta}
              onChange={(e) => mudarPergunta(i, { pergunta: e.target.value })}
              placeholder="Escreva a pergunta"
              className={ENTRADA}
            />
            <button
              type="button"
              onClick={() => atualizar(perguntas.filter((_, j) => j !== i))}
              aria-label="Remover pergunta"
              className="mt-1 shrink-0 text-[#6F6F6F] hover:text-[#F87171]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1.5 pl-5">
            {p.opcoes.map((o, j) => (
              <div key={j} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correta-${i}`}
                  checked={p.correta === j}
                  onChange={() => mudarPergunta(i, { correta: j })}
                  aria-label={`Marcar opção ${j + 1} como correta`}
                  className="shrink-0 accent-[#C9A962]"
                />
                <input
                  value={o}
                  onChange={(e) => mudarOpcao(i, j, e.target.value)}
                  placeholder={`Opção ${j + 1}`}
                  className={ENTRADA}
                />
                <button
                  type="button"
                  onClick={() => removerOpcao(i, j)}
                  disabled={p.opcoes.length <= 2}
                  aria-label="Remover opção"
                  className="shrink-0 text-[#5F5F5F] hover:text-[#F87171] disabled:opacity-30"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            {p.opcoes.length < 6 && (
              <button
                type="button"
                onClick={() => acrescentarOpcao(i)}
                className="text-[10px] text-[#8A8A8A] hover:text-[#C9A962]"
              >
                + opção
              </button>
            )}
            <input
              value={p.explicacao ?? ""}
              onChange={(e) => mudarPergunta(i, { explicacao: e.target.value })}
              placeholder="Explicação mostrada depois de responder (opcional)"
              className={ENTRADA}
            />
          </div>
        </div>
      ))}

      <p className="text-[10px] text-[#5F5F5F]">
        A opção marcada é a resposta certa. A aula conta como concluída quando o
        colaborador acerta pelo menos 70%.
      </p>
    </div>
  );
}
