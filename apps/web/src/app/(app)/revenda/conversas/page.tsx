import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import Chat from "@/components/Chat";

export const dynamic = "force-dynamic";

/**
 * Mensagens do revendedor.
 *
 * É o mesmo mensageiro de `/conversas`. A lista de contactos (`/api/contactos`)
 * devolve só o gerente da província e a administração nacional — as pessoas
 * que respondem pelo grosso.
 */
export default async function RevendaConversasPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/revenda/conversas");
  if (profile.role === "manager") redirect("/gerente/revendedores");
  if (profile.role !== "reseller") redirect("/");

  return (
    <Chat
      voltarHref="/revenda"
      voltarLabel="Área de revenda"
      vazioTexto="Ainda não tem conversas. Abra uma com o gerente da sua província na área de revenda."
      pedidoHref="/revenda/pedidos"
    />
  );
}
