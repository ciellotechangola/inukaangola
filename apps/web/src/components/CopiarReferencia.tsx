"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copiar a referência para a área de transferência.
 *
 * A referência é ditada ao telefone e escrita em fichas de papel — por isso o
 * botão tem de confirmar visualmente que copiou.
 */
export default function CopiarReferencia({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      // Navegador antigo ou sem permissão: seleccionar o texto é o suficiente.
      const el = document.createElement("textarea");
      el.value = valor;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title="Copiar referência"
      aria-label="Copiar referência"
      className="inline-flex items-center gap-1 rounded-md border border-[#333] px-2 py-1 text-[11px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
    >
      {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}
