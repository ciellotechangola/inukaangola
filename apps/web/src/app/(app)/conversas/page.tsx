import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import Chat from "@/components/Chat";

export const dynamic = "force-dynamic";

export default async function ConversasPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/conversas");

  const voltar =
    profile.role === "manager"
      ? { href: "/gerente", label: "Painel de gestão" }
      : profile.role === "store_seller"
        ? { href: "/loja", label: "Loja" }
        : profile.role === "seller"
          ? { href: "/vendedor", label: "Área de colaborador" }
          : profile.role === "reseller"
            ? { href: "/revenda", label: "Área de revenda" }
            : { href: "/cliente", label: "Área de cliente" };

  // O selo do pedido dentro da conversa leva à lista de pedidos de quem está a
  // ver — cada perfil tem a sua (0036).
  const pedidoHref =
    profile.role === "manager"
      ? "/gerente/pedidos"
      : profile.role === "reseller"
        ? "/revenda/pedidos"
        : profile.role === "customer"
          ? "/cliente/encomendas"
          : undefined;

  return (
    <Chat voltarHref={voltar.href} voltarLabel={voltar.label} pedidoHref={pedidoHref} />
  );
}
