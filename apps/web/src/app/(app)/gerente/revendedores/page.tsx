import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { telHref } from "@/lib/contactos";
import AcoesCandidatura from "./AcoesCandidatura";

export const dynamic = "force-dynamic";

interface Candidatura {
  id: string;
  full_name: string;
  phone: string;
  message: string | null;
  source: string | null;
  status: string;
  created_at: string;
  handled_at: string | null;
  provincia: { nome: string } | null;
}

const COR: Record<string, string> = {
  novo: "bg-[#2A2410] text-[#E3D5A7]",
  em_contacto: "bg-blue-950/60 text-blue-200",
  aprovado: "bg-green-950/60 text-green-200",
  recusado: "bg-red-950/60 text-red-200",
};

/**
 * Candidaturas a revendedor.
 *
 * Chegam do formulário público `/revendedor`. A gestão vê, contacta e marca o
 * estado — e o estado diz às outras pessoas da equipa quem já falou com a
 * pessoa, para não a chamarem três vezes.
 */
export default async function RevendedoresPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase
    .from("reseller_applications")
    .select(
      "id, full_name, phone, message, source, status, created_at, handled_at, provincia:provincias(nome)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const candidaturas = (data ?? []) as unknown as Candidatura[];

  const novos = candidaturas.filter((c) => c.status === "novo");
  const emCurso = candidaturas.filter((c) => c.status === "em_contacto");
  const fechadas = candidaturas.filter((c) => c.status === "aprovado" || c.status === "recusado");

  const semTabela = error && /PGRST205|does not exist/i.test(error.message);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <h1 className="text-3xl font-light text-[#F5F5F5]">Candidaturas a revendedor</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A3A3A3]">
        Pedidos enviados pelo formulário público. Contacte a pessoa pelo telefone e marque o
        estado — a equipa inteira vê quem já tratou do assunto.
      </p>

      {semTabela && (
        <div className="mt-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0008 (`PATCH_TAXAS_PEDIDOS.sql`) — a tabela das candidaturas
          ainda não existe nesta base.
        </div>
      )}

      {error && !semTabela && (
        <div className="mt-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          {error.message}
        </div>
      )}

      {!error && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Indicador rotulo="Por contactar" valor={String(novos.length)} destaque={novos.length > 0} />
          <Indicador rotulo="Em contacto" valor={String(emCurso.length)} />
          <Indicador rotulo="Fechadas" valor={String(fechadas.length)} />
        </div>
      )}

      {!error && candidaturas.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <p className="text-sm text-[#A3A3A3]">
            Ainda não há candidaturas. O formulário está em{" "}
            <Link href="/revendedor" className="text-[#C9A962] hover:underline">
              /revendedor
            </Link>
            .
          </p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {candidaturas.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[#F5F5F5]">{c.full_name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${COR[c.status] ?? "bg-[#262626] text-[#A3A3A3]"}`}>
                    {c.status === "em_contacto" ? "em contacto" : c.status}
                  </span>
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-[#8A8A8A]">
                  <a href={telHref(c.phone)} className="text-[#C9A962] hover:underline">
                    {c.phone}
                  </a>
                  {c.provincia?.nome && <span>· {c.provincia.nome}</span>}
                  <span>· {new Date(c.created_at).toLocaleString("pt-PT")}</span>
                  {c.source && <span className="text-[#525252]">· {c.source}</span>}
                </p>

                {c.message && (
                  <p className="mt-3 max-w-xl whitespace-pre-line rounded-lg bg-[#141414] p-3 text-xs leading-relaxed text-[#A3A3A3]">
                    {c.message}
                  </p>
                )}
              </div>

              <AcoesCandidatura id={c.id} estado={c.status} tratado={c.handled_at !== null} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-[#525252]">
        Aprovar aqui <strong className="text-[#6F6F6F]">não</strong> cria a conta. Para tornar
        alguém colaborador use{" "}
        <Link href="/gerente/colaboradores" className="text-[#C9A962] hover:underline">
          Colaboradores
        </Link>{" "}
        — conta nova ou promoção de um cliente existente.
      </p>
    </main>
  );
}

function Indicador({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-lg font-medium ${destaque ? "text-[#E3D5A7]" : "text-[#C9A962]"}`}>
        {valor}
      </p>
    </div>
  );
}
