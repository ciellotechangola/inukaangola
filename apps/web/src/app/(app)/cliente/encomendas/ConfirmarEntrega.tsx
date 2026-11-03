"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { updateOrderStatus } from "@/lib/api";

/**
 * "Já recebi".
 *
 * A loja marca "em entrega"; quem sabe se a encomenda chegou é o comprador.
 * Só aparece quando a encomenda está em entrega ou pronta para levantamento —
 * antes disso não haveria nada para confirmar, e a base recusa a transição.
 */
export default function ConfirmarEntrega({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [aConfirmar, setAConfirmar] = useState(false);
  const [erro, setErro] = useState("");

  async function confirmar() {
    const certo = window.confirm(
      "Confirma que recebeu esta encomenda? A encomenda fica concluída e não pode ser alterada depois."
    );
    if (!certo) return;

    setErro("");
    setAConfirmar(true);
    try {
      await updateOrderStatus(orderId, "completed", "Recebida pelo cliente");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível confirmar.");
    } finally {
      setAConfirmar(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#262626] pt-3">
      <button
        onClick={confirmar}
        disabled={aConfirmar}
        className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
      >
        <PackageCheck className="h-3.5 w-3.5" />
        {aConfirmar ? "A confirmar…" : "Já recebi a encomenda"}
      </button>
      <span className="text-[11px] text-[#6F6F6F]">
        Confirme só depois de ter o produto em mãos.
      </span>
      {erro && <span className="text-[11px] text-[#F87171]">{erro}</span>}
    </div>
  );
}
