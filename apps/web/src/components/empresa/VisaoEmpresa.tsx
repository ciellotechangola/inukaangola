"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { normalizarResumoDespesas, type ResumoDespesas } from "@/lib/despesas";
import { normalizarPainel } from "@/lib/financeiro";
import type { LinhaCategoria, StockValor } from "@/lib/empresa";
import type { ActivoProvincia } from "@/lib/activo";
import PainelActivo from "@/components/despesas/PainelActivo";
import PainelFinanceiro, {
  type ProvinciaOpcao,
} from "@/components/empresa/PainelFinanceiro";

export type { ProvinciaOpcao };

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

type Aba = "financeiro" | "empresa";

export default function VisaoEmpresa({
  nacional,
  provinciaNome,
  activo,
  painel: painelBruto,
  stock,
  resumo: resumoBruto,
  categorias,
  provincias,
  empresa,
  abaInicial = "financeiro",
}: {
  nacional: boolean;
  provinciaNome: string | null;
  activo: ActivoProvincia;
  painel: unknown;
  stock: StockValor;
  resumo: unknown;
  categorias: LinhaCategoria[];
  provincias: ProvinciaOpcao[];
  empresa: ResumoEmpresa;
  abaInicial?: Aba;
}) {
  const painel = normalizarPainel(painelBruto);
  const resumo: ResumoDespesas = normalizarResumoDespesas(resumoBruto);

  const [aba, setAba] = useState<Aba>(abaInicial);

  const total = activo.total;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Empresa</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          O painel financeiro que a gestão controla e a visão completa da operação.
          {nacional ? " Âmbito nacional." : ` Província do ${provinciaNome ?? "—"}.`}
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {(
          [
            { chave: "financeiro", rotulo: "Painel financeiro" },
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

      {aba === "financeiro" ? (
        <PainelFinanceiro painel={painel} provincias={provincias} nacional={nacional} />
      ) : (
        <>
          <PainelActivo activo={activo} />

          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              rotulo="Vendas (desde o início)"
              valor={formatCurrency(total.vendas)}
              nota={`${total.vendas_count} vendas`}
            />
            <Kpi
              rotulo="Vendido este mês"
              valor={formatCurrency(empresa.vendas_mes)}
              nota={`${empresa.vendas_mes_count} vendas`}
            />
            <Kpi
              rotulo="Caixa"
              valor={formatCurrency(total.activo_total)}
              nota="dinheiro disponível"
            />
            <Kpi
              rotulo="Bens e investimentos"
              valor={formatCurrency(total.activo_contabilistico)}
              nota="stock + investimento"
            />
            <Kpi
              rotulo="Valores a pagar"
              valor={formatCurrency(total.por_pagar)}
              nota={`${total.pendentes_count} despesas pendentes`}
            />
            <Kpi
              rotulo="Clientes"
              valor={String(empresa.clientes)}
              nota="registados"
            />
            <Kpi
              rotulo="Colaboradores ativos"
              valor={String(empresa.colaboradores_ativos)}
              nota={`de ${empresa.colaboradores}`}
            />
            <Kpi
              rotulo="Stock"
              valor={formatCurrency(stock.valor)}
              nota={`${stock.unidades} unidades`}
            />
            <Kpi
              rotulo="Comissões por pagar"
              valor={formatCurrency(empresa.comissao_pendente)}
              nota={`${formatCurrency(empresa.comissao_paga)} já pagas`}
            />
            <Kpi
              rotulo="Despesas reais"
              valor={formatCurrency(total.despesas_total)}
              nota={`${formatCurrency(total.por_pagar)} por pagar`}
            />
            <Kpi
              rotulo="Encomendas"
              valor={String(empresa.encomendas)}
              nota="no mês corrente"
            />
            <Kpi
              rotulo="Activo líquido"
              valor={formatCurrency(total.activo_liquido)}
              nota={total.excedido ? "despesas acima do activo" : "depois das despesas"}
            />
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
                          <span className="shrink-0 text-[#F5F5F5]">
                            {formatCurrency(c.valor)}
                          </span>
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
                        <span className="ml-2 text-[10px] text-[#525252]">
                          {p.unidades} un.
                        </span>
                      </span>
                      <span className="shrink-0 text-[#C9A962]">
                        {formatCurrency(p.valor)}
                      </span>
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
                  <span className="text-[#F5F5F5]">
                    {formatCurrency(empresa.comissao_gerada)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Comissões pagas</span>
                  <span className="text-[#22C55E]">
                    {formatCurrency(empresa.comissao_paga)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Comissões por pagar</span>
                  <span className="text-[#C9A962]">
                    {formatCurrency(empresa.comissao_pendente)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Despesas pagas (corrente)</span>
                  <span className="text-[#F5F5F5]">
                    {formatCurrency(resumo.despesa_total)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-[#A3A3A3]">Investimento pago</span>
                  <span className="text-[#E3D5A7]">
                    {formatCurrency(resumo.investimento_total)}
                  </span>
                </li>
              </ul>
            </Panel>
          </div>
        </>
      )}
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
