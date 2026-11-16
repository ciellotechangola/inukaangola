import { redirect } from "next/navigation";
import FormularioVenda from "@/components/vendas/FormularioVenda";
import { getProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Registar venda do colaborador.
 *
 * A gestão também pode registar vendas, mas faz isso na área dela
 * (`/gerente/vendas/registar`), onde tem a escolha do colaborador. Aqui manda
 * para lá em vez de mostrar um formulário sem essa opção.
 */
export default async function RegisterSalePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/gerente/vendas/registar");

  return <FormularioVenda voltar={{ href: "/vendedor", label: "Área de colaborador" }} />;
}
