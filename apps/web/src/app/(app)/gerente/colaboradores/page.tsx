import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias } from "@/lib/provincias";
import NovoColaborador from "./NovoColaborador";
import PesquisaColaboradores from "./PesquisaColaboradores";
import MetaProvincia from "./MetaProvincia";
import TaxaComissao from "./TaxaComissao";

export const dynamic = "force-dynamic";

export default async function ColaboradoresPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const nacional = profile.is_national_admin || profile.provincia_id === null;

  const [provincias, clientesRes, taxaRes, semTaxaRes] = await Promise.all([
    listarProvincias(supabase),
    supabase
      .from("profiles")
      .select("id, full_name, phone")
      .eq("role", "customer")
      .order("full_name"),
    // A taxa da empresa vive em `platform_settings`; a RPC já devolve o valor
    // por omissão quando a linha ainda não existe.
    supabase.rpc("taxa_comissao_global"),
    supabase
      .from("seller_profiles")
      .select("id", { count: "exact", head: true })
      .is("commission_rate", null),
  ]);

  const taxaGlobal = Number(taxaRes.data ?? 0.1);
  const colaboradoresSemTaxa = semTaxaRes.count ?? 0;

  const clientes = (clientesRes.data ?? []) as { id: string; full_name: string; phone: string | null }[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Gestão e pesquisa de colaboradores</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            Pesquise por referência INUKA, nome, BI, telefone, província ou município.
          </p>
          <p className="mt-1 text-xs text-[#6F6F6F]">
            Colaborador e vendedor são a mesma conta: é esta que acede à área de colaborador.
          </p>
        </div>
        <NovoColaborador
          clientes={clientes}
          provincias={provincias}
          provinciaFixa={nacional ? null : profile.provincia_id}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-start gap-2">
        <MetaProvincia
          provincias={provincias}
          provinciaFixa={nacional ? null : profile.provincia_id}
        />
      </div>

      <div className="mb-4">
        <TaxaComissao taxaGlobal={taxaGlobal} colaboradoresSemTaxa={colaboradoresSemTaxa} />
      </div>

      <PesquisaColaboradores provincias={provincias} podeEscolherProvincia={nacional} />

      <p className="mt-6 text-xs leading-relaxed text-[#525252]">
        A pesquisa e os indicadores são calculados na base de dados. Um gestor provincial só
        recebe colaboradores da sua província, mesmo que procure por outro nome. Promover altera{" "}
        <code className="text-[#6F6F6F]">profiles.role</code> e cria a ficha em{" "}
        <code className="text-[#6F6F6F]">seller_profiles</code>.
      </p>
    </main>
  );
}
