import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizarCatalogo, normalizarMinhaRevenda } from "@/lib/revenda";
import CatalogoGrosso from "./CatalogoGrosso";

export const dynamic = "force-dynamic";

/**
 * Catálogo de grosso.
 *
 * Os preços são calculados na base (`revendedor_catalogo`), nunca aqui: o
 * browser não pode decidir quanto custa um produto. Esta página só transporta
 * o que a função devolveu.
 */
export default async function CatalogoGrossoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/revenda/catalogo");
  if (profile.role === "manager") redirect("/gerente/revendedores");
  if (profile.role !== "reseller") redirect("/");

  const supabase = await createClientServer();
  const [{ data: catalogoRaw, error }, { data: painelRaw }] = await Promise.all([
    supabase.rpc("revendedor_catalogo"),
    supabase.rpc("minha_revenda"),
  ]);

  const painel = normalizarMinhaRevenda(painelRaw);
  if (!painel.revendedor) redirect("/revendedor");

  const produtos = normalizarCatalogo((catalogoRaw ?? []) as unknown[]);
  const semMigracao = !!error && /PGRST202|PGRST205|does not exist/i.test(error.message);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <CatalogoGrosso
        produtos={produtos}
        minimo={painel.revendedor.minimo_unidades}
        revendedor={painel.revendedor.nome}
        semMigracao={semMigracao}
      />
    </main>
  );
}
