"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  RotateCcw,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { dataCurta, mensagemErro } from "@/lib/colaborador";
import {
  COR_PAGAMENTO,
  ROTULO_EVENTO,
  ROTULO_PAGAMENTO,
  normalizarItens,
  type EventoVenda,
  type ItemVenda,
  type SaldosEquipa,
  type VendaLinha,
  type VendasGestao,
} from "@/lib/vendas";

/**
 * A área de vendas da gestão.
 *
 * Três coisas, e nada mais:
 *   1. os números do topo — quanto se vendeu, quanto falta confirmar, quanto já
 *      entrou e quanto os colaboradores podem levantar;
 *   2. quem é quem — uma linha por colaborador, com os três saldos lado a lado
 *      para nunca se confundir «vendeu» com «recebeu»;
 *   3. as vendas — filtrar por estado, abrir uma, confirmar o pagamento.
 *
 * Confirmar é uma transferência de estado, não uma venda nova: o valor sai de
 * «por confirmar» e entra em «confirmado», e o total vendido fica na mesma. É a
 * base que garante isso (`confirmar_pagamento_venda`); aqui só se mostra.
 */
export default function GestaoVendas({
  saldos,
  vendas,
}: {
  saldos: SaldosEquipa;
  vendas: VendasGestao;
}) {
  const router = useRouter();
  const [procuraColab, setProcuraColab] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "pendente" | "pago">("todas");
  const [procuraVenda, setProcuraVenda] = useState("");
  const [colaborador, setColaborador] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aConfirmar, setAConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  // O detalhe de uma venda (produtos e histórico) só se lê quando alguém o
  // abre. Fica em cache por venda para não repetir a leitura ao fechar e abrir.
  const [detalhes, setDetalhes] = useState<
    Record<string, { itens: ItemVenda[]; eventos: EventoVenda[] }>
  >({});
  const [aCarregar, setACarregar] = useState<string | null>(null);

  const colaboradores = useMemo(() => {
    const termo = procuraColab.trim().toLowerCase();
    if (!termo) return saldos.linhas;
    return saldos.linhas.filter(
      (c) =>
        c.nome.toLowerCase().includes(termo) ||
        (c.telefone ?? "").includes(termo) ||
        (c.provincia_codigo ?? "").toLowerCase().includes(termo)
    );
  }, [saldos.linhas, procuraColab]);

  const linhas = useMemo(() => {
    const termo = procuraVenda.trim().toLowerCase();
    return vendas.linhas.filter((v) => {
      const casaEstado =
        filtro === "todas" ||
        (filtro === "pago" && v.payment_status === "paid") ||
        (filtro === "pendente" && v.payment_status !== "paid");
      const casaColab = colaborador === null || v.seller_id === colaborador;
      const casaTexto =
        termo === "" ||
        v.reference.toLowerCase().includes(termo) ||
        v.seller_nome.toLowerCase().includes(termo);
      return casaEstado && casaColab && casaTexto;
    });
  }, [vendas.linhas, filtro, colaborador, procuraVenda]);

  const porConfirmar = vendas.linhas.filter((v) => v.payment_status !== "paid").length;

  async function confirmar(v: VendaLinha) {
    setErro("");
    setAConfirmar(v.id);
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase.rpc("confirmar_pagamento_venda", { p_venda: v.id });
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAConfirmar(null);
    }
  }

  /** Abrir uma venda: mostra os produtos e o histórico, lendo-os na primeira vez. */
  async function abrir(v: VendaLinha) {
    if (aberta === v.id) {
      setAberta(null);
      return;
    }
    setAberta(v.id);
    if (detalhes[v.id]) return;

    setACarregar(v.id);
    try {
      const supabase = createClientBrowser();
      const [itensRes, eventosRes] = await Promise.all([
        supabase
          .from("sale_items")
          .select("id, quantity, unit_price, total_price, product_snapshot")
          .eq("sale_id", v.id),
        supabase
          .from("sale_events")
          .select("id, tipo, de, para, detalhe, em, por")
          .eq("sale_id", v.id)
          .order("ordem", { ascending: true }),
      ]);

      const brutos = (eventosRes.data ?? []) as Record<string, unknown>[];
      const autores = [...new Set(brutos.map((e) => e.por).filter(Boolean))] as string[];
      let nomes: Record<string, string> = {};
      if (autores.length > 0) {
        const { data: perfis } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", autores);
        nomes = Object.fromEntries(
          ((perfis ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
        );
      }

      setDetalhes((prev) => ({
        ...prev,
        [v.id]: {
          itens: normalizarItens(itensRes.data),
          eventos: brutos.map((e) => ({
            id: String(e.id),
            tipo: e.tipo as EventoVenda["tipo"],
            de: (e.de as string | null) ?? null,
            para: (e.para as string | null) ?? null,
            detalhe: (e.detalhe as string | null) ?? null,
            em: String(e.em),
            por_nome: e.por ? (nomes[String(e.por)] ?? null) : null,
          })),
        },
      }));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setACarregar(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------- números */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero
          rotulo="Volume vendido"
          valor={formatCurrency(saldos.totais.contabilistico)}
          nota={`${vendas.totais.vendas} venda${vendas.totais.vendas === 1 ? "" : "s"} · desempenho, não dinheiro`}
        />
        <Numero
          rotulo="Por confirmar"
          valor={formatCurrency(saldos.totais.pendente)}
          nota={`${vendas.totais.pendentes} à espera de confirmação`}
          cor="text-[#C9A962]"
        />
        <Numero
          rotulo="Confirmado"
          valor={formatCurrency(saldos.totais.activo)}
          nota={`${vendas.totais.pagas} venda${vendas.totais.pagas === 1 ? "" : "s"} com dinheiro dentro`}
          cor="text-[#4ADE80]"
        />
        <Numero
          rotulo="Disponível para levantar"
          valor={formatCurrency(saldos.totais.disponivel)}
          nota="comissões — é este o dinheiro que sai"
          cor="text-[#E3D5A7]"
        />
      </div>

      {erro && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-[#4A2020] bg-[#2A1010] px-4 py-3 text-sm text-[#F87171]">
          <span>{erro}</span>
          <button type="button" onClick={() => setErro("")} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ----------------------------------------------------- por colaborador */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[#F5F5F5]">Por colaborador</h2>
            <p className="mt-0.5 text-[11px] text-[#6F6F6F]">
              {saldos.scope === "nacional" ? "Toda a rede" : "A sua província"} ·{" "}
              {saldos.totais.colaboradores} colaborador
              {saldos.totais.colaboradores === 1 ? "" : "es"}
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
            <input
              value={procuraColab}
              onChange={(e) => setProcuraColab(e.target.value)}
              placeholder="Nome, telefone ou província"
              className="w-full rounded-lg border border-[#262626] bg-[#141414] py-2 pl-9 pr-3 text-xs text-[#E5E5E5] placeholder:text-[#525252] focus:border-[#C9A962]/60 focus:outline-none"
            />
          </div>
        </div>

        {colaborador && (
          <button
            type="button"
            onClick={() => setColaborador(null)}
            className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#C9A962]/40 bg-[#241E0E] px-3 py-1 text-[11px] text-[#E3D5A7]"
          >
            só as vendas de {saldos.linhas.find((c) => c.seller_id === colaborador)?.nome ?? "—"}
            <X size={11} />
          </button>
        )}

        {colaboradores.length === 0 ? (
          <p className="rounded-xl border border-[#262626] bg-[#1A1A1A] px-4 py-6 text-center text-sm text-[#525252]">
            Nenhum colaborador encontrado.
          </p>
        ) : (
          <ul className="space-y-2">
            {colaboradores.map((c) => {
              const escolhido = colaborador === c.seller_id;
              return (
                <li key={c.seller_id}>
                  <button
                    type="button"
                    onClick={() => setColaborador(escolhido ? null : c.seller_id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      escolhido
                        ? "border-[#C9A962]/60 bg-[#1E1B12]"
                        : "border-[#262626] bg-[#1A1A1A] hover:border-[#3A3A3A]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm text-[#F5F5F5]">
                          {c.nome}
                          {!c.ativo && (
                            <span className="rounded bg-[#2A1010] px-1.5 py-0.5 text-[10px] text-[#F87171]">
                              inativo
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-[#6F6F6F]">
                          {[c.telefone, c.provincia_nome].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>

                      <div className="grid shrink-0 grid-cols-3 gap-x-5 gap-y-1 text-right sm:gap-x-8">
                        <Mini rotulo="Vendeu" valor={c.contabilistico} cor="text-[#A3A3A3]" />
                        <Mini
                          rotulo="Por confirmar"
                          valor={c.pendente}
                          cor={c.pendente > 0 ? "text-[#C9A962]" : "text-[#525252]"}
                          conta={c.count_pendente}
                        />
                        <Mini
                          rotulo="Confirmado"
                          valor={c.activo}
                          cor={c.activo > 0 ? "text-[#4ADE80]" : "text-[#525252]"}
                          conta={c.count_activo}
                        />
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#232323] pt-2 text-[11px]">
                      <span className="flex items-center gap-1.5 text-[#E3D5A7]">
                        <Wallet size={11} />
                        pode levantar {formatCurrency(c.disponivel)}
                      </span>
                      {c.reservado > 0 && (
                        <span className="text-[#7DD3FC]">
                          {formatCurrency(c.reservado)} reservado
                        </span>
                      )}
                      <span className="text-[#525252]">
                        comissão ganha {formatCurrency(c.comissao_ganha)} · paga{" "}
                        {formatCurrency(c.comissao_paga)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------- vendas */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[#F5F5F5]">Vendas</h2>
            <p className="mt-0.5 text-[11px] text-[#6F6F6F]">
              {porConfirmar > 0
                ? `${porConfirmar} por confirmar · confirmar move o valor de «pendente» para «activo», sem somar outra vez`
                : "Tudo confirmado."}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-[#262626] bg-[#141414] p-0.5">
              {(
                [
                  ["todas", "Todas", vendas.totais.vendas],
                  ["pendente", "Pendentes", vendas.totais.pendentes],
                  ["pago", "Pagas", vendas.totais.pagas],
                ] as const
              ).map(([chave, rotulo, n]) => (
                <button
                  key={chave}
                  type="button"
                  onClick={() => setFiltro(chave)}
                  className={`rounded-md px-3 py-1.5 text-[11px] transition ${
                    filtro === chave
                      ? "bg-[#C9A962] font-semibold text-[#0A0A0A]"
                      : "text-[#A3A3A3] hover:text-[#E5E5E5]"
                  }`}
                >
                  {rotulo} <span className="opacity-60">{n}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
              <input
                value={procuraVenda}
                onChange={(e) => setProcuraVenda(e.target.value)}
                placeholder="Referência ou colaborador"
                className="w-full rounded-lg border border-[#262626] bg-[#141414] py-2 pl-9 pr-3 text-xs text-[#E5E5E5] placeholder:text-[#525252] focus:border-[#C9A962]/60 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {linhas.length === 0 ? (
          <p className="rounded-xl border border-[#262626] bg-[#1A1A1A] px-4 py-6 text-center text-sm text-[#525252]">
            Nenhuma venda neste filtro.
          </p>
        ) : (
          <ul className="space-y-2">
            {linhas.map((v) => (
              <LinhaVenda
                key={v.id}
                venda={v}
                aberta={aberta === v.id}
                aConfirmar={aConfirmar === v.id}
                aCarregar={aCarregar === v.id}
                detalhe={detalhes[v.id] ?? null}
                onAbrir={() => abrir(v)}
                onConfirmar={() => confirmar(v)}
                onErro={setErro}
                onFeito={() => {
                  setAberta(null);
                  setDetalhes((prev) => {
                    const copia = { ...prev };
                    delete copia[v.id];
                    return copia;
                  });
                  router.refresh();
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-[#525252]">
        «Volume vendido» é desempenho — não é dinheiro do colaborador. O que ele recebe é a
        comissão, e é isso que aparece em «disponível para levantar». Uma venda confirmada
        passa de «por confirmar» para «confirmado»: o total vendido não muda, porque não
        houve venda nova.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- pedaços */

function Numero({
  rotulo,
  valor,
  nota,
  cor = "text-[#F5F5F5]",
}: {
  rotulo: string;
  valor: string;
  nota: string;
  cor?: string;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[#525252]">{rotulo}</p>
      <p className={`mt-1 text-xl font-light ${cor}`}>{valor}</p>
      <p className="mt-1 text-[10px] leading-snug text-[#525252]">{nota}</p>
    </div>
  );
}

function Mini({
  rotulo,
  valor,
  cor,
  conta,
}: {
  rotulo: string;
  valor: number;
  cor: string;
  conta?: number;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-[#4A4A4A]">{rotulo}</p>
      <p className={`text-xs tabular-nums ${cor}`}>
        {formatCurrency(valor)}
        {conta !== undefined && conta > 0 && (
          <span className="ml-1 text-[9px] opacity-60">({conta})</span>
        )}
      </p>
    </div>
  );
}

function LinhaVenda({
  venda,
  aberta,
  aConfirmar,
  aCarregar,
  detalhe,
  onAbrir,
  onConfirmar,
  onErro,
  onFeito,
}: {
  venda: VendaLinha;
  aberta: boolean;
  aConfirmar: boolean;
  aCarregar: boolean;
  detalhe: { itens: ItemVenda[]; eventos: EventoVenda[] } | null;
  onAbrir: () => void;
  onConfirmar: () => void;
  onErro: (m: string) => void;
  onFeito: () => void;
}) {
  const paga = venda.payment_status === "paid";
  const anulada = venda.status === "cancelled";

  return (
    <li
      className={`overflow-hidden rounded-xl border bg-[#1A1A1A] transition ${
        aberta ? "border-[#C9A962]/45" : "border-[#262626]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onAbrir}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {aberta ? (
            <ChevronDown size={14} className="shrink-0 text-[#C9A962]" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-[#525252]" />
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-xs text-[#E5E5E5]">{venda.reference}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  anulada
                    ? "border-[#4A2020] bg-[#2A1010] text-[#F87171]"
                    : COR_PAGAMENTO[venda.payment_status]
                }`}
              >
                {anulada ? "Anulada" : ROTULO_PAGAMENTO[venda.payment_status]}
              </span>
              {paga && venda.payment_confirmed_at && (
                <span className="flex items-center gap-1 text-[10px] text-[#525252]">
                  <BadgeCheck size={10} className="text-[#4ADE80]" />
                  {venda.confirmado_por ?? "gestão"} · {dataCurta(venda.payment_confirmed_at)}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-[#6F6F6F]">
              {venda.seller_nome} · {dataCurta(venda.created_at)}
              {venda.payment_method ? ` · ${venda.payment_method}` : ""}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm tabular-nums text-[#F5F5F5]">
            {formatCurrency(venda.total_amount)}
          </span>
          {!paga && !anulada && (
            <button
              type="button"
              onClick={onConfirmar}
              disabled={aConfirmar}
              className="flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
            >
              {aConfirmar ? (
                <Clock3 size={12} className="animate-pulse" />
              ) : (
                <BadgeCheck size={12} />
              )}
              {aConfirmar ? "A confirmar…" : "Confirmar"}
            </button>
          )}
        </div>
      </div>

      {aberta && (
        <DetalheVenda
          venda={venda}
          detalhe={detalhe}
          aCarregar={aCarregar}
          onErro={onErro}
          onFeito={onFeito}
        />
      )}
    </li>
  );
}

function DetalheVenda({
  venda,
  detalhe,
  aCarregar,
  onErro,
  onFeito,
}: {
  venda: VendaLinha;
  detalhe: { itens: ItemVenda[]; eventos: EventoVenda[] } | null;
  aCarregar: boolean;
  onErro: (m: string) => void;
  onFeito: () => void;
}) {
  const [aReabrir, setAReabrir] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [aGravar, setAGravar] = useState(false);

  const itens = detalhe?.itens ?? null;
  const eventos = detalhe?.eventos ?? null;

  async function reabrir() {
    onErro("");
    setAGravar(true);
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase.rpc("reabrir_pagamento_venda", {
        p_venda: venda.id,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw new Error(error.message);
      onFeito();
    } catch (e) {
      onErro(mensagemErro(e));
    } finally {
      setAGravar(false);
    }
  }

  return (
    <div className="border-t border-[#262323] bg-[#141414] px-4 py-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[#525252]">Produtos</p>
          {itens === null ? (
            <p className="text-xs text-[#525252]">{aCarregar ? "a carregar…" : "—"}</p>
          ) : itens.length === 0 ? (
            <p className="text-xs text-[#525252]">Venda sem linhas de detalhe.</p>
          ) : (
            <ul className="space-y-1.5">
              {itens.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-[#E5E5E5]">
                    {i.quantidade}× {i.nome}
                    {i.sku && <span className="ml-1.5 text-[10px] text-[#525252]">{i.sku}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-[#A3A3A3]">
                    {formatCurrency(i.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[#525252]">Histórico</p>
          {eventos === null ? (
            <p className="text-xs text-[#525252]">{aCarregar ? "a carregar…" : "—"}</p>
          ) : eventos.length === 0 ? (
            <p className="text-xs text-[#525252]">Sem alterações registadas.</p>
          ) : (
            <ol className="space-y-2">
              {eventos.map((e) => (
                <li key={e.id} className="text-xs">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[#E5E5E5]">{ROTULO_EVENTO[e.tipo] ?? e.tipo}</span>
                    <span className="text-[10px] text-[#525252]">{dataCurta(e.em)}</span>
                  </p>
                  <p className="text-[10px] text-[#525252]">
                    {[e.por_nome, e.detalhe].filter(Boolean).join(" · ") || "—"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {venda.payment_status === "paid" && venda.status !== "cancelled" && (
        <div className="mt-4 border-t border-[#232323] pt-3">
          {aReabrir ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo da reabertura (fica no histórico)"
                className="min-w-0 flex-1 rounded-lg border border-[#262626] bg-[#1A1A1A] px-3 py-1.5 text-xs text-[#E5E5E5] placeholder:text-[#525252] focus:border-[#C9A962]/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={reabrir}
                disabled={aGravar}
                className="rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-1.5 text-[11px] text-[#F87171] transition hover:bg-[#3A1616] disabled:opacity-50"
              >
                {aGravar ? "a reabrir…" : "Confirmar reabertura"}
              </button>
              <button
                type="button"
                onClick={() => setAReabrir(false)}
                className="rounded-lg px-2 py-1.5 text-[11px] text-[#6F6F6F] hover:text-[#A3A3A3]"
              >
                cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAReabrir(true)}
              className="flex items-center gap-1.5 text-[11px] text-[#6F6F6F] transition hover:text-[#F87171]"
            >
              <RotateCcw size={11} />
              reabrir o pagamento
            </button>
          )}
          <p className="mt-1 text-[10px] text-[#4A4A4A]">
            Reabrir devolve o valor a «por confirmar». Se a comissão já foi paga, a base recusa.
          </p>
        </div>
      )}
    </div>
  );
}
