"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Percent, Power, Save } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";

/**
 * Painel de gestão da ficha de um revendedor.
 *
 * Desconto de grosso, mínimo de unidades, estado e nota. Tudo numa chamada a
 * `actualizar_revendedor`, que valida o âmbito da província e trata `NULL`
 * como «não mexer». O desconto vazio devolve o revendedor ao desconto da
 * empresa (`p_limpar_desconto`); a nota vazia apaga-a (`p_limpar_nota`).
 */
export default function AcoesFicha({
  id,
  desconto,
  minimo,
  status,
  nota,
  telefone,
  nome,
}: {
  id: string;
  desconto: number | null;
  minimo: number;
  status: string;
  nota: string | null;
  telefone: string;
  nome: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(desconto === null ? "" : String(Math.round(Number(desconto) * 100)));
  const [m, setM] = useState(String(minimo));
  const [estado, setEstado] = useState(status);
  const [texto, setTexto] = useState(nota ?? "");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aGuardar, setAGuardar] = useState(false);

  async function guardar(novoEstado?: string) {
    setErro("");
    setAviso("");
    setAGuardar(true);
    try {
      const supabase = createClientBrowser();
      const descontoNum = Number(String(d).replace(",", "."));
      const minimoNum = Number(String(m).replace(",", "."));

      const { error } = await supabase.rpc("actualizar_revendedor", {
        p_id: id,
        p_desconto:
          String(d).trim() === "" || !Number.isFinite(descontoNum) ? null : descontoNum / 100,
        p_minimo: Number.isFinite(minimoNum) && minimoNum >= 1 ? Math.round(minimoNum) : null,
        p_status: novoEstado ?? null,
        p_nota: texto.trim(),
        p_limpar_desconto: String(d).trim() === "",
        p_limpar_nota: texto.trim() === "",
      });

      if (error) throw new Error(error.message);
      setAviso(novoEstado ? `Ficha ${novoEstado === "activo" ? "reactivada" : novoEstado}.` : "Ficha actualizada.");
      if (novoEstado) setEstado(novoEstado);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#262626] bg-[#141414] p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-[#F5F5F5]">Gestão da ficha</h2>
          <p className="text-[11px] text-[#6F6F6F]">
            Condições comerciais de {nome}. As alterações ficam registadas com data.
          </p>
        </div>
        <a
          href={`https://wa.me/${telefone.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
        >
          <MessageSquare className="h-3 w-3" />
          Falar no WhatsApp
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            <Percent className="h-3 w-3" />
            Desconto de grosso
          </span>
          <div className="flex items-center gap-1">
            <input
              value={d}
              onChange={(e) => setD(e.target.value)}
              inputMode="decimal"
              placeholder="empresa"
              className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
            />
            <span className="text-xs text-[#525252]">%</span>
          </div>
          <span className="mt-1 block text-[10px] text-[#525252]">
            Vazio = desconto da empresa.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Mínimo por produto
          </span>
          <input
            value={m}
            onChange={(e) => setM(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
          <span className="mt-1 block text-[10px] text-[#525252]">unidades</span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Estado
          </span>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            <option value="activo">activo</option>
            <option value="suspenso">suspenso</option>
            <option value="encerrado">encerrado</option>
          </select>
          <span className="mt-1 block text-[10px] text-[#525252]">
            Suspenso não compra ao grosso.
          </span>
        </label>

        <label className="block sm:col-span-3">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Nota interna
          </span>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Ex.: compra sempre ao dia 5, entrega na loja do centro."
            className="w-full resize-y rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>
      </div>

      {erro && (
        <p className="mt-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mt-3 rounded-lg border border-[#1F3D2B] bg-[#0F1F16] px-3 py-2 text-xs text-[#4ADE80]">
          {aviso}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => guardar()}
          disabled={aGuardar}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
        >
          {aGuardar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Guardar alterações
        </button>

        {status === "activo" ? (
          <button
            type="button"
            onClick={() => guardar("suspenso")}
            disabled={aGuardar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#4A2020] px-4 py-2 text-xs text-[#F87171] transition hover:bg-[#2A1010] disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" />
            Suspender
          </button>
        ) : (
          <button
            type="button"
            onClick={() => guardar("activo")}
            disabled={aGuardar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6B45] px-4 py-2 text-xs text-[#4ADE80] transition hover:bg-[#12351F] disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" />
            Reactivar
          </button>
        )}
      </div>
    </section>
  );
}
