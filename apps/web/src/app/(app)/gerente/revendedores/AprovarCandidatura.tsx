"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, KeyRound, Wand2, X } from "lucide-react";
import { normalizePhone } from "@/lib/utils";
import type { ProvinciaOpcao } from "./page";

interface Candidatura {
  id: string;
  tipo: string;
  nome: string;
  telefone: string;
  nif: string | null;
  email: string | null;
  provincia_id: string | null;
}

interface ContaCriada {
  telefone: string;
  palavraPasse: string;
  nome: string;
  /** Conta de cliente que já existia e foi promovida — não há palavra nova. */
  existente: boolean;
}

/**
 * Aprovar uma candidatura: cria a conta e a ficha ao mesmo tempo.
 *
 * O desconto escreve-se em percentagem (é como a gestão pensa), mas grava-se
 * em fracção (é como a base compara). A conversão fica num só sítio.
 */
export default function AprovarCandidatura({
  candidatura,
  provincias,
  provinciaFixa,
  abertoInicial = false,
}: {
  candidatura: Candidatura;
  provincias: ProvinciaOpcao[];
  provinciaFixa: string | null;
  abertoInicial?: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abertoInicial);
  const [nome, setNome] = useState(candidatura.nome);
  const [telefone, setTelefone] = useState(candidatura.telefone);
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [provincia, setProvincia] = useState(
    provinciaFixa ?? candidatura.provincia_id ?? ""
  );
  const [desconto, setDesconto] = useState("");
  const [minimo, setMinimo] = useState("4");
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState("");
  const [aGuardar, setAGuardar] = useState(false);
  const [criada, setCriada] = useState<ContaCriada | null>(null);
  const [copiado, setCopiado] = useState(false);

  const telefoneNormalizado = normalizePhone(telefone);
  const telefoneValido = /^\+244\d{9}$/.test(telefoneNormalizado);

  function gerarPalavra() {
    const digitos = String(Math.floor(1000 + Math.random() * 9000));
    const palavra = `Inuka${digitos}!`;
    setPassword(palavra);
    setConfirmar(palavra);
    setVer(true);
    setErro("");
  }

  async function aprovar() {
    setErro("");

    if (nome.trim().length < 3) {
      setErro("Indique o nome da empresa ou da pessoa.");
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
          candidatura_id: candidatura.id,
          tipo: candidatura.tipo,
          nome: nome.trim(),
          telefone: telefoneNormalizado,
          password,
          provincia_id: provincia || null,
          nif: candidatura.nif,
          email: candidatura.email,
          desconto:
            Number.isFinite(descontoNum) && String(desconto).trim() !== ""
              ? descontoNum / 100
              : null,
          minimo: Number.isFinite(minimoNum) && minimoNum > 0 ? Math.max(4, minimoNum) : 4,
        }),
      });

      const dados = (await resposta.json()) as {
        error?: string;
        telefone?: string;
        conta_existente?: boolean;
      };
      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível aprovar.");
        return;
      }

      setCriada({
        telefone: dados.telefone ?? telefoneNormalizado,
        palavraPasse: password,
        nome: nome.trim(),
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

  if (criada) {
    return (
      <div className="mt-3 rounded-lg border border-[#1F4D2E] bg-[#0F2A18] p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-[#4ADE80]">
          <Check className="h-3.5 w-3.5" />
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
            <button
              type="button"
              onClick={copiar}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#2F6B45] px-2.5 py-1 text-[11px] text-[#4ADE80] transition hover:bg-[#12351F]"
            >
              {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiado ? "Copiado" : "Copiar credenciais"}
            </button>
          </>
        )}
      </div>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
      >
        Aprovar e criar conta
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-[#E5E5E5]">Aprovar e criar acesso</p>
        <button
          type="button"
          onClick={() => setAberto(false)}
          aria-label="Fechar"
          className="text-[#525252] hover:text-[#F5F5F5]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {erro && (
        <p className="mb-2 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Nome (empresa ou pessoa)</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Telefone (login)</span>
          <input
            type="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="+244 9xx xxx xxx"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
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
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Província</span>
          <select
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            disabled={!!provinciaFixa}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-60"
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
          <span className="mb-1 flex items-center justify-between text-[10px] text-[#6F6F6F]">
            <span>Palavra-passe provisória</span>
            <button
              type="button"
              onClick={gerarPalavra}
              className="inline-flex items-center gap-1 text-[10px] text-[#C9A962] hover:text-[#E3D5A7]"
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
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 pr-8 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              aria-label={ver ? "Esconder" : "Mostrar"}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#C9A962]"
            >
              {ver ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <span className="mt-0.5 block text-[10px] text-[#525252]">
            Obrigatória só se a conta for nova. Um cliente mantém a que já usa.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Repetir palavra-passe</span>
          <input
            type={ver ? "text" : "password"}
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            autoComplete="new-password"
            className={`w-full rounded-lg border bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-[#F5F5F5] focus:outline-none ${
              confirmar === ""
                ? "border-[#404040] focus:border-[#C9A962]"
                : confirmar === password
                  ? "border-[#2F6B45]"
                  : "border-[#4A2020]"
            }`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">
            Desconto de grosso (%) — opcional
          </span>
          <input
            type="number"
            min={0}
            max={90}
            value={desconto}
            onChange={(e) => setDesconto(e.target.value)}
            placeholder="tabela"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
          <span className="mt-0.5 block text-[10px] text-[#525252]">
            Em branco, o preço vem da tabela de reduções (3.500 / 4.000 / 5.000 Kz). Preencha
            só quando houver um acordo especial com este revendedor.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] text-[#6F6F6F]">Mínimo de unidades por pedido</span>
          <input
            type="number"
            min={4}
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={aprovar}
          disabled={aGuardar}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {aGuardar ? "A criar…" : "Criar revendedor"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          disabled={aGuardar}
          className="rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
