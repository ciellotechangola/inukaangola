"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Check } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { registerSale, registerSaleByPhone, type PaymentStatus } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  official_price: number;
  promotional_price: number | null;
}

interface Line {
  product_id: string;
  quantity: number;
}

export default function RegisterSalePage() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ reference: string; total: number } | null>(null);

  useEffect(() => {
    const supabase = createClientBrowser();
    supabase
      .from("products")
      .select("id, name, sku, official_price, promotional_price")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setProducts((data ?? []) as ProductOption[]));
  }, []);

  const priceOf = (p?: ProductOption) =>
    p ? Number(p.promotional_price ?? p.official_price) : 0;

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const p = products.find((x) => x.id === line.product_id);
        return sum + priceOf(p) * line.quantity;
      }, 0),
    [lines, products]
  );

  function addLine() {
    const available = products.find((p) => !lines.some((l) => l.product_id === p.id));
    if (!available) return;
    setLines((prev) => [...prev, { product_id: available.id, quantity: 1 }]);
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleSubmit() {
    setError("");
    setInfo("");

    if (lines.length === 0) {
      setError("Adicione pelo menos um produto.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      setError("As quantidades devem ser superiores a zero.");
      return;
    }

    setSaving(true);
    try {
      const telefone = customerPhone.trim();
      const detalhes = { paymentMethod, paymentStatus, notes: notes || undefined };

      // O telefone é o cadastro: a base de dados decide sozinha se o cliente já
      // tem conta (entra na carteira) ou não (fica reservado). Não há aqui
      // passo nenhum de «associar primeiro».
      if (telefone) {
        const sale = await registerSaleByPhone(lines, telefone, {
          ...detalhes,
          customerName,
        });
        const nome = customerName.trim() || "O cliente";

        setResult({ reference: sale.reference, total: Number(sale.total) });
        setInfo(
          sale.duplicated
            ? "Operação já registada anteriormente."
            : sale.conquistado
              ? `Venda registada. ${nome} entrou nos seus clientes conquistados.`
              : `Venda registada. ${nome} ficou na sua carteira por activar — recebe esta compra quando abrir conta com o número ${telefone}.`
        );
      } else {
        const sale = await registerSale(lines, detalhes);
        setResult({ reference: sale.reference, total: Number(sale.total) });
        setInfo(
          sale.duplicated
            ? "Operação já registada anteriormente."
            : "Venda registada com sucesso."
        );
      }

      setLines([]);
      setNotes("");
      setCustomerName("");
      setCustomerPhone("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível registar a venda.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/vendedor" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Área do colaborador
      </Link>
      <h1 className="mb-8 text-3xl font-light text-[#F5F5F5]">Registar venda</h1>

      {error && <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      {info && <div className="mb-4 rounded-lg bg-green-950/50 p-3 text-sm text-green-200">{info}</div>}

      {result && (
        <div className="mb-4 rounded-lg border border-[#C9A962]/40 bg-[#C9A962]/10 p-4">
          <p className="text-sm text-[#C9A962]">
            Venda <span className="font-medium">{result.reference}</span> —{" "}
            {formatCurrency(result.total)}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
        <div className="mb-4 space-y-3">
          {lines.length === 0 && (
            <p className="text-sm text-[#525252]">Nenhum produto adicionado.</p>
          )}

          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-3">
              <select
                value={line.product_id}
                onChange={(e) => updateLine(index, { product_id: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""} — {formatCurrency(priceOf(p))}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                className="w-20 rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              />

              <span className="w-28 text-right text-sm text-[#C9A962]">
                {formatCurrency(priceOf(products.find((p) => p.id === line.product_id)) * line.quantity)}
              </span>

              <button
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                className="text-[#A3A3A3] hover:text-[#DC2626]"
                aria-label="Remover linha"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addLine}
          disabled={lines.length >= products.length}
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-[#404040] px-4 py-2 text-sm text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Adicionar produto
        </button>

        <div className="mb-5 rounded-xl border border-[#2A2A2A] bg-[#141414] p-4">
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Quem comprou
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nome do cliente"
              className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Telefone (+244 9xx xxx xxx)"
              className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#6F6F6F]">
            {customerPhone.trim() ? (
              <>
                Com o telefone, o cliente entra sozinho nos seus{" "}
                <span className="text-[#C9A962]">clientes conquistados</span>: se já tiver
                conta fica logo associado a si; se ainda não tiver, fica na carteira como{" "}
                <span className="text-[#C9A962]">por activar</span>, com o nome, a compra e
                o valor — a conta abre-a ele quando quiser.
              </>
            ) : (
              <>
                O telefone é o que liga a compra a uma pessoa. Sem ele a venda fica registada à
                mesma, mas ninguém entra nos seus clientes conquistados.
              </>
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            <option value="cash">Numerário</option>
            <option value="transfer">Transferência</option>
            <option value="multicaixa">Multicaixa</option>
            <option value="other">Outro</option>
          </select>
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
            className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            <option value="paid">Pago</option>
            <option value="pending">Pendente</option>
            <option value="partial">Parcial</option>
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações"
            className="rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-[#262626] pt-4">
          <span className="text-[#A3A3A3]">Total</span>
          <span className="text-lg font-medium text-[#C9A962]">{formatCurrency(total)}</span>
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
        >
          {saving ? "A registar..." : "Registar venda"}
          {!saving && <Check className="h-4 w-4" />}
        </button>

        <p className="mt-3 text-xs text-[#525252]">
          O stock e os preços são validados no servidor. Vendas repetidas com a mesma referência
          não são duplicadas. O telefone é o cadastro do cliente: com ele, quem comprou passa a
          ser seu cliente conquistado — associado à sua carteira se já tiver conta, reservado com
          o nome e a compra se ainda não tiver.
        </p>
      </div>
    </main>
  );
}
