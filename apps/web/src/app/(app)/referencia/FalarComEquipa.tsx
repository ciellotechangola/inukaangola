"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Users } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";

/**
 * Abre a conversa privada com a gestão.
 *
 * Já não é um grupo com o colaborador **e** a gestão: o cliente via-se numa
 * sala de três pessoas e nunca sabia quem respondia. Passa a ser uma conversa
 * directa com o gestor (migração 0011). Grupos ficaram reservados à equipa
 * interna.
 */
export default function FalarComEquipa(_props: { temColaborador?: boolean }) {
  const router = useRouter();
  const [aAbrir, setAAbrir] = useState(false);
  const [erro, setErro] = useState("");

  async function abrir() {
    setErro("");
    setAAbrir(true);

    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("abrir_conversa_equipa");

    if (error || !data) {
      setAAbrir(false);
      setErro(
        /could not find the function|PGRST202/i.test(error?.message ?? "")
          ? "Falta aplicar a migração das conversas de equipa."
          : (error?.message ?? "Não foi possível abrir a conversa.")
      );
      return;
    }

    router.push(`/conversas?c=${data as string}`);
  }

  return (
    <div>
      <button
        onClick={abrir}
        disabled={aAbrir}
        className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
      >
        <MessageCircle className="h-4 w-4" />
        {aAbrir ? "A abrir…" : "Enviar mensagem"}
      </button>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#6F6F6F]">
        <Users className="h-3 w-3" />
        Conversa privada com a gestão INUKA — só vocês dois.
      </p>

      {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}
    </div>
  );
}
