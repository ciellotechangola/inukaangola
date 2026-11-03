import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import {
  numero,
  dataCurta,
  mensagemErro,
  type PainelColaborador,
} from "@/lib/colaborador";
import ColaboradorIdentidade from "@/components/ColaboradorIdentidade";
import TaxaAoVivo from "@/components/comissoes/TaxaAoVivo";
import { normalizarTaxa } from "@/lib/comissoes";
import { GraficoEvolucao, ProgressoMeta } from "@/components/Graficos";

export const dynamic = "force-dynamic";

export default async function SellerDashboardPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  const supabase = await createClientServer();
  const [{ data, error }, { data: taxaBruta }] = await Promise.all([
    supabase.rpc("colaborador_painel"),
    supabase.rpc("taxa_comissao"),
  ]);

  const taxa = normalizarTaxa(taxaBruta);

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">Área de colaborador</h1>
        <div className="mt-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-6 text-sm text-[#F87171]">
          {mensagemErro(error)}
        </div>
      </main>
    );
  }

  const painel = data as PainelColaborador;
  const { identidade, cartoes, series, historico, alertas } = painel;
  const vendasValor = numero(cartoes.vendas_valor);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Área de colaborador
      </p>

      <ColaboradorIdentidade
        nome={identidade.full_name}
        referencia={identidade.referencia}
        avatarUrl={identidade.avatar_url}
        provincia={identidade.provincia_nome}
        delegacao={identidade.delegacao_nome}
        telefone={identidade.phone}
        categoria={identidade.category}
        funcao={identidade.job_title}
        desde={identidade.hired_at ?? identidade.created_at}
        ativo={identidade.is_active}
        userId={identidade.id}
        podeEditarFoto
        acoes={
          <>
            <Link
              href="/vendedor/vendas/registar"
              className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
            >
              Registar venda
            </Link>
            <Link
              href="/vendedor/perfil"
              className="rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            >
              O meu perfil
            </Link>
          </>
        }
        nota={
          cartoes.posicao && cartoes.equipa
            ? `${cartoes.posicao}.º de ${cartoes.equipa} colaboradores da província este mês`
            : undefined
        }
      />

      <div className="mb-4">
        <TaxaAoVivo inicial={taxa} />
      </div>

      {alertas.length > 0 && (
        <div className="mb-6 space-y-2">
          {alertas.map((a) => (
            <div
              key={a.tipo}
              className={`rounded-lg border px-4 py-2 text-sm ${
                a.tipo === "meta_atingida"
                  ? "border-[#1F4D2E] bg-[#0F2A18] text-[#4ADE80]"
                  : a.tipo === "meta_perto"
                    ? "border-[#4A3F1A] bg-[#2A2410] text-[#E3D5A7]"
                    : "border-[#333] bg-[#161616] text-[#A3A3A3]"
              }`}
            >
              {a.texto}
            </div>
          ))}
        </div>
      )}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo="Clientes conquistados" valor={String(cartoes.clientes_total)} />
        <Cartao rotulo="Vendas realizadas" valor={String(cartoes.vendas_count)} />
        <Cartao rotulo="Volume vendido" valor={formatCurrency(vendasValor)} />
        <Cartao
          rotulo="Clientes ativos"
          valor={String(cartoes.clientes_ativos)}
          detalhe={`${cartoes.clientes_total} no total`}
        />
        <Cartao rotulo="Comissão acumulada" valor={formatCurrency(numero(cartoes.comissao_total))} />
        <Cartao
          rotulo="Comissão disponível"
          valor={formatCurrency(numero(cartoes.comissao_paga))}
          detalhe="já paga"
        />
        <Cartao
          rotulo="Comissão pendente"
          valor={formatCurrency(numero(cartoes.comissao_pendente))}
          detalhe="por receber"
          destaque={numero(cartoes.comissao_pendente) > 0}
        />
        <Cartao
          rotulo="Meta mensal"
          valor={
            numero(cartoes.meta_valor) > 0
              ? formatCurrency(numero(cartoes.meta_valor))
              : "—"
          }
          detalhe={
            numero(cartoes.meta_valor) > 0
              ? `${Number(cartoes.meta_pct).toFixed(0)}% cumprido`
              : "sem meta definida"
          }
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
          <GraficoEvolucao
            titulo="Evolução das vendas"
            meses={series.meses}
            valores={series.vendas.map(numero)}
            formato={(n) => formatCurrency(n)}
          />
          <GraficoEvolucao
            titulo="Evolução das comissões"
            meses={series.meses}
            valores={series.comissoes.map(numero)}
            formato={(n) => formatCurrency(n)}
            cor="#E3D5A7"
          />
        </div>
        <ProgressoMeta
          valor={vendasValor}
          meta={numero(cartoes.meta_valor)}
          percentagem={numero(cartoes.meta_pct)}
          origem={cartoes.meta_origem}
        />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <Lista
          titulo="Últimas vendas"
          href="/vendedor/vendas"
          vazio="Ainda não registou vendas."
          itens={historico.vendas.map((v) => ({
            chave: v.id,
            principal: v.reference,
            secundario: dataCurta(v.created_at),
            valor: formatCurrency(numero(v.total_amount)),
            aviso: v.status === "cancelled" ? "cancelada" : undefined,
          }))}
        />
        <Lista
          titulo="Clientes conquistados"
          href="/vendedor/clientes"
          vazio="Ainda não tem clientes associados."
          itens={historico.clientes.map((c, i) => ({
            chave: `${c.full_name}-${i}`,
            principal: c.full_name,
            secundario: dataCurta(c.assigned_at),
            valor: c.is_active ? "ativo" : "inativo",
          }))}
        />
        <Lista
          titulo="Pagamentos de comissões"
          href="/vendedor/perfil"
          vazio="Ainda não recebeu comissões."
          itens={historico.pagamentos.map((p) => ({
            chave: p.id,
            principal: formatCurrency(numero(p.amount)),
            secundario: dataCurta(p.paid_at),
            valor: p.method ?? "—",
          }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Acao href="/vendedor/vendas/registar" titulo="Registar venda" descricao="Nova operação" />
        <Acao href="/vendedor/vendas" titulo="Histórico" descricao="Todas as vendas" />
        <Acao href="/vendedor/clientes" titulo="Meus clientes" descricao="Gerir associações" />
        <Acao href="/vendedor/encomendas" titulo="Encomendas" descricao="Pedidos da carteira" />
        <Acao href="/cliente/conversas" titulo="Mensagens" descricao="Falar com clientes" />
        <Acao href="/vendedor/comunicados" titulo="Comunicados" descricao="Avisos da gestão" />
        <Acao href="/vendedor/formacao" titulo="Formação INUKA" descricao="Cursos e progresso" />
      </div>
    </main>
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
      <p className={`text-lg font-medium ${destaque ? "text-[#E3D5A7]" : "text-[#C9A962]"}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-[11px] text-[#525252]">{detalhe}</p>}
    </div>
  );
}

function Lista({
  titulo,
  href,
  vazio,
  itens,
}: {
  titulo: string;
  href: string;
  vazio: string;
  itens: { chave: string; principal: string; secundario: string; valor: string; aviso?: string }[];
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[#F5F5F5]">{titulo}</h2>
        <Link href={href} className="text-[11px] text-[#6F6F6F] transition hover:text-[#C9A962]">
          ver tudo
        </Link>
      </div>
      {itens.length === 0 ? (
        <p className="text-sm text-[#525252]">{vazio}</p>
      ) : (
        <ul className="space-y-3">
          {itens.map((item) => (
            <li key={item.chave} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate text-[#F5F5F5]">
                  {item.principal}
                  {item.aviso && (
                    <span className="ml-2 rounded bg-[#2A1010] px-1.5 py-0.5 text-[10px] text-[#F87171]">
                      {item.aviso}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[#525252]">{item.secundario}</p>
              </div>
              <span className="shrink-0 text-xs text-[#C9A962]">{item.valor}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Acao({ href, titulo, descricao }: { href: string; titulo: string; descricao: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5 transition hover:border-[#C9A962]/40"
    >
      <h3 className="mb-1 text-sm font-medium text-[#C9A962]">{titulo}</h3>
      <p className="text-xs text-[#A3A3A3]">{descricao}</p>
    </Link>
  );
}
