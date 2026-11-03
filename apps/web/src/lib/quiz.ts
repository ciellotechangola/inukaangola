/**
 * Questionários das aulas de formação.
 *
 * As perguntas vivem em `training_lessons.body` quando a aula é do tipo
 * `quiz`. Guardar JSON num campo de texto evita uma tabela nova para algo que
 * só é lido de uma maneira: junto com a aula, de uma vez.
 *
 * O formato é tolerante: se o gestor escrever texto simples no campo (em vez
 * de JSON), a aula mostra o texto e não finge ser um questionário — é melhor
 * do que rebentar a página por causa de uma vírgula.
 */

export interface PerguntaQuiz {
  pergunta: string;
  opcoes: string[];
  correta: number;
  explicacao?: string;
}

export const QUIZ_VAZIO: PerguntaQuiz = {
  pergunta: "",
  opcoes: ["", "", ""],
  correta: 0,
};

export function lerQuiz(body: string | null | undefined): PerguntaQuiz[] {
  if (!body) return [];
  const texto = body.trim();
  if (!texto.startsWith("[")) return [];

  try {
    const bruto = JSON.parse(texto);
    if (!Array.isArray(bruto)) return [];

    return bruto
      .map((p) => {
        const pergunta = typeof p?.pergunta === "string" ? p.pergunta.trim() : "";
        const opcoes = Array.isArray(p?.opcoes)
          ? p.opcoes.filter((o: unknown): o is string => typeof o === "string" && o.trim() !== "")
          : [];
        const correta = Number.isInteger(p?.correta) ? Number(p.correta) : 0;
        return {
          pergunta,
          opcoes,
          correta: correta >= 0 && correta < opcoes.length ? correta : 0,
          explicacao: typeof p?.explicacao === "string" ? p.explicacao : undefined,
        };
      })
      .filter((p) => p.pergunta !== "" && p.opcoes.length >= 2);
  } catch {
    return [];
  }
}

export function escreverQuiz(perguntas: PerguntaQuiz[]): string | null {
  const limpas = perguntas
    .map((p) => ({
      pergunta: p.pergunta.trim(),
      opcoes: p.opcoes.map((o) => o.trim()).filter((o) => o !== ""),
      correta: p.correta,
      ...(p.explicacao?.trim() ? { explicacao: p.explicacao.trim() } : {}),
    }))
    .filter((p) => p.pergunta !== "" && p.opcoes.length >= 2)
    // Se a resposta certa ficou fora do intervalo (opção apagada), recua para a primeira.
    .map((p) => ({ ...p, correta: p.correta < p.opcoes.length ? p.correta : 0 }));

  return limpas.length ? JSON.stringify(limpas) : null;
}

/** Nota mínima para a aula contar como concluída. */
export const NOTA_MINIMA = 70;
