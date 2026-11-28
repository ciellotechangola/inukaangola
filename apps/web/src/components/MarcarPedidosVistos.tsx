"use client";

import { useEffect } from "react";
import { marcarPedidosVistos } from "@/lib/notificacoes";

/**
 * ZERA O CONTADOR DE PEDIDOS QUANDO A LISTA JÁ ESTÁ NO ECRÃ.
 *
 * Não se faz no `page.tsx`: o servidor não sabe se a pessoa chegou a ver a
 * lista (pode ter saído antes do primeiro pintado), e marcar na renderização
 * do servidor zerava o número sem ninguém ter lido nada.
 *
 * Fica no fundo da página e não desenha nada.
 */
export default function MarcarPedidosVistos() {
  useEffect(() => {
    marcarPedidosVistos().catch(() => {
      // Sem a 0036 aplicada a RPC não existe — não há nada a marcar.
    });
  }, []);

  return null;
}
