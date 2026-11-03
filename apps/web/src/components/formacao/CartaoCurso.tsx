import Link from "next/link";
import { CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { rotuloNivel, type CursoFormacao } from "@/lib/formacao";

/** Cartão de curso — usado nos carrosséis e nas listas da gestão. */
export function CartaoCurso({
  curso,
  href,
}: {
  curso: CursoFormacao;
  href?: string;
}) {
  const total = Number(curso.aulas) || 0;
  const feitas = Number(curso.concluidas) || 0;
  const pct = total > 0 ? Math.round((feitas / total) * 100) : 0;
  const concluido = total > 0 && feitas >= total;

  return (
    <Link
      href={href ?? `/vendedor/formacao/${curso.id}`}
      className="group w-[220px] shrink-0 snap-start overflow-hidden rounded-xl border border-[#262626] bg-[#141414] transition hover:border-[#C9A962]/45"
    >
      <div className="relative aspect-[16/10] w-full bg-gradient-to-br from-[#1A1A1A] to-[#0F0F0F]">
        {curso.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={curso.cover_url}
            alt={curso.title}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[10px] uppercase tracking-wider text-[#4A4A4A]">
            Formação INUKA
          </div>
        )}
        {concluido && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-[#0F2A18] px-1.5 py-0.5 text-[10px] text-[#4ADE80]">
            <CheckCircle2 className="h-2.5 w-2.5" /> Concluído
          </span>
        )}
      </div>

      <div className="p-3">
        {curso.categoria && (
          <p className="mb-1 text-[9px] uppercase tracking-wider text-[#6F6F6F]">
            {curso.categoria}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[#F5F5F5] group-hover:text-[#C9A962]">
          {curso.title}
        </h3>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-[#6F6F6F]">
          <span className="flex items-center gap-1">
            <PlayCircle className="h-3 w-3" /> {total} {total === 1 ? "aula" : "aulas"}
          </span>
          {Number(curso.duration_min) > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {curso.duration_min} min
            </span>
          )}
          <span className="ml-auto text-[#525252]">{rotuloNivel(curso.level)}</span>
        </div>

        {total > 0 && (
          <div className="mt-2">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[#262626]">
              <div
                className={`h-full rounded-full ${concluido ? "bg-[#4ADE80]" : "bg-[#C9A962]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-[#5F5F5F]">
              {feitas} de {total} · {pct}%
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}
