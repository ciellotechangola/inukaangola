import { redirect } from "next/navigation";
import Link from "next/link";
import { getProfile } from "@/lib/auth";
import AreaLevantamento from "@/components/levantamentos/AreaLevantamento";

export const dynamic = "force-dynamic";

/**
 * «RETIRAR DINHEIRO» — a área de levantamentos do colaborador.
 *
 * Os números vêm todos de `levantamento_resumo()`; esta página só garante que
 * quem entra é colaborador. Um cliente que chegue aqui por URL não vê saldo
 * nenhum.
 */
export default async function SellerWithdrawalsPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/vendedor"
        className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]"
      >
        ← Área do colaborador
      </Link>
      <AreaLevantamento />
    </main>
  );
}
