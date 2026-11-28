import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizarCatalogo, normalizarMinhaRevenda } from "@/lib/revenda";
import { ordenarCatalogo } from "@/lib/ordenacao-catalogo";
import CatalogoGrosso from "./CatalogoGrosso";

export const dynamic = "force-dynamic";

/**
 * Catálogo de grosso.
 *
 * Os preços são calculados na base (`revendedor_catalogo`), nunca aqui: o
 * browser não pode decidir quanto custa um produto. Esta página só transporta
 * o que a função devolveu.
 *
 * A ordem de abertura é a da casa — **perfumes, depois cremes, depois o
 * resto** —, aplicada pela mesma função que o catálogo de cliente usa
 * (`lib/ordenacao-catalogo`). A base continua a devolver o último submetido em
 * primeiro (0035); dentro de cada grupo essa ordem mantém-se, e é isso que faz
 * um creme recém-inscrito aparecer no topo dos cremes.
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

  const produtos = ordenarCatalogo(
    normalizarCatalogo((catalogoRaw ?? []) as unknown[]),
    (p) => ({ nome: p.nome, categoria: p.categoria })
  );
  const semMigracao = !!error && /PGRST202|PGRST205|does not exist/i.test(error.message);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <CatalogoGrosso
        produtos={produtos}
        minimo={painel.regras.minimo_unidades}
        revendedor={{ id: painel.revendedor.id, nome: painel.revendedor.nome }}
        semMigracao={semMigracao}
      />
    </main>
  );
}
