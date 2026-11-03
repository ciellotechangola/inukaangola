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
      : profile.role === "seller"
        ? { href: "/vendedor", label: "Área de colaborador" }
        : { href: "/cliente", label: "Área de cliente" };

  return <Chat voltarHref={voltar.href} voltarLabel={voltar.label} />;
}
