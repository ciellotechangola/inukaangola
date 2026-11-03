"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";

interface Props {
  id: string;
  regiao: string | null;
  /** Taxa pessoal. `null` = herda a taxa da empresa. */
  comissao: number | null;
}

export default function AcoesVendedor({ id, regiao, comissao }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [regiaoEdit, setRegiaoEdit] = useState(regiao ?? "");
  const [comissaoEdit, setComissaoEdit] = useState(
    comissao === null ? "" : String(Number((comissao * 100).toFixed(2)))
  );
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setErro("");

    const texto = comissaoEdit.trim();
    const taxa = texto === "" ? null : Number(texto.replace(",", ".")) / 100;

    if (taxa !== null && (!Number.isFinite(taxa) || taxa < 0 || taxa > 1)) {
      setErro("Comissão entre 0 e 100 %.");
      return;
    }

    setOcupado(true);
    const supabase = createClientBrowser();

    const { error } = await supabase
      .from("seller_profiles")
      .update({ region: regiaoEdit.trim() || null })
      .eq("id", id);

    if (error) {
      setOcupado(false);
      setErro(error.message);
      return;
    }

    // A taxa vai por RPC: vazio tem de gravar NULL ("herda"), e não 0.
    const { error: erroTaxa } = await supabase.rpc("definir_taxa_colaborador", {
      p_id: id,
      p_rate: taxa,
    });

    setOcupado(false);
    if (erroTaxa) {
      setErro(erroTaxa.message);
      return;
    }
    setAberto(false);
    router.refresh();
  }

  async function despromover() {
    const confirmado = window.confirm(
      "Tornar este colaborador em cliente? Perde o acesso à área de colaborador. O histórico de vendas mantém-se."
    );
    if (!confirmado) return;

    setErro("");
    setOcupado(true);
    const supabase = createClientBrowser();
    try {
      const { error: erroPapel } = await supabase
        .from("profiles")
        .update({ role: "customer" })
        .eq("id", id);
      if (erroPapel) throw new Error(erroPapel.message);

      // A ficha de vendedor deixa de fazer sentido; vendas e clientes
      // associados apontam para profiles, por isso o histórico fica intacto.
      const { error: erroFicha } = await supabase.from("seller_profiles").delete().eq("id", id);
      if (erroFicha) throw new Error(erroFicha.message);

      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar.");
    } finally {
      setOcupado(false);
    }
  }

  if (aberto) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <input
            value={regiaoEdit}
            onChange={(e) => setRegiaoEdit(e.target.value)}
            placeholder="Região"
            className="w-28 rounded-lg border border-[#404040] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
          <input
            value={comissaoEdit}
            onChange={(e) => setComissaoEdit(e.target.value)}
            inputMode="decimal"
            placeholder="empresa"
            title="Percentagem. Vazio = taxa da empresa."
            className="w-20 rounded-lg border border-[#404040] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
          <button
            onClick={guardar}
            disabled={ocupado}
            aria-label="Guardar"
            className="rounded-lg border border-[#C9A962] px-2 py-1 text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
        {erro && <span className="text-[11px] text-[#DC2626]">{erro}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {erro && <span className="text-[11px] text-[#DC2626]">{erro}</span>}
      <button
        onClick={() => setAberto(true)}
        className="rounded-lg border border-[#333] px-3 py-1 text-xs text-[#A3A3A3] transition hover:border-[#C9A962] hover:text-[#C9A962]"
      >
        Editar
      </button>
      <button
        onClick={despromover}
        disabled={ocupado}
        aria-label="Tornar cliente"
        className="rounded-lg border border-[#333] p-1.5 text-[#8A8A8A] transition hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
