"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ImpactoEliminar } from "@/lib/colaborador";

/**
 * Zona de perigo da ficha do colaborador.
 *
 * Apagar leva a conta, as vendas e tudo o que pendia dela — não há como voltar
 * atrás. Por isso a confirmação não é um «sim/não»: obriga a escrever a
 * referência da pessoa e um motivo, e mostra primeiro, por extenso, o que vai
 * desaparecer.
 */
export default function EliminarColaborador({
  id,
  nome,
  referencia,
  impacto,
}: {
  id: string;
  nome: string;
  referencia: string | null;
  impacto: ImpactoEliminar;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [confirmar, setConfirmar] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ciente, setCiente] = useState(false);
  const [aApagar, setAApagar] = useState(false);
  const [erro, setErro] = useState("");

  const referenciaCerta =
    !!referencia && confirmar.trim().toUpperCase() === referencia.toUpperCase();
  const podeApagar = referenciaCerta && motivo.trim().length >= 3 && ciente && !aApagar;

  async function apagar() {
    setAApagar(true);
    setErro("");

    try {
      const resposta = await fetch(`/api/gerente/colaboradores/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmar: confirmar.trim(), motivo: motivo.trim() }),
      });
      const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível eliminar o colaborador.");
        setAApagar(false);
        return;
      }

      router.push("/gerente/colaboradores");
      router.refresh();
    } catch {
      setErro("Falha de rede. Tente novamente.");
      setAApagar(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-[#4A2020] bg-[#1A0F0F] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-[#F87171]">
            <AlertTriangle className="h-4 w-4" />
            Zona de perigo
          </h2>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-[#A3A3A3]">
            Eliminar remove a conta, as vendas e as comissões deste colaborador. Não há
            como recuperar. Se só quer suspender o acesso, use «Estado» acima e ponha a
            conta inativa.
          </p>
        </div>
        {!aberto && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#4A2020] px-4 py-2 text-xs font-medium text-[#F87171] transition hover:bg-[#2A1010]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar colaborador
          </button>
        )}
      </div>

      {aberto && (
        <div className="mt-5 rounded-lg border border-[#4A2020] bg-[#120A0A] p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-[#8A8A8A]">
              Vai desaparecer de vez
            </p>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-[#525252] transition hover:text-[#F5F5F5]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="mb-4 grid gap-2 text-xs sm:grid-cols-2">
            <Linha rotulo="Conta" valor={`${nome}${referencia ? ` · ${referencia}` : ""}`} />
            <Linha rotulo="Vendas" valor={String(impacto.vendas)} />
            <Linha rotulo="Produtos vendidos" valor={String(impacto.unidades)} />
            <Linha rotulo="Volume vendido" valor={formatCurrency(impacto.volume)} />
            <Linha rotulo="Comissões geradas" valor={formatCurrency(impacto.comissoes_valor)} />
            <Linha rotulo="Comissões já pagas" valor={formatCurrency(impacto.total_pago)} />
            <Linha rotulo="Pedidos de levantamento" valor={String(impacto.levantamentos)} />
            <Linha rotulo="Clientes na carteira" valor={String(impacto.clientes)} />
            {impacto.mensagens > 0 && (
              <Linha rotulo="Mensagens enviadas" valor={String(impacto.mensagens)} />
            )}
            {impacto.encomendas > 0 && (
              <Linha rotulo="Encomendas em nome próprio" valor={String(impacto.encomendas)} />
            )}
          </dl>

          <p className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-[11px] leading-relaxed text-[#F87171]">
            O histórico de pagamentos e as vendas deste colaborador desaparecem do
            relatório. Os clientes dele continuam a existir como clientes.
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-[#8A8A8A]">
              Escreva a referência <span className="font-mono text-[#C9A962]">{referencia ?? "—"}</span> para
              confirmar
            </span>
            <input
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              placeholder={referencia ?? "sem referência"}
              autoComplete="off"
              className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 font-mono text-sm uppercase tracking-wider text-[#F5F5F5] placeholder:normal-case placeholder:tracking-normal placeholder:text-[#525252] focus:border-[#DC2626] focus:outline-none"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-[#8A8A8A]">Motivo</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ex.: pediu demissão e a conta foi encerrada a 10/11."
              className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#DC2626] focus:outline-none"
            />
          </label>

          <label className="mb-4 flex items-start gap-2 text-[11px] text-[#D4D4D4]">
            <input
              type="checkbox"
              checked={ciente}
              onChange={(e) => setCiente(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#DC2626]"
            />
            Entendo que esta acção é definitiva e que as vendas e comissões não podem
            ser recuperadas.
          </label>

          {erro && <p className="mb-3 text-xs text-[#F87171]">{erro}</p>}

          <button
            type="button"
            onClick={apagar}
            disabled={!podeApagar}
            className="inline-flex items-center gap-2 rounded-lg bg-[#DC2626] px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {aApagar ? "A eliminar…" : "Eliminar definitivamente"}
          </button>
        </div>
      )}
    </section>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#2A1616] pb-1.5 last:border-0">
      <dt className="text-[#6F6F6F]">{rotulo}</dt>
      <dd className="text-right text-[#E5E5E5]">{valor}</dd>
    </div>
  );
}
