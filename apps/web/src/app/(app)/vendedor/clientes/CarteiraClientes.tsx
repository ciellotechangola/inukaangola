"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Clock,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  criarClienteNaCarteira,
  getOrCreateConversation,
  linkCustomerByPhone,
  type RespostaNovoCliente,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/**
 * Uma linha da carteira. `tipo` distingue o que é uma conta real do que é
 * apenas uma reserva à espera de registo — a diferença decide que acções
 * aparecem (um reservado não pode receber mensagens: não tem sessão).
 */
export interface LinhaCarteira {
  id: string;
  tipo: "cliente" | "reservado";
  desde: string;
  nome: string;
  telefone: string | null;
  bairro: string | null;
  provincia: string | null;
  customerId: string | null;
  notas: string | null;
  comprasPendentes: number;
  valorPendente: number;
  /** O que já comprou, produto a produto (vendas à espera do registo). */
  produtos: { nome: string; quantidade: number }[];
}

export interface TotaisCliente {
  total: number;
  compras: number;
  ultima: string | null;
}

const ENTRADA =
  "w-full rounded-lg border border-[#333] bg-[#0F0F0F] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

const BOTAO_ACCAO =
  "inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#D4D4D4] transition";

/** `+244923111222` → `244923111222` (o formato que o wa.me espera). */
function soDigitos(telefone: string): string {
  return telefone.replace(/\D/g, "");
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT");
}

/**
 * A carteira, do lado do browser.
 *
 * Os dados chegam já lidos do servidor (`page.tsx`); este componente só trata
 * do que precisa de interacção — reservar, associar, procurar e contactar.
 * Depois de escrever, `router.refresh()` volta a pedir a lista ao servidor, em
 * vez de a reconstruir à mão e arriscar divergir.
 */
export function CarteiraClientes({
  iniciais,
  totaisIniciais,
  totalVendido,
  erroInicial,
}: {
  iniciais: LinhaCarteira[];
  totaisIniciais: Record<string, TotaisCliente>;
  totalVendido: number;
  erroInicial: string | null;
}) {
  const router = useRouter();
  const [erro, setErro] = useState(erroInicial ?? "");
  const [aviso, setAviso] = useState("");
  const [procura, setProcura] = useState("");

  const [painel, setPainel] = useState<"novo" | "existente" | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [bairro, setBairro] = useState("");
  const [notas, setNotas] = useState("");
  const [telefoneExistente, setTelefoneExistente] = useState("");
  const [aGuardar, setAGuardar] = useState(false);
  const [criado, setCriado] = useState<RespostaNovoCliente | null>(null);

  const visiveis = useMemo(() => {
    const q = procura.trim().toLowerCase();
    if (!q) return iniciais;
    return iniciais.filter(
      (r) => r.nome.toLowerCase().includes(q) || (r.telefone ?? "").includes(q)
    );
  }, [iniciais, procura]);

  const reservados = iniciais.filter((l) => l.tipo === "reservado");
  // Reservar é cadastrar. Quem está por activar já é cliente do colaborador —
  // conta no total, e a parte «por activar» diz quantos desses ainda não têm
  // acesso. Antes somavam-se só as contas abertas, e um colaborador com um
  // cliente reservado lia «0 clientes».
  const totalClientes = iniciais.length;
  const totalPendente = reservados.reduce((n, l) => n + l.valorPendente, 0);

  async function reservar(e: React.FormEvent) {
    e.preventDefault();
    if (aGuardar) return;
    setErro("");
    setAviso("");
    setCriado(null);
    setAGuardar(true);
    try {
      const res = await criarClienteNaCarteira({
        full_name: nome,
        phone: telefone,
        neighborhood: bairro,
        notes: notas,
      });
      setCriado(res);
      setAviso(
        res.existente
          ? `${res.nome} já tinha conta e ficou na sua carteira.`
          : `${res.nome} ficou reservado.`
      );
      setNome("");
      setTelefone("");
      setBairro("");
      setNotas("");
      setPainel(null);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível reservar.");
    } finally {
      setAGuardar(false);
    }
  }

  async function associarExistente(e: React.FormEvent) {
    e.preventDefault();
    if (aGuardar) return;
    setErro("");
    setAviso("");
    setAGuardar(true);
    try {
      const res = await linkCustomerByPhone(telefoneExistente);
      if (!res.found) {
        setErro(
          "Nenhuma conta com este telefone. Use «Reservar cliente»: a pessoa abre a conta quando quiser."
        );
      } else if (res.linked === false) {
        setErro(res.message ?? "Cliente já associado a outro colaborador.");
      } else {
        setAviso("Cliente associado à sua carteira.");
        setTelefoneExistente("");
        setPainel(null);
        router.refresh();
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível associar.");
    } finally {
      setAGuardar(false);
    }
  }

  async function cancelarReserva(id: string, nomeCliente: string) {
    if (!window.confirm(`Cancelar a reserva de ${nomeCliente}? O número fica livre.`)) return;
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/vendedor/clientes?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(corpo.error ?? "Não foi possível cancelar a reserva.");
      setAviso(`Reserva de ${nomeCliente} cancelada.`);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível cancelar a reserva.");
    }
  }

  async function conversar(customerId: string) {
    try {
      const convId = await getOrCreateConversation(customerId);
      // `/cliente/conversas` é área de cliente: um colaborador é desviado de
      // lá. A caixa de mensagens comum serve os dois papéis.
      router.push(`/conversas?c=${convId}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir a conversa.");
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/vendedor"
        className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]"
      >
        ← Área do colaborador
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">A minha carteira</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            {totalClientes} {totalClientes === 1 ? "cliente" : "clientes"}
            {reservados.length > 0 && (
              <>
                {" · "}
                <span className="text-[#C9A962]">
                  {reservados.length} por activar
                </span>
              </>
            )}
            {" · "}
            {formatCurrency(totalVendido)} vendidos por si
          </p>
          {totalPendente > 0 && (
            <p className="mt-1 text-[11px] text-[#6F6F6F]">
              {formatCurrency(totalPendente)} em compras à espera de o cliente abrir conta.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPainel(painel === "novo" ? null : "novo");
              setErro("");
              setAviso("");
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
          >
            <UserPlus className="h-4 w-4" /> Reservar cliente
          </button>
          <button
            type="button"
            onClick={() => {
              setPainel(painel === "existente" ? null : "existente");
              setErro("");
              setAviso("");
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-4 py-2 text-sm text-[#D4D4D4] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            <Plus className="h-4 w-4" /> Já tem conta
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="mb-4 rounded-lg border border-[#1F4D2E] bg-[#12291B] p-3 text-sm text-[#B9E6C8]">
          {aviso}
        </div>
      )}

      {criado && (
        <div className="mb-4 rounded-xl border border-[#C9A962]/40 bg-[#1A1710] p-4">
          <p className="text-xs uppercase tracking-wider text-[#C9A962]">
            {criado.reservado ? "Cliente reservado" : "Cliente associado"}
          </p>
          {criado.reservado ? (
            <>
              <p className="mt-1 text-sm text-[#F5F5F5]">
                {criado.nome} ainda não tem conta. É <strong>ele</strong> que a abre, em
                «Criar conta», com o número <strong>{criado.telefone}</strong>.
              </p>
              <p className="mt-1 text-[11px] text-[#8A8A8A]">
                Quando o fizer, fica automaticamente na sua carteira e recebe as compras
                que já tenha registado com este número. Não há palavra-passe para
                comunicar — nem nada para decorar.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[#F5F5F5]">
              {criado.nome} já tinha conta e ficou na sua carteira. As compras anteriores
              com este número passaram para o histórico dele.
            </p>
          )}
        </div>
      )}

      {painel === "novo" && (
        <form
          onSubmit={reservar}
          className="mb-6 rounded-xl border border-[#262626] bg-[#141414] p-4"
        >
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Reservar cliente
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do cliente"
              className={ENTRADA}
              required
              minLength={3}
            />
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="+244 9xx xxx xxx"
              className={ENTRADA}
              required
            />
            <input
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              placeholder="Bairro (opcional)"
              className={ENTRADA}
            />
          </div>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Nota para si (opcional) — ex.: prefere ser contactado à tarde"
            className={`${ENTRADA} mt-3`}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-md text-[11px] text-[#6F6F6F]">
              Não cria conta nenhuma. Fica registado com a província da sua delegação; o acesso é
              aberto pelo próprio cliente, com este número. Para registar uma compra, use{" "}
              <Link href="/vendedor/vendas/registar" className="text-[#C9A962] hover:underline">
                Registar venda
              </Link>{" "}
              — os produtos e o valor aparecem aqui sozinhos.
            </p>
            <button
              type="submit"
              disabled={aGuardar || nome.trim().length < 3 || !telefone.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] disabled:opacity-40"
            >
              {aGuardar ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              {aGuardar ? "A reservar…" : "Reservar"}
            </button>
          </div>
        </form>
      )}

      {painel === "existente" && (
        <form
          onSubmit={associarExistente}
          className="mb-6 rounded-xl border border-[#262626] bg-[#141414] p-4"
        >
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Associar conta que já existe
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={telefoneExistente}
              onChange={(e) => setTelefoneExistente(e.target.value)}
              placeholder="Telefone do cliente (+244 9xx xxx xxx)"
              className={`${ENTRADA} min-w-0 flex-1`}
              required
            />
            <button
              type="submit"
              disabled={aGuardar || !telefoneExistente.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-semibold text-[#C9A962] disabled:opacity-40"
            >
              {aGuardar ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Associar
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[#6F6F6F]">
            Um cliente só pode estar na carteira de um colaborador. Se já for de um colega, a
            transferência é feita pela gestão.
          </p>
        </form>
      )}

      {iniciais.length > 4 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#525252]" />
          <input
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            placeholder="Procurar na carteira"
            className={`${ENTRADA} pl-8`}
          />
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
          <Users className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">
            {procura ? "Nenhum cliente corresponde à procura." : "Ainda não tem clientes na carteira."}
          </p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            Reserve quem ainda não tem conta, ou associe quem já se registou. O vínculo fica
            visível para a gestão.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((linha) => {
            const tel = linha.telefone ? soDigitos(linha.telefone) : "";
            const t = linha.customerId ? totaisIniciais[linha.customerId] : undefined;
            const reservado = linha.tipo === "reservado";

            return (
              <li
                key={linha.id}
                className={`rounded-xl border p-4 transition ${
                  reservado
                    ? "border-[#3A3324] bg-[#151310] hover:border-[#C9A962]/40"
                    : "border-[#262626] bg-[#141414] hover:border-[#333]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[#F5F5F5]">
                      {linha.nome}
                      {reservado && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A962]/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#C9A962]">
                          <Clock className="h-2.5 w-2.5" /> por activar
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-[#6F6F6F]">
                      {linha.telefone ?? "sem telefone"}
                      {linha.bairro ? ` · ${linha.bairro}` : ""}
                      {linha.provincia ? ` · ${linha.provincia}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-[#525252]">
                      {reservado ? "reservado em " : "na carteira desde "}
                      {dataCurta(linha.desde)}
                    </p>
                    {reservado && linha.notas && (
                      <p className="mt-1 text-[11px] italic text-[#6F6F6F]">“{linha.notas}”</p>
                    )}
                    {reservado && linha.produtos.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-l border-[#3A3324] pl-2">
                        {linha.produtos.map((produto, i) => (
                          <li key={`${produto.nome}-${i}`} className="text-[11px] text-[#8A8A8A]">
                            <span className="text-[#C9A962]">{produto.quantidade}×</span>{" "}
                            {produto.nome}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="text-right">
                    {reservado ? (
                      linha.comprasPendentes > 0 ? (
                        <>
                          <p className="text-sm text-[#C9A962]">
                            {formatCurrency(linha.valorPendente)}
                          </p>
                          <p className="text-[10px] text-[#5F5F5F]">
                            {linha.comprasPendentes}{" "}
                            {linha.comprasPendentes === 1 ? "compra" : "compras"} à espera do registo
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] text-[#5F5F5F]">sem compras registadas</p>
                      )
                    ) : (
                      <>
                        <p className="text-sm text-[#C9A962]">{formatCurrency(t?.total ?? 0)}</p>
                        <p className="text-[10px] text-[#5F5F5F]">
                          {t?.compras
                            ? `${t.compras} ${t.compras === 1 ? "compra" : "compras"}`
                            : "sem compras"}
                          {t?.ultima ? ` · última ${dataCurta(t.ultima)}` : ""}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#242424] pt-3">
                  {tel && (
                    <a href={`tel:${tel}`} className={`${BOTAO_ACCAO} hover:border-[#C9A962]/50 hover:text-[#C9A962]`}>
                      <Phone className="h-3 w-3" /> Ligar
                    </a>
                  )}
                  {tel && (
                    <a
                      href={`https://wa.me/${tel}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${BOTAO_ACCAO} hover:border-[#25D366]/60 hover:text-[#25D366]`}
                    >
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </a>
                  )}
                  {!reservado && linha.customerId && (
                    <button
                      type="button"
                      onClick={() => void conversar(linha.customerId as string)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/50 px-2.5 py-1.5 text-[11px] text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
                    >
                      <ChevronDown className="h-3 w-3 -rotate-90" /> Conversar na INUKA
                    </button>
                  )}
                  {reservado && (
                    <button
                      type="button"
                      onClick={() => void cancelarReserva(linha.id, linha.nome)}
                      className={`${BOTAO_ACCAO} hover:border-[#DC2626]/60 hover:text-[#DC2626]`}
                    >
                      <Trash2 className="h-3 w-3" /> Cancelar reserva
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-xs leading-relaxed text-[#525252]">
        Reservar já é cadastrar: a pessoa conta na sua carteira desde o primeiro dia, mesmo antes
        de ter acesso. Tudo o que faz aqui é visível para a gestão — quem reservou ou abriu a
        conta, quando, e a quem está associada. Um cliente por activar ainda não entra na INUKA: a
        conta é criada por ele, com o número reservado, e nesse momento recebe as compras que já
        tenham sido registadas. A gestão pode mudar o colaborador de um cliente a qualquer momento
        em Clientes.
      </p>
    </main>
  );
}
