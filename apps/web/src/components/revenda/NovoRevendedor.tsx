"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  User,
  Wand2,
  X,
} from "lucide-react";
import { normalizePhone } from "@/lib/utils";

interface ProvinciaOpcao {
  id: string;
  nome: string;
  codigo: string;
}

interface ContaCriada {
  telefone: string;
  palavraPasse: string;
  nome: string;
  revendedorId: string;
  /** Conta de cliente que já existia e foi promovida — não há palavra nova. */
  existente: boolean;
}

/**
 * Criar um revendedor de raiz, sem candidatura pelo meio.
 *
 * A gestão faz isto ao balcão: a pessoa aparece, combina-se o desconto e o
 * mínimo, e a conta nasce ali. É o mesmo caminho da aprovação de candidatura
 * (`/api/gerente/revendedores`), sem `candidatura_id` — a rota trata os dois
 * casos, e a palavra-passe só é exigida quando a conta é nova (um cliente que
 * já compra INUKA é promovido e mantém a palavra que usa).
 */
export default function NovoRevendedor({
  provincias,
  provinciaFixa,
}: {
  provincias: ProvinciaOpcao[];
  provinciaFixa: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);

  const [tipo, setTipo] = useState<"empresa" | "pessoa">("empresa");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");
  const [provincia, setProvincia] = useState(provinciaFixa ?? "");
  const [desconto, setDesconto] = useState("35");
  const [minimo, setMinimo] = useState("5");
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver, setVer] = useState(false);

  const [erro, setErro] = useState("");
  const [aGuardar, setAGuardar] = useState(false);
  const [criada, setCriada] = useState<ContaCriada | null>(null);
  const [copiado, setCopiado] = useState(false);

  const telefoneNormalizado = normalizePhone(telefone);
  const telefoneValido = /^\+244\d{9}$/.test(telefoneNormalizado);

  function gerarPalavra() {
    const palavra = `Inuka${Math.floor(1000 + Math.random() * 9000)}!`;
    setPassword(palavra);
    setConfirmar(palavra);
    setVer(true);
    setErro("");
  }

  function fechar() {
    setAberto(false);
    setErro("");
    setCriada(null);
    setCopiado(false);
    setNome("");
    setTelefone("");
    setNif("");
    setEmail("");
    setDesconto("35");
    setMinimo("5");
    setPassword("");
    setConfirmar("");
    setProvincia(provinciaFixa ?? "");
    setTipo("empresa");
  }

  async function criar() {
    setErro("");

    if (nome.trim().length < 3) {
      setErro("Indique o nome da empresa ou da pessoa (mínimo 3 caracteres).");
      return;
    }
    if (!telefoneValido) {
      setErro("Telefone inválido. Use o formato +244 9xx xxx xxx.");
      return;
    }
    if (password.length > 0 && password.length < 6) {
      setErro("A palavra-passe provisória precisa de pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmar) {
      setErro("As duas palavras-passe não coincidem.");
      return;
    }

    const descontoNum = Number(String(desconto).replace(",", "."));
    const minimoNum = Number(String(minimo).replace(",", "."));

    setAGuardar(true);
    try {
      const resposta = await fetch("/api/gerente/revendedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          nome: nome.trim(),
          telefone: telefoneNormalizado,
          password,
          provincia_id: provincia || null,
          nif: nif.trim(),
          email: email.trim(),
          desconto:
            Number.isFinite(descontoNum) && String(desconto).trim() !== ""
              ? descontoNum / 100
              : null,
          minimo: Number.isFinite(minimoNum) && minimoNum >= 1 ? minimoNum : 5,
        }),
      });

      const dados = (await resposta.json()) as {
        error?: string;
        telefone?: string;
        revendedor_id?: string;
        conta_existente?: boolean;
      };
      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível criar o revendedor.");
        return;
      }

      setCriada({
        telefone: dados.telefone ?? telefoneNormalizado,
        palavraPasse: password,
        nome: nome.trim(),
        revendedorId: dados.revendedor_id ?? "",
        existente: dados.conta_existente === true,
      });
      router.refresh();
    } catch {
      setErro("Não foi possível contactar o servidor.");
    } finally {
      setAGuardar(false);
    }
  }

  async function copiar() {
    if (!criada) return;
    const texto =
      `INUKA Angola — acesso de revendedor\n` +
      `Nome: ${criada.nome}\n` +
      `Telefone: ${criada.telefone}\n` +
      `Palavra-passe provisória: ${criada.palavraPasse}\n` +
      `Entrar em: /login\n`;
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

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
      >
        <Plus className="h-3.5 w-3.5" />
        Novo revendedor
      </button>
    );
  }

  /* ------------------------------------------------------------- CRIADO */
  if (criada) {
    return (
      <div className="w-full rounded-xl border border-[#1F4D2E] bg-[#0F2A18] p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-[#4ADE80]">
          <Check className="h-4 w-4" />
          {criada.existente
            ? "Conta de cliente promovida a revendedor."
            : "Revendedor criado. Já pode entrar na plataforma."}
        </p>

        {criada.existente ? (
          <p className="mt-2 text-xs leading-relaxed text-[#A3A3A3]">
            {criada.nome} entra com o telefone{" "}
            <span className="font-mono text-[#F5F5F5]">{criada.telefone}</span> e a palavra-passe
            que já usa. O histórico de compras mantém-se.
          </p>
        ) : (
          <>
            <dl className="mt-3 grid gap-1 text-xs text-[#A3A3A3] sm:grid-cols-2">
              <div className="flex gap-1">
                <dt>Telefone:</dt>
                <dd className="font-mono text-[#F5F5F5]">{criada.telefone}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Palavra-passe:</dt>
                <dd className="font-mono text-[#F5F5F5]">{criada.palavraPasse}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={copiar}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#2F6B45] px-2.5 py-1 text-[11px] text-[#4ADE80] transition hover:bg-[#12351F]"
            >
              {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiado ? "Copiado" : "Copiar credenciais"}
            </button>
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {criada.revendedorId && (
            <Link
              href={`/gerente/rede/${criada.revendedorId}`}
              className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
            >
              Abrir ficha
            </Link>
          )}
          <button
            type="button"
            onClick={fechar}
            className="rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            Criar outro
          </button>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------- FORMULÁRIO */
  return (
    <div className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-[#F5F5F5]">Novo revendedor</h3>
          <p className="mt-0.5 text-[11px] text-[#6F6F6F]">
            Cria a conta de acesso e a ficha comercial na mesma operação.
          </p>
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

      {/* Tipo */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {(
          [
            { valor: "empresa", titulo: "Empresarial", texto: "Empresa ou organização", icone: <Building2 className="h-4 w-4" /> },
            { valor: "pessoa", titulo: "Individual", texto: "Pessoa singular", icone: <User className="h-4 w-4" /> },
          ] as const
        ).map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setTipo(op.valor)}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
              tipo === op.valor
                ? "border-[#C9A962]/70 bg-[#C9A962]/10 text-[#E3D5A7]"
                : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/40"
            }`}
          >
            <span className={tipo === op.valor ? "text-[#C9A962]" : "text-[#6F6F6F]"}>
              {op.icone}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.1em]">
                {op.titulo}
              </span>
              <span className="block text-[10px] text-[#6F6F6F]">{op.texto}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            {tipo === "empresa" ? "Nome da empresa *" : "Nome completo *"}
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={tipo === "empresa" ? "Ex.: Kianda Comércio, Lda." : "Ex.: Ana Manuel"}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Telefone (login) *
          </span>
          <input
            type="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="+244 9xx xxx xxx"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
          <span
            className={`mt-0.5 block text-[10px] ${
              telefone.trim() === ""
                ? "text-[#525252]"
                : telefoneValido
                  ? "text-[#4ADE80]"
                  : "text-[#F87171]"
            }`}
          >
            {telefone.trim() === ""
              ? "O número com que entra."
              : telefoneValido
                ? `Entra com ${telefoneNormalizado}`
                : "Número inválido."}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">NIF</span>
          <input
            value={nif}
            onChange={(e) => setNif(e.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            E-mail
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Província
          </span>
          <select
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            disabled={!!provinciaFixa}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-60"
          >
            <option value="">Sem província</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} ({p.codigo})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Desconto de grosso (%)
          </span>
          <input
            type="number"
            min={0}
            max={90}
            value={desconto}
            onChange={(e) => setDesconto(e.target.value)}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
          <span className="mt-0.5 block text-[10px] text-[#525252]">Vazio = desconto da empresa.</span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Mínimo de unidades
          </span>
          <input
            type="number"
            min={1}
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            <span>Palavra-passe provisória</span>
            <button
              type="button"
              onClick={gerarPalavra}
              className="inline-flex items-center gap-1 text-[10px] normal-case text-[#C9A962] hover:text-[#E3D5A7]"
            >
              <Wand2 className="h-3 w-3" />
              Gerar
            </button>
          </span>
          <div className="relative">
            <input
              type={ver ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Mínimo 6 caracteres"
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 pr-9 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              aria-label={ver ? "Esconder" : "Mostrar"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#C9A962]"
            >
              {ver ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <span className="mt-0.5 block text-[10px] text-[#525252]">
            Só para conta nova. Um cliente mantém a que já usa.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
            Repetir palavra-passe
          </span>
          <input
            type={ver ? "text" : "password"}
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            autoComplete="new-password"
            className={`w-full rounded-lg border bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:outline-none ${
              confirmar === ""
                ? "border-[#404040] focus:border-[#C9A962]"
                : confirmar === password
                  ? "border-[#2F6B45]"
                  : "border-[#4A2020]"
            }`}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={criar}
          disabled={aGuardar}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {aGuardar ? "A criar…" : "Criar conta e ficha"}
        </button>
        <button
          type="button"
          onClick={fechar}
          disabled={aGuardar}
          className="rounded-lg border border-[#333] px-4 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
