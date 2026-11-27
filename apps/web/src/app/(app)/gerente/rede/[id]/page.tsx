import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizarFicha } from "@/lib/rede";
import FichaRevendedorProfissional from "@/components/revenda/FichaRevendedorProfissional";
import AcoesFicha from "./AcoesFicha";

export const dynamic = "force-dynamic";

/**
 * Ficha de um revendedor, na óptica da gestão.
 *
 * A mesma peça que o revendedor vê em `/revenda/perfil`, com um painel de
 * gestão a mais: desconto de grosso, mínimo de unidades, estado e nota. A
 * função `revendedor_ficha()` já recusa quem não tem acesso — a página não
 * repete a regra, só a traduz num `notFound()`.
 */
export default async function FichaRevendedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const perfil = await getProfile();
  if (!perfil || perfil.role !== "manager") redirect("/");

  const { id } = await params;
  const supabase = await createClientServer();

  const { data, error } = await supabase.rpc("revendedor_ficha", { p_id: id });

  if (error) {
    // Sem acesso ou ficha inexistente: a função levanta, o PostgREST devolve
    // erro. Não vale a pena distinguir os dois casos para quem está a ver.
    if (/Sem acesso|não encontrado|PGRST202/i.test(error.message)) notFound();
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/gerente/rede" className="text-sm text-[#A3A3A3] hover:text-[#C9A962]">
          ← Rede de vendedores
        </Link>
        <p className="mt-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível abrir a ficha: {error.message}
        </p>
      </main>
    );
  }

  const ficha = normalizarFicha(data);
  if (!ficha) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <FichaRevendedorProfissional
        ficha={ficha}
        voltar={{ href: "/gerente/rede", label: "Rede de vendedores" }}
        acoes={
          <AcoesFicha
            id={ficha.revendedor.id}
            desconto={ficha.revendedor.desconto}
            minimo={ficha.revendedor.minimo_unidades}
            status={ficha.revendedor.status}
            nota={ficha.revendedor.nota}
            telefone={ficha.revendedor.telefone}
            nome={ficha.revendedor.nome}
          />
        }
      />
    </main>
  );
}
