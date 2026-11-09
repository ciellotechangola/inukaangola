"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Package, Search } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";

export interface LinhaStock {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  is_active: boolean;
  quantity: number;
  reserved: number;
  threshold: number;
}

/**
 * Contagem de stock.
 *
 * A quantidade nunca é calculada no browser: grava-se pelo RPC
 * `set_product_stock`, que valida a província, escreve o movimento e devolve
 * o valor efectivo. Assim o histórico fica sempre coerente.
 */
export default function GestorStock({
  linhas,
  provinciaId,
}: {
  linhas: LinhaStock[];
  provinciaId: string | null;
}) {
  const [itens, setItens] = useState(linhas);
  const [pesquisa, setPesquisa] = useState("");
  const [soBaixo, setSoBaixo] = useState(false);
  const [edicao, setEdicao] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const visiveis = useMemo(() => {
    const termo = pesquisa.trim().toLowerCase();
    return itens.filter((l) => {
      const disponivel = Math.max(0, l.quantity - l.reserved);
      if (soBaixo && disponivel > l.threshold) return false;
      if (!termo) return true;
      return (
        l.name.toLowerCase().includes(termo) || (l.sku ?? "").toLowerCase().includes(termo)
      );
    });
  }, [itens, pesquisa, soBaixo]);

  async function guardar(linha: LinhaStock) {
    const bruto = edicao[linha.id];
    const nova = Number(bruto);

    if (bruto === undefined || bruto === "") return;
    if (!Number.isFinite(nova) || nova < 0) {
      setErro("A quantidade tem de ser um número igual ou maior que zero.");
      return;
    }

    setOcupado(linha.id);
    setErro("");
    setAviso("");

    try {
      const supabase = createClientBrowser();
      const { data, error } = await supabase.rpc("set_product_stock", {
        p_product_id: linha.id,
        p_quantity: Math.trunc(nova),
        p_reason: "Contagem na loja",
        p_provincia_id: provinciaId,
      });
      if (error) throw new Error(error.message);

      const efectiva = Number((data as { quantity?: number } | null)?.quantity ?? nova);
      setItens((prev) =>
        prev.map((l) => (l.id === linha.id ? { ...l, quantity: efectiva } : l))
      );
      setEdicao((prev) => {
        const copia = { ...prev };
        delete copia[linha.id];
        return copia;
      });
      setAviso(`«${linha.name}» actualizado para ${efectiva} un.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
          <input
            value={pesquisa}
            onChange={(e) => setPesquisa(e.target.value)}
            placeholder="Procurar por nome ou SKU"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#A3A3A3]">
          <input
            type="checkbox"
            checked={soBaixo}
            onChange={(e) => setSoBaixo(e.target.checked)}
            className="accent-[#C9A962]"
          />
          Só stock baixo
        </label>
      </div>

      {erro && (
        <p className="mb-3 rounded-lg bg-[#2A1010] px-3 py-2 text-sm text-[#F87171]">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-[#0F2A18] px-3 py-2 text-sm text-[#4ADE80]">{aviso}</p>
      )}

      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-[#262626] bg-[#141414] p-6 text-sm text-[#6F6F6F]">
          Nenhum produto encontrado.
        </p>
      ) : (
        <ul className="divide-y divide-[#1F1F1F] overflow-hidden rounded-xl border border-[#262626]">
          {visiveis.map((l) => {
            const disponivel = Math.max(0, l.quantity - l.reserved);
            const baixo = disponivel <= l.threshold;
            const valor = edicao[l.id] ?? "";

            return (
              <li
                key={l.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                  baixo ? "bg-[#1C1212]" : "bg-[#121212]"
                }`}
              >
                <div className="min-w-[180px] flex-1">
                  <p className="flex items-center gap-2 text-sm text-[#EDEDED]">
                    {l.name}
                    {!l.is_active && (
                      <span className="rounded border border-[#3A3A3A] px-1.5 py-0.5 text-[10px] text-[#8A8A8A]">
                        inactivo
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[10px] text-[#525252]">
                    {l.sku ?? "sem SKU"} · {formatCurrency(l.price)}
                  </p>
                </div>

                <div className="w-24 text-right">
                  <p className={`text-sm ${baixo ? "text-[#F87171]" : "text-[#EDEDED]"}`}>
                    {disponivel} un.
                  </p>
                  <p className="text-[10px] text-[#525252]">
                    {l.reserved > 0 ? `${l.reserved} reservadas` : "sem reservas"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={valor}
                    onChange={(e) => setEdicao({ ...edicao, [l.id]: e.target.value })}
                    placeholder={String(l.quantity)}
                    className="w-20 rounded-lg border border-[#333] bg-[#0A0A0A] px-2 py-1.5 text-center text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
                    aria-label={`Nova quantidade de ${l.name}`}
                  />
                  <button
                    onClick={() => guardar(l)}
                    disabled={ocupado === l.id || valor === ""}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-40"
                  >
                    {ocupado === l.id ? (
                      "A guardar…"
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" /> Guardar
                      </>
                    )}
                  </button>
                </div>

                {baixo && (
                  <span className="flex items-center gap-1 text-[10px] text-[#F87171]">
                    <AlertTriangle className="h-3 w-3" />
                    {disponivel === 0 ? "esgotado" : `limiar ${l.threshold}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 flex items-center gap-2 text-[11px] text-[#525252]">
        <Package className="h-3.5 w-3.5" />
        Cada gravação fica no histórico de movimentos com a sua autoria.
      </p>
    </div>
  );
}
