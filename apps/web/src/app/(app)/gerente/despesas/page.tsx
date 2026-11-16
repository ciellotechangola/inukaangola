import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import GestaoDespesas from "@/components/despesas/GestaoDespesas";

export const dynamic = "force-dynamic";

/**
 * Despesas e investimento da empresa.
 *
 * Quem vê o quê é decidido na base de dados (`despesas_equipa` filtra por
 * `can_manage_province`), por isso a página só garante que é gestão — um
 * colaborador que chegue aqui por URL directa não passa.
 */
export default async function GestaoDespesasPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <GestaoDespesas />
    </main>
  );
}
