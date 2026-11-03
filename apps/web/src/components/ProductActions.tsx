"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, Tag, Check } from "lucide-react";
import { useCart } from "@/components/cart-context";
import { createClientBrowser } from "@/lib/supabase-browser";
import { requestDiscount } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface Props {
  productId: string;
  name: string;
  price: number;
  image?: string | null;
}

export default function ProductActions({ productId, name, price, image }: Props) {
  const router = useRouter();
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [requestedPrice, setRequestedPrice] = useState("");
  const [justification, setJustification] = useState("");
  const [discountMsg, setDiscountMsg] = useState("");
  const [discountErr, setDiscountErr] = useState("");
  const [sending, setSending] = useState(false);

  async function handleAdd() {
    add({ product_id: productId, name, price, image }, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  async function handleDiscount() {
    setDiscountErr("");
    setDiscountMsg("");

    const supabase = createClientBrowser();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.push(`/login?redirect=/produto/${productId}`);
      return;
    }

    const value = Number(requestedPrice.replace(/[^\d.]/g, ""));
    if (!value || value <= 0) {
      setDiscountErr("Indique um valor válido.");
      return;
    }
    if (value >= price) {
      setDiscountErr("O valor deve ser inferior ao preço atual.");
      return;
    }

    setSending(true);
    try {
      await requestDiscount(productId, value, justification);
      setDiscountMsg("Pedido enviado. A gerência irá responder.");
      setRequestedPrice("");
      setJustification("");
    } catch (e) {
      setDiscountErr(e instanceof Error ? e.message : "Não foi possível enviar o pedido.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-[#A3A3A3]" htmlFor="qty">
          Quantidade
        </label>
        <div className="flex items-center rounded-lg border border-[#404040]">
          <button
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="px-3 py-2 text-[#A3A3A3] hover:text-[#C9A962]"
            aria-label="Diminuir"
          >
            −
          </button>
          <input
            id="qty"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 border-x border-[#404040] bg-transparent py-2 text-center text-[#F5F5F5] focus:outline-none"
          />
          <button
            onClick={() => setQuantity((q) => q + 1)}
            className="px-3 py-2 text-[#A3A3A3] hover:text-[#C9A962]"
            aria-label="Aumentar"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={handleAdd}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#C9A962] px-8 py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
        >
          {added ? <Check className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
          {added ? "Adicionado" : "Adicionar ao carrinho"}
        </button>

        <button
          onClick={() => setShowDiscount((v) => !v)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#404040] px-6 py-3 font-medium text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
        >
          <Tag className="h-4 w-4" />
          Pedir desconto
        </button>
      </div>

      {showDiscount && (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-3 text-sm text-[#A3A3A3]">
            Preço atual: <span className="text-[#C9A962]">{formatCurrency(price)}</span>
          </p>

          {discountErr && (
            <div className="mb-3 rounded-lg bg-red-950/50 p-2 text-sm text-red-200">{discountErr}</div>
          )}
          {discountMsg && (
            <div className="mb-3 rounded-lg bg-green-950/50 p-2 text-sm text-green-200">{discountMsg}</div>
          )}

          <div className="space-y-3">
            <input
              type="number"
              value={requestedPrice}
              onChange={(e) => setRequestedPrice(e.target.value)}
              placeholder="Valor pretendido (Kz)"
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-2.5 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Justificação (opcional)"
              rows={2}
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-2.5 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <button
              onClick={handleDiscount}
              disabled={sending}
              className="w-full rounded-lg bg-[#C9A962] py-2.5 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
            >
              {sending ? "A enviar..." : "Enviar pedido"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
