import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import {
  numero,
  dataCurta,
  normalizarImpacto,
  type FichaColaborador,
  type PainelColaborador,
} from "@/lib/colaborador";
import { listarProvincias } from "@/lib/provincias";
import { formatarTaxa, normalizarTaxa } from "@/lib/comissoes";
import ColaboradorIdentidade from "@/components/ColaboradorIdentidade";
import CopiarReferencia from "@/components/CopiarReferencia";
import { GraficoEvolucao, ProgressoMeta } from "@/components/Graficos";
import { mensagemDeErro } from "@/lib/erros";
import { ordenarTarefas, type Tarefa } from "@/lib/tarefas";
import GestaoColaborador from "./GestaoColaborador";
import EliminarColaborador from "./EliminarColaborador";
import { TarefasColaborador } from "./TarefasColaborador";
import { GestorResponsavel, type CandidatoGestor } from "./GestorResponsavel";
import { CorrigirVendas, type VendaCorrigivel } from "./CorrigirVendas";
import {
  COR_ESTADO,
  ROTULO_ESTADO,
  ROTULO_METODO,
  resumoDestino,
  type EstadoLevantamento,
  type MetodoRecebimento,
} from "@/lib/levantamentos";

export const dynamic = "force-dynamic";

export default async function ColaboradorDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();

  const [fichaRes, painelRes, metaRes, provincias, taxaRes, levantamentosRes, pagamentoRes, impactoRes, tarefasRes, gestoresRes, vendasRes] =
    await Promise.all([
      supabase.rpc("colaborador_ficha", { p_id: id }),
      supabase.rpc("colaborador_painel", { p_id: id }),
      supabase
        .from("sales_goals")
        .select("target_amount, target_sales, period_start, period_end")
        .eq("seller_id", id)
        .lte("period_start", new Date().toISOString().slice(0, 10))
        .gte("period_end", new Date().toISOString().slice(0, 10))
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      listarProvincias(supabase),
      // A ficha devolve 0 quando não há taxa pessoal, o que se confunde com 0%.
      // Aqui lê-se a taxa tal como ela é: pessoal, ou herdada da empresa.
      supabase.rpc("taxa_comissao_de", { p_seller: id }),
      // Levantamentos do colaborador: o pedido fica no perfil dele, com o
      // estado, o valor e para onde foi o dinheiro. O RLS já limita a leitura
      // ao próprio e à gestão da província.
      supabase
        .from("levantamentos")
        .select(
          "id, referencia, valor, metodo, estado, solicitado_em, pago_em, motivo_rejeicao, notas, dados"
        )
        .eq("seller_id", id)
        .order("solicitado_em", { ascending: false })
        .limit(20),
      // Coordenadas guardadas para o próximo pedido (dados sensíveis: só a
      // gestão da província as lê, por RLS de `seller_profiles`).
      supabase
        .from("seller_profiles")
        .select("xpress_dados, banco_dados")
        .eq("id", id)
        .maybeSingle(),
      // O que desaparece se a gestão eliminar esta pessoa. Só lê — a decisão
      // de apagar é que passa pela RPC `eliminar_colaborador`.
      supabase.rpc("impacto_eliminar_colaborador", { p_id: id }),
      // Tarefas atribuídas pela gestão. O embed precisa do nome da coluna
      // (`!criado_por`): há duas chaves estrangeiras para `profiles` nesta
      // tabela — a do colaborador e a de quem escreveu — e sem a dica o
      // PostgREST recusa com PGRST201.
      supabase
        .from("colaborador_tarefas")
        .select(
          "id, seller_id, titulo, descricao, prazo, prioridade, estado, criado_por, criado_em, concluida_em, autor:profiles!criado_por(full_name)"
        )
        .eq("seller_id", id)
        .limit(100),
      // Candidatos a gestor responsável: o gestor máximo e os da província
      // desta pessoa. A RPC também valida a escolha — a lista não é a regra.
      supabase.rpc("gestores_para_colaborador", { p_seller: id }),
      // Vendas com as linhas, para a correcção. O total da venda é a soma
      // delas; é por isso que se corrige a linha e não o cabeçalho.
      supabase
        .from("sales")
        .select(
          "id, reference, total_amount, status, payment_status, created_at, sale_items(id, quantity, unit_price, total_price, product_snapshot)"
        )
        .eq("seller_id", id)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

  // A RPC recusa com 42501 quem não pode ver; o RLS esconde o resto. Em ambos
  // os casos a resposta certa é "não existe" — não se confirma que a pessoa
  // existe a quem não tem permissão.
  if (fichaRes.error || !fichaRes.data) notFound();

  const ficha = fichaRes.data as FichaColaborador;
  const taxa = normalizarTaxa(taxaRes.data);
  const painel = (painelRes.data ?? null) as PainelColaborador | null;
  const cartoes = painel?.cartoes;
  const impacto = normalizarImpacto(impactoRes.data);
  const metaIndividual = metaRes.data as
    | { target_amount: number; target_sales: number }
    | null;

  const levantamentos = (levantamentosRes.data ?? []) as {
    id: string;
    referencia: string | null;
    valor: number;
    metodo: string;
    estado: EstadoLevantamento;
    solicitado_em: string;
    pago_em: string | null;
    motivo_rejeicao: string | null;
    notas: string | null;
    dados: Record<string, string> | null;
  }[];

  const pagamento = (pagamentoRes.data ?? null) as {
    xpress_dados: Record<string, string> | null;
    banco_dados: Record<string, string> | null;
  } | null;

  const tarefas = ordenarTarefas((tarefasRes.data ?? []) as unknown as Tarefa[]);
  const falhaTarefas = tarefasRes.error
    ? mensagemDeErro(tarefasRes.error, "supabase/PATCH_TAREFAS_GESTOR.sql")
    : null;

  const gestores = (gestoresRes.data ?? []) as CandidatoGestor[];
  const falhaGestores = gestoresRes.error
    ? mensagemDeErro(gestoresRes.error, "supabase/PATCH_TAREFAS_GESTOR.sql")
    : null;

  const vendas = (
    (vendasRes.data ?? []) as unknown as {
      id: string;
      reference: string;
      total_amount: number;
      status: string;
      payment_status: string;
      created_at: string;
      sale_items: {
        id: string;
        quantity: number;
        unit_price: number;
        total_price: number;
        product_snapshot: Record<string, unknown> | null;
      }[] | null;
    }[]
  ).map<VendaCorrigivel>((v) => ({
    id: v.id,
    reference: v.reference,
    total_amount: Number(v.total_amount),
    status: v.status,
    payment_status: v.payment_status,
    created_at: v.created_at,
    linhas: (v.sale_items ?? []).map((l) => ({
      id: l.id,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      total_price: Number(l.total_price),
      produto:
        typeof l.product_snapshot?.name === "string" ? l.product_snapshot.name : null,
    })),
  }));
  const falhaVendas = vendasRes.error
    ? mensagemDeErro(vendasRes.error, "supabase/PATCH_TAREFAS_GESTOR.sql")
    : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link
        href="/gerente/colaboradores"
        className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]"
      >
        ← Colaboradores
      </Link>

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
        nota={`Taxa de comissão: ${formatarTaxa(taxa.efetiva)} ${
          taxa.origem === "pessoal" ? "(pessoal)" : "(da empresa)"
        } · Gestor: ${ficha.manager_name ?? "não definido"}`}
      />

      <div className="mb-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-[#F5F5F5]">Referência do Colaborador</h2>
            <p className="mt-1 text-[11px] text-[#525252]">
              Código único e permanente. Não é editável — nem pelo próprio, nem pela gestão.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg tracking-[0.12em] text-[#C9A962]">
              {ficha.referencia ?? "—"}
            </span>
            {ficha.referencia && <CopiarReferencia valor={ficha.referencia} />}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[#525252]">Província</dt>
            <dd className="text-[#E5E5E5]">
              {ficha.provincia_nome ?? "sem província"}
              {ficha.provincia_codigo ? ` (${ficha.provincia_codigo})` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[#525252]">Sequência</dt>
            <dd className="text-[#E5E5E5]">
              {ficha.referencia ? `${Number(ficha.referencia.split("-")[2])}.º da província` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[#525252]">Atribuída em</dt>
            <dd className="text-[#E5E5E5]">{dataCurta(ficha.created_at)}</dd>
          </div>
        </dl>
      </div>

      <div className="mb-6">
        <GestaoColaborador
          id={ficha.id}
          referencia={ficha.referencia}
          provinciaId={ficha.provincia_id}
          provincias={provincias}
          podeEscolherProvincia={Boolean(
            profile.is_national_admin || profile.provincia_id === null
          )}
          inicial={{
            full_name: ficha.full_name,
            phone: ficha.phone,
            bi_number: ficha.bi_number,
            birth_date: ficha.birth_date,
            whatsapp: ficha.whatsapp,
            address: ficha.address,
            municipio: ficha.municipio,
            job_title: ficha.job_title,
            category: ficha.category,
            hired_at: ficha.hired_at,
            commission_rate: taxa.pessoal,
            is_active: ficha.is_active,
          }}
          comissaoPendente={numero(cartoes?.comissao_pendente)}
          metaAtual={
            metaIndividual
              ? {
                  valor: numero(metaIndividual.target_amount),
                  vendas: numero(metaIndividual.target_sales),
                }
              : null
          }
        />
      </div>

      {cartoes && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador rotulo="Clientes conquistados" valor={String(cartoes.clientes_total)} />
          <Indicador rotulo="Clientes ativos" valor={String(cartoes.clientes_ativos)} />
          <Indicador rotulo="Vendas realizadas" valor={String(cartoes.vendas_count)} />
          <Indicador rotulo="Volume vendido" valor={formatCurrency(numero(cartoes.vendas_valor))} />
          <Indicador rotulo="Comissões acumuladas" valor={formatCurrency(numero(cartoes.comissao_total))} />
          <Indicador rotulo="Comissões pagas" valor={formatCurrency(numero(cartoes.comissao_paga))} />
          <Indicador rotulo="Comissões pendentes" valor={formatCurrency(numero(cartoes.comissao_pendente))} />
          <Indicador
            rotulo="Cumprimento da meta"
            valor={numero(cartoes.meta_valor) > 0 ? `${Number(cartoes.meta_pct).toFixed(0)}%` : "—"}
          />
        </div>
      )}

      {/* ---------------------------------------------------------------
          Tarefas, gestor e correcção de vendas
          O que a gestão pede à pessoa e o que ela fez. Fica a seguir aos
          números porque é aqui que se age sobre eles.
          --------------------------------------------------------------- */}
      <TarefasColaborador sellerId={ficha.id} tarefas={tarefas} falhaLeitura={falhaTarefas} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <GestorResponsavel
          sellerId={ficha.id}
          gestorId={ficha.manager_id}
          gestorNome={ficha.manager_name}
          candidatos={gestores}
          falhaLista={falhaGestores}
        />

        <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <h2 className="mb-1 text-sm font-medium text-[#F5F5F5]">Resumo das tarefas</h2>
          <p className="mb-4 text-[11px] text-[#6F6F6F]">
            O que está por fazer, o que já foi feito e o que foi cancelado.
          </p>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-[#2A2A2A] bg-[#141414] py-3">
              <dt className="text-[10px] uppercase tracking-wide text-[#525252]">Por fazer</dt>
              <dd className="mt-1 text-lg font-medium text-[#C9A962]">
                {tarefas.filter((t) => t.estado === "pendente").length}
              </dd>
            </div>
            <div className="rounded-lg border border-[#2A2A2A] bg-[#141414] py-3">
              <dt className="text-[10px] uppercase tracking-wide text-[#525252]">Feitas</dt>
              <dd className="mt-1 text-lg font-medium text-[#4ADE80]">
                {tarefas.filter((t) => t.estado === "concluida").length}
              </dd>
            </div>
            <div className="rounded-lg border border-[#2A2A2A] bg-[#141414] py-3">
              <dt className="text-[10px] uppercase tracking-wide text-[#525252]">Canceladas</dt>
              <dd className="mt-1 text-lg font-medium text-[#6F6F6F]">
                {tarefas.filter((t) => t.estado === "cancelada").length}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <CorrigirVendas vendas={vendas} falhaLeitura={falhaVendas} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <h2 className="mb-4 text-sm font-medium text-[#F5F5F5]">Dados pessoais</h2>
          <dl className="space-y-3 text-sm">
            <Linha rotulo="Nome completo" valor={ficha.full_name} />
            <Linha rotulo="Nº do BI" valor={ficha.bi_number} mono />
            <Linha rotulo="Data de nascimento" valor={ficha.birth_date ? dataCurta(ficha.birth_date) : null} />
            <Linha rotulo="Telefone" valor={ficha.phone} />
            <Linha rotulo="WhatsApp" valor={ficha.whatsapp} />
            <Linha rotulo="Endereço" valor={ficha.address} />
            <Linha rotulo="Município" valor={ficha.municipio} />
            <Linha rotulo="Província" valor={ficha.provincia_nome} />
            <Linha rotulo="Email" valor={ficha.email} />
          </dl>
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

      {/* ---------------------------------------------------------------
          Recebimento e levantamentos
          O pedido de dinheiro vive no perfil do colaborador: aqui a gestão vê
          para onde vai o dinheiro, o estado de cada pedido e o histórico.
          --------------------------------------------------------------- */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <h2 className="mb-1 text-sm font-medium text-[#F5F5F5]">
            Dados de recebimento
          </h2>
          <p className="mb-4 text-[11px] text-[#6F6F6F]">
            Guardados pelo colaborador. Só o próprio e a gestão os vêem.
          </p>

          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
                XPRESS
              </p>
              <p className="text-[#D4D4D4]">
                {pagamento?.xpress_dados
                  ? resumoDestino("xpress", pagamento.xpress_dados)
                  : "Ainda não indicou dados XPRESS."}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
                Transferência bancária
              </p>
              <p className="text-[#D4D4D4]">
                {pagamento?.banco_dados
                  ? resumoDestino("transferencia", pagamento.banco_dados)
                  : "Ainda não indicou dados bancários."}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-[#F5F5F5]">
              Levantamentos
            </h2>
            <Link
              href="/gerente/levantamentos"
              className="text-[11px] text-[#6F6F6F] transition hover:text-[#C9A962]"
            >
              gerir todos
            </Link>
          </div>

          {levantamentos.length === 0 ? (
            <p className="text-sm text-[#525252]">Ainda não pediu levantamentos.</p>
          ) : (
            <ul className="space-y-3">
              {levantamentos.slice(0, 6).map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-[#F5F5F5]">
                        {l.referencia ?? "Levantamento"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          COR_ESTADO[l.estado] ?? COR_ESTADO.pendente
                        }`}
                      >
                        {ROTULO_ESTADO[l.estado] ?? l.estado}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6F6F6F]">
                      {new Date(l.solicitado_em).toLocaleString("pt-PT")} ·{" "}
                      {ROTULO_METODO[l.metodo as MetodoRecebimento] ?? l.metodo}
                    </p>
                    {l.estado === "rejeitado" && l.motivo_rejeicao && (
                      <p className="text-[11px] text-[#F87171]">
                        Motivo: {l.motivo_rejeicao}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-[#C9A962]">
                    {formatCurrency(Number(l.valor))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {painel && (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <GraficoEvolucao
                titulo="Evolução das vendas"
                meses={painel.series.meses}
                valores={painel.series.vendas.map(numero)}
                formato={(n) => formatCurrency(n)}
              />
              <GraficoEvolucao
                titulo="Evolução das comissões"
                meses={painel.series.meses}
                valores={painel.series.comissoes.map(numero)}
                formato={(n) => formatCurrency(n)}
                cor="#E3D5A7"
              />
            </div>
            <ProgressoMeta
              valor={numero(cartoes?.vendas_valor)}
              meta={numero(cartoes?.meta_valor)}
              percentagem={numero(cartoes?.meta_pct)}
              origem={cartoes?.meta_origem ?? null}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Lista
              titulo="Últimas vendas"
              vazio="Sem vendas registadas."
              itens={painel.historico.vendas.map((v) => ({
                chave: v.id,
                principal: v.reference,
                secundario: dataCurta(v.created_at),
                valor: formatCurrency(numero(v.total_amount)),
                aviso: v.status === "cancelled" ? "cancelada" : undefined,
              }))}
            />
            <Lista
              titulo="Clientes"
              vazio="Sem clientes associados."
              itens={painel.historico.clientes.map((c, i) => ({
                chave: `${c.full_name}-${i}`,
                principal: c.full_name,
                secundario: dataCurta(c.assigned_at),
                valor: c.is_active ? "ativo" : "inativo",
              }))}
            />
            <Lista
              titulo="Pagamentos"
              vazio="Sem pagamentos."
              itens={painel.historico.pagamentos.map((p) => ({
                chave: p.id,
                principal: formatCurrency(numero(p.amount)),
                secundario: dataCurta(p.paid_at),
                valor: p.method ?? "—",
              }))}
            />
          </div>
        </>
      )}

      {/* Apagar é o último recurso da ficha: fica no fundo, depois de tudo o
          que a gestão precisa de ver antes de decidir. */}
      <EliminarColaborador
        id={ficha.id}
        nome={ficha.full_name}
        referencia={ficha.referencia}
        impacto={impacto}
      />
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

function Lista({
  titulo,
  vazio,
  itens,
}: {
  titulo: string;
  vazio: string;
  itens: { chave: string; principal: string; secundario: string; valor: string; aviso?: string }[];
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <h2 className="mb-4 text-sm font-medium text-[#F5F5F5]">{titulo}</h2>
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
