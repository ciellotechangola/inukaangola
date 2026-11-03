import Chat from "@/components/Chat";

export const dynamic = "force-dynamic";

/**
 * Mantida por compatibilidade: os links antigos apontam para aqui.
 * A conversa em si vive em `components/Chat.tsx`, partilhada por todos os perfis.
 */
export default function ClienteConversasPage() {
  return <Chat voltarHref="/cliente" voltarLabel="Área de cliente" />;
}
