import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import Chat from "@/components/Chat";

export const dynamic = "force-dynamic";

/**
 * Mensagens da gerência.
 *
 * É o mesmo mensageiro de `/conversas`; a diferença é que o gestor vê todas as
 * conversas da empresa (`conversations_select` inclui `is_manager()`), não só
 * aquelas em que figura. Para responder numa conversa alheia tem de entrar
 * nela — a política `messages_insert` exige `is_conversation_member(...)`.
 */
export default async function GerenteConversasPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/gerente/conversas");
  if (profile.role !== "manager") redirect("/");

  return (
    <Chat
      voltarHref="/gerente"
      voltarLabel="Painel de gestão"
      vazioTexto="Ainda não há conversas na empresa. Comece uma conversa directa ou crie um grupo."
    />
  );
}
