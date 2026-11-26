import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { normalizarVisaoLojas, type GerenteOpcao, type ProvinciaOpcao } from "@/lib/lojas";
import GestaoLojas from "./GestaoLojas";

export const dynamic = "force-dynamic";

/**
 * Painel das lojas.
 *
 * A administração nacional vê o país inteiro (ou uma província, pelo filtro);
 * um gestor provincial vê as lojas da sua província. O que cada um pode
 * corrigir é decidido pela base (`pode_editar` por loja): o gerente da loja
 * corrige a dele; a administração nacional só corrige as da sua zona.
 */
export default async function LojasPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const nacional = profile.is_national_admin || profile.provincia_id === null;

  const [visaoRes, provinciasRes, gerentesRes] = await Promise.all([
    supabase.rpc("lojas_overview"),
    supabase.from("provincias").select("id, nome, codigo, is_default").order("nome"),
    supabase
      .from("profiles")
      .select("id, full_name, provincia_id, is_national_admin")
      .eq("role", "manager")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const visao = normalizarVisaoLojas(visaoRes.data);
  const provincias = (provinciasRes.data ?? []) as ProvinciaOpcao[];
  const gerentes = (gerentesRes.data ?? []) as GerenteOpcao[];

  const emFalta =
    visaoRes.error &&
    /PGRST202|PGRST205|Could not find/i.test(visaoRes.error.message ?? "");

  const total = visao.total;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Lojas</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          {nacional
            ? "Todas as lojas do país: stock, vendas, caixa, saldo e investimento de cada uma."
            : `As lojas da província do ${visao.provincia ?? "—"}. Cada gerente corrige a sua.`}
        </p>
      </div>

      {emFalta ? (
        <div className="rounded-xl border border-[#4A3F1F] bg-[#241E0E] p-4 text-sm text-[#C9A962]">
          As lojas ainda não estão criadas na base de dados. Cole{" "}
          <code className="font-mono text-xs">supabase/PATCH_LOJAS.sql</code> no SQL Editor do
          Supabase e recarregue a página.
        </div>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi rotulo="Lojas" valor={String(total.lojas)} />
            <Kpi rotulo="Stock" valor={`${total.stock_unidades} un.`} nota={formatCurrency(total.stock_valor)} />
            <Kpi rotulo="Vendas" valor={formatCurrency(total.vendas)} />
            <Kpi rotulo="Caixa" valor={formatCurrency(total.caixa)} nota={`Saldo ${formatCurrency(total.saldo)}`} />
          </div>

          <GestaoLojas
            lojas={visao.lojas}
            provincias={provincias}
            gerentes={gerentes}
            nacional={nacional}
            provinciaFixa={nacional ? null : profile.provincia_id}
          />
        </>
      )}
    </main>
  );
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <p className="mb-1 text-xs uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="text-xl font-medium text-[#C9A962]">{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-[#6F6F6F]">{nota}</p>}
    </div>
  );
}
