import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import CancelReservationButton from "./CancelReservationButton";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  expired: "Expirada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-950/60 text-green-200",
  expired: "bg-yellow-950/60 text-yellow-200",
  confirmed: "bg-blue-950/60 text-blue-200",
  cancelled: "bg-red-950/60 text-red-200",
};

function formatarData(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function MyReservationsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/cliente/reservas");

  const supabase = await createClientServer();
  const { data: reservas, error } = await supabase
    .from("reservations")
    .select("*, items:reservation_items(*, product:products(name, sku))")
    .eq("customer_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">Reservas</h1>
        <p className="mb-8 text-[#A3A3A3]">
          Reservas guardam o stock durante o prazo indicado. Depois de expirar, os
          produtos voltam a ficar disponíveis para outros clientes.
        </p>

        {error && (
          <div className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            Não foi possível carregar as reservas: {error.message}
          </div>
        )}

        {!reservas || reservas.length === 0 ? (
          <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-12 text-center">
            <p className="text-[#A3A3A3]">Ainda não tem reservas.</p>
            <p className="mt-2 text-sm text-[#525252]">
              Pode reservar produtos a partir do catálogo.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {reservas.map((reserva) => {
              const total = (reserva.items ?? []).reduce(
                (soma: number, item: { unit_price: number; quantity: number }) =>
                  soma + Number(item.unit_price) * item.quantity,
                0,
              );

              return (
                <article
                  key={reserva.id}
                  className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          STATUS_STYLE[reserva.status] ?? "bg-[#262626] text-[#A3A3A3]"
                        }`}
                      >
                        {STATUS_LABEL[reserva.status] ?? reserva.status}
                      </span>
                      <span className="text-xs text-[#525252]">
                        Criada em {formatarData(reserva.created_at)}
                      </span>
                    </div>
                    {reserva.status === "active" && (
                      <CancelReservationButton reservationId={reserva.id} />
                    )}
                  </div>

                  <ul className="mb-3 space-y-1 text-sm text-[#D4D4D4]">
                    {(reserva.items ?? []).map(
                      (item: {
                        id: string;
                        quantity: number;
                        unit_price: number;
                        product: { name: string; sku: string | null } | null;
                      }) => (
                        <li key={item.id} className="flex justify-between gap-4">
                          <span>
                            {item.quantity}× {item.product?.name ?? "Produto"}
                          </span>
                          <span className="text-[#A3A3A3]">
                            {formatCurrency(Number(item.unit_price) * item.quantity)}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#262626] pt-3 text-sm">
                    <span className="text-[#A3A3A3]">
                      Expira em {formatarData(reserva.expires_at)}
                    </span>
                    <span className="font-medium text-[#C9A962]">{formatCurrency(total)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
