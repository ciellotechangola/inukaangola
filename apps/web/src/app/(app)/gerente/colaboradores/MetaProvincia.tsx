"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemErro } from "@/lib/colaborador";
import type { Provincia } from "@/lib/provincias";

/**
 * Meta mensal de uma província (objectivo da equipa).
 *
 * A meta individual define-se na ficha de cada colaborador; esta é a da
 * delegação e serve de referência a quem ainda não tem meta própria.
 */
export default function MetaProvincia({
  provincias,
  provinciaFixa,
}: {
  provincias: Provincia[];
  provinciaFixa: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [provincia, setProvincia] = useState(provinciaFixa ?? "");
  const [valor, setValor] = useState("");
  const [vendas, setVendas] = useState("");
  const [estado, setEstado] = useState<"idle" | "a-guardar" | "ok" | "erro">("idle");
  const [msg, setMsg] = useState("");

  async function guardar() {
    const alvo = provinciaFixa ?? provincia;
    if (!alvo) {
      setEstado("erro");
      setMsg("Escolha a província.");
      return;
    }

    setEstado("a-guardar");
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("definir_meta", {
      p_seller_id: null,
      p_provincia_id: alvo,
      p_inicio: null,
      p_fim: null,
      p_valor: Number(valor) || 0,
      p_vendas: Number(vendas) || 0,
    });

    if (error) {
      setEstado("erro");
      setMsg(mensagemErro(error));
      return;
    }

    setEstado("ok");
    setMsg("Meta da província guardada.");
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      >
        <Target className="h-3.5 w-3.5" />
        Meta da província
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4">
      <p className="mb-3 text-xs uppercase tracking-wide text-[#6F6F6F]">
        Meta mensal da província
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {!provinciaFixa && (
          <select
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            className={campo}
            aria-label="Província"
          >
            <option value="">Escolher província</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        )}

        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          type="number"
          min={0}
          placeholder="Valor (AOA)"
          className={campo}
          aria-label="Valor da meta"
        />
        <input
          value={vendas}
          onChange={(e) => setVendas(e.target.value)}
          type="number"
          min={0}
          placeholder="Nº de vendas"
          className={`${campo} w-28`}
          aria-label="Número de vendas"
        />

        <button
          type="button"
          onClick={guardar}
          disabled={estado === "a-guardar"}
          className="rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
        >
          {estado === "a-guardar" ? "A guardar…" : "Guardar"}
        </button>

        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-xs text-[#6F6F6F] transition hover:text-[#F5F5F5]"
        >
          fechar
        </button>
      </div>

      {valor && Number(valor) > 0 && (
        <p className="mt-2 text-[11px] text-[#525252]">
          Objectivo: {formatCurrency(Number(valor))}
          {vendas ? ` · ${vendas} vendas` : ""}
        </p>
      )}
      {msg && (
        <p className={`mt-2 text-[11px] ${estado === "erro" ? "text-[#F87171]" : "text-[#4ADE80]"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

const campo =
  "rounded-lg border border-[#333] bg-[#0A0A0A] px-2.5 py-2 text-xs text-[#E5E5E5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";
