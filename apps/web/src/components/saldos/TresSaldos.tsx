import { BadgeCheck, Clock3 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { SaldoColaborador } from "@/lib/vendas";

/**
 * Os três saldos de um colaborador, lado a lado e com nomes que não se
 * confundem.
 *
 * O erro que isto corrige: um colaborador via 30.000 Kz no ecrã e achava que
 * tinha 30.000 Kz para levantar. Não tinha — o que se levanta é a comissão, e
 * só depois de a gestão confirmar que o dinheiro entrou. Por isso o volume
 * vendido diz explicitamente «não é dinheiro para levantar», o pendente diz
 * «ainda não entrou» e o confirmado é o único pintado de verde.
 *
 * Cores por significado, iguais em todo o sistema: dourado = à espera, verde =
 * dinheiro dentro, cinza = referência.
 */
export default function TresSaldos({
  saldo,
  compacto = false,
}: {
  saldo: SaldoColaborador;
  /** Versão curta, para dentro de um cartão de gestão. */
  compacto?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${compacto ? "sm:grid-cols-3" : "sm:grid-cols-3"}`}>
      <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
        <p className="text-[10px] uppercase tracking-wide text-[#525252]">Saldo contabilístico</p>
        <p className="mt-1 text-lg font-medium text-[#E5E5E5]">
          {formatCurrency(saldo.vendas.contabilistico)}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-[#525252]">
          {saldo.vendas.count} venda{saldo.vendas.count === 1 ? "" : "s"} · conta para a meta.{" "}
          <span className="text-[#8A8A8A]">Não é dinheiro para levantar.</span>
        </p>
      </div>

      <div className="rounded-xl border border-[#4A3F1F] bg-[#241E0E]/60 p-4">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8A7A3F]">
          <Clock3 size={11} />
          Saldo pendente
        </p>
        <p className="mt-1 text-lg font-medium text-[#C9A962]">
          {formatCurrency(saldo.vendas.pendente)}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-[#8A7A3F]">
          {saldo.vendas.count_pendente === 0
            ? "Nada por confirmar."
            : `${saldo.vendas.count_pendente} venda${saldo.vendas.count_pendente === 1 ? "" : "s"} por confirmar. Dinheiro possível — ainda não entrou.`}
        </p>
      </div>

      <div className="rounded-xl border border-[#1F4D2E] bg-[#0E2417]/60 p-4">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#3F7A54]">
          <BadgeCheck size={11} />
          Saldo activo (recebido)
        </p>
        <p className="mt-1 text-lg font-medium text-[#4ADE80]">
          {formatCurrency(saldo.vendas.activo)}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-[#3F7A54]">
          {saldo.vendas.count_activo === 0
            ? "Ainda sem vendas confirmadas."
            : `${saldo.vendas.count_activo} venda${saldo.vendas.count_activo === 1 ? "" : "s"} confirmada${saldo.vendas.count_activo === 1 ? "" : "s"} pela gestão.`}
        </p>
      </div>
    </div>
  );
}
