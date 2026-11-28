"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Inbox,
  MessageSquare,
  Package,
  Phone,
  Send,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { updateOrderStatus, type OrderStatus } from "@/lib/api";
import { enviarMensagem } from "@/lib/chat";
import { formatCurrency } from "@/lib/utils";
import {
  ESTADOS_CANDIDATURA,
  ESTADOS_ENCOMENDA,
  ESTADOS_GROSSO,
  corEstado,
  estaPendente,
  rotuloEstado,
  type Central,
  type PedidoMensagem,
  type PedidoProduto,
  type SolicitacaoColaborador,
  type SolicitacaoRevendedor,
  type TipoCentral,
} from "@/lib/central-pedidos";

const CATEGORIAS: {
  chave: TipoCentral;
  nome: string;
  descricao: string;
  Icone: LucideIcon;
}[] = [
  {
    chave: "produtos",
    nome: "Pedidos de produtos",
    descricao: "Encomendas de clientes e pedidos de grosso",
    Icone: Package,
  },
  {
    chave: "mensagens",
    nome: "Pedidos de mensagens",
    descricao: "Conversas à espera da sua resposta",
    Icone: MessageSquare,
  },
  {
    chave: "revendedores",
    nome: "Adesão de revendedores",
    descricao: "Candidaturas a revenda por grosso",
    Icone: Store,
  },
  {
    chave: "colaboradores",
    nome: "Solicitações de colaboradores",
    descricao: "Candidaturas a colaborador",
    Icone: Users,
  },
];

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function telHref(telefone: string): string {
  return `tel:${telefone.replace(/[^+\d]/g, "")}`;
}

/**
 * A central de atendimento da gestão.
 *
 * Quatro categorias, cada uma com o que está pendente à vista; abre-se uma
 * para ver a lista, e cada linha abre os dados do solicitante, o histórico e
 * as acções (responder e mudar de estado).
 *
 * As acções falam com a base pelas funções que já existiam — nenhuma escreve
 * à mão em tabelas que não devia: `update_order_status`,
 * `responder_pedido_revendedor`, `decidir_candidatura_revendedor`, e o
 * mensageiro para as conversas.
 */
export default function CentralPedidos({ central }: { central: Central }) {
  const [tipo, setTipo] = useState<TipoCentral>("produtos");
  const [aberto, setAberto] = useState<string | null>(null);

  const contagem = (chave: TipoCentral) => {
    const lista =
      chave === "produtos"
        ? central.produtos
        : chave === "mensagens"
          ? central.mensagens
          : chave === "revendedores"
            ? central.revendedores
            : central.colaboradores;

    const pendentes = lista.filter((item) =>
      estaPendente(chave, (item as { estado?: string }).estado ?? "novo")
    ).length;

    return { total: lista.length, pendentes };
  };

  const totalPendentes = CATEGORIAS.reduce((soma, c) => soma + contagem(c.chave).pendentes, 0);
  const ativa = CATEGORIAS.find((c) => c.chave === tipo)!;

  function alternar(id: string) {
    setAberto((atual) => (atual === id ? null : id));
  }

  return (
    <div>
      <header className="mb-6">
        <Link href="/gerente" className="text-xs text-[#6F6F6F] hover:text-[#C9A962]">
          ← Painel de gestão
        </Link>
        <h1 className="mt-2 text-3xl font-light text-[#F5F5F5]">Central de pedidos</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#A3A3A3]">
          Tudo o que chega à gestão num sítio só: encomendas, mensagens, adesões de revendedores
          e candidaturas de colaboradores.
          {totalPendentes > 0 ? (
            <span className="text-[#E3D5A7]">
              {" "}
              {totalPendentes} {totalPendentes === 1 ? "está à espera" : "estão à espera"} de
              resposta.
            </span>
          ) : (
            <span className="text-[#4ADE80]"> Nada pendente.</span>
          )}
        </p>
      </header>

      {central.avisos.length > 0 && (
        <div className="mb-5 rounded-xl border border-[#4A2020] bg-[#2A1010] p-3 text-xs text-[#F87171]">
          {central.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- CATEGORIAS */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIAS.map((c) => {
          const { total, pendentes } = contagem(c.chave);
          const escolhida = tipo === c.chave;
          return (
            <button
              key={c.chave}
              type="button"
              onClick={() => {
                setTipo(c.chave);
                setAberto(null);
              }}
              aria-pressed={escolhida}
              className={`group flex flex-col items-start rounded-xl border p-4 text-left transition ${
                escolhida
                  ? "border-[#C9A962]/60 bg-[#171308]"
                  : "border-[#262626] bg-[#141414] hover:border-[#C9A962]/40"
              }`}
            >
              <span className="flex w-full items-start justify-between">
                <span
                  className={`grid h-9 w-9 place-items-center rounded-lg ${
                    escolhida ? "bg-[#C9A962]/20 text-[#C9A962]" : "bg-[#C9A962]/10 text-[#C9A962]"
                  }`}
                >
                  <c.Icone className="h-4 w-4" />
                </span>
                {pendentes > 0 && (
                  <span className="rounded-full bg-[#C9A962] px-2 py-0.5 text-[10px] font-semibold text-[#0A0A0A]">
                    {pendentes}
                  </span>
                )}
              </span>
              <span className="mt-3 text-sm font-medium text-[#F5F5F5]">{c.nome}</span>
              <span className="mt-0.5 text-[11px] leading-relaxed text-[#6F6F6F]">
                {c.descricao}
              </span>
              <span className="mt-2 text-[10px] uppercase tracking-wide text-[#525252]">
                {pendentes} {pendentes === 1 ? "pendente" : "pendentes"} · {total} no total
              </span>
            </button>
          );
        })}
      </section>

      {/* ------------------------------------------------------------ LISTA */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-[#F5F5F5]">
            {ativa.nome}
            <span className="ml-2 text-[11px] font-normal text-[#6F6F6F]">
              {contagem(ativa.chave).total} registo
              {contagem(ativa.chave).total === 1 ? "" : "s"}
            </span>
          </h2>
          <p className="text-[11px] text-[#525252]">{ativa.descricao}</p>
        </div>

        {tipo === "produtos" && (
          <Lista
            vazia={central.produtos.length === 0}
            textoVazio="Ainda não há encomendas nem pedidos de grosso."
          >
            {central.produtos.map((p) => (
              <ItemProduto
                key={`${p.origem}-${p.id}`}
                p={p}
                aberto={aberto === `${p.origem}-${p.id}`}
                onToggle={() => alternar(`${p.origem}-${p.id}`)}
              />
            ))}
          </Lista>
        )}

        {tipo === "mensagens" && (
          <Lista
            vazia={central.mensagens.length === 0}
            textoVazio="Não há conversas à espera de resposta."
          >
            {central.mensagens.map((m) => (
              <ItemMensagem
                key={m.id}
                m={m}
                aberto={aberto === m.id}
                onToggle={() => alternar(m.id)}
              />
            ))}
          </Lista>
        )}

        {tipo === "revendedores" && (
          <Lista
            vazia={central.revendedores.length === 0}
            textoVazio="Ainda não há candidaturas a revendedor."
          >
            {central.revendedores.map((c) => (
              <ItemRevendedor
                key={c.id}
                c={c}
                aberto={aberto === c.id}
                onToggle={() => alternar(c.id)}
              />
            ))}
          </Lista>
        )}

        {tipo === "colaboradores" && (
          <Lista
            vazia={central.colaboradores.length === 0}
            textoVazio="Ainda não há candidaturas a colaborador."
          >
            {central.colaboradores.map((c) => (
              <ItemColaborador
                key={c.id}
                c={c}
                aberto={aberto === c.id}
                onToggle={() => alternar(c.id)}
              />
            ))}
          </Lista>
        )}
      </section>

      <p className="mt-8 text-[11px] leading-relaxed text-[#525252]">
        Cada gerente vê o que a sua província lhe permite ver; a administração nacional vê todas
        as províncias. As acções ficam registadas com data, hora e o nome de quem as fez.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ listas */

function Lista({
  vazia,
  textoVazio,
  children,
}: {
  vazia: boolean;
  textoVazio: string;
  children: React.ReactNode;
}) {
  if (vazia) {
    return (
      <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
        <Inbox className="mx-auto mb-3 h-6 w-6 text-[#3A3A3A]" />
        <p className="text-sm text-[#A3A3A3]">{textoVazio}</p>
      </div>
    );
  }
  return <div className="space-y-2">{children}</div>;
}

/** A moldura de cada linha: cabeçalho clicável + detalhe quando aberto. */
function Cartao({
  aberto,
  onToggle,
  titulo,
  sub,
  estado,
  etiqueta,
  direita,
  children,
}: {
  aberto: boolean;
  onToggle: () => void;
  titulo: string;
  sub: string;
  estado: string;
  etiqueta?: string;
  direita?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border transition ${
        aberto ? "border-[#C9A962]/50 bg-[#141414]" : "border-[#262626] bg-[#141414]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-[#181818]"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#525252] transition ${aberto ? "rotate-180 text-[#C9A962]" : ""}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[#F5F5F5]">{titulo}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${corEstado(estado)}`}>
              {rotuloEstado(estado)}
            </span>
            {etiqueta && (
              <span className="rounded-full border border-[#333] px-2 py-0.5 text-[10px] text-[#8A8A8A]">
                {etiqueta}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[#6F6F6F]">{sub}</span>
        </span>
        {direita && <span className="shrink-0 text-right">{direita}</span>}
      </button>

      {aberto && <div className="border-t border-[#1F1F1F] px-4 py-4">{children}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- produtos */

function ItemProduto({
  p,
  aberto,
  onToggle,
}: {
  p: PedidoProduto;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <Cartao
      aberto={aberto}
      onToggle={onToggle}
      titulo={p.referencia || "Pedido"}
      sub={`${p.cliente}${p.provincia ? ` · ${p.provincia}` : ""} · ${quando(p.criadoEm)}`}
      estado={p.estado}
      etiqueta={p.origem === "grosso" ? "grosso" : "loja"}
      direita={
        <span className="text-sm text-[#C9A962]">{formatCurrency(p.valor)}</span>
      }
    >
      <DetalheProduto p={p} />
    </Cartao>
  );
}

function DetalheProduto({ p }: { p: PedidoProduto }) {
  const router = useRouter();
  const [estado, setEstado] = useState(p.estado);
  const [resposta, setResposta] = useState(p.resposta ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);

  const opcoes = p.origem === "grosso" ? ESTADOS_GROSSO : ESTADOS_ENCOMENDA;

  async function guardar() {
    setErro("");
    setFeito(false);
    setOcupado(true);
    try {
      if (p.origem === "grosso") {
        const supabase = createClientBrowser();
        const { error } = await supabase.rpc("responder_pedido_revendedor", {
          p_pedido: p.id,
          p_status: estado,
          p_resposta: resposta.trim() || null,
        });
        if (error) throw new Error(error.message);
      } else {
        // Na encomenda de loja a resposta fica na nota do histórico de estado:
        // é o único sítio onde `update_order_status` a guarda, e é lá que a
        // equipa a vai ler.
        await updateOrderStatus(p.id, estado as OrderStatus, resposta.trim() || undefined);
      }
      setFeito(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Dado rotulo="Solicitante" valor={p.cliente} />
        <Dado
          rotulo="Telefone"
          valor={
            p.telefone ? (
              <a href={telHref(p.telefone)} className="text-[#C9A962] hover:underline">
                {p.telefone}
              </a>
            ) : (
              "—"
            )
          }
        />
        <Dado rotulo="Província" valor={p.provincia ?? "—"} />
        <Dado
          rotulo={p.origem === "grosso" ? "Unidades" : "Artigos"}
          valor={p.unidades ? String(p.unidades) : "—"}
        />
      </div>

      {p.mensagem && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            Mensagem do solicitante
          </p>
          <p className="whitespace-pre-line rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] p-3 text-xs leading-relaxed text-[#A3A3A3]">
            {p.mensagem}
          </p>
        </div>
      )}

      {p.itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] border-collapse text-left text-[12px]">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-wide text-[#525252]">
                <th className="pb-1.5 pr-3 font-medium">Produto</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Qtd</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Preço</th>
                <th className="pb-1.5 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody className="text-[#D4D4D4]">
              {p.itens.map((i, n) => (
                <tr key={`${i.nome}-${n}`} className="border-t border-[#1F1F1F]">
                  <td className="py-1.5 pr-3">{i.nome}</td>
                  <td className="py-1.5 pr-3 text-right">{i.quantidade}</td>
                  <td className="py-1.5 pr-3 text-right text-[#8A8A8A]">
                    {formatCurrency(i.preco)}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatCurrency(i.preco * i.quantidade)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A conversa do pedido: é aqui que o assunto continua depois da
          primeira resposta. Uma por pedido, sempre a mesma (0036) — abrir
          outra vez carrega tudo o que já foi dito. */}
      <Link
        href={
          p.origem === "grosso"
            ? `/gerente/conversas?pedido=${p.id}`
            : `/gerente/conversas?encomenda=${p.id}`
        }
        className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962]/50 bg-[#C9A962]/10 px-4 py-2 text-xs font-semibold text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Abrir conversa
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>

      <Historico eventos={p.historico} />

      <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
              Estado
            </span>
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setFeito(false);
              }}
              className="rounded-lg border border-[#404040] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
            >
              {opcoes.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
              Resposta ao solicitante
            </span>
            <input
              value={resposta}
              onChange={(e) => {
                setResposta(e.target.value);
                setFeito(false);
              }}
              placeholder="Ex.: cotação enviada, entrega na sexta…"
              maxLength={800}
              className="w-full rounded-lg border border-[#404040] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={guardar}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
          >
            {feito ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {feito ? "Guardado" : ocupado ? "A guardar…" : "Responder"}
          </button>
        </div>
        {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- mensagens */

function ItemMensagem({
  m,
  aberto,
  onToggle,
}: {
  m: PedidoMensagem;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <Cartao
      aberto={aberto}
      onToggle={onToggle}
      titulo={m.titulo}
      sub={`${m.de} · ${quando(m.quando)}`}
      estado="pending"
      etiqueta={m.papel ?? undefined}
      direita={
        m.naoLidas > 0 ? (
          <span className="rounded-full bg-[#C9A962] px-2 py-0.5 text-[10px] font-semibold text-[#0A0A0A]">
            {m.naoLidas} nova{m.naoLidas === 1 ? "" : "s"}
          </span>
        ) : null
      }
    >
      <DetalheMensagem m={m} />
    </Cartao>
  );
}

function DetalheMensagem({ m }: { m: PedidoMensagem }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);

  async function responder() {
    if (!texto.trim()) {
      setErro("Escreva a resposta antes de enviar.");
      return;
    }
    setErro("");
    setOcupado(true);
    try {
      const supabase = createClientBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Volte a entrar.");
      await enviarMensagem(supabase, m.id, user.id, texto.trim());
      setTexto("");
      setFeito(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">Última mensagem</p>
        <p className="whitespace-pre-line rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] p-3 text-xs leading-relaxed text-[#A3A3A3]">
          {m.ultima || "(sem texto)"}
        </p>
        <p className="mt-1 text-[10px] text-[#525252]">
          {m.de} · {quando(m.quando)}
        </p>
      </div>

      <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Responder
          </span>
          <textarea
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setFeito(false);
            }}
            rows={3}
            placeholder="Escreva a resposta…"
            className="w-full rounded-lg border border-[#404040] bg-[#141414] px-3 py-2 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={responder}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
          >
            {feito ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {feito ? "Enviada" : ocupado ? "A enviar…" : "Enviar resposta"}
          </button>
          <Link
            href={`/gerente/conversas?c=${m.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            Abrir conversa
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ revendedores */

function ItemRevendedor({
  c,
  aberto,
  onToggle,
}: {
  c: SolicitacaoRevendedor;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <Cartao
      aberto={aberto}
      onToggle={onToggle}
      titulo={c.nome}
      sub={`${c.telefone}${c.provincia ? ` · ${c.provincia}` : ""} · ${quando(c.criadoEm)}`}
      estado={c.estado}
      etiqueta={c.tipo === "empresa" ? "empresa" : "pessoa"}
      direita={
        <span className="text-[10px] uppercase tracking-wide text-[#525252]">
          {c.nif ? `NIF ${c.nif}` : ""}
        </span>
      }
    >
      <DetalheRevendedor c={c} />
    </Cartao>
  );
}

function DetalheRevendedor({ c }: { c: SolicitacaoRevendedor }) {
  const router = useRouter();
  const [estado, setEstado] = useState(c.estado);
  const [resposta, setResposta] = useState(c.resposta ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);

  async function guardar() {
    setErro("");
    setFeito(false);
    setOcupado(true);
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase.rpc("decidir_candidatura_revendedor", {
        p_id: c.id,
        p_estado: estado,
        p_resposta: resposta.trim() || null,
      });
      if (error) throw new Error(error.message);
      setFeito(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Dado rotulo="Telefone" valor={
          <a href={telHref(c.telefone)} className="text-[#C9A962] hover:underline">
            {c.telefone}
          </a>
        } />
        <Dado rotulo="E-mail" valor={c.email ?? "—"} />
        <Dado rotulo="Província" valor={c.provincia ?? "—"} />
        <Dado rotulo="NIF" valor={c.nif ?? "—"} />
      </div>

      {c.mensagem && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            Mensagem do candidato
          </p>
          <p className="whitespace-pre-line rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] p-3 text-xs leading-relaxed text-[#A3A3A3]">
            {c.mensagem}
          </p>
        </div>
      )}

      <Historico
        eventos={[
          { em: c.criadoEm, estado: "novo", por: null, nota: null },
          ...(c.tratadoEm
            ? [{ em: c.tratadoEm, estado: c.estado, por: c.tratadoPor, nota: c.resposta }]
            : []),
        ]}
      />

      <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
              Estado
            </span>
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setFeito(false);
              }}
              className="rounded-lg border border-[#404040] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
            >
              {ESTADOS_CANDIDATURA.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
              Resposta ao candidato
            </span>
            <input
              value={resposta}
              onChange={(e) => {
                setResposta(e.target.value);
                setFeito(false);
              }}
              placeholder="Ex.: reunião marcada, documentação em falta…"
              maxLength={1000}
              className="w-full rounded-lg border border-[#404040] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={guardar}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
          >
            {feito ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {feito ? "Guardado" : ocupado ? "A guardar…" : "Responder"}
          </button>
        </div>
        {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}
        <p className="mt-2 text-[10.5px] leading-relaxed text-[#525252]">
          Aprovar aqui não cria a conta. A conta faz-se em{" "}
          <Link href="/gerente/revendedores" className="text-[#C9A962] hover:underline">
            Revendedores
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- colaboradores */

function ItemColaborador({
  c,
  aberto,
  onToggle,
}: {
  c: SolicitacaoColaborador;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <Cartao
      aberto={aberto}
      onToggle={onToggle}
      titulo={c.nome}
      sub={`${c.telefone}${c.provincia ? ` · ${c.provincia}` : ""} · ${quando(c.criadoEm)}`}
      estado={c.estado}
      etiqueta={c.origem ?? undefined}
    >
      <DetalheColaborador c={c} />
    </Cartao>
  );
}

function DetalheColaborador({ c }: { c: SolicitacaoColaborador }) {
  const router = useRouter();
  const [estado, setEstado] = useState(c.estado);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);

  async function guardar() {
    setErro("");
    setFeito(false);
    setOcupado(true);
    try {
      const supabase = createClientBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // A candidatura a colaborador não tem campo de resposta: o contacto é
      // por telefone. Fica registado **quem** a tratou e **quando** — que é o
      // que impede duas pessoas da gestão de ligarem à mesma.
      const { error } = await supabase
        .from("reseller_applications")
        .update({
          status: estado,
          handled_by: estado === "novo" ? null : (user?.id ?? null),
          handled_at: estado === "novo" ? null : new Date().toISOString(),
        })
        .eq("id", c.id);
      if (error) throw new Error(error.message);
      setFeito(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Dado
          rotulo="Telefone"
          valor={
            <a href={telHref(c.telefone)} className="text-[#C9A962] hover:underline">
              {c.telefone}
            </a>
          }
        />
        <Dado rotulo="Província" valor={c.provincia ?? "—"} />
        <Dado rotulo="Origem" valor={c.origem ?? "—"} />
        <Dado rotulo="Tratada por" valor={c.tratadoPor ?? "—"} />
      </div>

      {c.mensagem && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
            Mensagem do candidato
          </p>
          <p className="whitespace-pre-line rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] p-3 text-xs leading-relaxed text-[#A3A3A3]">
            {c.mensagem}
          </p>
        </div>
      )}

      <Historico
        eventos={[
          { em: c.criadoEm, estado: "novo", por: null, nota: null },
          ...(c.tratadoEm
            ? [{ em: c.tratadoEm, estado: c.estado, por: c.tratadoPor, nota: null }]
            : []),
        ]}
      />

      <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
              Estado
            </span>
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setFeito(false);
              }}
              className="rounded-lg border border-[#404040] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
            >
              {ESTADOS_CANDIDATURA.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>

          <a
            href={telHref(c.telefone)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            <Phone className="h-3.5 w-3.5" />
            Ligar
          </a>

          <button
            type="button"
            onClick={guardar}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
          >
            {feito ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {feito ? "Guardado" : ocupado ? "A guardar…" : "Registar"}
          </button>
        </div>
        {erro && <p className="mt-2 text-[11px] text-[#F87171]">{erro}</p>}
        <p className="mt-2 text-[10.5px] leading-relaxed text-[#525252]">
          A resposta a um colaborador é feita por telefone. O estado guarda quem já falou com a
          pessoa, para não a chamarem duas vezes.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pedaços */

function Dado({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] px-3 py-2">
      <p className="text-[9.5px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="mt-0.5 truncate text-xs text-[#E5E5E5]">{valor}</p>
    </div>
  );
}

function Historico({ eventos }: { eventos: PedidoProduto["historico"] }) {
  if (eventos.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">Histórico</p>
      <ol className="space-y-1.5">
        {eventos.map((e, n) => (
          <li key={`${e.em}-${n}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <span className="font-mono text-[10px] text-[#525252]">{quando(e.em)}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] ${corEstado(e.estado)}`}>
              {rotuloEstado(e.estado)}
            </span>
            {e.por && <span className="text-[#8A8A8A]">por {e.por}</span>}
            {e.nota && <span className="text-[#6F6F6F]">· {e.nota}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
