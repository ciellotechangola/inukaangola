"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelReservation } from "@/lib/api";

export default function CancelReservationButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    if (!confirm("Cancelar esta reserva? O stock é libertado imediatamente.")) return;
    setLoading(true);
    setErro(null);
    try {
      await cancelReservation(reservationId);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cancelar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={cancelar}
        disabled={loading}
        className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-950/40 disabled:opacity-50"
      >
        {loading ? "A cancelar…" : "Cancelar reserva"}
      </button>
      {erro && <p className="mt-1 text-xs text-red-300">{erro}</p>}
    </div>
  );
}
