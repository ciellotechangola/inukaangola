"use client";

/**
 * Descarregar ficheiros sem sair da página.
 *
 * Antes disto o botão era uma ligação directa ao URL do ficheiro. Num browser
 * de telemóvel isso abre a imagem numa aba nova — o `download` de um `<a>` só
 * vale para o mesmo domínio — e a pessoa ficava com a fotografia no ecrã em
 * vez de na galeria. Pior: uma imagem do bucket do Supabase vive noutro
 * domínio, por isso nem o `download` nem o `target` ajudavam.
 *
 * Aqui o ficheiro é pedido por `fetch` à nossa rota (que responde sempre com
 * `Content-Disposition: attachment` e, no caso das imagens, já em PNG) e
 * guardado a partir de um blob. Não há navegação, não há aba nova, não há
 * pré-visualização pelo meio.
 */

/** Erro com uma frase que se pode mostrar tal e qual à pessoa. */
export class ErroDownload extends Error {}

export async function descarregar(url: string, nomeSugerido = "inuka.png"): Promise<string> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ErroDownload("Sem ligação. Tenta outra vez.");
  }

  if (!resposta.ok) {
    throw new ErroDownload(await mensagemDeErro(resposta));
  }

  const blob = await resposta.blob();
  const nome = nomeDoCabecalho(resposta.headers.get("content-disposition")) ?? nomeSugerido;
  guardarBlob(blob, nome);
  return nome;
}

/** A rota responde JSON nos casos de recusa; o texto é que serve. */
async function mensagemDeErro(resposta: Response): Promise<string> {
  try {
    const dados = (await resposta.json()) as { error?: string };
    if (dados?.error) return dados.error;
  } catch {
    // Corpo vazio ou HTML: fica a frase genérica.
  }
  return resposta.status === 403
    ? "Não tens acesso a este ficheiro."
    : "Não foi possível descarregar.";
}

/**
 * Nome que o servidor escolheu (`filename="…"` ou `filename*=UTF-8''…`).
 *
 * Vale mais do que o nome que o browser conhece: é o servidor que decide a
 * extensão final — e é ele que garante que uma imagem sai sempre `.png`.
 */
function nomeDoCabecalho(disposicao: string | null): string | null {
  if (!disposicao) return null;

  const estendido = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposicao);
  if (estendido?.[1]) {
    try {
      return decodeURIComponent(estendido[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // Percentagem inválida: cai para o `filename` simples.
    }
  }

  const simples = /filename\s*=\s*"([^"]+)"/i.exec(disposicao) ?? /filename\s*=\s*([^;]+)/i.exec(disposicao);
  return simples?.[1]?.trim() || null;
}

/** Guarda um blob como ficheiro, sem passar por nenhuma página. */
export function guardarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O Safari ainda lê o blob depois do clique: revogar à pressa dava um
  // ficheiro vazio.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Nome de ficheiro seguro para servir de recurso quando o servidor não manda um. */
export function nomeSeguro(titulo: string, extensao = "png"): string {
  const limpo = (titulo || "inuka")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${limpo || "inuka"}.${extensao}`;
}
