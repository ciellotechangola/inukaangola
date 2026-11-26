"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import { normalizarResumoDespesas, type ResumoDespesas } from "@/lib/despesas";
import { normalizarSaldos, quando, type LinhaCategoria, type StockValor } from "@/lib/empresa";
import { COR_TOM, temSaldoDoGestor, tomActivo, type ActivoProvincia } from "@/lib/activo";
import PainelActivo from "@/components/despesas/PainelActivo";

const PATCH = "supabase/PATCH_SALDO_CONTABILISTICO.sql";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";
const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

export interface ProvinciaOpcao {
  id: string;
  nome: string;
  is_default: boolean;
}

export interface ResumoEmpresa {
  vendas_mes: number;
  vendas_mes_count: number;
  encomendas: number;
  clientes: number;
  colaboradores_ativos: number;
  colaboradores: number;
  comissao_gerada: number;
  comissao_paga: number;
  comissao_pendente: number;
  metas_atingidas: number;
  metas_em_curso: number;
  top_produtos: { name: string; units: number; value: number }[];
}

type Aba = "saldo" | "empresa";

export default function VisaoEmpresa({
  nacional,
  provinciaNome,
  activo,
  saldos: saldosBrutos,
  stock,
  resumo: resumoBruto,
  categorias,
  provincias,
  empresa,
  abaInicial = "saldo",
}: {
  nacional: boolean;
  provinciaNome: string | null;
  activo: ActivoProvincia;
  saldos: unknown;
  stock: StockValor;
  resumo: unknown;
  categorias: LinhaCategoria[];
  provincias: ProvinciaOpcao[];
  empresa: ResumoEmpresa;
  abaInicial?: Aba;
}) {
  const router = useRouter();
  const saldos = normalizarSaldos(saldosBrutos);
  const resumo: ResumoDespesas = normalizarResumoDespesas(resumoBruto);

  const [aba, setAba] = useState<Aba>(abaInicial);
  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const [provinciaId, setProvinciaId] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const total = activo.total;
  const doGestor = temSaldoDoGestor(total);
  const tom = tomActivo(total);

  const saldoDaVez = nacional
    ? saldos.find((s) => s.provincia_id === (provinciaId || null))
    : saldos[0];

  async function guardar() {
    setErro("");
    setAviso("");

    const numero = Number(String(valor).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(numero) || numero < 0) {
      setErro("Indique um valor válido para o saldo (0 ou mais).");
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("definir_saldo_contabilistico", {
      p_valor: numero,
      p_provincia_id: nacional ? provinciaId || null : null,
      p_nota: nota.trim() || null,
    });
    setAGravar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso(`Saldo de ${formatCurrency(numero)} guardado. Passa a ser a meta do activo.`);
    setValor("");
    setNota("");
    router.refresh();
  }

  async function voltarAoAutomatico() {
    setErro("");
    setAviso("");

    if (
      !window.confirm(
        "Remover o saldo contabilístico? O activo volta a ser calculado automaticamente (vendas + investimento − despesas)."
      )
    ) {
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("limpar_saldo_contabilistico", {
      p_provincia_id: nacional ? provinciaId || null : null,
    });
    setAGravar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso("Saldo removido. O activo volta ao cálculo automático.");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Empresa</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          O saldo contabilístico que a gestão declara e a visão completa da operação.
          {nacional ? " Âmbito nacional." : ` Província do ${provinciaNome ?? "—"}.`}
        </p>
      </div>

      <div className="mb-6 flex gap-1.5">
        {(
          [
            { chave: "saldo", rotulo: "Saldo contabilístico" },
            { chave: "empresa", rotulo: "Visão completa" },
          ] as { chave: Aba; rotulo: string }[]
        ).map((t) => (
          <button
            key={t.chave}
            onClick={() => setAba(t.chave)}
            aria-pressed={aba === t.chave}
            className={`rounded-full border px-4 py-1.5 text-xs transition ${
              aba === t.chave
                ? "border-[#C9A962] bg-[#241E0E] text-[#C9A962]"
                : "border-[#333333] text-[#8A8A8A] hover:border-[#C9A962]/40 hover:text-[#D4D4D4]"
            }`}
          >
            {t.rotulo}
          </button>
        ))}
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

      {aba === "saldo" ? (
        <>
          <div className="mb-6 rounded-xl border border-[#C9A962]/30 bg-[#121212] p-5">
            <h2 className="text-sm uppercase tracking-wider text-[#C9A962]">
              Saldo contabilístico (meta)
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#A3A3A3]">
              Este valor <strong className="font-medium text-[#F5F5F5]">não é calculado pelo sistema</strong>.
              Olhe para o stock, para o que está na delegação e para o que já se gastou, e escreva
              quanto a empresa vale. É a meta: as despesas reais descontam dela, e o activo
              líquido mostra o que resta.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Referencia
                rotulo="Stock a preço oficial"
                valor={formatCurrency(stock.valor)}
                nota={`${stock.unidades} unidades · ${stock.produtos} produtos`}
              />
              <Referencia
                rotulo="Activo calculado pelo sistema"
                valor={formatCurrency(total.activo_calculado)}
                nota="Vendas + investimento pago"
              />
              <Referencia
                rotulo="Despesas reais"
                valor={formatCurrency(total.despesas_total)}
                nota={`${formatCurrency(total.por_pagar)} ainda por pagar`}
              />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {nacional && (
                <div>
                  <label className={ROTULO} htmlFor="s-provincia">
                    Aplica-se a
                  </label>
                  <select
                    id="s-provincia"
                    value={provinciaId}
                    onChange={(e) => setProvinciaId(e.target.value)}
                    className={ENTRADA}
                  >
                    <option value="">Empresa toda (saldo nacional)</option>
                    {provincias.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                        {p.is_default ? " · sede" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={ROTULO} htmlFor="s-valor">
                  Valor do saldo (Kz)
                </label>
                <input
                  id="s-valor"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  placeholder={saldoDaVez ? String(saldoDaVez.valor) : "0"}
                  className={ENTRADA}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={ROTULO} htmlFor="s-nota">
                  Como chegou a este valor? (opcional)
                </label>
                <input
                  id="s-nota"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Ex.: contagem do stock em 26/11 + equipamento da delegação"
                  className={ENTRADA}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={guardar}
                disabled={aGravar}
                className="rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
              >
                {aGravar ? "A guardar…" : "GUARDAR SALDO"}
              </button>
              {saldoDaVez && (
                <button
                  onClick={voltarAoAutomatico}
                  disabled={aGravar}
                  className="rounded-lg border border-[#333333] px-4 py-2.5 text-sm text-[#A3A3A3] transition hover:border-[#C9A962]/40 hover:text-[#C9A962] disabled:opacity-50"
                >
                  Voltar ao automático
                </button>
              )}
            </div>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Referencia
              rotulo="Activo total em vigor"
              valor={formatCurrency(total.activo_total)}
              nota={doGestor ? "Saldo declarado pela gestão" : "Calculado automaticamente"}
            />
            <Referencia
              rotulo="Activo líquido"
              valor={formatCurrency(total.activo_liquido)}
              nota={
                total.excedido
                  ? "As despesas ultrapassaram o activo"
                  : doGestor && total.progresso !== null
                    ? `Resta ${total.progresso} % da meta`
                    : "Despesas cobertas"
              }
              cor={COR_TOM[tom]}
            />
            <Referencia
              rotulo="Desvio do cálculo automático"
              valor={
                doGestor
                  ? `${total.meta !== null && total.meta >= total.activo_calculado ? "+" : "−"}${formatCurrency(
                      Math.abs((total.meta ?? 0) - total.activo_calculado)
                    )}`
                  : "—"
              }
              nota={doGestor ? "Declarado menos calculado" : "Sem saldo declarado"}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-[#262626]">
            <div className="border-b border-[#1F1F1F] bg-[#141414] px-4 py-3 text-sm font-medium text-[#F5F5F5]">
              Saldos definidos
            </div>
            {saldos.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[#525252]">
                Ainda não há saldo definido. Enquanto não houver, o activo é calculado
                automaticamente.
              </p>
            ) : (
              <ul className="divide-y divide-[#1F1F1F]">
                {saldos.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[#F5F5F5]">
                        {s.provincia ?? "Empresa toda"}
                      </p>
                      <p className="text-[11px] text-[#6F6F6F]">
                        {s.definido_por ?? "—"} · {quando(s.updated_at)}
                        {s.nota ? ` · ${s.nota}` : ""}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-[#C9A962]">
                      {formatCurrency(s.valor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <PainelActivo activo={activo} />

          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi rotulo="Vendas (desde o início)" valor={formatCurrency(total.vendas)} nota={`${total.vendas_count} vendas`} />
            <Kpi rotulo="Vendido este mês" valor={formatCurrency(empresa.vendas_mes)} nota={`${empresa.vendas_mes_count} vendas`} />
            <Kpi rotulo="Encomendas" valor={String(empresa.encomendas)} nota="no mês corrente" />
            <Kpi rotulo="Clientes" valor={String(empresa.clientes)} nota="registados" />
            <Kpi rotulo="Colaboradores ativos" valor={String(empresa.colaboradores_ativos)} nota={`de ${empresa.colaboradores}`} />
            <Kpi rotulo="Stock" valor={formatCurrency(stock.valor)} nota={`${stock.unidades} unidades`} />
            <Kpi rotulo="Comissões por pagar" valor={formatCurrency(empresa.comissao_pendente)} nota={`${formatCurrency(empresa.comissao_paga)} já pagas`} />
            <Kpi rotulo="Despesas por pagar" valor={formatCurrency(total.por_pagar)} nota={`${total.pendentes_count} despesas`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel titulo="Onde vai o dinheiro">
              {categorias.length === 0 ? (
                <Vazio />
              ) : (
                <ul className="space-y-3">
                  {categorias.slice(0, 8).map((c) => {
                    const max = categorias[0]?.valor || 1;
                    return (
                      <li key={c.categoria}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate text-[#A3A3A3]">{c.rotulo}</span>
                          <span className="shrink-0 text-[#F5F5F5]">{formatCurrency(c.valor)}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#262626]">
                          <div
                            className="h-full rounded-full bg-[#C9A962]"
                            style={{ width: `${Math.max((c.valor / max) * 100, 2)}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[10px] text-[#525252]">
                          {c.count} despesa{c.count === 1 ? "" : "s"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel titulo="Stock mais valioso">
              {stock.top.length === 0 ? (
                <Vazio />
              ) : (
                <ul className="space-y-2 text-sm">
                  {stock.top.map((p) => (
                    <li key={p.nome} className="flex justify-between gap-3">
                      <span className="truncate text-[#A3A3A3]">
                        {p.nome}
                        <span className="ml-2 text-[10px] text-[#525252]">{p.unidades} un.</span>
                      </span>
                      <span className="shrink-0 text-[#C9A962]">{formatCurrency(p.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel titulo="Produtos mais vendidos">
              {empresa.top_produtos.length === 0 ? (
                <Vazio />
              ) : (
                <ul className="space-y-2 text-sm">
                  {empresa.top_produtos.map((p) => (
                    <li key={p.name} className="flex justify-between gap-3">
                      <span className="truncate text-[#A3A3A3]">{p.name}</span>
                      <span className="shrink-0 text-[#F5F5F5]">{p.units} un.</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel titulo="Metas da equipa">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Metas atingidas</span>
                  <span className="text-[#F5F5F5]">
                    {empresa.metas_atingidas} / {empresa.metas_em_curso}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Comissões geradas</span>
                  <span className="text-[#F5F5F5]">{formatCurrency(empresa.comissao_gerada)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Comissões pagas</span>
                  <span className="text-[#22C55E]">{formatCurrency(empresa.comissao_paga)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Comissões por pagar</span>
                  <span className="text-[#C9A962]">{formatCurrency(empresa.comissao_pendente)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Despesas pagas (corrente)</span>
                  <span className="text-[#F5F5F5]">{formatCurrency(resumo.despesa_total)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Investimento pago</span>
                  <span className="text-[#E3D5A7]">{formatCurrency(resumo.investimento_total)}</span>
                </li>
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Referencia({
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
    <div className="rounded-lg border border-[#262626] bg-[#1A1A1A] p-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-base font-medium ${cor}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-[#525252]">{nota}</p>
    </div>
  );
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="text-lg font-medium text-[#C9A962]">{valor}</p>
      <p className="mt-0.5 text-[11px] text-[#525252]">{nota}</p>
    </div>
  );
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <h2 className="mb-4 text-lg font-medium text-[#F5F5F5]">{titulo}</h2>
      {children}
    </div>
  );
}

function Vazio() {
  return <p className="text-sm text-[#525252]">Sem dados no período.</p>;
}
