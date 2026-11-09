"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";

export interface ProdutoBalcao {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  disponivel: number;
}

interface LinhaCarrinho {
  produto: ProdutoBalcao;
  quantidade: number;
}

const PAGAMENTOS = [
  { valor: "dinheiro", etiqueta: "Dinheiro" },
  { valor: "multicaixa", etiqueta: "Multicaixa" },
  { valor: "transferencia", etiqueta: "Transferência" },
];

/**
 * Balcão.
 *
 * O browser só envia `product_id` e `quantity`. O preço, o total e a baixa de
 * stock são calculados no servidor (`registar_venda_loja`), para que ninguém
 * consiga vender a um preço inventado.
 */
export default function Balcao({
  produtos,
  provinciaId,
}: {
  produtos: ProdutoBalcao[];
  provinciaId: string | null;
}) {
  const router = useRouter();
  const [pesquisa, setPesquisa] = useState("");
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [pagamento, setPagamento] = useState("dinheiro");
  const [telefone, setTelefone] = useState("");
  const [notas, setNotas] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState("");
  const [recibo, setRecibo] = useState<{ reference: string; total: number } | null>(null);

  const encontrados = useMemo(() => {
    const termo = pesquisa.trim().toLowerCase();
    if (!termo) return produtos.slice(0, 12);
    return produtos
      .filter(
        (p) =>
          p.name.toLowerCase().includes(termo) || (p.sku ?? "").toLowerCase().includes(termo)
      )
      .slice(0, 20);
  }, [pesquisa, produtos]);

  const total = carrinho.reduce((s, l) => s + l.produto.price * l.quantidade, 0);

  function juntar(p: ProdutoBalcao) {
    setErro("");
    setRecibo(null);
    if (p.disponivel <= 0) {
      setErro(`«${p.name}» está esgotado nesta província.`);
      return;
    }
    setCarrinho((prev) => {
      const existe = prev.find((l) => l.produto.id === p.id);
      if (existe) {
        if (existe.quantidade >= p.disponivel) return prev;
        return prev.map((l) =>
          l.produto.id === p.id ? { ...l, quantidade: l.quantidade + 1 } : l
        );
      }
      return [...prev, { produto: p, quantidade: 1 }];
    });
  }

  function mudar(id: string, delta: number) {
    setCarrinho((prev) =>
      prev
        .map((l) =>
          l.produto.id === id
            ? {
                ...l,
                quantidade: Math.min(
                  Math.max(0, l.quantidade + delta),
                  l.produto.disponivel
                ),
              }
            : l
        )
        .filter((l) => l.quantidade > 0)
    );
  }

  async function registar() {
    if (carrinho.length === 0) return;
    setAEnviar(true);
    setErro("");
    setRecibo(null);

    try {
      const supabase = createClientBrowser();
      const { data, error } = await supabase.rpc("registar_venda_loja", {
        p_items: carrinho.map((l) => ({
          product_id: l.produto.id,
          quantity: l.quantidade,
        })),
        p_payment_method: pagamento,
        p_customer_phone: telefone.trim() || null,
        p_notes: notas.trim() || null,
        p_client_ref: crypto.randomUUID(),
        p_provincia_id: provinciaId,
      });

      if (error) throw new Error(error.message);

      const r = data as { reference: string; total: number };
      setRecibo({ reference: r.reference, total: Number(r.total) });
      setCarrinho([]);
      setTelefone("");
      setNotas("");
      router.refresh();
    } catch (e) {
      setErro(mensagemDeErro(e, "supabase/PATCH_PERFIS_LOJA.sql", "Não foi possível registar a venda."));
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* ------------------------------------------------------- produtos */}
      <section>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
          <input
            value={pesquisa}
            onChange={(e) => setPesquisa(e.target.value)}
            placeholder="Procurar produto por nome ou SKU"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] py-2.5 pl-9 pr-3 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {encontrados.map((p) => (
            <button
              key={p.id}
              onClick={() => juntar(p)}
              disabled={p.disponivel <= 0}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#262626] bg-[#141414] px-4 py-3 text-left transition hover:border-[#5FBF8F]/60 disabled:opacity-40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-[#EDEDED]">{p.name}</span>
                <span className="block font-mono text-[10px] text-[#525252]">
                  {p.sku ?? "sem SKU"} · {p.disponivel} un.
                </span>
              </span>
              <span className="shrink-0 text-sm text-[#C9A962]">{formatCurrency(p.price)}</span>
            </button>
          ))}
        </div>

        {encontrados.length === 0 && (
          <p className="rounded-xl border border-[#262626] bg-[#141414] p-6 text-sm text-[#6F6F6F]">
            Nenhum produto encontrado.
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- carrinho */}
      <aside className="h-fit rounded-xl border border-[#262626] bg-[#141414] p-4 lg:sticky lg:top-24">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
          <ShoppingCart className="h-4 w-4 text-[#5FBF8F]" />
          Venda actual
        </h2>

        {carrinho.length === 0 ? (
          <p className="mb-3 text-sm text-[#525252]">Escolha produtos à esquerda.</p>
        ) : (
          <ul className="mb-3 divide-y divide-[#1F1F1F]">
            {carrinho.map((l) => (
              <li key={l.produto.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm text-[#EDEDED]">
                    {l.produto.name}
                  </p>
                  <button
                    onClick={() => mudar(l.produto.id, -l.quantidade)}
                    aria-label={`Remover ${l.produto.name}`}
                    className="text-[#6F6F6F] hover:text-[#F87171]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => mudar(l.produto.id, -1)}
                      className="rounded border border-[#333] p-1 text-[#A3A3A3] hover:border-[#C9A962]"
                      aria-label="Diminuir"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-7 text-center text-sm text-[#F5F5F5]">
                      {l.quantidade}
                    </span>
                    <button
                      onClick={() => mudar(l.produto.id, 1)}
                      className="rounded border border-[#333] p-1 text-[#A3A3A3] hover:border-[#C9A962]"
                      aria-label="Aumentar"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="text-sm text-[#C9A962]">
                    {formatCurrency(l.produto.price * l.quantidade)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mb-3 flex items-baseline justify-between border-t border-[#262626] pt-3">
          <span className="text-sm text-[#A3A3A3]">Total</span>
          <span className="text-lg font-medium text-[#C9A962]">{formatCurrency(total)}</span>
        </div>

        <div className="space-y-2">
          <select
            value={pagamento}
            onChange={(e) => setPagamento(e.target.value)}
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            {PAGAMENTOS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.etiqueta}
              </option>
            ))}
          </select>
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="Telefone do cliente (opcional)"
            inputMode="tel"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Nota (opcional)"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </div>

        {erro && <p className="mt-2 text-xs text-[#F87171]">{erro}</p>}
        {recibo && (
          <div className="mt-2 rounded-lg bg-[#0F2A18] px-3 py-2 text-xs text-[#4ADE80]">
            <p className="flex items-center gap-1 font-medium">
              <Check className="h-3.5 w-3.5" /> Venda registada
            </p>
            <p className="font-mono">{recibo.reference}</p>
            <p>{formatCurrency(recibo.total)}</p>
          </div>
        )}

        <button
          onClick={registar}
          disabled={aEnviar || carrinho.length === 0}
          className="mt-3 w-full rounded-lg bg-[#5FBF8F] px-4 py-2.5 text-sm font-semibold text-[#07130D] transition hover:bg-[#78D6A6] disabled:opacity-40"
        >
          {aEnviar ? "A registar…" : "Registar venda"}
        </button>

        <p className="mt-2 text-[11px] text-[#525252]">
          A venda dá baixa imediata no stock e não gera comissão.
        </p>
      </aside>
    </div>
  );
}
