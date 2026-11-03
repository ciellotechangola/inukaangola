"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Search,
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

export interface ClienteCarteira {
  vinculoId: string;
  desde: string;
  cliente: {
    id: string;
    full_name: string;
    phone: string | null;
    neighborhood: string | null;
  } | null;
}

export interface TotaisCliente {
  total: number;
  compras: number;
  ultima: string | null;
}

const ENTRADA =
  "w-full rounded-lg border border-[#333] bg-[#0F0F0F] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

/** `+244923111222` → `244923111222` (o formato que o wa.me espera). */
function soDigitos(telefone: string): string {
  return telefone.replace(/\D/g, "");
}

/**
 * A carteira, do lado do browser.
 *
 * Os dados chegam já lidos do servidor (`page.tsx`); este componente só trata
 * do que precisa de interacção — abrir conta, associar, procurar e contactar.
 * Depois de escrever, `router.refresh()` volta a pedir a lista ao servidor, em
 * vez de a reconstruir à mão e arriscar divergir.
 */
export function CarteiraClientes({
  iniciais,
  totaisIniciais,
  erroInicial,
}: {
  iniciais: ClienteCarteira[];
  totaisIniciais: Record<string, TotaisCliente>;
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
  const [telefoneExistente, setTelefoneExistente] = useState("");
  const [aGuardar, setAGuardar] = useState(false);
  const [criado, setCriado] = useState<RespostaNovoCliente | null>(null);

  const visiveis = useMemo(() => {
    const q = procura.trim().toLowerCase();
    if (!q) return iniciais;
    return iniciais.filter(
      (r) =>
        (r.cliente?.full_name ?? "").toLowerCase().includes(q) ||
        (r.cliente?.phone ?? "").includes(q)
    );
  }, [iniciais, procura]);

  const totalCarteira = Object.values(totaisIniciais).reduce((n, t) => n + t.total, 0);

  async function abrirConta(e: React.FormEvent) {
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
      });
      setCriado(res);
      setAviso(
        res.existente
          ? `${res.nome} já tinha conta e ficou na sua carteira.`
          : `${res.nome} foi acrescentado à sua carteira.`
      );
      setNome("");
      setTelefone("");
      setBairro("");
      setPainel(null);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível acrescentar.");
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
          "Nenhuma conta com este telefone. Use «Abrir conta de cliente» para a criar."
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

  async function conversar(customerId: string) {
    try {
      const convId = await getOrCreateConversation(customerId);
      // `/cliente/conversas` é área de cliente: um colaborador é desviado de
      // lá. A caixa de mensagens comum serve os dois papéis.
      window.location.href = `/conversas?c=${convId}`;
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
            {iniciais.length} {iniciais.length === 1 ? "cliente" : "clientes"} ·{" "}
            {formatCurrency(totalCarteira)} vendidos por si
          </p>
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
            <UserPlus className="h-4 w-4" /> Abrir conta de cliente
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

      {criado && !criado.existente && criado.password && (
        <div className="mb-4 rounded-xl border border-[#C9A962]/40 bg-[#1A1710] p-4">
          <p className="text-xs uppercase tracking-wider text-[#C9A962]">Acesso do cliente</p>
          <p className="mt-1 text-sm text-[#F5F5F5]">
            {criado.nome} entra com o telefone <strong>{criado.telefone}</strong> e a palavra-passe{" "}
            <strong className="font-mono text-[#C9A962]">{criado.password}</strong>.
          </p>
          <p className="mt-1 text-[11px] text-[#8A8A8A]">
            Mostre esta palavra-passe uma vez — não volta a aparecer. O cliente pode alterá-la
            depois em «Perfil». A conta fica na província {criado.provincia ?? "da sua delegação"}.
          </p>
        </div>
      )}

      {painel === "novo" && (
        <form
          onSubmit={abrirConta}
          className="mb-6 rounded-xl border border-[#262626] bg-[#141414] p-4"
        >
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[#8A8A8A]">
            Abrir conta de cliente
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[#6F6F6F]">
              A conta é criada na sua província. Se o telefone já tiver conta, fica só associada.
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
              {aGuardar ? "A criar…" : "Criar e associar"}
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
            Abra conta a quem ainda não tem, ou associe quem já se registou. O vínculo fica
            visível para a gestão.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((row) => {
            const c = row.cliente;
            const t = c ? totaisIniciais[c.id] : undefined;
            const tel = c?.phone ? soDigitos(c.phone) : "";

            return (
              <li
                key={row.vinculoId}
                className="rounded-xl border border-[#262626] bg-[#141414] p-4 transition hover:border-[#333]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[#F5F5F5]">{c?.full_name ?? "Cliente"}</p>
                    <p className="mt-0.5 text-xs text-[#6F6F6F]">
                      {c?.phone ?? "sem telefone"}
                      {c?.neighborhood ? ` · ${c.neighborhood}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-[#525252]">
                      na carteira desde {new Date(row.desde).toLocaleDateString("pt-PT")}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm text-[#C9A962]">{formatCurrency(t?.total ?? 0)}</p>
                    <p className="text-[10px] text-[#5F5F5F]">
                      {t?.compras
                        ? `${t.compras} ${t.compras === 1 ? "compra" : "compras"}`
                        : "sem compras"}
                      {t?.ultima
                        ? ` · última ${new Date(t.ultima).toLocaleDateString("pt-PT")}`
                        : ""}
                    </p>
                  </div>
                </div>

                {c?.id && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#242424] pt-3">
                    {tel && (
                      <a
                        href={`tel:${tel}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#D4D4D4] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                      >
                        <Phone className="h-3 w-3" /> Ligar
                      </a>
                    )}
                    {tel && (
                      <a
                        href={`https://wa.me/${tel}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#D4D4D4] transition hover:border-[#25D366]/60 hover:text-[#25D366]"
                      >
                        <MessageCircle className="h-3 w-3" /> WhatsApp
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void conversar(c.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/50 px-2.5 py-1.5 text-[11px] text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
                    >
                      <ChevronDown className="h-3 w-3 -rotate-90" /> Conversar na INUKA
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-xs leading-relaxed text-[#525252]">
        Tudo o que faz aqui é visível para a gestão: quem abriu a conta, quando, e a quem está
        associada. A gestão pode mudar o colaborador de um cliente a qualquer momento em
        Clientes.
      </p>
    </main>
  );
}
