"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Send } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { ESTADOS, type EstadoPedido } from "@/lib/revenda";

const RESPOSTA: EstadoPedido[] = [
  "em_analise",
  "cotado",
  "aprovado",
  "enviado",
  "entregue",
  "cancelado",
];

/**
 * Responder a um pedido de grosso.
 *
 * O estado e a nota vão juntos: quem lê «cotado» sem o valor ao lado fica a
 * saber o mesmo que antes. A nota é opcional, mas é ela que fecha o ciclo com
 * o revendedor.
 */
export default function AcoesPedido({
  pedido,
}: {
  pedido: { id: string; numero: string; status: string; resposta: string | null };
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoPedido>(
    RESPOSTA.includes(pedido.status as EstadoPedido) ? (pedido.status as EstadoPedido) : "em_analise"
  );
  const [resposta, setResposta] = useState(pedido.resposta ?? "");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState("");
  const [guardado, setGuardado] = useState(false);

  async function guardar() {
    setErro("");
    setGuardado(false);
    setAGuardar(true);
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase.rpc("responder_pedido_revendedor", {
        p_pedido: pedido.id,
        p_status: estado,
        p_resposta: resposta.trim() || null,
      });
      if (error) throw new Error(error.message);
      setGuardado(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Estado</span>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoPedido)}
            className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            {RESPOSTA.map((s) => (
              <option key={s} value={s}>
                {ESTADOS[s].rotulo}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-[12rem] flex-1">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Resposta ao revendedor</span>
          <input
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            placeholder="Ex.: 5 un. a 5 500 Kz, entrega em 3 dias."
            maxLength={800}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={guardar}
          disabled={aGuardar}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {aGuardar ? "A guardar…" : "Responder"}
        </button>
      </div>

      {erro && (
        <p className="mt-2 rounded-lg border border-[#4A2020] bg-[#2A1010] px-2.5 py-1.5 text-[11px] text-[#F87171]">
          {erro}
        </p>
      )}
      {guardado && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#4ADE80]">
          <Check className="h-3 w-3" />
          Resposta guardada.
        </p>
      )}
    </div>
  );
}
