import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import TabelaResponsiva from "@/components/TabelaResponsiva";
import {
  COR_TOM,
  ROTULO_TOM,
  desvioDoCalculado,
  quantoExcedeu,
  rotuloAmbito,
  temSaldoDoGestor,
  tomActivo,
  type ActivoProvincia,
  type LinhaActivo,
} from "@/lib/activo";

/**
 * O activo de uma província (ou do país) em quatro números e uma tabela.
 *
 * Sem `"use client"`: a página de despesas usa-o dentro de um componente de
 * cliente e o painel de gestão dentro de um componente de servidor. Como não
 * tem estado, serve os dois sem duplicar markup.
 *
 * Quando o gestor definiu o saldo contabilístico, é esse valor que manda
 * (`origem = gestor`) e o cartão passa a chamar-se «Saldo contabilístico» —
 * a meta. O cálculo automático fica na nota, para comparação.
 */
export default function PainelActivo({
  activo,
  mostrarTabela = true,
}: {
  activo: ActivoProvincia;
  /** A tabela por província só faz sentido no âmbito nacional. */
  mostrarTabela?: boolean;
}) {
  const { total, maximo, scope, em_risco } = activo;
  const tom = tomActivo(total);
  const excedeu = quantoExcedeu(total);
  const nacional = scope === "nacional";
  const doGestor = temSaldoDoGestor(total);
  const desvio = desvioDoCalculado(total);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-light text-[#F5F5F5]">Activo</h2>
          <p className="text-sm text-[#A3A3A3]">
            {doGestor
              ? "O saldo contabilístico declarado pela gestão, menos o que já foi gasto."
              : "O que a província gerou menos o que gastou, desde o início."}{" "}
            {rotuloAmbito(activo)}.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] ${
            tom === "negativo"
              ? "border-[#4A2020] bg-[#2A1010] text-[#F87171]"
              : "border-[#1F4D2E] bg-[#0E2417] text-[#22C55E]"
          }`}
        >
          {ROTULO_TOM[tom]}
        </span>
      </div>

      {!doGestor && (
        <p className="mb-3 text-[11px] text-[#6F6F6F]">
          O activo está a ser calculado automaticamente.{" "}
          <Link href="/gerente/empresa" className="text-[#C9A962] hover:underline">
            Definir o saldo contabilístico →
          </Link>
        </p>
      )}

      {total.excedido && (
        <div className="mb-3 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          <strong className="font-semibold">As despesas ultrapassam o activo.</strong>{" "}
          {nacional ? "O país" : "Esta província"} já gastou{" "}
          {formatCurrency(excedeu)} mais do que {doGestor ? "o saldo declarado" : "aquilo que gerou"}.
          Novas despesas continuam a ser registadas — o alerta serve para travar o
          ritmo, não para esconder o que já foi gasto.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo={doGestor ? "Saldo contabilístico (meta)" : "Activo total"}
          valor={formatCurrency(total.activo_total)}
          nota={
            doGestor
              ? `Definido pela gestão · o sistema calcula ${formatCurrency(
                  total.activo_calculado
                )}${desvio ? ` (${desvio > 0 ? "+" : "−"}${formatCurrency(Math.abs(desvio))})` : ""}`
              : `Vendas ${formatCurrency(total.vendas)} + investimento ${formatCurrency(
                  total.investimento_pago
                )}`
          }
          cor="text-[#C9A962]"
        />
        <Cartao
          rotulo="Despesas reais"
          valor={formatCurrency(total.despesas_total)}
          nota={`${formatCurrency(total.por_pagar)} por pagar · ${
            total.pendentes_count
          } despesa${total.pendentes_count === 1 ? "" : "s"}${
            total.ja_coberto > 0
              ? ` · ${formatCurrency(total.ja_coberto)} já coberto por comissões`
              : ""
          }`}
          cor="text-[#F5F5F5]"
        />
        <Cartao
          rotulo="Activo líquido"
          valor={formatCurrency(total.activo_liquido)}
          nota={
            total.excedido
              ? `Falta ${formatCurrency(excedeu)} para empatar`
              : doGestor && total.progresso !== null
                ? `Resta ${total.progresso} % da meta declarada`
                : total.cobertura >= 200
                  ? "As despesas estão cobertas com folga"
                  : `Cobre ${total.cobertura} % das despesas`
          }
          cor={COR_TOM[tom]}
        />
        {nacional ? (
          <Cartao
            rotulo="Maior activo do país"
            valor={maximo ? formatCurrency(maximo.activo_total) : "—"}
            nota={
              maximo
                ? `${maximo.nome}${
                    em_risco > 0
                      ? ` · ${em_risco} província${em_risco === 1 ? "" : "s"} acima do activo`
                      : ""
                  }`
                : "Sem províncias com movimento"
            }
            cor="text-[#E3D5A7]"
          />
        ) : (
          <Cartao
            rotulo="Por pagar"
            valor={formatCurrency(total.por_pagar)}
            nota={`${total.pendentes_count} despesa${
              total.pendentes_count === 1 ? "" : "s"
            } ainda por liquidar`}
            cor="text-[#C9A962]"
          />
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#525252]">
        {doGestor
          ? "Saldo contabilístico = valor declarado pela gestão a partir da análise ao stock. É a meta: as despesas reais descontam dele. O cálculo automático (vendas + investimento) aparece na nota, só para comparar."
          : "Activo total = vendas não canceladas desde o início + investimento já pago. Despesas reais = pagas + investimento + tudo o que está por pagar (as anuladas não contam). O investimento entra dos dois lados porque comprar um bem não é perder dinheiro — só a despesa corrente e o que está por pagar fazem o activo descer."}{" "}
        Enquanto a gestão não declarar o saldo contabilístico, o activo é calculado
        automaticamente.
      </p>

      {mostrarTabela && nacional && activo.linhas.length > 1 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-[#262626]">
          <div className="border-b border-[#1F1F1F] bg-[#141414] px-4 py-3 text-sm font-medium text-[#F5F5F5]">
            Activo por província
          </div>
          <TabelaResponsiva<LinhaActivo>
            itens={activo.linhas}
            chaveDe={(l) => l.id}
            minimo={760}
            moldura={false}
            vazio={
              <p className="px-4 py-6 text-center text-sm text-[#525252]">
                Ainda não há vendas nem despesas por província.
              </p>
            }
            colunas={[
              {
                chave: "provincia",
                rotulo: "Província",
                titulo: true,
                celula: (l) => (
                  <span className="text-[#F5F5F5]">
                    {l.nome}
                    {maximo?.id === l.id && (
                      <span className="ml-2 rounded-full border border-[#4A3F1F] bg-[#241E0E] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#C9A962]">
                        Maior
                      </span>
                    )}
                    <span className="ml-2 font-mono text-[10px] text-[#525252]">{l.codigo}</span>
                  </span>
                ),
              },
              {
                chave: "vendas",
                rotulo: "Vendas",
                alinhar: "direita",
                celula: (l) => (
                  <span className="text-[#A3A3A3]">{formatCurrency(l.vendas)}</span>
                ),
              },
              {
                chave: "stock",
                rotulo: "Stock",
                alinhar: "direita",
                celula: (l) => (
                  <span className="text-[#8A8A8A]" title={`${l.stock_unidades} unidades`}>
                    {formatCurrency(l.stock_valor)}
                  </span>
                ),
              },
              {
                chave: "despesas",
                rotulo: "Despesas",
                alinhar: "direita",
                celula: (l) => (
                  <span className={l.excedido ? "text-[#F87171]" : "text-[#A3A3A3]"}>
                    {formatCurrency(l.despesas_total)}
                  </span>
                ),
              },
              {
                chave: "activo",
                rotulo: "Activo total",
                alinhar: "direita",
                celula: (l) => (
                  <span className="text-[#C9A962]">
                    {formatCurrency(l.activo_total)}
                    {l.origem === "gestor" && (
                      <span
                        className="ml-1.5 rounded-full border border-[#4A3F1F] bg-[#241E0E] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[#C9A962]"
                        title="Saldo definido pela gestão"
                      >
                        meta
                      </span>
                    )}
                  </span>
                ),
              },
              {
                chave: "liquido",
                rotulo: "Líquido",
                alinhar: "direita",
                celula: (l) => (
                  <span className={COR_TOM[tomActivo(l)]}>{formatCurrency(l.activo_liquido)}</span>
                ),
              },
              {
                chave: "estado",
                rotulo: "Estado",
                alinhar: "direita",
                celula: (l) => (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      l.excedido
                        ? "border-[#4A2020] bg-[#2A1010] text-[#F87171]"
                        : "border-[#1F4D2E] bg-[#0E2417] text-[#22C55E]"
                    }`}
                  >
                    {l.excedido ? "Acima do activo" : "Com activo"}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
    </section>
  );
}

function Cartao({
  rotulo,
  valor,
  nota,
  cor,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  cor: string;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-lg font-medium ${cor}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[#525252]">{nota}</p>
    </div>
  );
}
