"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag, Tag, Check, BellRing, CalendarClock } from "lucide-react";
import { useCart } from "@/components/cart-context";
import { createClientBrowser } from "@/lib/supabase-browser";
import { requestDiscount } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface Props {
  productId: string;
  name: string;
  price: number;
  image?: string | null;
  /** Unidades disponíveis; `null` = desconhecido, `0` = esgotado. */
  disponivel?: number | null;
}

/** Dias que uma reserva fica de pé à espera de reposição. */
const DIAS_RESERVA = 7;

export default function ProductActions({
  productId,
  name,
  price,
  image,
  disponivel = null,
}: Props) {
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

  // Reserva de produto esgotado.
  const [reservaQtd, setReservaQtd] = useState(1);
  const [reservaNota, setReservaNota] = useState("");
  const [reservaMsg, setReservaMsg] = useState("");
  const [reservaErr, setReservaErr] = useState("");
  const [aReservar, setAReservar] = useState(false);

  const esgotado = disponivel === 0;
  /** Sem stock conhecido não se limita; com stock, não se passa do que há. */
  const maximo = disponivel !== null && disponivel > 0 ? disponivel : undefined;

  async function handleAdd() {
    add({ product_id: productId, name, price, image }, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  /**
   * Reserva um produto esgotado.
   *
   * Grava em `reservations` + `reservation_items` — as mesmas tabelas que a
   * gestão usa — para o cliente ver a reserva em /cliente/reservas com os
   * detalhes (quantidade, preço, prazo) e poder cancelá-la. Não mexe em
   * stock: não há stock para mexer.
   */
  async function handleReservar() {
    setReservaErr("");
    setReservaMsg("");

    const supabase = createClientBrowser();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.push(`/login?redirect=/produto/${productId}`);
      return;
    }

    const qtd = Math.max(1, Math.trunc(reservaQtd) || 1);
    setAReservar(true);
    try {
      const expira = new Date(Date.now() + DIAS_RESERVA * 86_400_000).toISOString();

      const { data: reserva, error: erroReserva } = await supabase
        .from("reservations")
        .insert({
          customer_id: auth.user.id,
          status: "active",
          expires_at: expira,
          notes: reservaNota.trim()
            ? `Reserva de produto esgotado: ${reservaNota.trim()}`
            : "Reserva de produto esgotado",
        })
        .select("id")
        .single();

      if (erroReserva || !reserva) throw new Error(erroReserva?.message ?? "Reserva recusada.");

      const { error: erroItem } = await supabase.from("reservation_items").insert({
        reservation_id: (reserva as { id: string }).id,
        product_id: productId,
        quantity: qtd,
        unit_price: price,
      });

      if (erroItem) {
        // Sem a linha do produto a reserva ficava vazia e sem sentido.
        await supabase.from("reservations").delete().eq("id", (reserva as { id: string }).id);
        throw new Error(erroItem.message);
      }

      setReservaMsg(
        `Reserva registada: ${qtd}× ${name}. A equipa entra em contacto quando houver stock.`
      );
      setReservaNota("");
      setReservaQtd(1);
    } catch (e) {
      setReservaErr(e instanceof Error ? e.message : "Não foi possível reservar.");
    } finally {
      setAReservar(false);
    }
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

  if (esgotado) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[#C9A962]/30 bg-[#141414] p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
            <BellRing className="h-4 w-4 text-[#C9A962]" />
            Esgotado de momento
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[#A3A3A3]">
            Deixe a sua reserva: fica registada durante {DIAS_RESERVA} dias e a equipa avisa
            assim que o produto voltar. Pode acompanhar e cancelar em «Reservas».
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-[#6F6F6F]" htmlFor="reserva-qtd">
                Quantidade
              </label>
              <div className="flex items-center rounded-lg border border-[#404040]">
                <button
                  type="button"
                  onClick={() => setReservaQtd((q) => Math.max(1, q - 1))}
                  className="px-3 py-2 text-[#A3A3A3] hover:text-[#C9A962]"
                  aria-label="Diminuir quantidade da reserva"
                >
                  −
                </button>
                <input
                  id="reserva-qtd"
                  type="number"
                  min={1}
                  value={reservaQtd}
                  onChange={(e) => setReservaQtd(Math.max(1, Number(e.target.value) || 1))}
                  className="w-14 border-x border-[#404040] bg-transparent py-2 text-center text-[#F5F5F5] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setReservaQtd((q) => q + 1)}
                  className="px-3 py-2 text-[#A3A3A3] hover:text-[#C9A962]"
                  aria-label="Aumentar quantidade da reserva"
                >
                  +
                </button>
              </div>
            </div>

            <p className="pb-2 text-xs text-[#6F6F6F]">
              Total previsto:{" "}
              <span className="font-medium text-[#C9A962]">
                {formatCurrency(price * Math.max(1, reservaQtd || 1))}
              </span>
            </p>
          </div>

          <textarea
            value={reservaNota}
            onChange={(e) => setReservaNota(e.target.value)}
            rows={2}
            placeholder="Alguma preferência? (opcional)"
            className="mt-3 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />

          {reservaErr && (
            <div className="mt-3 rounded-lg bg-red-950/50 p-2 text-sm text-red-200">{reservaErr}</div>
          )}
          {reservaMsg && (
            <div className="mt-3 rounded-lg bg-green-950/50 p-2 text-sm text-green-200">{reservaMsg}</div>
          )}

          <button
            onClick={handleReservar}
            disabled={aReservar}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] px-6 py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60 sm:w-auto"
          >
            <CalendarClock className="h-4 w-4" />
            {aReservar ? "A reservar…" : "Reservar este produto"}
          </button>

          {reservaMsg && (
            <Link
              href="/cliente/reservas"
              className="mt-3 inline-block text-xs text-[#C9A962] underline-offset-4 hover:underline"
            >
              Ver detalhes da reserva
            </Link>
          )}
        </div>

        <p className="text-xs leading-relaxed text-[#525252]">
          Prefere falar com alguém? A equipa responde na área de cliente, em «Mensagens».
        </p>
      </div>
    );
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
            max={maximo}
            value={quantity}
            onChange={(e) =>
              setQuantity(
                Math.min(maximo ?? Infinity, Math.max(1, Number(e.target.value) || 1))
              )
            }
            className="w-14 border-x border-[#404040] bg-transparent py-2 text-center text-[#F5F5F5] focus:outline-none"
          />
          <button
            onClick={() => setQuantity((q) => Math.min(maximo ?? Infinity, q + 1))}
            className="px-3 py-2 text-[#A3A3A3] hover:text-[#C9A962]"
            aria-label="Aumentar"
          >
            +
          </button>
        </div>
        {maximo !== undefined && (
          <span className="text-xs text-[#6F6F6F]">{maximo} disponíveis</span>
        )}
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
