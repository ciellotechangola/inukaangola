"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, KeyRound, UserPlus, Wand2, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { mensagemErro } from "@/lib/colaborador";
import { normalizePhone } from "@/lib/utils";
import type { Provincia } from "@/lib/provincias";

/**
 * Percentagem escrita à mão -> fracção.
 * Vazio significa "herda a taxa da empresa", que se grava como `null`.
 */
function taxaDe(valor: string): number | null {
  const texto = valor.trim();
  if (texto === "") return null;
  const n = Number(texto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
}

interface Cliente {
  id: string;
  full_name: string;
  phone: string | null;
}

/** Conta criada, com o que é preciso entregar à pessoa. */
interface ContaCriada {
  referencia: string | null;
  telefone: string;
  palavraPasse: string;
  nome: string;
}

/**
 * Criar um colaborador. Duas portas para a mesma coisa:
 *
 *  - **Conta nova** — a pessoa ainda não existe no sistema; a conta é criada
 *    na Admin API (`/api/gerente/utilizadores`) porque só o servidor tem
 *    `service_role`. A referência INUKA nasce aí, na sequência da província.
 *    Reparte-se em dois passos: os dados pessoais e o **acesso**, que é onde o
 *    gestor define o telefone e a palavra-passe com que a pessoa entra.
 *  - **Promover cliente** — já tem conta de cliente; passa a colaborador sem
 *    perder o histórico de compras.
 */
export default function NovoColaborador({
  clientes,
  provincias,
  provinciaFixa,
}: {
  clientes: Cliente[];
  provincias: Provincia[];
  /** Gestor provincial: a província não se escolhe. */
  provinciaFixa: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<"novo" | "promover">("novo");
  const [passo, setPasso] = useState<"dados" | "acesso">("dados");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aGuardar, setAGuardar] = useState(false);
  const [criada, setCriada] = useState<ContaCriada | null>(null);
  const [copiado, setCopiado] = useState(false);

  const [verPalavra, setVerPalavra] = useState(false);
  const [confirmar, setConfirmar] = useState("");

  const [novo, setNovo] = useState({
    full_name: "",
    phone: "",
    password: "",
    provincia_id: provinciaFixa ?? "",
    bi_number: "",
    birth_date: "",
    whatsapp: "",
    municipio: "",
    address: "",
    job_title: "Colaborador de vendas",
    category: "",
    hired_at: "",
    commission_rate: "",
  });

  const [promover, setPromover] = useState({
    clienteId: "",
    regiao: "",
    comissao: "",
  });

  const telefoneNormalizado = normalizePhone(novo.phone);
  const telefoneValido = /^\+244\d{9}$/.test(telefoneNormalizado);
  const acessoCompleto =
    telefoneValido && novo.password.length >= 6 && novo.password === confirmar;

  function limpar() {
    setErro("");
    setAviso("");
    setCopiado(false);
  }

  function fechar() {
    setAberto(false);
    limpar();
    setCriada(null);
    setPasso("dados");
  }

  function mudarModo(m: "novo" | "promover") {
    setModo(m);
    setPasso("dados");
    limpar();
    setCriada(null);
  }

  /** Palavra-passe provisória fácil de ditar ao telefone. */
  function gerarPalavra() {
    const digitos = String(Math.floor(1000 + Math.random() * 9000));
    const palavra = `Inuka${digitos}!`;
    setNovo((n) => ({ ...n, password: palavra }));
    setConfirmar(palavra);
    setVerPalavra(true);
    limpar();
  }

  function continuar() {
    limpar();
    if (novo.full_name.trim().length < 3) {
      setErro("Indique o nome completo antes de avançar.");
      return;
    }
    setPasso("acesso");
  }

  async function criarConta() {
    limpar();

    if (novo.full_name.trim().length < 3) {
      setErro("Indique o nome completo.");
      setPasso("dados");
      return;
    }
    if (!telefoneValido) {
      setErro("Telefone inválido. Use o formato +244 9xx xxx xxx.");
      return;
    }
    if (novo.password.length < 6) {
      setErro("A palavra-passe provisória precisa de pelo menos 6 caracteres.");
      return;
    }
    if (novo.password !== confirmar) {
      setErro("As duas palavras-passe não coincidem.");
      return;
    }

    setAGuardar(true);
    try {
      const resposta = await fetch("/api/gerente/utilizadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "seller",
          ...novo,
          phone: telefoneNormalizado,
          commission_rate: taxaDe(novo.commission_rate),
        }),
      });

      const dados = (await resposta.json()) as {
        error?: string;
        id?: string;
        referencia?: string | null;
        telefone?: string;
      };

      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível criar a conta.");
        return;
      }

      // A conta já existe e já entra: mostrar o que o gestor tem de entregar.
      setCriada({
        referencia: dados.referencia ?? null,
        telefone: dados.telefone ?? telefoneNormalizado,
        palavraPasse: novo.password,
        nome: novo.full_name.trim(),
      });

      setNovo({
        ...novo,
        full_name: "",
        phone: "",
        password: "",
        bi_number: "",
        birth_date: "",
        whatsapp: "",
        municipio: "",
        address: "",
        hired_at: "",
      });
      setConfirmar("");
      setPasso("dados");
      router.refresh();
    } catch {
      setErro("Não foi possível contactar o servidor.");
    } finally {
      setAGuardar(false);
    }
  }

  async function copiarCredenciais() {
    if (!criada) return;
    const texto =
      `INUKA Angola — acesso à plataforma\n` +
      `Nome: ${criada.nome}\n` +
      `Telefone: ${criada.telefone}\n` +
      `Palavra-passe provisória: ${criada.palavraPasse}\n` +
      (criada.referencia ? `Referência: ${criada.referencia}\n` : "");

    // `navigator.clipboard` só existe em contexto seguro (https ou localhost).
    // O gestor usa o site pelo IP da rede em http, por isso há um recurso
    // antigo para o mesmo efeito — sem ele o botão falhava precisamente onde
    // é preciso.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        const area = document.createElement("textarea");
        area.value = texto;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopiado(true);
    } catch {
      setErro("Não foi possível copiar. Copie os dados à mão.");
    }
  }

  async function promoverCliente() {
    limpar();
    if (!promover.clienteId) {
      setErro("Escolha um cliente.");
      return;
    }

    setAGuardar(true);
    const supabase = createClientBrowser();

    const { error: erroPapel } = await supabase
      .from("profiles")
      .update({ role: "seller" })
      .eq("id", promover.clienteId);

    if (erroPapel) {
      setAGuardar(false);
      setErro(mensagemErro(erroPapel));
      return;
    }

    const { error: erroPerfil } = await supabase.from("seller_profiles").upsert(
      {
        id: promover.clienteId,
        region: promover.regiao.trim() || null,
        commission_rate: taxaDe(promover.comissao),
      },
      { onConflict: "id" }
    );

    setAGuardar(false);
    if (erroPerfil) {
      setErro(mensagemErro(erroPerfil));
      return;
    }

    setPromover({ clienteId: "", regiao: "", comissao: "" });
    setAviso("Cliente promovido a colaborador. O histórico de compras mantém-se.");
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
      >
        <UserPlus className="h-4 w-4" />
        Novo colaborador
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414] p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Separador ativo={modo === "novo"} onClick={() => mudarModo("novo")}>
            Conta nova
          </Separador>
          <Separador ativo={modo === "promover"} onClick={() => mudarModo("promover")}>
            Promover cliente
          </Separador>
        </div>
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          className="text-[#525252] transition hover:text-[#F5F5F5]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {erro && (
        <p className="mb-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg border border-[#1F4D2E] bg-[#0F2A18] px-3 py-2 text-xs text-[#4ADE80]">
          {aviso}
        </p>
      )}

      {/* Conta criada: o gestor tem de entregar estes dados à pessoa. */}
      {criada && modo === "novo" && (
        <div className="mb-4 rounded-lg border border-[#1F4D2E] bg-[#0F2A18] p-3">
          <p className="flex items-center gap-2 text-xs font-medium text-[#4ADE80]">
            <Check className="h-3.5 w-3.5" />
            Conta criada{criada.referencia ? ` · ${criada.referencia}` : ""}. Já pode entrar na
            plataforma.
          </p>
          <dl className="mt-2 grid gap-1 text-xs text-[#A3A3A3] sm:grid-cols-2">
            <div className="flex gap-1">
              <dt>Telefone:</dt>
              <dd className="font-mono text-[#F5F5F5]">{criada.telefone}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Palavra-passe:</dt>
              <dd className="font-mono text-[#F5F5F5]">{criada.palavraPasse}</dd>
            </div>
          </dl>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copiarCredenciais}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6B45] px-2.5 py-1 text-[11px] text-[#4ADE80] transition hover:bg-[#12351F]"
            >
              {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiado ? "Copiado" : "Copiar credenciais"}
            </button>
            <button
              type="button"
              onClick={() => setCriada(null)}
              className="rounded-lg border border-[#333] px-2.5 py-1 text-[11px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            >
              Criar outro
            </button>
          </div>
        </div>
      )}

      {modo === "novo" ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Passo ativo={passo === "dados"} onClick={() => { setPasso("dados"); limpar(); }} numero="1">
              Dados pessoais
            </Passo>
            <Passo
              ativo={passo === "acesso"}
              onClick={() => { setPasso("acesso"); limpar(); }}
              numero="2"
              concluido={acessoCompleto}
            >
              Acesso à plataforma
            </Passo>
          </div>

          {passo === "dados" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo rotulo="Nome completo" valor={novo.full_name} onChange={(v) => setNovo({ ...novo, full_name: v })} />
                <Campo rotulo="Nº do BI" valor={novo.bi_number} onChange={(v) => setNovo({ ...novo, bi_number: v })} mono />
                <Campo rotulo="Data de nascimento" tipo="date" valor={novo.birth_date} onChange={(v) => setNovo({ ...novo, birth_date: v })} />
                <Campo rotulo="WhatsApp" valor={novo.whatsapp} onChange={(v) => setNovo({ ...novo, whatsapp: v })} placeholder="+244 9xx xxx xxx" />
                <Campo rotulo="Município" valor={novo.municipio} onChange={(v) => setNovo({ ...novo, municipio: v })} />
                <Campo rotulo="Endereço" valor={novo.address} onChange={(v) => setNovo({ ...novo, address: v })} />
                <Campo rotulo="Função" valor={novo.job_title} onChange={(v) => setNovo({ ...novo, job_title: v })} />
                <Campo rotulo="Categoria" valor={novo.category} onChange={(v) => setNovo({ ...novo, category: v })} />
                <Campo rotulo="Data de entrada" tipo="date" valor={novo.hired_at} onChange={(v) => setNovo({ ...novo, hired_at: v })} />
                <Campo
                  rotulo="Comissão pessoal (%)"
                  tipo="number"
                  valor={novo.commission_rate}
                  onChange={(v) => setNovo({ ...novo, commission_rate: v })}
                  placeholder="vazio = taxa da empresa"
                />

                {!provinciaFixa && (
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-[#6F6F6F]">Província</span>
                    <select
                      value={novo.provincia_id}
                      onChange={(e) => setNovo({ ...novo, provincia_id: e.target.value })}
                      className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
                    >
                      <option value="">Sem província (administração nacional)</option>
                      {provincias.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome} ({p.codigo})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={continuar}
                  className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
                >
                  Continuar para o acesso
                </button>
                <span className="text-[11px] text-[#525252]">
                  A conta só é criada no passo seguinte.
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-[11px] leading-relaxed text-[#A3A3A3]">
                É com estes dois dados que a pessoa entra na plataforma. A conta fica criada e
                confirmada por si — não é enviado nenhum email nem é preciso a pessoa registar-se.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-[#6F6F6F]">Telefone (login)</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={novo.phone}
                    onChange={(e) => setNovo({ ...novo, phone: e.target.value })}
                    placeholder="+244 9xx xxx xxx"
                    className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
                  />
                  <span
                    className={`mt-1 block text-[10px] ${
                      novo.phone.trim() === ""
                        ? "text-[#525252]"
                        : telefoneValido
                          ? "text-[#4ADE80]"
                          : "text-[#F87171]"
                    }`}
                  >
                    {novo.phone.trim() === ""
                      ? "O número com que a pessoa vai entrar."
                      : telefoneValido
                        ? `Entra com ${telefoneNormalizado}`
                        : "Número inválido — use +244 9xx xxx xxx."}
                  </span>
                </label>

                <div className="block">
                  <span className="mb-1 flex items-center justify-between text-[11px] text-[#6F6F6F]">
                    <span>Palavra-passe provisória</span>
                    <button
                      type="button"
                      onClick={gerarPalavra}
                      className="inline-flex items-center gap-1 text-[10px] text-[#C9A962] transition hover:text-[#E3D5A7]"
                    >
                      <Wand2 className="h-3 w-3" />
                      Gerar
                    </button>
                  </span>
                  <div className="relative">
                    <input
                      type={verPalavra ? "text" : "password"}
                      value={novo.password}
                      onChange={(e) => setNovo({ ...novo, password: e.target.value })}
                      autoComplete="new-password"
                      placeholder="Mínimo 6 caracteres"
                      className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 pr-10 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setVerPalavra((v) => !v)}
                      aria-label={verPalavra ? "Esconder palavra-passe" : "Mostrar palavra-passe"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] transition hover:text-[#C9A962]"
                    >
                      {verPalavra ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <span className="mt-1 block text-[10px] text-[#525252]">
                    A pessoa pode mudá-la depois de entrar.
                  </span>
                </div>

                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[#6F6F6F]">Repetir palavra-passe</span>
                  <input
                    type={verPalavra ? "text" : "password"}
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    autoComplete="new-password"
                    className={`w-full rounded-lg border bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:outline-none ${
                      confirmar === ""
                        ? "border-[#404040] focus:border-[#C9A962]"
                        : confirmar === novo.password
                          ? "border-[#2F6B45]"
                          : "border-[#4A2020]"
                    }`}
                  />
                  {confirmar !== "" && confirmar !== novo.password && (
                    <span className="mt-1 block text-[10px] text-[#F87171]">
                      As palavras-passe não coincidem.
                    </span>
                  )}
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={criarConta}
                  disabled={aGuardar}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  {aGuardar ? "A criar…" : "Criar colaborador"}
                </button>
                <button
                  type="button"
                  onClick={() => setPasso("dados")}
                  disabled={aGuardar}
                  className="rounded-lg border border-[#333] px-3 py-2 text-sm text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-50"
                >
                  Voltar
                </button>
              </div>

              <p className="mt-2 text-[11px] text-[#525252]">
                A referência INUKA é gerada na sequência da província escolhida e não se edita.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-[#A3A3A3]">
              Cliente
              <select
                value={promover.clienteId}
                onChange={(e) => setPromover({ ...promover, clienteId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              >
                <option value="">Escolher…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <Campo rotulo="Região" valor={promover.regiao} onChange={(v) => setPromover({ ...promover, regiao: v })} />
            <Campo
              rotulo="Comissão pessoal (%)"
              tipo="number"
              valor={promover.comissao}
              onChange={(v) => setPromover({ ...promover, comissao: v })}
              placeholder="vazio = taxa da empresa"
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={promoverCliente}
              disabled={aGuardar}
              className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
            >
              {aGuardar ? "A promover…" : "Promover"}
            </button>
          </div>

          <p className="mt-2 text-[11px] text-[#525252]">
            O cliente passa a ter acesso à área de colaborador com o telefone e a palavra-passe que
            já usa. O histórico de compras mantém-se.
          </p>
        </>
      )}
    </div>
  );
}

function Separador({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs transition ${
        ativo
          ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#C9A962]"
          : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      }`}
    >
      {children}
    </button>
  );
}

/** Passo do formulário de conta nova. */
function Passo({
  ativo,
  onClick,
  numero,
  concluido,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  numero: string;
  concluido?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "step" : undefined}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
        ativo
          ? "border-[#C9A962] bg-[#C9A962]/10 text-[#C9A962]"
          : "border-[#2A2A2A] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
          ativo
            ? "bg-[#C9A962] text-[#0A0A0A]"
            : concluido
              ? "bg-[#1F4D2E] text-[#4ADE80]"
              : "bg-[#262626] text-[#6F6F6F]"
        }`}
      >
        {concluido && !ativo ? <Check className="h-2.5 w-2.5" /> : numero}
      </span>
      {children}
    </button>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  tipo = "text",
  mono,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[#6F6F6F]">{rotulo}</span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={tipo === "number" ? 0 : undefined}
        step={tipo === "number" ? "0.1" : undefined}
        className={`w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none ${
          mono ? "font-mono text-xs" : ""
        }`}
      />
    </label>
  );
}
