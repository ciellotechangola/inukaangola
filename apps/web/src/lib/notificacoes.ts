"use client";

import { useCallback, useEffect, useState } from "react";
import { createClientBrowser } from "./supabase-browser";

/**
 * Os dois números do cabeçalho.
 *
 * Uma só chamada (`contadores_nao_lidas`, migração 0036) devolve tudo: contar
 * no browser obrigaria a trazer mensagens e pedidos todos para o cliente só
 * para somar, e o RLS deixaria metade de fora.
 */
export interface Contadores {
  /** Mensagens de outras pessoas que ainda não abri. */
  mensagens: number;
  /** Pedidos com novidade — ou, para a gestão, pedidos à espera. */
  pedidos: number;
}

const ZERO: Contadores = { mensagens: 0, pedidos: 0 };

/** Quanto tempo entre uma verificação e a seguinte, quando o realtime falha. */
const INTERVALO = 30_000;

export async function lerContadores(): Promise<Contadores> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("contadores_nao_lidas");
  // Sem a 0036 aplicada a função não existe: zero é melhor do que uma barra
  // de erro em todas as páginas do site.
  if (error) return ZERO;

  const bruto = (data ?? {}) as { mensagens?: number | string; pedidos?: number | string };
  return {
    mensagens: Number(bruto.mensagens ?? 0) || 0,
    pedidos: Number(bruto.pedidos ?? 0) || 0,
  };
}

/**
 * Abrir a área de pedidos marca-os como vistos.
 *
 * Chama-se depois de a lista estar no ecrã — o servidor não sabe o que o
 * browser mostrou, e marcar no `page.tsx` zerava o contador mesmo que a
 * pessoa saísse antes de ver o primeiro pedido.
 */
export async function marcarPedidosVistos(): Promise<void> {
  const supabase = createClientBrowser();
  await supabase.rpc("marcar_pedidos_vistos");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("inuka:pedidos"));
}

/**
 * Contadores vivos.
 *
 * Três caminhos para o mesmo número, por ordem de rapidez:
 *   1. realtime — mensagem nova, «lido» novo, estado de pedido mudado;
 *   2. eventos da própria aplicação (`inuka:mensagens`, `inuka:pedidos`) —
 *      enviar, abrir ou marcar como lido não precisa de ir à rede outra vez;
 *   3. um ciclo de 30 s e o voltar ao separador — para quando o websocket
 *      caiu (telemóvel em segundo plano) e ninguém deu por isso.
 */
export function useNotificacoes(activo: boolean) {
  const [contadores, setContadores] = useState<Contadores>(ZERO);

  const recarregar = useCallback(async () => {
    const novos = await lerContadores();
    // Objecto novo só quando o número muda: um `setState` igual re-renderiza
    // o cabeçalho de 30 em 30 segundos sem nada ter mudado.
    setContadores((antes) =>
      antes.mensagens === novos.mensagens && antes.pedidos === novos.pedidos ? antes : novos
    );
  }, []);

  useEffect(() => {
    if (!activo) return;

    let cancelado = false;
    const actualizar = () => {
      if (!cancelado) recarregar().catch(() => {});
    };

    actualizar();

    const supabase = createClientBrowser();
    // Nome único: o Chat tem o seu canal, e dois canais com o mesmo nome no
    // mesmo cliente fazem o segundo ser ignorado em silêncio.
    const canal = supabase
      .channel(`avisos:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        actualizar
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_members" },
        actualizar
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        actualizar
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "revendedor_pedidos" },
        actualizar
      )
      .subscribe();

    const relogio = setInterval(actualizar, INTERVALO);

    const aoVoltar = () => {
      if (document.visibilityState === "visible") actualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("inuka:mensagens", actualizar);
    window.addEventListener("inuka:pedidos", actualizar);

    return () => {
      cancelado = true;
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("inuka:mensagens", actualizar);
      window.removeEventListener("inuka:pedidos", actualizar);
      supabase.removeChannel(canal);
    };
  }, [activo, recarregar]);

  return { contadores, recarregar };
}
