"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  PlayCircle,
} from "lucide-react";
import { concluirAula, type AulaFormacao, type TipoAula } from "@/lib/formacao";
import { Quiz } from "@/components/formacao/Quiz";

const ICONE: Record<TipoAula, typeof FileText> = {
  texto: FileText,
  video: PlayCircle,
  pdf: FileText,
  link: ExternalLink,
  quiz: HelpCircle,
};

/**
 * Lista de aulas com conclusão.
 *
 * O progresso é calculado no servidor e devolvido por `formacao_concluir_aula`,
 * para o número no ecrã nunca divergir do que ficou guardado.
 */
export function AulasCurso({
  aulasIniciais,
  percentagemInicial,
  feitasIniciais,
}: {
  aulasIniciais: AulaFormacao[];
  percentagemInicial: number;
  feitasIniciais: number;
}) {
  const [aulas, setAulas] = useState(aulasIniciais);
  // Abre na primeira aula por fazer — quem entra a meio do curso continua onde
  // parou, em vez de voltar a ver a introdução já concluída.
  const [aberta, setAberta] = useState<string | null>(
    aulasIniciais.find((a) => !a.concluida)?.id ?? aulasIniciais[0]?.id ?? null
  );
  const [pct, setPct] = useState(percentagemInicial);
  const [feitas, setFeitas] = useState(feitasIniciais);
  const [aProcessar, setAProcessar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function alternar(aula: AulaFormacao) {
    if (aProcessar) return;
    setAProcessar(aula.id);
    setErro(null);
    setAviso(null);

    try {
      const res = await concluirAula(aula.id, !aula.concluida);
      setAulas((lista) =>
        lista.map((a) => (a.id === aula.id ? { ...a, concluida: !aula.concluida } : a))
      );
      setPct(res.percentagem);
      setFeitas(res.concluidas);
      if (res.curso_concluido) setAviso("Curso concluído. Bom trabalho.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar o progresso.");
    } finally {
      setAProcessar(null);
    }
  }

  return (
    <div>
      <div className="mb-5 rounded-xl border border-[#262626] bg-[#141414] p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider text-[#6F6F6F]">O seu progresso</p>
          <p className="text-sm text-[#C9A962]">
            {feitas} de {aulas.length} · {pct}%
          </p>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#262626]">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-[#4ADE80]" : "bg-[#C9A962]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {aviso && <p className="mt-2 text-[11px] text-[#4ADE80]">{aviso}</p>}
        {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}
      </div>

      <ul className="space-y-2">
        {aulas.map((aula, i) => {
          const Icone = ICONE[aula.kind] ?? FileText;
          const expandida = aberta === aula.id;

          return (
            <li
              key={aula.id}
              className={`overflow-hidden rounded-xl border bg-[#141414] ${
                aula.concluida ? "border-[#1F4D2E]/60" : "border-[#262626]"
              }`}
            >
              <div className="flex items-start gap-3 p-3">
                <button
                  type="button"
                  onClick={() => void alternar(aula)}
                  disabled={aProcessar !== null}
                  aria-label={aula.concluida ? "Marcar como não concluída" : "Marcar como concluída"}
                  className="mt-0.5 shrink-0 text-[#C9A962] disabled:opacity-50"
                >
                  {aProcessar === aula.id ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : aula.concluida ? (
                    <CheckCircle2 className="h-5 w-5 text-[#4ADE80]" />
                  ) : (
                    <Circle className="h-5 w-5 text-[#3F3F3F]" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setAberta(expandida ? null : aula.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={expandida}
                >
                  <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#5F5F5F]">
                    <Icone className="h-3 w-3" />
                    Aula {i + 1}
                    {Number(aula.duration_min) > 0 && <span>· {aula.duration_min} min</span>}
                  </span>
                  <span
                    className={`mt-0.5 block text-sm ${
                      aula.concluida ? "text-[#A3A3A3]" : "text-[#F5F5F5]"
                    }`}
                  >
                    {aula.title}
                  </span>
                  {aula.summary && !expandida && (
                    <span className="mt-0.5 block line-clamp-1 text-[11px] text-[#6F6F6F]">
                      {aula.summary}
                    </span>
                  )}
                </button>

                <ChevronDown
                  className={`mt-1 h-4 w-4 shrink-0 text-[#5F5F5F] transition ${
                    expandida ? "rotate-180" : ""
                  }`}
                />
              </div>

              {expandida && (
                <div className="border-t border-[#242424] px-4 py-3 pl-11">
                  {aula.summary && (
                    <p className="mb-2 text-xs text-[#A3A3A3]">{aula.summary}</p>
                  )}

                  {aula.body && aula.kind !== "quiz" && (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#D4D4D4]">
                      {aula.body}
                    </div>
                  )}

                  {aula.kind === "quiz" && aula.body && (
                    <Quiz
                      body={aula.body}
                      concluida={aula.concluida}
                      onAprovado={() => void alternar(aula)}
                    />
                  )}

                  {aula.kind === "video" && aula.video_url && (
                    <div className="mt-3">
                      {/\.(mp4|webm|ogg)$/i.test(aula.video_url) ? (
                        <video
                          src={aula.video_url}
                          controls
                          className="w-full rounded-lg border border-[#262626]"
                        />
                      ) : (
                        <a
                          href={aula.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962] px-3 py-2 text-xs text-[#C9A962] hover:bg-[#C9A962] hover:text-[#0A0A0A]"
                        >
                          <PlayCircle className="h-3.5 w-3.5" /> Abrir vídeo
                        </a>
                      )}
                    </div>
                  )}

                  {aula.kind === "pdf" && (aula.file_path || aula.video_url) && (
                    <a
                      href={aula.file_path ?? aula.video_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#D4D4D4] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                    >
                      <FileText className="h-3.5 w-3.5" /> {aula.file_name ?? "Abrir documento"}
                    </a>
                  )}

                  {aula.kind === "link" && aula.video_url && (
                    <a
                      href={aula.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#D4D4D4] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir ligação
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => void alternar(aula)}
                    disabled={aProcessar !== null}
                    className={`mt-4 rounded-lg px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                      aula.concluida
                        ? "border border-[#333] text-[#A3A3A3] hover:text-[#F87171]"
                        : "bg-[#C9A962] text-[#0A0A0A] hover:bg-[#D8BC7A]"
                    }`}
                  >
                    {aula.concluida ? "Marcar como não concluída" : "Marcar como concluída"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {aulas.length === 0 && (
        <p className="rounded-xl border border-dashed border-[#2A2A2A] px-4 py-10 text-center text-sm text-[#6F6F6F]">
          Este curso ainda não tem aulas publicadas.
        </p>
      )}
    </div>
  );
}
