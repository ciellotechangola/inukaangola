"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Phone,
  Search,
  ShoppingBag,
  Store,
  TrendingUp,
  User,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ESTADOS, estadoDe } from "@/lib/revenda";
import {
  COR_ESTADO_REVENDEDOR,
  ROTULO_TIPO,
  desdeQuando,
  type Rede,
  type RedeRevendedor,
} from "@/lib/rede";
import TabelaResponsiva from "@/components/TabelaResponsiva";
import NovoRevendedor from "@/components/revenda/NovoRevendedor";

export interface SolicitacaoLinha {
  id: string;
  numero: string;
  status: string;
  unidades: number;
  valor: number;
  mensagem: string | null;
  resposta: string | null;
  created_at: string;
  revendedor_id: string | null;
  revendedor: string;
  tipo: string;
  telefone: string;
  nif: string | null;
  provincia: string | null;
}

type Aba = "revendedores" | "solicitacoes" | "provincias";

/**
 * A rede de vendedores, em três abas.
 *
 * «Revendedores» é o cadastro — todos, mesmo os que não compraram este mês.
 * «Solicitações» é o que os revendedores pediram, com os dados deles ao lado.
 * «Por província» compara territórios. O filtro é local: a rede já veio
 * inteira do servidor, e procurar não deve custar um pedido à base.
 */
export default function RedeVendedores({
  rede,
  pedidos,
  nomeProvincia,
  provincias,
  provinciaFixa,
}: {
  rede: Rede;
  pedidos: SolicitacaoLinha[];
  nomeProvincia: string | null;
  provincias: { id: string; nome: string; codigo: string }[];
  provinciaFixa: string | null;
}) {
  const [aba, setAba] = useState<Aba>("revendedores");
  const [procura, setProcura] = useState("");

  const t = rede.totais;

  const filtrados = useMemo(() => {
    const termo = procura.trim().toLowerCase();
    if (!termo) return rede.revendedores;
    return rede.revendedores.filter((r) =>
      [r.nome, r.telefone, r.nif ?? "", r.provincia ?? "", r.loja_codigo ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(termo)
    );
  }, [procura, rede.revendedores]);

  const porContactar = pedidos.filter((p) =>
    ["novo", "em_analise"].includes(p.status)
  ).length;

  return (
    <div>
      {/* ----------------------------------------------------------- NÚMEROS */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Revendedores"
          valor={`${t.activos} / ${t.revendedores}`}
          nota="activos / cadastrados"
        />
        <Kpi rotulo="Pedidos no mês" valor={String(t.pedidos)} nota={`${t.unidades} unidades`} />
        <Kpi rotulo="Valor no mês" valor={formatCurrency(t.valor)} destaque />
        <Kpi
          rotulo="Em curso"
          valor={String(t.em_curso)}
          nota={formatCurrency(t.valor_em_curso)}
        />
        <Kpi rotulo="Entregues no mês" valor={String(t.entregues)} />
        <Kpi rotulo="Suspensos" valor={String(t.suspensos)} />
        <Kpi
          rotulo="Por contactar"
          valor={String(t.candidaturas)}
          nota="candidaturas novas"
        />
        <Kpi
          rotulo="Último pedido"
          valor={desdeQuando(t.ultimo_pedido)}
          nota={t.ultimo_pedido ? new Date(t.ultimo_pedido).toLocaleDateString("pt-PT") : "—"}
        />
      </div>

      {/* -------------------------------------------------------------- ABAS */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Separador
          ativo={aba === "revendedores"}
          onClick={() => setAba("revendedores")}
          icone={<Store className="h-3.5 w-3.5" />}
          contagem={rede.revendedores.length}
        >
          Revendedores
        </Separador>
        <Separador
          ativo={aba === "solicitacoes"}
          onClick={() => setAba("solicitacoes")}
          icone={<ShoppingBag className="h-3.5 w-3.5" />}
          contagem={pedidos.length}
          alerta={porContactar}
        >
          Solicitações
        </Separador>
        <Separador
          ativo={aba === "provincias"}
          onClick={() => setAba("provincias")}
          icone={<TrendingUp className="h-3.5 w-3.5" />}
        >
          Por província
        </Separador>
      </div>

      {/* ------------------------------------------------------ REVENDEDORES */}
      {aba === "revendedores" && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-[#8A8A8A]">
              Todos os revendedores cadastrados
              {rede.scope === "provincial" && nomeProvincia ? ` em ${nomeProvincia}` : ""} — com
              os números do período.
            </p>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#525252]" />
              <input
                value={procura}
                onChange={(e) => setProcura(e.target.value)}
                placeholder="Procurar nome, telefone, NIF…"
                className="w-64 rounded-lg border border-[#333] bg-[#0A0A0A] py-2 pl-9 pr-3 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
              />
            </label>
            {/* Criar conta ao balcão: a pessoa aparece, combinam-se as
                condições e a ficha nasce ali — sem passar pelo site. */}
            <NovoRevendedor provincias={provincias} provinciaFixa={provinciaFixa} />
          </div>

          <TabelaResponsiva<RedeRevendedor>
            itens={filtrados}
            chaveDe={(r) => r.id}
            minimo={760}
            vazio={
              <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
                <p className="text-sm text-[#A3A3A3]">
                  {procura
                    ? "Nenhum revendedor corresponde à procura."
                    : "Ainda não há revendedores. Crie um em «Novo revendedor» ou aprove uma candidatura na aba Solicitações."}
                </p>
              </div>
            }
            colunas={[
              {
                chave: "nome",
                rotulo: "Revendedor",
                titulo: true,
                celula: (r) => (
                  <Link href={`/gerente/rede/${r.id}`} className="group block">
                    <span className="flex items-center gap-2">
                      {r.tipo === "empresa" ? (
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-[#C9A962]" />
                      ) : (
                        <User className="h-3.5 w-3.5 shrink-0 text-[#C9A962]" />
                      )}
                      <span className="truncate text-[#F5F5F5] transition group-hover:text-[#C9A962]">
                        {r.nome}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[#525252]">
                      {ROTULO_TIPO[r.tipo] ?? r.tipo}
                      {r.nif ? ` · NIF ${r.nif}` : ""}
                    </span>
                  </Link>
                ),
              },
              {
                chave: "provincia",
                rotulo: "Província",
                celula: (r) => (
                  <span className="text-[#A3A3A3]">
                    {r.provincia ?? "—"}
                    {r.loja_codigo && (
                      <span className="ml-1.5 font-mono text-[10px] text-[#525252]">
                        {r.loja_codigo}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                chave: "contacto",
                rotulo: "Contacto",
                celula: (r) => (
                  <a
                    href={`tel:${r.telefone}`}
                    className="inline-flex items-center gap-1 text-[#C9A962] hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {r.telefone}
                  </a>
                ),
              },
              {
                chave: "estado",
                rotulo: "Estado",
                celula: (r) => (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      COR_ESTADO_REVENDEDOR[r.status] ?? "bg-[#262626] text-[#A3A3A3]"
                    }`}
                  >
                    {r.status}
                  </span>
                ),
              },
              {
                chave: "pedidos",
                rotulo: "Pedidos",
                alinhar: "direita",
                celula: (r) => (
                  <span className="text-[#A3A3A3]">
                    {r.pedidos}
                    {r.em_curso > 0 && (
                      <span className="ml-1 text-[10px] text-[#E3D5A7]">({r.em_curso} aberto)</span>
                    )}
                  </span>
                ),
              },
              {
                chave: "valor",
                rotulo: "Valor no mês",
                alinhar: "direita",
                celula: (r) => (
                  <span className={r.valor > 0 ? "text-[#C9A962]" : "text-[#525252]"}>
                    {formatCurrency(r.valor)}
                  </span>
                ),
              },
              {
                chave: "ultimo",
                rotulo: "Último pedido",
                alinhar: "direita",
                celula: (r) => (
                  <span className="text-[11px] text-[#6F6F6F]">{desdeQuando(r.ultimo_pedido)}</span>
                ),
              },
            ]}
          />
        </section>
      )}

      {/* ------------------------------------------------------ SOLICITAÇÕES */}
      {aba === "solicitacoes" && (
        <section className="space-y-3">
          {pedidos.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
              <p className="text-sm text-[#A3A3A3]">
                Ainda não há solicitações de revendedores.
              </p>
            </div>
          )}

          {pedidos.map((p) => {
            const estado = estadoDe(p.status);
            return (
              <article key={p.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-[#F5F5F5]">{p.numero}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADOS[estado].cor}`}>
                        {ESTADOS[estado].rotulo}
                      </span>
                      <span className="text-[10px] text-[#525252]">
                        {new Date(p.created_at).toLocaleString("pt-PT")}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {p.revendedor_id ? (
                        <Link
                          href={`/gerente/rede/${p.revendedor_id}`}
                          className="inline-flex items-center gap-1.5 text-[#F5F5F5] hover:text-[#C9A962]"
                        >
                          {p.tipo === "empresa" ? (
                            <Building2 className="h-3.5 w-3.5 text-[#C9A962]" />
                          ) : (
                            <User className="h-3.5 w-3.5 text-[#C9A962]" />
                          )}
                          {p.revendedor}
                        </Link>
                      ) : (
                        <span className="text-[#F5F5F5]">{p.revendedor}</span>
                      )}
                      <span className="rounded-full border border-[#C9A962]/25 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[#E3D5A7]">
                        {ROTULO_TIPO[p.tipo] ?? p.tipo}
                      </span>
                      {p.provincia && <span className="text-[#8A8A8A]">· {p.provincia}</span>}
                      {p.telefone && (
                        <a
                          href={`tel:${p.telefone}`}
                          className="inline-flex items-center gap-1 text-[#C9A962] hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {p.telefone}
                        </a>
                      )}
                      {p.nif && <span className="text-[#6F6F6F]">· NIF {p.nif}</span>}
                    </div>

                    {p.mensagem && (
                      <p className="mt-2 max-w-xl whitespace-pre-line rounded-lg bg-[#141414] p-3 text-xs leading-relaxed text-[#A3A3A3]">
                        {p.mensagem}
                      </p>
                    )}
                    {p.resposta && (
                      <p className="mt-2 max-w-xl whitespace-pre-line rounded-lg border-l-2 border-[#C9A962]/50 bg-[#141414] p-3 text-xs leading-relaxed text-[#C9A962]">
                        <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-[#6F6F6F]">
                          Resposta da gestão
                        </span>
                        {p.resposta}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-light text-[#C9A962]">{formatCurrency(p.valor)}</p>
                    <p className="text-[11px] text-[#6F6F6F]">{p.unidades} unidades</p>
                    {p.revendedor_id && (
                      <Link
                        href={`/gerente/rede/${p.revendedor_id}`}
                        className="mt-2 inline-block text-[11px] text-[#A3A3A3] transition hover:text-[#C9A962]"
                      >
                        Ver ficha →
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {pedidos.length > 0 && (
            <p className="pt-1 text-[11px] text-[#525252]">
              A responder a um pedido? O estado e a resposta registam-se em{" "}
              <Link href="/gerente/revendedores" className="text-[#C9A962] hover:underline">
                Revendedores e grosso → Pedidos
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {/* --------------------------------------------------------- PROVÍNCIAS */}
      {aba === "provincias" && (
        <section>
          <TabelaResponsiva
            itens={rede.provincias.filter((p) => p.revendedores > 0 || p.valor > 0)}
            chaveDe={(p) => p.id}
            minimo={620}
            vazio={
              <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
                <p className="text-sm text-[#A3A3A3]">
                  Ainda não há revendedores nem pedidos por província.
                </p>
              </div>
            }
            colunas={[
              {
                chave: "provincia",
                rotulo: "Província",
                titulo: true,
                celula: (p) => (
                  <span className="text-[#F5F5F5]">
                    {p.nome}
                    <span className="ml-2 font-mono text-[10px] text-[#525252]">{p.codigo}</span>
                  </span>
                ),
              },
              {
                chave: "revendedores",
                rotulo: "Revendedores",
                alinhar: "direita",
                celula: (p) => (
                  <span className="text-[#A3A3A3]">
                    {p.activos}/{p.revendedores}
                  </span>
                ),
              },
              {
                chave: "pedidos",
                rotulo: "Pedidos",
                alinhar: "direita",
                celula: (p) => <span className="text-[#A3A3A3]">{p.pedidos}</span>,
              },
              {
                chave: "valor",
                rotulo: "Valor no mês",
                alinhar: "direita",
                celula: (p) => (
                  <span className={p.valor > 0 ? "text-[#C9A962]" : "text-[#525252]"}>
                    {formatCurrency(p.valor)}
                  </span>
                ),
              },
            ]}
          />

          {rede.ranking.length > 0 && (
            <div className="mt-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
              <h2 className="mb-3 text-sm font-medium text-[#F5F5F5]">
                Quem mais comprou no mês
              </h2>
              <ol className="space-y-2 text-sm">
                {rede.ranking.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 text-[#525252]">{i + 1}.</span>
                      <Link href={`/gerente/rede/${r.id}`} className="text-[#F5F5F5] hover:text-[#C9A962]">
                        {r.nome}
                      </Link>
                      {r.provincia && (
                        <span className="ml-2 text-[10px] text-[#525252]">{r.provincia}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-[#C9A962]">
                      {formatCurrency(r.valor)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-lg font-medium ${destaque ? "text-[#E3D5A7]" : "text-[#C9A962]"}`}>
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-[10px] text-[#525252]">{nota}</p>}
    </div>
  );
}

function Separador({
  ativo,
  onClick,
  icone,
  contagem,
  alerta,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  contagem?: number;
  alerta?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
        ativo
          ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#C9A962]"
          : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      }`}
    >
      {icone}
      {children}
      {typeof contagem === "number" && contagem > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] ${
            ativo ? "bg-[#C9A962] text-[#0A0A0A]" : "bg-[#262626] text-[#A3A3A3]"
          }`}
        >
          {contagem}
        </span>
      )}
      {typeof alerta === "number" && alerta > 0 && (
        <span className="rounded-full bg-[#2A2410] px-1.5 py-0.5 text-[9px] text-[#E3D5A7]">
          {alerta} novo(s)
        </span>
      )}
    </button>
  );
}
