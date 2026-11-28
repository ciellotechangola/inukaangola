import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { carregarCentral } from "@/lib/central-pedidos-server";
import CentralPedidos from "./CentralPedidos";

export const dynamic = "force-dynamic";

/**
 * CENTRAL DE PEDIDOS — a porta única da gestão.
 *
 * Antes, um pedido podia estar em quatro sítios diferentes: encomendas de
 * cliente, pedidos de grosso, candidaturas de revendedor e candidaturas de
 * colaborador. Quem atendia tinha de saber qual abrir. Aqui está tudo na mesma
 * página, separado por tipo, com o que está pendente à frente.
 *
 * O que cada gerente vê é decidido pelas políticas da base (província para as
 * candidaturas de revendedor e pedidos de grosso; tudo para a administração
 * nacional). Esta página não repete esse filtro — só mostra o que a sessão
 * dele já pode ler.
 */
export default async function PedidosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/gerente/pedidos");
  if (profile.role !== "manager") redirect("/");

  const central = await carregarCentral();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <CentralPedidos central={central} />
    </main>
  );
}
