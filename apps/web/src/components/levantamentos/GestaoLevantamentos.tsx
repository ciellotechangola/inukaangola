"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import {
  COR_ESTADO,
  ROTULO_ACCAO,
  ROTULO_ESTADO,
  ROTULO_METODO,
  accoesDisponiveis,
  normalizarLevantamentosEquipa,
  resumoDestino,
  type EstadoLevantamento,
  type LevantamentoEquipa,
} from "@/lib/levantamentos";

const PATCH = "supabase/PATCH_PROMOCOES_LEVANTAMENTOS.sql";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

type Filtro = "todos" | EstadoLevantamento;

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "pendente", rotulo: "Pendentes" },
  { chave: "aprovado", rotulo: "Aprovados" },
  { chave: "em_processamento", rotulo: "Em processamento" },
  { chave: "pago", rotulo: "Pagos" },
  { chave: "rejeitado", rotulo: "Rejeitados" },
];

function quando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function GestaoLevantamentos() {
  const [pedidos, setPedidos] = useState<LevantamentoEquipa[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aDecidir, setADecidir] = useState<string | null>(null);
  const [aRejeitar, setARejeitar] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("levantamentos_equipa", {
      p_estado: filtro === "todos" ? null : filtro,
    });

    if (error) setErro(mensagemDeErro(error, PATCH));
    else setErro("");

    setPedidos(normalizarLevantamentosEquipa(data));
    setCarregando(false);
  }, [filtro]);

  useEffect(() => {
    setCarregando(true);
    carregar();
  }, [carregar]);

  const totais = useMemo(() => {
    const soma = (estados: EstadoLevantamento[]) =>
      pedidos
        .filter((p) => estados.includes(p.estado))
        .reduce((acc, p) => acc + p.valor, 0);

    return {
      pendente: soma(["pendente"]),
      emCurso: soma(["aprovado", "em_processamento"]),
      pago: soma(["pago"]),
      contagem: pedidos.filter((p) => p.estado === "pendente").length,
    };
  }, [pedidos]);

  async function decidir(pedido: LevantamentoEquipa, estado: EstadoLevantamento, nota?: string) {
    setErro("");
    setAviso("");

    if (estado === "rejeitado" && !String(nota ?? "").trim()) {
      setErro("Indique o motivo da rejeição — o colaborador precisa de saber porque foi recusado.");
      return;
    }

    if (estado === "pago") {
      const confirmar = window.confirm(
        `Marcar ${formatCurrency(pedido.valor)} como PAGO a ${pedido.seller_nome}?\n\n` +
          "Confirme que o dinheiro já saiu. Esta acção fecha as comissões e não se desfaz."
      );
      if (!confirmar) return;
    }

    setADecidir(pedido.id);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("decidir_levantamento", {
      p_id: pedido.id,
      p_estado: estado,
      p_nota: nota?.trim() || null,
    });
    setADecidir(null);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso(
      estado === "pago"
        ? `${pedido.referencia ?? "Pedido"} marcado como pago. O saldo do colaborador foi actualizado.`
        : `${pedido.referencia ?? "Pedido"} passou a ${ROTULO_ESTADO[estado].toLowerCase()}.`
    );
    setARejeitar(null);
    setMotivo("");
    await carregar();
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Levantamentos</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          Pedidos de dinheiro dos colaboradores. Aprovar não paga nada: só «Marcar como pago»
          fecha as comissões e actualiza o saldo.
        </p>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="mb-4 rounded-lg border border-[#1F4D2E] bg-[#0E2417] p-3 text-sm text-[#22C55E]">
          {aviso}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            À espera de decisão
          </p>
          <p className="text-lg font-medium text-[#C9A962]">{formatCurrency(totais.pendente)}</p>
          <p className="mt-0.5 text-[11px] text-[#525252]">
            {totais.contagem} pedido{totais.contagem === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">Em curso</p>
          <p className="text-lg font-medium text-[#E3D5A7]">{formatCurrency(totais.emCurso)}</p>
          <p className="mt-0.5 text-[11px] text-[#525252]">aprovado ou em processamento</p>
        </div>
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">Já pago</p>
          <p className="text-lg font-medium text-[#22C55E]">{formatCurrency(totais.pago)}</p>
          <p className="mt-0.5 text-[11px] text-[#525252]">nesta vista</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            onClick={() => setFiltro(f.chave)}
            className={`rounded-full border px-3 py-1 text-[11px] transition ${
              filtro === f.chave
                ? "border-[#C9A962] bg-[#241E0E] text-[#C9A962]"
                : "border-[#333333] text-[#8A8A8A] hover:border-[#C9A962]/40 hover:text-[#D4D4D4]"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {carregando ? (
        <p className="text-sm text-[#8A8A8A]">A carregar pedidos…</p>
      ) : pedidos.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#121212] p-8 text-center text-sm text-[#A3A3A3]">
          {filtro === "todos"
            ? "Ainda não há pedidos de levantamento."
            : "Nenhum pedido neste estado."}
        </div>
      ) : (
        <div className="space-y-3">
          {pedidos.map((p) => {
            const accoes = accoesDisponiveis(p.estado);
            const ocupado = aDecidir === p.id;

            return (
              <div key={p.id} className="rounded-xl border border-[#262626] bg-[#121212] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-[#F5F5F5]">{p.seller_nome}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${COR_ESTADO[p.estado]}`}
                      >
                        {ROTULO_ESTADO[p.estado]}
                      </span>
                      <span className="rounded-full border border-[#333333] px-2 py-0.5 text-[10px] text-[#C9A962]">
                        {ROTULO_METODO[p.metodo]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#8A8A8A]">
                      {p.seller_ref ? `${p.seller_ref} · ` : ""}
                      {p.seller_phone ?? "sem telefone"}
                      {p.provincia ? ` · ${p.provincia}` : ""}
                      {p.referencia ? ` · ${p.referencia}` : ""}
                    </p>
                    <p className="text-[11px] text-[#6F6F6F]">
                      Pedido em {quando(p.solicitado_em)}
                      {p.pago_em ? ` · pago em ${quando(p.pago_em)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-medium text-[#C9A962]">{formatCurrency(p.valor)}</p>
                  </div>
                </div>

                {/* Coordenadas: é o que a gestão precisa para pagar */}
                <div className="mt-3 rounded-lg border border-[#262626] bg-[#161616] p-3">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
                    Dados de recebimento
                  </p>
                  <p className="text-xs text-[#D4D4D4]">{resumoDestino(p.metodo, p.dados)}</p>
                  {p.dados && Object.keys(p.dados).length > 0 && (
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
                      {Object.entries(p.dados).map(([campo, valor]) => (
                        <div key={campo} className="flex gap-1">
                          <dt className="text-[#6F6F6F]">
                            {campo.charAt(0).toUpperCase() + campo.slice(1)}:
                          </dt>
                          <dd className="break-all text-[#D4D4D4]">{valor || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {p.notas && (
                    <p className="mt-2 text-[11px] text-[#A3A3A3]">Nota: {p.notas}</p>
                  )}
                  {p.estado === "rejeitado" && p.motivo && (
                    <p className="mt-2 text-[11px] text-[#F87171]">Motivo: {p.motivo}</p>
                  )}
                </div>

                {accoes.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {accoes
                      .filter((a) => a !== "rejeitado")
                      .map((a) => (
                        <button
                          key={a}
                          onClick={() => decidir(p, a)}
                          disabled={ocupado}
                          className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                        >
                          {ocupado ? "…" : ROTULO_ACCAO[a]}
                        </button>
                      ))}

                    {accoes.includes("rejeitado") && (
                      <button
                        onClick={() => {
                          setARejeitar(aRejeitar === p.id ? null : p.id);
                          setMotivo("");
                        }}
                        disabled={ocupado}
                        className="rounded-lg border border-[#4A2020] px-3 py-1.5 text-[11px] text-[#F87171] transition hover:bg-[#2A1010] disabled:opacity-50"
                      >
                        {ROTULO_ACCAO.rejeitado}
                      </button>
                    )}
                  </div>
                )}

                {aRejeitar === p.id && (
                  <div className="mt-3 rounded-lg border border-[#4A2020] bg-[#1A0E0E] p-3">
                    <label
                      className="mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]"
                      htmlFor={`motivo-${p.id}`}
                    >
                      Motivo da rejeição
                    </label>
                    <input
                      id={`motivo-${p.id}`}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: dados bancários incompletos"
                      className={ENTRADA}
                    />
                    <p className="mt-1 text-[11px] text-[#6F6F6F]">
                      O valor reservado volta ao saldo disponível do colaborador.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => decidir(p, "rejeitado", motivo)}
                        disabled={ocupado}
                        className="rounded-lg bg-[#DC2626] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#EF4444] disabled:opacity-50"
                      >
                        {ocupado ? "…" : "Confirmar rejeição"}
                      </button>
                      <button
                        onClick={() => {
                          setARejeitar(null);
                          setMotivo("");
                        }}
                        className="rounded-lg px-3 py-1.5 text-[11px] text-[#8A8A8A] hover:text-[#F5F5F5]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {p.estado === "pago" && (
                  <p className="mt-2 text-[11px] text-[#22C55E]">
                    Pago — pedido fechado. O histórico do colaborador já reflecte este valor.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
