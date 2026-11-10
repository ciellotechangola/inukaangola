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
import { MinhasTarefas } from "@/components/tarefas/MinhasTarefas";
import { ordenarTarefas, type Tarefa } from "@/lib/tarefas";
import { formatarTaxa, normalizarTaxa } from "@/lib/comissoes";
import { normalizarResumo, progressoVendas } from "@/lib/levantamentos";
import { GraficoEvolucao, ProgressoMeta } from "@/components/Graficos";
import DadosPessoais from "./DadosPessoais";

export const dynamic = "force-dynamic";

/**
 * Área de colaborador — a única página do colaborador.
 *
 * Antes havia duas: esta e `/vendedor/perfil`, que repetia a identidade, os
 * indicadores e a referência. Ficou uma só, com os dados pessoais e
 * profissionais no fim. O código de referência aparece **uma vez**, no cartão
 * de identidade — é o que o colaborador mostra ao cliente e à INUKA.
 */
export default async function SellerDashboardPage() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "seller" && profile.role !== "manager")) redirect("/");

  const supabase = await createClientServer();
  const [{ data, error }, { data: taxaBruta }, { data: resumoBruto }, fichaRes, tarefasRes] =
    await Promise.all([
      supabase.rpc("colaborador_painel"),
      supabase.rpc("taxa_comissao"),
      supabase.rpc("levantamento_resumo", { p_seller: profile.id }),
      // A ficha traz o BI, a morada e a função — o que antes só se via no
      // perfil. Se falhar, a área abre na mesma: os dados são o menos urgente.
      supabase.rpc("colaborador_ficha", { p_id: profile.id }),
      // Tarefas atribuídas pela gestão. Se a migração 0018 ainda não estiver
      // aplicada a consulta falha e a secção desaparece — o painel abre na mesma.
      supabase
        .from("colaborador_tarefas")
        .select(
          "id, seller_id, titulo, descricao, prazo, prioridade, estado, criado_por, criado_em, concluida_em, autor:profiles!criado_por(full_name)"
        )
        .eq("seller_id", profile.id)
        .order("prazo", { ascending: true, nullsFirst: false })
        .limit(50),
    ]);

  const taxa = normalizarTaxa(taxaBruta);
  // Se a migração dos levantamentos ainda não estiver aplicada, a RPC devolve
  // erro e o resumo fica a zeros — o painel continua a abrir.
  const resumo = normalizarResumo(resumoBruto);
  const ficha = (fichaRes.data ?? null) as FichaColaborador | null;

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

  // Reservar é cadastrar: quem está por activar já é cliente do colaborador.
  // O `colaborador_painel` conta só vínculos reais (`seller_customers`), por
  // isso a reserva soma-se aqui — sem mexer na função, que a gestão também usa.
  const { count: porActivar } = await supabase
    .from("reserved_customers")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", profile.id)
    .eq("status", "reservado");

  const totalClientes = numero(cartoes.clientes_total) + (porActivar ?? 0);

  const tarefas = ordenarTarefas((tarefasRes.data ?? []) as unknown as Tarefa[]);

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
          <Link
            href="/vendedor/vendas/registar"
            className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
          >
            Registar venda
          </Link>
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

      {/* O que a gestão pediu. Fica acima do dinheiro: uma tarefa com prazo é
          para hoje, o saldo já esperou até aqui. */}
      <MinhasTarefas tarefas={tarefas} />

      {/* Retirar dinheiro: o saldo é a primeira coisa que o colaborador quer ver. */}
      <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#1A1A1A] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
              Retirar dinheiro
            </p>
            <p className="mt-1 text-2xl font-light text-[#E3D5A7]">
              {formatCurrency(resumo.disponivel)}
            </p>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              {resumo.habilitado
                ? resumo.reservado > 0
                  ? `${formatCurrency(resumo.reservado)} reservado num pedido em curso`
                  : `${resumo.vendas_pagas} produto${resumo.vendas_pagas === 1 ? "" : "s"} vendido${resumo.vendas_pagas === 1 ? "" : "s"} e pago${resumo.vendas_pagas === 1 ? "" : "s"}`
                : `Faltam ${resumo.vendas_faltam} produto${resumo.vendas_faltam === 1 ? "" : "s"} vendido${resumo.vendas_faltam === 1 ? "" : "s"} e pago${resumo.vendas_faltam === 1 ? "" : "s"} para desbloquear (${resumo.vendas_pagas}/${resumo.vendas_minimas})`}
            </p>
            {!resumo.habilitado && (
              <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-[#262626]">
                <div
                  className="h-full rounded-full bg-[#C9A962]"
                  style={{ width: `${progressoVendas(resumo)}%` }}
                />
              </div>
            )}
          </div>
          <Link
            href="/vendedor/levantamentos"
            className="rounded-lg bg-[#C9A962] px-6 py-2.5 text-xs font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
          >
            RETIRAR DINHEIRO
          </Link>
        </div>
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
        <Cartao
          rotulo="Clientes conquistados"
          valor={String(totalClientes)}
          detalhe={porActivar ? `${porActivar} por activar` : undefined}
        />
        <Cartao rotulo="Vendas realizadas" valor={String(cartoes.vendas_count)} />
        <Cartao rotulo="Volume vendido" valor={formatCurrency(vendasValor)} />
        <Cartao
          rotulo="Clientes ativos"
          valor={String(cartoes.clientes_ativos)}
          detalhe={`${totalClientes} no total`}
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
          href="/vendedor/levantamentos"
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
        <Acao
          href="/vendedor/levantamentos"
          titulo="Retirar dinheiro"
          descricao="Comissões e levantamentos"
        />
        <Acao href="/vendedor/clientes" titulo="Meus clientes" descricao="Gerir associações" />
        <Acao href="/vendedor/encomendas" titulo="Encomendas" descricao="Pedidos da carteira" />
        <Acao href="/cliente/conversas" titulo="Mensagens" descricao="Falar com clientes" />
        <Acao href="/vendedor/comunicados" titulo="Comunicados" descricao="Avisos da gestão" />
        <Acao href="/vendedor/formacao" titulo="Formação INUKA" descricao="Cursos e progresso" />
        {/* O menu do topo é desenhado no browser (só sabe o papel depois de
            hidratar); este cartão garante que «Perfil» está à vista mal a
            página abre — e leva à secção dos dados, mais abaixo. */}
        <Acao href="/vendedor#perfil" titulo="Perfil" descricao="Dados pessoais e profissionais" />
      </div>

      {/* ---------- Dados pessoais e profissionais (o antigo «perfil») ---------- */}
      {ficha && (
        // `id="perfil"` é o destino do botão «Perfil» do menu: como a tela do
        // perfil foi fundida nesta, o menu leva à secção em vez de abrir outra
        // página. `scroll-mt` compensa o cabeçalho fixo.
        <div id="perfil" className="mt-8 grid scroll-mt-24 gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
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
              <Linha
                rotulo="Data de nascimento"
                valor={ficha.birth_date ? dataCurta(ficha.birth_date) : null}
              />
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
              <Linha
                rotulo="Data de entrada"
                valor={ficha.hired_at ? dataCurta(ficha.hired_at) : null}
              />
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
      )}
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

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#1F1F1F] pb-2 last:border-0">
      <dt className="text-[#6F6F6F]">{rotulo}</dt>
      <dd
        className={`text-right ${valor ? "text-[#E5E5E5]" : "text-[#3F3F3F]"} ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {valor || "—"}
      </dd>
    </div>
  );
}
