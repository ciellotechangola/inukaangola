"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProductImage from "@/components/ProductImage";
import Link from "next/link";
import { Trash2, ArrowRight } from "lucide-react";
import { useCart } from "@/components/cart-context";
import { createClientBrowser } from "@/lib/supabase-browser";
import { placeOrder } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function CartPage() {
  const router = useRouter();
  const { items, total, setQuantity, remove, clear, ready } = useCart();

  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ reference: string; total: number } | null>(null);

  async function handleCheckout() {
    setError("");

    const supabase = createClientBrowser();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.push("/login?redirect=/carrinho");
      return;
    }

    if (deliveryMethod === "delivery" && !address.trim()) {
      setError("Indique o endereço de entrega.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await placeOrder(
        items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        {
          deliveryMethod,
          deliveryAddress: deliveryMethod === "delivery" ? address : undefined,
          contactPhone: phone || undefined,
          notes: notes || undefined,
        }
      );
      setSuccess({ reference: result.reference, total: Number(result.total) });
      clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a encomenda.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="rounded-2xl border border-[#262626] bg-[#1A1A1A] p-10">
          <h1 className="mb-3 text-2xl font-light text-[#C9A962]">Encomenda registada</h1>
          <p className="mb-2 text-[#A3A3A3]">A sua referência é</p>
          <p className="mb-4 text-2xl font-medium tracking-wider text-[#F5F5F5]">{success.reference}</p>
          <p className="mb-8 text-[#A3A3A3]">Total: {formatCurrency(success.total)}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/cliente/encomendas"
              className="rounded-lg bg-[#C9A962] px-6 py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
            >
              Acompanhar encomenda
            </Link>
            <Link
              href="/catalogo"
              className="rounded-lg border border-[#404040] px-6 py-3 font-medium text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
            >
              Continuar a comprar
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-[#A3A3A3]">A carregar carrinho...</p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="mb-3 text-2xl font-light text-[#F5F5F5]">O carrinho está vazio</h1>
        <p className="mb-8 text-[#A3A3A3]">Explore o catálogo e adicione produtos.</p>
        <Link
          href="/catalogo"
          className="inline-flex rounded-lg bg-[#C9A962] px-6 py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
        >
          Ver catálogo
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-8 text-3xl font-light text-[#F5F5F5]">Carrinho</h1>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.product_id}
              className="flex items-center gap-4 rounded-xl border border-[#262626] bg-[#1A1A1A] p-4"
            >
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#0A0A0A]">
                {item.image ? (
                  <ProductImage
                    src={item.image}
                    alt={item.name}
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#404040]">
                    INUKA
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[#F5F5F5]">{item.name}</p>
                <p className="text-sm text-[#C9A962]">{formatCurrency(item.price)}</p>
              </div>

              <div className="flex items-center rounded-lg border border-[#404040]">
                <button
                  onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                  className="px-2.5 py-1.5 text-[#A3A3A3] hover:text-[#C9A962]"
                  aria-label="Diminuir"
                >
                  −
                </button>
                <span className="min-w-8 text-center text-sm text-[#F5F5F5]">{item.quantity}</span>
                <button
                  onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                  className="px-2.5 py-1.5 text-[#A3A3A3] hover:text-[#C9A962]"
                  aria-label="Aumentar"
                >
                  +
                </button>
              </div>

              <p className="w-24 text-right text-sm text-[#F5F5F5]">
                {formatCurrency(item.price * item.quantity)}
              </p>

              <button
                onClick={() => remove(item.product_id)}
                className="text-[#A3A3A3] transition hover:text-[#DC2626]"
                aria-label="Remover"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="h-fit rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <h2 className="mb-4 text-lg font-medium text-[#F5F5F5]">Finalizar</h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>
          )}

          <div className="mb-4 space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#A3A3A3]">
              <input
                type="radio"
                checked={deliveryMethod === "pickup"}
                onChange={() => setDeliveryMethod("pickup")}
                className="accent-[#C9A962]"
              />
              Levantamento
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#A3A3A3]">
              <input
                type="radio"
                checked={deliveryMethod === "delivery"}
                onChange={() => setDeliveryMethod("delivery")}
                className="accent-[#C9A962]"
              />
              Entrega ao domicílio
            </label>
          </div>

          {deliveryMethod === "delivery" && (
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Endereço de entrega"
              rows={2}
              className="mb-3 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
          )}

          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Telefone de contacto"
            className="mb-3 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações (opcional)"
            rows={2}
            className="mb-4 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />

          <div className="mb-4 flex items-center justify-between border-t border-[#262626] pt-4">
            <span className="text-[#A3A3A3]">Total</span>
            <span className="text-lg font-medium text-[#C9A962]">{formatCurrency(total)}</span>
          </div>

          <button
            onClick={handleCheckout}
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
          >
            {submitting ? "A processar..." : "Confirmar encomenda"}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>

          <p className="mt-3 text-xs text-[#525252]">
            O pagamento é combinado com o colaborador. Nenhuma cobrança é feita nesta etapa.
          </p>
        </div>
      </div>
    </main>
  );
}
