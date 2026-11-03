"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientBrowser } from "@/lib/supabase-browser";

/**
 * O estado da encomenda é mudado pela gestão noutro sítio. Sem isto o cliente
 * tinha de recarregar a página para saber que a encomenda já saiu — e a maior
 * parte das vezes não recarregava, ficava com "Pendente" no ecrã.
 *
 * A subscrição ouve `orders` (já está na publicação `supabase_realtime`). O
 * filtro por `customer_id` é só uma optimização: quem manda é o RLS do
 * Realtime, que apenas entrega as linhas que este utilizador pode ler.
 */
export default function SeguirEncomendas({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const [aviso, setAviso] = useState(false);

  useEffect(() => {
    const supabase = createClientBrowser();

    const canal = supabase
      .channel(`encomendas-${clienteId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `customer_id=eq.${clienteId}`,
        },
        () => {
          setAviso(true);
          router.refresh();
        }
      )
      .subscribe();

    // Voltar à aplicação depois de a ter deixado em segundo plano é o caso
    // mais comum no telemóvel: o evento pode ter chegado com o separador
    // suspenso, por isso relemos ao ficar visível outra vez.
    function aoVoltar() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      supabase.removeChannel(canal);
    };
  }, [clienteId, router]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(false), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  if (!aviso) return null;

  return (
    <p
      role="status"
      className="mb-4 rounded-lg border border-[#C9A962]/40 bg-[#C9A962]/10 px-4 py-2 text-sm text-[#C9A962]"
    >
      O estado da sua encomenda mudou — actualizado agora.
    </p>
  );
}
