"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import { formatarTaxa } from "@/lib/comissoes";
import {
  BANCO_VAZIO,
  COR_COMISSAO,
  COR_ESTADO,
  ESTADOS_ABERTOS,
  ROTULO_COMISSAO,
  ROTULO_ESTADO,
  ROTULO_METODO,
  XPRESS_VAZIO,
  bancoDe,
  limparDados,
  normalizarComissoes,
  normalizarDadosRecebimento,
  normalizarMeusLevantamentos,
  normalizarResumo,
  progressoVendas,
  resumoDestino,
  validarBanco,
  validarXpress,
  xpressDe,
  type ComissaoLinha,
  type DadosBanco,
  type DadosRecebimento,
  type DadosXpress,
  type Levantamento,
  type MetodoRecebimento,
  type ResumoLevantamento,
} from "@/lib/levantamentos";

const PATCH = "supabase/PATCH_PROMOCOES_LEVANTAMENTOS.sql";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";
const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

/** Data e hora curtas, no fuso de Angola. */
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

export default function AreaLevantamento() {
  const [resumo, setResumo] = useState<ResumoLevantamento>(normalizarResumo(null));
  const [comissoes, setComissoes] = useState<ComissaoLinha[]>([]);
  const [historico, setHistorico] = useState<Levantamento[]>([]);
  const [recebimento, setRecebimento] = useState<DadosRecebimento>({ xpress: null, banco: null });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Painel do saque
  const [aberto, setAberto] = useState(false);
  const [metodo, setMetodo] = useState<MetodoRecebimento | null>(null);
  const [valor, setValor] = useState("");
  const [xpress, setXpress] = useState<DadosXpress>({ ...XPRESS_VAZIO });
  const [banco, setBanco] = useState<DadosBanco>({ ...BANCO_VAZIO });
  const [notas, setNotas] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erroForm, setErroForm] = useState("");

  const carregar = useCallback(async () => {
    const supabase = createClientBrowser();

    // O saldo é do próprio. Passa-se o id explicitamente em vez de confiar no
    // valor por omissão de `p_seller` — o PostgREST tem de reconhecer a
    // assinatura, e um parâmetro em falta dá PGRST202 em vez do saldo.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;

    if (!uid) {
      setErro("É necessário iniciar sessão para ver as suas comissões.");
      setCarregando(false);
      return;
    }

    const [{ data: brutoResumo, error: e1 }, { data: brutoComissoes }, { data: brutoHist }] =
      await Promise.all([
        supabase.rpc("levantamento_resumo", { p_seller: uid }),
        supabase.rpc("minhas_comissoes", { p_limite: 200 }),
        supabase.rpc("meus_levantamentos", { p_limite: 50 }),
      ]);

    if (e1) {
      setErro(mensagemDeErro(e1, PATCH));
      setCarregando(false);
      return;
    }

    setErro("");
    setResumo(normalizarResumo(brutoResumo));
    setComissoes(normalizarComissoes(brutoComissoes));
    setHistorico(normalizarMeusLevantamentos(brutoHist));

    const { data: brutoDados } = await supabase.rpc("dados_recebimento");
    const guardados = normalizarDadosRecebimento(brutoDados);
    setRecebimento(guardados);
    setXpress(xpressDe(guardados.xpress));
    setBanco(bancoDe(guardados.banco));
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /** Um pedido em curso bloqueia outro: o saldo já está reservado. */
  const pedidoAberto = useMemo(
    () => historico.find((l) => ESTADOS_ABERTOS.includes(l.estado)) ?? null,
    [historico]
  );

  const podePedir = resumo.habilitado && resumo.disponivel > 0 && !pedidoAberto;
  const progresso = progressoVendas(resumo);

  function abrir() {
    setErro("");
    setAviso("");
    setErroForm("");
    setMetodo(null);
    setNotas("");
    // Sugere o saldo todo — o colaborador pode baixar.
    setValor(resumo.disponivel > 0 ? String(Math.floor(resumo.disponivel)) : "");
    setXpress(xpressDe(recebimento.xpress));
    setBanco(bancoDe(recebimento.banco));
    setAberto(true);
  }

  function fechar() {
    setAberto(false);
    setMetodo(null);
    setErroForm("");
  }

  function dadosDoMetodo(): Record<string, string> {
    return metodo === "xpress" ? limparDados(xpress) : limparDados(banco);
  }

  function validar(): string | null {
    const n = Number(String(valor).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return "Indique o valor que quer levantar.";
    if (n > resumo.disponivel) {
      return `O valor pedido é superior ao disponível (${formatCurrency(resumo.disponivel)}).`;
    }
    if (!metodo) return "Escolha como quer receber.";
    const erroDados = metodo === "xpress" ? validarXpress(xpress) : validarBanco(banco);
    if (erroDados) return erroDados;
    return null;
  }

  function valorNumerico(): number {
    const n = Number(String(valor).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  async function confirmar() {
    setErroForm("");
    setAviso("");
    const problema = validar();
    if (problema) {
      setErroForm(problema);
      return;
    }

    setAEnviar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("solicitar_levantamento", {
      p_valor: valorNumerico(),
      p_metodo: metodo,
      p_dados: dadosDoMetodo(),
      p_notas: notas.trim() || null,
    });
    setAEnviar(false);

    if (error) {
      setErroForm(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso(
      "Pedido enviado para a gestão. O valor fica reservado até à decisão — pode acompanhar o estado aqui em baixo."
    );
    fechar();
    await carregar();
  }

  /** Guarda os dados sem pedir dinheiro: para quem quer deixar tudo pronto. */
  async function guardarDados() {
    setErroForm("");
    setAviso("");
    if (!metodo) {
      setErroForm("Escolha primeiro o método de recebimento.");
      return;
    }
    const problema = metodo === "xpress" ? validarXpress(xpress) : validarBanco(banco);
    if (problema) {
      setErroForm(problema);
      return;
    }

    setAEnviar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("guardar_dados_recebimento", {
      p_metodo: metodo,
      p_dados: dadosDoMetodo(),
    });
    setAEnviar(false);

    if (error) {
      setErroForm(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso("Dados de recebimento guardados. Na próxima vez já aparecem preenchidos.");
    await carregar();
  }

  if (carregando) {
    return <p className="text-sm text-[#8A8A8A]">A carregar as suas comissões…</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Retirar dinheiro</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          Comissão de {formatarTaxa(resumo.taxa)} por produto vendido, calculada venda a venda.
          Só contam as vendas confirmadas e pagas.
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

      {/* ---------- Saldo ---------- */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo="Disponível para levantar"
          valor={formatCurrency(resumo.disponivel)}
          detalhe={
            resumo.reservado > 0
              ? `${formatCurrency(resumo.reservado)} reservado`
              : "sem valores reservados"
          }
          destaque
        />
        <Cartao
          rotulo="Comissões ganhas"
          valor={formatCurrency(resumo.comissoes_ganhas)}
          detalhe="vendas confirmadas e pagas"
        />
        <Cartao
          rotulo="Já levantado"
          valor={formatCurrency(resumo.total_pago)}
          detalhe="total pago pela gestão"
        />
        <Cartao
          rotulo="Por confirmar"
          valor={formatCurrency(resumo.comissoes_pendentes)}
          detalhe="vendas ainda não pagas"
        />
      </div>

      {/* ---------- Desbloqueio / botão ---------- */}
      <div className="mb-8 rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
        {resumo.habilitado ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-[#F5F5F5]">
                {resumo.vendas_pagas} venda{resumo.vendas_pagas === 1 ? "" : "s"} confirmada
                {resumo.vendas_pagas === 1 ? "" : "s"} e paga
                {resumo.vendas_pagas === 1 ? "" : "s"} · levantamento desbloqueado
              </p>
              <p className="mt-1 text-xs text-[#8A8A8A]">
                {pedidoAberto
                  ? `Tem o pedido ${pedidoAberto.referencia ?? ""} em curso (${ROTULO_ESTADO[pedidoAberto.estado].toLowerCase()}). O saldo fica reservado até à decisão.`
                  : resumo.disponivel > 0
                    ? "Pode levantar o valor que quiser, até ao saldo disponível."
                    : "Ainda não tem saldo disponível para levantar."}
              </p>
            </div>
            <button
              onClick={abrir}
              disabled={!podePedir}
              title={
                pedidoAberto
                  ? "Já tem um levantamento em curso"
                  : resumo.disponivel <= 0
                    ? "Sem saldo disponível"
                    : undefined
              }
              className="rounded-lg bg-[#C9A962] px-8 py-3 text-sm font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              SACAR
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-[#E3D5A7]">
              Faltam {resumo.vendas_faltam} venda{resumo.vendas_faltam === 1 ? "" : "s"}{" "}
              confirmada{resumo.vendas_faltam === 1 ? "" : "s"} e paga
              {resumo.vendas_faltam === 1 ? "" : "s"} para poder levantar.
            </p>
            <p className="mt-1 text-xs text-[#8A8A8A]">
              O primeiro levantamento abre às {resumo.vendas_minimas} vendas. Já tem{" "}
              {resumo.vendas_pagas}.
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#262626]">
              <div
                className="h-full rounded-full bg-[#C9A962] transition-all"
                style={{ width: `${progresso}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[#6F6F6F]">
              <span>{progresso} %</span>
              <span>
                {resumo.vendas_pagas} / {resumo.vendas_minimas} vendas
              </span>
            </div>
            <button
              disabled
              className="mt-4 cursor-not-allowed rounded-lg bg-[#C9A962] px-8 py-3 text-sm font-semibold tracking-wide text-[#0A0A0A] opacity-40"
            >
              SACAR
            </button>
          </div>
        )}
      </div>

      {/* ---------- Painel de saque ---------- */}
      {aberto && (
        <div className="mb-8 rounded-xl border border-[#C9A962]/40 bg-[#121212] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-[#C9A962]">
              {metodo ? ROTULO_METODO[metodo] : "Como quer receber?"}
            </h2>
            <button onClick={fechar} className="text-xs text-[#8A8A8A] hover:text-[#F5F5F5]">
              fechar
            </button>
          </div>

          {erroForm && (
            <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
              {erroForm}
            </div>
          )}

          {/* Passo 1 — método */}
          {!metodo ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <OpcaoMetodo
                titulo="XPRESS"
                descricao="Recebe numa conta XPRESS. Indique o número da conta ou o telefone associado."
                activo={false}
                onClick={() => {
                  setMetodo("xpress");
                  setErroForm("");
                }}
              />
              <OpcaoMetodo
                titulo="Transferência bancária"
                descricao="Recebe numa conta bancária. Indique o titular, o banco e o número de conta ou IBAN."
                activo={false}
                onClick={() => {
                  setMetodo("transferencia");
                  setErroForm("");
                }}
              />
            </div>
          ) : (
            <>
              <button
                onClick={() => {
                  setMetodo(null);
                  setErroForm("");
                }}
                className="mb-4 text-[11px] text-[#8A8A8A] hover:text-[#C9A962]"
              >
                ← escolher outro método
              </button>

              {/* Valor */}
              <div className="mb-4">
                <label className={ROTULO} htmlFor="valor">
                  Valor a levantar (Kz)
                </label>
                <div className="flex gap-2">
                  <input
                    id="valor"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className={ENTRADA}
                  />
                  <button
                    type="button"
                    onClick={() => setValor(String(Math.floor(resumo.disponivel)))}
                    className="shrink-0 rounded-lg border border-[#404040] px-3 text-xs text-[#D4D4D4] transition hover:border-[#C9A962]"
                  >
                    Tudo
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[#525252]">
                  Disponível: {formatCurrency(resumo.disponivel)}
                </p>
              </div>

              {/* Dados do método */}
              {metodo === "xpress" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo
                    id="xp-titular"
                    rotulo="Titular da conta"
                    valor={xpress.titular}
                    onChange={(v) => setXpress({ ...xpress, titular: v })}
                    placeholder="Nome completo"
                  />
                  <Campo
                    id="xp-telefone"
                    rotulo="Telefone XPRESS"
                    valor={xpress.telefone}
                    onChange={(v) => setXpress({ ...xpress, telefone: v })}
                    placeholder="+244 9xx xxx xxx"
                  />
                  <Campo
                    id="xp-conta"
                    rotulo="Número da conta XPRESS"
                    valor={xpress.conta}
                    onChange={(v) => setXpress({ ...xpress, conta: v })}
                    placeholder="Opcional se indicar o telefone"
                  />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo
                    id="bk-titular"
                    rotulo="Titular da conta"
                    valor={banco.titular}
                    onChange={(v) => setBanco({ ...banco, titular: v })}
                    placeholder="Nome como está no banco"
                  />
                  <Campo
                    id="bk-banco"
                    rotulo="Banco"
                    valor={banco.banco}
                    onChange={(v) => setBanco({ ...banco, banco: v })}
                    placeholder="Ex.: BAI, BFA, BIC, Standard Bank"
                  />
                  <Campo
                    id="bk-conta"
                    rotulo="Número de conta"
                    valor={banco.conta}
                    onChange={(v) => setBanco({ ...banco, conta: v })}
                    placeholder="Número da conta"
                  />
                  <Campo
                    id="bk-iban"
                    rotulo="IBAN (opcional)"
                    valor={banco.iban}
                    onChange={(v) => setBanco({ ...banco, iban: v })}
                    placeholder="AO06 0000 0000 0000 0000 0000 0"
                  />
                  <Campo
                    id="bk-agencia"
                    rotulo="Agência (opcional)"
                    valor={banco.agencia}
                    onChange={(v) => setBanco({ ...banco, agencia: v })}
                    placeholder="Balcão / agência"
                  />
                </div>
              )}

              <div className="mt-4">
                <label className={ROTULO} htmlFor="notas">
                  Nota para a gestão (opcional)
                </label>
                <input
                  id="notas"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Ex.: pode processar até sexta"
                  className={ENTRADA}
                />
              </div>

              <p className="mt-3 rounded-lg border border-[#262626] bg-[#161616] p-3 text-[11px] text-[#8A8A8A]">
                {resumoDestino(metodo, dadosDoMetodo())} — estes dados ficam guardados no seu
                perfil e aparecem preenchidos no próximo pedido. Só a gestão os vê.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={confirmar}
                  disabled={aEnviar}
                  className="rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                >
                  {aEnviar ? "A enviar…" : "CONFIRMAR SAQUE"}
                </button>
                <button
                  onClick={guardarDados}
                  disabled={aEnviar}
                  className="rounded-lg border border-[#404040] px-4 py-2.5 text-sm text-[#D4D4D4] transition hover:border-[#C9A962] disabled:opacity-50"
                >
                  Guardar dados
                </button>
                <button
                  onClick={fechar}
                  className="rounded-lg px-4 py-2.5 text-sm text-[#8A8A8A] transition hover:text-[#F5F5F5]"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- Histórico de pedidos ---------- */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-[#F5F5F5]">Histórico de levantamentos</h2>
        {historico.length === 0 ? (
          <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6 text-sm text-[#6F6F6F]">
            Ainda não pediu nenhum levantamento.
          </div>
        ) : (
          <div className="space-y-2">
            {historico.map((l) => (
              <div key={l.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#F5F5F5]">
                        {l.referencia ?? "Levantamento"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${COR_ESTADO[l.estado]}`}
                      >
                        {ROTULO_ESTADO[l.estado]}
                      </span>
                      <span className="text-[10px] text-[#6F6F6F]">
                        {ROTULO_METODO[l.metodo]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#8A8A8A]">
                      Pedido em {quando(l.solicitado_em)}
                      {l.pago_em ? ` · pago em ${quando(l.pago_em)}` : ""}
                    </p>
                    {l.estado === "rejeitado" && l.motivo && (
                      <p className="mt-1 text-[11px] text-[#F87171]">Motivo: {l.motivo}</p>
                    )}
                    {l.estado === "pendente" && (
                      <p className="mt-1 text-[11px] text-[#6F6F6F]">
                        O valor está reservado e não pode ser pedido outra vez.
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-[#C9A962]">
                    {formatCurrency(l.valor)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Comissões por venda ---------- */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-[#F5F5F5]">Comissões venda a venda</h2>
          <span className="text-[11px] text-[#6F6F6F]">
            {comissoes.length} venda{comissoes.length === 1 ? "" : "s"}
          </span>
        </div>
        {comissoes.length === 0 ? (
          <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6 text-sm text-[#6F6F6F]">
            Ainda não tem vendas com comissão.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#262626] bg-[#1A1A1A]">
            <div className="divide-y divide-[#262626]">
              {comissoes.map((c) => (
                <div key={c.sale_id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[#F5F5F5]">{c.referencia}</p>
                    <p className="text-[11px] text-[#6F6F6F]">
                      {quando(c.criada_em)}
                      {c.provincia ? ` · ${c.provincia}` : ""} · {formatarTaxa(c.taxa)}
                    </p>
                  </div>
                  <span className="text-xs text-[#A3A3A3]">{formatCurrency(c.total)}</span>
                  <span className={`w-24 text-right text-xs ${COR_COMISSAO[c.estado]}`}>
                    {ROTULO_COMISSAO[c.estado]}
                  </span>
                  <span className="w-24 text-right text-sm text-[#C9A962]">
                    {formatCurrency(c.comissao)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-[#525252]">
          Uma venda cancelada não gera comissão. Uma venda por confirmar fica «por pagar» até a
          gestão a marcar como paga.
        </p>
      </section>
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-lg font-medium ${destaque ? "text-[#E3D5A7]" : "text-[#C9A962]"}`}>
        {valor}
      </p>
      {detalhe && <p className="mt-0.5 text-[11px] text-[#525252]">{detalhe}</p>}
    </div>
  );
}

function OpcaoMetodo({
  titulo,
  descricao,
  activo,
  onClick,
}: {
  titulo: string;
  descricao: string;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        activo
          ? "border-[#C9A962] bg-[#241E0E]"
          : "border-[#333333] bg-[#161616] hover:border-[#C9A962]/50"
      }`}
    >
      <p className="text-sm font-medium text-[#F5F5F5]">{titulo}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#8A8A8A]">{descricao}</p>
    </button>
  );
}

function Campo({
  id,
  rotulo,
  valor,
  onChange,
  placeholder,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className={ROTULO} htmlFor={id}>
        {rotulo}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={ENTRADA}
      />
    </div>
  );
}
