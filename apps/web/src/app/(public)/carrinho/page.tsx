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
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <div className="mb-6 flex items-end justify-between gap-3 sm:mb-8">
        <div>
          <h1 className="text-2xl font-light text-[#F5F5F5] sm:text-3xl">Carrinho</h1>
          <p className="mt-1 text-xs text-[#7A7A7A] sm:text-sm">
            {items.length === 1 ? "1 artigo" : `${items.length} artigos`} ·{" "}
            {items.reduce((n, i) => n + i.quantity, 0)} unidades
          </p>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Esvaziar o carrinho?")) clear();
          }}
          className="shrink-0 text-xs text-[#8A8A8A] underline-offset-4 transition hover:text-[#DC2626] hover:underline"
        >
          Esvaziar
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:gap-8">
        <div className="space-y-3">
          {items.map((item) => (
            // No telemóvel a linha do desktop (imagem · nome · quantidade ·
            // total · remover) não cabe em 360 px e empurrava o botão de
            // remover para fora do ecrã. Passou a duas linhas: em cima a
            // imagem e o nome, em baixo a quantidade e o total.
            <div
              key={item.product_id}
              className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-3 sm:p-4"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <Link
                  href={`/produto/${item.product_id}`}
                  className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#0A0A0A] sm:h-24 sm:w-24"
                >
                  {item.image ? (
                    <ProductImage
                      src={item.image}
                      alt={item.name}
                      width={96}
                      height={96}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-[#404040]">
                      INUKA
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/produto/${item.product_id}`}
                        className="line-clamp-2 text-sm font-medium leading-snug text-[#F5F5F5] transition hover:text-[#C9A962] sm:text-base"
                      >
                        {item.name}
                      </Link>
                      <p className="mt-1 text-sm text-[#C9A962]">{formatCurrency(item.price)}</p>
                      {item.quantity > 1 && (
                        <p className="text-[11px] text-[#6F6F6F]">
                          {item.quantity} × {formatCurrency(item.price)}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => remove(item.product_id)}
                      className="-mr-1 -mt-1 inline-flex shrink-0 items-center gap-1 rounded-lg p-2 text-[#8A8A8A] transition hover:bg-red-950/40 hover:text-[#DC2626]"
                      aria-label={`Remover ${item.name} do carrinho`}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden text-xs sm:inline">Remover</span>
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center rounded-lg border border-[#404040]">
                      <button
                        onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                        className="flex h-9 w-9 items-center justify-center text-[#A3A3A3] transition hover:text-[#C9A962]"
                        aria-label="Diminuir quantidade"
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-sm text-[#F5F5F5]">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                        className="flex h-9 w-9 items-center justify-center text-[#A3A3A3] transition hover:text-[#C9A962]"
                        aria-label="Aumentar quantidade"
                      >
                        +
                      </button>
                    </div>

                    <p className="text-sm font-medium text-[#F5F5F5] sm:text-base">
                      {formatCurrency(item.price * item.quantity)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="h-fit rounded-xl border border-[#262626] bg-[#1A1A1A] p-4 sm:p-6 lg:sticky lg:top-24">
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
