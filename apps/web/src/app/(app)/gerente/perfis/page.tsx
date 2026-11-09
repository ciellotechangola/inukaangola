import { redirect } from "next/navigation";
import { Check, Minus, ShieldCheck } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias } from "@/lib/provincias";
import { MATRIZ, PERFIS, type Papel } from "@/lib/perfis";
import NovoVendedorLoja from "./NovoVendedorLoja";

export const dynamic = "force-dynamic";

interface Membro {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  referencia: string | null;
  provincia_id: string | null;
  provincia: { nome: string } | null;
}

const ORDEM: Papel[] = ["manager", "seller", "store_seller", "customer"];

const COR_PAPEL: Record<string, string> = {
  manager: "border-[#C9A962]/40 bg-[#C9A962]/10 text-[#C9A962]",
  seller: "border-[#7BA7D9]/40 bg-[#7BA7D9]/10 text-[#9CC2EA]",
  store_seller: "border-[#5FBF8F]/40 bg-[#5FBF8F]/10 text-[#7FD6AB]",
  customer: "border-[#3A3A3A] bg-[#1A1A1A] text-[#C9C9C9]",
};

export default async function PerfisPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();

  const [{ data: membrosRaw }, provincias] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active, referencia, provincia_id, provincia:provincias(nome)")
      .in("role", ["manager", "seller", "store_seller"])
      .order("role")
      .order("full_name"),
    listarProvincias(supabase),
  ]);

  const membros = (membrosRaw ?? []) as unknown as Membro[];
  const provinciaFixa =
    profile.is_national_admin || profile.provincia_id === null ? null : profile.provincia_id;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-light text-[#F5F5F5]">
            <ShieldCheck className="h-7 w-7 text-[#C9A962]" />
            Perfis e permissões
          </h1>
          <p className="max-w-2xl text-[#A3A3A3]">
            Cada perfil tem a sua área e as suas competências. A separação é aplicada na base de
            dados: mesmo que alguém tente entrar por um endereço directo, as regras recusam.
          </p>
        </div>
        <NovoVendedorLoja provincias={provincias} provinciaFixa={provinciaFixa} />
      </header>

      {/* ---------------------------------------------------------- perfis */}
      <section className="mb-10 grid gap-4 md:grid-cols-2">
        {PERFIS.map((p) => (
          <article
            key={p.papel}
            className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5"
            style={{ borderTopColor: p.cor, borderTopWidth: 2 }}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-lg font-medium text-[#F5F5F5]">{p.etiqueta}</h2>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${COR_PAPEL[p.papel]}`}
              >
                {p.papel}
              </span>
            </div>
            <p className="mb-4 text-sm text-[#A3A3A3]">{p.missao}</p>

            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#525252]">Regalias</p>
            <ul className="mb-4 space-y-1.5 text-sm text-[#D4D4D4]">
              {p.regalias.map((r) => (
                <li key={r} className="flex gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5FBF8F]" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>

            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#525252]">Limites</p>
            <ul className="space-y-1.5 text-sm text-[#8A8A8A]">
              {p.limites.map((r) => (
                <li key={r} className="flex gap-2">
                  <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6F6F6F]" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 border-t border-[#262626] pt-3 text-[11px] text-[#525252]">
              Área principal: <span className="font-mono text-[#8A8A8A]">{p.area}</span>
            </p>
          </article>
        ))}
      </section>

      {/* ---------------------------------------------------------- matriz */}
      <section className="mb-10">
        <h2 className="mb-1 text-xl font-light text-[#F5F5F5]">Matriz de competências</h2>
        <p className="mb-4 text-sm text-[#A3A3A3]">
          Uma linha por competência. Serve para conferir rapidamente quem pode o quê.
        </p>

        <div className="overflow-x-auto rounded-xl border border-[#262626]">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#141414] text-left">
                <th className="px-4 py-3 font-medium text-[#A3A3A3]">Competência</th>
                {ORDEM.map((papel) => (
                  <th key={papel} className="px-3 py-3 text-center font-medium text-[#A3A3A3]">
                    {PERFIS.find((p) => p.papel === papel)?.etiqueta ?? papel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIZ.map((linha, i) => (
                <tr
                  key={linha.competencia}
                  className={i % 2 === 0 ? "bg-[#0F0F0F]" : "bg-[#121212]"}
                >
                  <td className="px-4 py-2.5">
                    <span className="block text-[#EDEDED]">{linha.rotulo}</span>
                    <span className="block text-[11px] text-[#6F6F6F]">{linha.descricao}</span>
                  </td>
                  {ORDEM.map((papel) => (
                    <td key={papel} className="px-3 py-2.5 text-center">
                      {linha.quem.includes(papel) ? (
                        <Check
                          className="mx-auto h-4 w-4 text-[#5FBF8F]"
                          aria-label="permitido"
                        />
                      ) : (
                        <Minus
                          className="mx-auto h-4 w-4 text-[#3A3A3A]"
                          aria-label="não permitido"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------- equipa */}
      <section>
        <h2 className="mb-1 text-xl font-light text-[#F5F5F5]">Contas de equipa</h2>
        <p className="mb-4 text-sm text-[#A3A3A3]">
          Gestores, colaboradores de vendas e vendedores de loja. As contas de cliente não entram
          nesta lista.
        </p>

        {membros.length === 0 ? (
          <p className="rounded-xl border border-[#262626] bg-[#141414] p-6 text-sm text-[#6F6F6F]">
            Ainda não há contas de equipa.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#262626]">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-[#141414] text-left text-[#A3A3A3]">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Perfil</th>
                  <th className="px-4 py-3 font-medium">Província</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {membros.map((m, i) => (
                  <tr key={m.id} className={i % 2 === 0 ? "bg-[#0F0F0F]" : "bg-[#121212]"}>
                    <td className="px-4 py-2.5">
                      <span className="block text-[#EDEDED]">{m.full_name}</span>
                      {m.referencia && (
                        <span className="block font-mono text-[10px] text-[#525252]">
                          {m.referencia}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          COR_PAPEL[m.role] ?? COR_PAPEL.customer
                        }`}
                      >
                        {PERFIS.find((p) => p.papel === m.role)?.etiqueta ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#A3A3A3]">
                      {m.provincia?.nome ?? "Nacional"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[#A3A3A3]">{m.phone ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={m.is_active ? "text-[#5FBF8F]" : "text-[#F87171]"}>
                        {m.is_active ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-[11px] text-[#525252]">
          Para desactivar um colaborador ou mudar a taxa de comissão, use{" "}
          <span className="font-mono text-[#8A8A8A]">/gerente/colaboradores</span>. A desactivação
          corta o acesso sem apagar o histórico.
        </p>
      </section>
    </main>
  );
}
