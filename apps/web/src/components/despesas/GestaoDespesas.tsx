"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import { normalizarResumo } from "@/lib/levantamentos";
import {
  CATEGORIAS,
  COR_ESTADO_DESPESA,
  COR_TIPO,
  DESCRICAO_TIPO,
  ROTULO_CATEGORIA,
  ROTULO_ESTADO_DESPESA,
  ROTULO_TIPO,
  TIPOS_DESPESA,
  normalizarDespesas,
  normalizarResumoDespesas,
  progressoDespesa,
  quemPagou,
  type CategoriaDespesa,
  type Despesa,
  type EstadoDespesa,
  type ResumoDespesas,
  type TipoDespesa,
} from "@/lib/despesas";

const PATCH = "supabase/PATCH_DESPESAS_INVESTIMENTO.sql";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";
const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

type Filtro = "todas" | EstadoDespesa;

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "pendente", rotulo: "Por pagar" },
  { chave: "paga", rotulo: "Pagas" },
  { chave: "anulada", rotulo: "Anuladas" },
];

interface Colaborador {
  id: string;
  nome: string;
  provincia: string | null;
}

function quando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function numero(valor: string): number {
  const n = Number(String(valor).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function GestaoDespesas() {
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [resumo, setResumo] = useState<ResumoDespesas>(normalizarResumoDespesas(null));
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Registar
  const [novoAberto, setNovoAberto] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState<TipoDespesa>("despesa");
  const [categoria, setCategoria] = useState<CategoriaDespesa>("outros");
  const [fornecedor, setFornecedor] = useState("");
  const [notas, setNotas] = useState("");
  const [aGravar, setAGravar] = useState(false);

  // Pagar
  const [aPagar, setAPagar] = useState<string | null>(null);
  const [quemPaga, setQuemPaga] = useState("");
  const [saldoEscolhido, setSaldoEscolhido] = useState<number | null>(null);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [aProcessar, setAProcessar] = useState(false);

  // Anular
  const [aAnular, setAAnular] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    const supabase = createClientBrowser();
    const [{ data: lista, error }, { data: brutoResumo }] = await Promise.all([
      supabase.rpc("despesas_equipa", {
        p_estado: filtro === "todas" ? null : filtro,
        p_tipo: null,
      }),
      supabase.rpc("despesas_resumo"),
    ]);

    if (error) setErro(mensagemDeErro(error, PATCH));
    else setErro("");

    setDespesas(normalizarDespesas(lista));
    setResumo(normalizarResumoDespesas(brutoResumo));
    setCarregando(false);
  }, [filtro]);

  useEffect(() => {
    setCarregando(true);
    carregar();
  }, [carregar]);

  // A lista de colaboradores só serve para escolher de quem sai o dinheiro.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const supabase = createClientBrowser();
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, provincia:provincias(nome)")
        .eq("role", "seller")
        .eq("is_active", true)
        .order("full_name");

      type Linha = {
        id: string;
        full_name: string;
        provincia: { nome: string } | { nome: string }[] | null;
      };

      if (!vivo) return;
      setColaboradores(
        ((data ?? []) as unknown as Linha[]).map((c) => ({
          id: c.id,
          nome: c.full_name,
          provincia: Array.isArray(c.provincia)
            ? (c.provincia[0]?.nome ?? null)
            : (c.provincia?.nome ?? null),
        }))
      );
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const pendentes = useMemo(
    () => despesas.filter((d) => d.estado === "pendente"),
    [despesas]
  );

  function limparFormulario() {
    setDescricao("");
    setValor("");
    setTipo("despesa");
    setCategoria("outros");
    setFornecedor("");
    setNotas("");
  }

  async function registar() {
    setErro("");
    setAviso("");

    if (!descricao.trim()) {
      setErro("Descreva a despesa — é o que aparece na lista e no histórico do colaborador.");
      return;
    }
    if (numero(valor) <= 0) {
      setErro("Indique o valor da despesa.");
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("registar_despesa", {
      p_descricao: descricao.trim(),
      p_valor: numero(valor),
      p_tipo: tipo,
      p_categoria: categoria,
      p_fornecedor: fornecedor.trim() || null,
      p_provincia_id: null,
      p_notas: notas.trim() || null,
      p_comprovativo: null,
    });
    setAGravar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    const referencia = (data as { referencia?: string } | null)?.referencia;
    setAviso(`${referencia ?? "Despesa"} registada. Já aparece na lista por pagar.`);
    limparFormulario();
    setNovoAberto(false);
    await carregar();
  }

  function abrirPagar(d: Despesa) {
    setErro("");
    setAviso("");
    setAAnular(null);
    setMotivo("");
    setAPagar(aPagar === d.id ? null : d.id);
    setQuemPaga("");
    setSaldoEscolhido(null);
  }

  /** Ao escolher o colaborador, mostra o saldo dele antes de confirmar. */
  async function escolherQuemPaga(id: string) {
    setQuemPaga(id);
    setSaldoEscolhido(null);
    if (!id) return;

    const supabase = createClientBrowser();
    const { data } = await supabase.rpc("levantamento_resumo", { p_seller: id });
    setSaldoEscolhido(normalizarResumo(data).disponivel);
  }

  async function pagar(d: Despesa) {
    setErro("");
    setAviso("");

    const deQuem = quemPaga
      ? colaboradores.find((c) => c.id === quemPaga)?.nome ?? "o colaborador"
      : null;

    const confirmar = window.confirm(
      deQuem
        ? `Pagar ${formatCurrency(d.restante)} de «${d.descricao}» com o saldo de comissões de ${deQuem}?\n\n` +
            "O saldo dele baixa e as comissões mais antigas são fechadas. Esta acção não se desfaz."
        : `Marcar ${formatCurrency(d.restante)} de «${d.descricao}» como pago pela tesouraria?\n\n` +
            "Nenhum saldo de colaborador é afectado. Esta acção não se desfaz."
    );
    if (!confirmar) return;

    setAProcessar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("pagar_despesa", {
      p_id: d.id,
      p_seller_id: quemPaga || null,
      p_nota: null,
    });
    setAProcessar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso(
      deQuem
        ? `Despesa paga com ${formatCurrency(d.restante)} do saldo de ${deQuem}.`
        : `Despesa paga pela tesouraria (${formatCurrency(d.restante)}).`
    );
    setAPagar(null);
    setQuemPaga("");
    setSaldoEscolhido(null);
    await carregar();
  }

  async function anular(d: Despesa) {
    setErro("");
    setAviso("");

    if (!motivo.trim()) {
      setErro("Indique o motivo da anulação.");
      return;
    }

    setAProcessar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("anular_despesa", {
      p_id: d.id,
      p_motivo: motivo.trim(),
    });
    setAProcessar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso(`${d.referencia ?? "Despesa"} anulada.`);
    setAAnular(null);
    setMotivo("");
    await carregar();
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Despesas e investimento</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            O que a empresa gasta e investe. Pode ser pago pela tesouraria ou descontado do
            saldo de comissões de um colaborador.
          </p>
        </div>
        <button
          onClick={() => {
            setNovoAberto(!novoAberto);
            setErro("");
          }}
          className="rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
        >
          {novoAberto ? "FECHAR" : "REGISTAR DESPESA"}
        </button>
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

      {/* ---------- Totais ---------- */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">Por pagar</p>
          <p className="text-lg font-medium text-[#C9A962]">
            {formatCurrency(resumo.pendente_valor)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#525252]">
            {resumo.pendente_count} despesa{resumo.pendente_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            Despesas pagas
          </p>
          <p className="text-lg font-medium text-[#F5F5F5]">
            {formatCurrency(resumo.despesa_total)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#525252]">custo corrente</p>
        </div>
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            Investimento pago
          </p>
          <p className="text-lg font-medium text-[#E3D5A7]">
            {formatCurrency(resumo.investimento_total)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#525252]">fica para a empresa</p>
        </div>
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            Pago com comissões
          </p>
          <p className="text-lg font-medium text-[#22C55E]">
            {formatCurrency(resumo.pago_com_comissoes)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#525252]">saiu do saldo da equipa</p>
        </div>
      </div>

      {/* ---------- Registar ---------- */}
      {novoAberto && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#121212] p-5">
          <h2 className="mb-4 text-sm uppercase tracking-wider text-[#C9A962]">Nova despesa</h2>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {TIPOS_DESPESA.map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                aria-pressed={tipo === t}
                className={`rounded-xl border p-4 text-left transition ${
                  tipo === t
                    ? "border-[#C9A962] bg-[#241E0E]"
                    : "border-[#333333] bg-[#161616] hover:border-[#C9A962]/50"
                }`}
              >
                <p className="text-sm font-medium text-[#F5F5F5]">{ROTULO_TIPO[t]}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#8A8A8A]">
                  {DESCRICAO_TIPO[t]}
                </p>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={ROTULO} htmlFor="d-descricao">
                Descrição
              </label>
              <input
                id="d-descricao"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: Balança industrial para a delegação do Uíge"
                className={ENTRADA}
              />
            </div>
            <div>
              <label className={ROTULO} htmlFor="d-valor">
                Valor (Kz)
              </label>
              <input
                id="d-valor"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={ENTRADA}
              />
            </div>
            <div>
              <label className={ROTULO} htmlFor="d-categoria">
                Categoria
              </label>
              <select
                id="d-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as CategoriaDespesa)}
                className={ENTRADA}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_CATEGORIA[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={ROTULO} htmlFor="d-fornecedor">
                Fornecedor (opcional)
              </label>
              <input
                id="d-fornecedor"
                value={fornecedor}
                onChange={(e) => setFornecedor(e.target.value)}
                placeholder="A quem se pagou"
                className={ENTRADA}
              />
            </div>
            <div>
              <label className={ROTULO} htmlFor="d-notas">
                Nota interna (opcional)
              </label>
              <input
                id="d-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Ex.: aprovado em conselho"
                className={ENTRADA}
              />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-[#525252]">
            A despesa fica na província que gere. A administração nacional registra na sede.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={registar}
              disabled={aGravar}
              className="rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
            >
              {aGravar ? "A registar…" : "REGISTAR"}
            </button>
            <button
              onClick={() => {
                setNovoAberto(false);
                limparFormulario();
              }}
              className="rounded-lg px-4 py-2.5 text-sm text-[#8A8A8A] transition hover:text-[#F5F5F5]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ---------- Filtros ---------- */}
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

      {/* ---------- Lista ---------- */}
      {carregando ? (
        <p className="text-sm text-[#8A8A8A]">A carregar despesas…</p>
      ) : despesas.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#121212] p-8 text-center text-sm text-[#A3A3A3]">
          {filtro === "todas"
            ? "Ainda não há despesas registadas."
            : "Nenhuma despesa neste estado."}
        </div>
      ) : (
        <div className="space-y-3">
          {despesas.map((d) => {
            const ocupado = aProcessar;
            const emPagar = aPagar === d.id;
            const emAnular = aAnular === d.id;
            const falta = Math.max(d.valor - d.coberto, 0);

            return (
              <div key={d.id} className="rounded-xl border border-[#262626] bg-[#121212] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-[#F5F5F5]">{d.descricao}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${COR_TIPO[d.tipo]}`}
                      >
                        {ROTULO_TIPO[d.tipo]}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${COR_ESTADO_DESPESA[d.estado]}`}
                      >
                        {ROTULO_ESTADO_DESPESA[d.estado]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#8A8A8A]">
                      {d.referencia ?? "Sem referência"} · {ROTULO_CATEGORIA[d.categoria]}
                      {d.provincia ? ` · ${d.provincia}` : ""}
                      {d.fornecedor ? ` · ${d.fornecedor}` : ""}
                    </p>
                    <p className="text-[11px] text-[#6F6F6F]">
                      Registada em {quando(d.criada_em)}
                      {d.pago_em ? ` · paga em ${quando(d.pago_em)}` : ""}
                      {` · ${quemPagou(d)}`}
                    </p>
                    {d.notas && (
                      <p className="mt-1 text-[11px] text-[#A3A3A3]">{d.notas}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-medium text-[#C9A962]">{formatCurrency(d.valor)}</p>
                    {d.estado === "pendente" && falta !== d.valor && (
                      <p className="text-[11px] text-[#8A8A8A]">
                        faltam {formatCurrency(falta)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Progresso do que já foi coberto por comissões */}
                {d.coberto > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#262626]">
                      <div
                        className="h-full rounded-full bg-[#C9A962] transition-all"
                        style={{ width: `${progressoDespesa(d)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-[#6F6F6F]">
                      {formatCurrency(d.coberto)} de {formatCurrency(d.valor)} já pagos por
                      comissões ({progressoDespesa(d)} %)
                    </p>
                  </div>
                )}

                {/* Acções */}
                {d.estado === "pendente" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => abrirPagar(d)}
                      disabled={ocupado}
                      className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                    >
                      Pagar {formatCurrency(falta)}
                    </button>
                    <button
                      onClick={() => {
                        setAAnular(emAnular ? null : d.id);
                        setAPagar(null);
                        setMotivo("");
                        setErro("");
                      }}
                      disabled={ocupado || d.coberto > 0}
                      title={
                        d.coberto > 0
                          ? "Já tem comissões aplicadas — não se pode anular"
                          : undefined
                      }
                      className="rounded-lg border border-[#4A2020] px-3 py-1.5 text-[11px] text-[#F87171] transition hover:bg-[#2A1010] disabled:opacity-40"
                    >
                      Anular
                    </button>
                  </div>
                )}

                {/* Painel de pagamento */}
                {emPagar && (
                  <div className="mt-3 rounded-lg border border-[#C9A962]/30 bg-[#161616] p-3">
                    <label
                      className={ROTULO}
                      htmlFor={`quem-${d.id}`}
                    >
                      De onde sai o dinheiro?
                    </label>
                    <select
                      id={`quem-${d.id}`}
                      value={quemPaga}
                      onChange={(e) => escolherQuemPaga(e.target.value)}
                      className={ENTRADA}
                    >
                      <option value="">Tesouraria da empresa</option>
                      {colaboradores.map((c) => (
                        <option key={c.id} value={c.id}>
                          Saldo de {c.nome}
                          {c.provincia ? ` · ${c.provincia}` : ""}
                        </option>
                      ))}
                    </select>

                    {quemPaga && (
                      <p
                        className={`mt-2 text-[11px] ${
                          saldoEscolhido === null
                            ? "text-[#8A8A8A]"
                            : saldoEscolhido >= falta
                              ? "text-[#22C55E]"
                              : "text-[#F87171]"
                        }`}
                      >
                        {saldoEscolhido === null
                          ? "A ler o saldo…"
                          : saldoEscolhido >= falta
                            ? `Saldo disponível: ${formatCurrency(saldoEscolhido)} — chega para os ${formatCurrency(falta)} que faltam.`
                            : `Saldo disponível: ${formatCurrency(saldoEscolhido)} — não chega para os ${formatCurrency(falta)} que faltam.`}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => pagar(d)}
                        disabled={ocupado}
                        className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                      >
                        {ocupado ? "…" : "Confirmar pagamento"}
                      </button>
                      <button
                        onClick={() => {
                          setAPagar(null);
                          setQuemPaga("");
                          setSaldoEscolhido(null);
                        }}
                        className="rounded-lg px-3 py-1.5 text-[11px] text-[#8A8A8A] hover:text-[#F5F5F5]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Painel de anulação */}
                {emAnular && (
                  <div className="mt-3 rounded-lg border border-[#4A2020] bg-[#1A0E0E] p-3">
                    <label className={ROTULO} htmlFor={`motivo-${d.id}`}>
                      Motivo da anulação
                    </label>
                    <input
                      id={`motivo-${d.id}`}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: registada duas vezes"
                      className={ENTRADA}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => anular(d)}
                        disabled={ocupado}
                        className="rounded-lg bg-[#DC2626] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#EF4444] disabled:opacity-50"
                      >
                        {ocupado ? "…" : "Confirmar anulação"}
                      </button>
                      <button
                        onClick={() => {
                          setAAnular(null);
                          setMotivo("");
                        }}
                        className="rounded-lg px-3 py-1.5 text-[11px] text-[#8A8A8A] hover:text-[#F5F5F5]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendentes.length > 0 && (
        <p className="mt-4 text-[11px] text-[#525252]">
          {pendentes.length} despesa{pendentes.length === 1 ? "" : "s"} por pagar na vista
          actual. Os colaboradores vêem estas despesas no painel de levantamento e podem aplicar
          a comissão nelas.
        </p>
      )}
    </div>
  );
}
