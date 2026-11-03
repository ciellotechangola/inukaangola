import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import {
  numero,
  dataCurta,
  mensagemErro,
  type FichaColaborador,
  type PainelColaborador,
} from "@/lib/colaborador";
import ColaboradorIdentidade from "@/components/ColaboradorIdentidade";
import TaxaAoVivo from "@/components/comissoes/TaxaAoVivo";
import { formatarTaxa, normalizarTaxa } from "@/lib/comissoes";
import { ProgressoMeta } from "@/components/Graficos";
import DadosPessoais from "./DadosPessoais";

export const dynamic = "force-dynamic";

export default async function PerfilColaboradorPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  const supabase = await createClientServer();
  const [fichaRes, painelRes, taxaRes] = await Promise.all([
    supabase.rpc("colaborador_ficha", { p_id: profile.id }),
    supabase.rpc("colaborador_painel", { p_id: profile.id }),
    // A taxa vive fora da ficha: uma é pessoal, a outra é da empresa, e a
    // ficha guardava 0 para "sem taxa definida" — que se confundia com 0%.
    supabase.rpc("taxa_comissao"),
  ]);

  const taxa = normalizarTaxa(taxaRes.data);

  if (fichaRes.error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">O meu perfil</h1>
        <div className="mt-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-6 text-sm text-[#F87171]">
          {mensagemErro(fichaRes.error)}
        </div>
      </main>
    );
  }

  const ficha = fichaRes.data as FichaColaborador;
  const painel = (painelRes.data ?? null) as PainelColaborador | null;
  const cartoes = painel?.cartoes;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/vendedor" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Voltar ao painel
      </Link>

      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Área de colaborador · o meu perfil
      </p>

      <ColaboradorIdentidade
        nome={ficha.full_name}
        referencia={ficha.referencia}
        avatarUrl={ficha.avatar_url}
        provincia={ficha.provincia_nome}
        delegacao={ficha.delegacao_nome}
        telefone={ficha.phone}
        categoria={ficha.category}
        funcao={ficha.job_title}
        desde={ficha.hired_at ?? ficha.created_at}
        ativo={ficha.is_active}
        userId={ficha.id}
        podeEditarFoto
        nota={`Taxa de comissão: ${formatarTaxa(taxa.efetiva)} por venda`}
      />

      <div className="mb-4">
        <TaxaAoVivo inicial={taxa} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-[#F5F5F5]">Dados pessoais</h2>
            <DadosPessoais
              id={ficha.id}
              whatsapp={ficha.whatsapp}
              address={ficha.address}
              municipio={ficha.municipio}
            />
          </div>

          <dl className="space-y-3 text-sm">
            <Linha rotulo="Nome completo" valor={ficha.full_name} />
            <Linha rotulo="Nº do Bilhete de Identidade" valor={ficha.bi_number} mono />
            <Linha rotulo="Data de nascimento" valor={ficha.birth_date ? dataCurta(ficha.birth_date) : null} />
            <Linha rotulo="Telefone" valor={ficha.phone} />
            <Linha rotulo="WhatsApp" valor={ficha.whatsapp} />
            <Linha rotulo="Endereço" valor={ficha.address} />
            <Linha rotulo="Município" valor={ficha.municipio} />
            <Linha rotulo="Província" valor={ficha.provincia_nome} />
            <Linha rotulo="Email" valor={ficha.email} />
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-[#525252]">
            O BI e a morada só são visíveis para si e para a gestão da sua província.
            Para corrigir o BI, fale com o seu gestor.
          </p>
        </section>

        <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <h2 className="mb-4 text-sm font-medium text-[#F5F5F5]">Dados profissionais</h2>
          <dl className="space-y-3 text-sm">
            <Linha rotulo="Referência INUKA" valor={ficha.referencia} mono />
            <Linha rotulo="Data de entrada" valor={ficha.hired_at ? dataCurta(ficha.hired_at) : null} />
            <Linha rotulo="Função" valor={ficha.job_title} />
            <Linha rotulo="Categoria" valor={ficha.category} />
            <Linha rotulo="Estado" valor={ficha.is_active ? "Ativo" : "Inativo"} />
            <Linha rotulo="Gestor responsável" valor={ficha.manager_name} />
            <Linha rotulo="Província de atuação" valor={ficha.provincia_nome} />
            <Linha rotulo="Delegação" valor={ficha.delegacao_nome} />
            <Linha
              rotulo="Taxa de comissão"
              valor={`${formatarTaxa(taxa.efetiva)} ${
                taxa.origem === "pessoal" ? "(pessoal)" : "(da empresa)"
              }`}
            />
            <Linha rotulo="Conta criada em" valor={dataCurta(ficha.created_at)} />
          </dl>
        </section>
      </div>

      {cartoes && (
        <>
          <h2 className="mb-4 mt-8 text-sm font-medium text-[#F5F5F5]">Indicadores de desempenho</h2>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador rotulo="Clientes conquistados" valor={String(cartoes.clientes_total)} />
            <Indicador rotulo="Clientes ativos" valor={String(cartoes.clientes_ativos)} />
            <Indicador rotulo="Vendas realizadas" valor={String(cartoes.vendas_count)} />
            <Indicador rotulo="Volume de vendas" valor={formatCurrency(numero(cartoes.vendas_valor))} />
            <Indicador rotulo="Comissões acumuladas" valor={formatCurrency(numero(cartoes.comissao_total))} />
            <Indicador rotulo="Comissões pagas" valor={formatCurrency(numero(cartoes.comissao_paga))} />
            <Indicador rotulo="Comissões pendentes" valor={formatCurrency(numero(cartoes.comissao_pendente))} />
            <Indicador
              rotulo="Cumprimento da meta"
              valor={numero(cartoes.meta_valor) > 0 ? `${Number(cartoes.meta_pct).toFixed(0)}%` : "—"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ProgressoMeta
              valor={numero(cartoes.vendas_valor)}
              meta={numero(cartoes.meta_valor)}
              percentagem={numero(cartoes.meta_pct)}
              origem={cartoes.meta_origem}
            />

            <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
              <h2 className="mb-4 text-sm font-medium text-[#F5F5F5]">Histórico de pagamentos</h2>
              {!painel || painel.historico.pagamentos.length === 0 ? (
                <p className="text-sm text-[#525252]">Ainda não há pagamentos registados.</p>
              ) : (
                <ul className="space-y-3">
                  {painel.historico.pagamentos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="text-[#F5F5F5]">{formatCurrency(numero(p.amount))}</p>
                        <p className="text-[11px] text-[#525252]">
                          {dataCurta(p.paid_at)}
                          {p.method ? ` · ${p.method}` : ""}
                        </p>
                      </div>
                      {p.notes && <span className="text-[11px] text-[#6F6F6F]">{p.notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#1F1F1F] pb-2 last:border-0">
      <dt className="text-[#6F6F6F]">{rotulo}</dt>
      <dd className={`text-right ${valor ? "text-[#E5E5E5]" : "text-[#3F3F3F]"} ${mono ? "font-mono text-xs" : ""}`}>
        {valor || "—"}
      </dd>
    </div>
  );
}

function Indicador({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="text-base font-medium text-[#C9A962]">{valor}</p>
    </div>
  );
}
