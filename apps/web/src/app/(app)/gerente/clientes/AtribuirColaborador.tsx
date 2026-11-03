"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientBrowser } from "@/lib/supabase-browser";

interface Props {
  clienteId: string;
  vendedorAtual: string | null;
  vendedores: { id: string; full_name: string }[];
  /** Quem fez o vínculo actual e quando — para a gestão ver a origem. */
  ligadoPor?: string | null;
  ligadoEm?: string | null;
}

export default function AtribuirColaborador({
  clienteId,
  vendedorAtual,
  vendedores,
  ligadoPor,
  ligadoEm,
}: Props) {
  const router = useRouter();
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState("");

  async function atribuir(novo: string) {
    setErro("");
    setAGuardar(true);
    const supabase = createClientBrowser();
    try {
      // Um cliente tem no máximo um vínculo activo. Desactivar (em vez de
      // apagar) preserva quem o ligou e quando: a gestão consegue reconstruir
      // a história da carteira, que é o que o colaborador também vê.
      const { error: erroDesactivar } = await supabase
        .from("seller_customers")
        .update({ is_active: false })
        .eq("customer_id", clienteId)
        .eq("is_active", true);
      if (erroDesactivar) throw new Error(erroDesactivar.message);

      if (novo) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error: erroUpsert } = await supabase.from("seller_customers").upsert(
          {
            seller_id: novo,
            customer_id: clienteId,
            assigned_by: user?.id ?? null,
            assigned_at: new Date().toISOString(),
            is_active: true,
          },
          { onConflict: "seller_id,customer_id" }
        );
        if (erroUpsert) throw new Error(erroUpsert.message);
      }

      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={vendedorAtual ?? ""}
        disabled={aGuardar}
        onChange={(e) => atribuir(e.target.value)}
        className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-1.5 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-50"
      >
        <option value="">Sem colaborador</option>
        {vendedores.map((v) => (
          <option key={v.id} value={v.id}>
            {v.full_name}
          </option>
        ))}
      </select>
      {ligadoEm && (
        <span className="text-[10px] text-[#525252]">
          {ligadoPor ? `por ${ligadoPor} · ` : ""}
          {new Date(ligadoEm).toLocaleDateString("pt-PT")}
        </span>
      )}
      {erro && <span className="text-[11px] text-[#DC2626]">{erro}</span>}
    </div>
  );
}
