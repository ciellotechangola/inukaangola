"use client";

import { useState } from "react";
import { Building2, Check, Send, User } from "lucide-react";
import { normalizePhone } from "@/lib/utils";
import type { Provincia } from "@/lib/provincias";

/**
 * Formulário público «Ser revendedor INUKA».
 *
 * Empresa ou pessoa — o mesmo formulário, com o rótulo do nome a mudar. Os
 * campos a mais custam candidaturas: NIF e e-mail são opcionais e ficam para
 * quem quiser acelerar a aprovação. O telefone é normalizado antes de sair
 * daqui para a gestão não receber o mesmo número em duas grafias.
 */
export default function FormularioRevendedor({ provincias }: { provincias: Provincia[] }) {
  const [tipo, setTipo] = useState<"pessoa" | "empresa">("empresa");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [nif, setNif] = useState("");
  const [provincia, setProvincia] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (nome.trim().length < 2) {
      setErro(
        tipo === "empresa"
          ? "Indique o nome da empresa."
          : "Indique o seu nome completo."
      );
      return;
    }

    const numero = normalizePhone(telefone);
    if (!numero) {
      setErro("Indique um número de telefone válido (ex.: +244 9xx xxx xxx).");
      return;
    }

    setAEnviar(true);
    try {
      const resposta = await fetch("/api/revendedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          full_name: nome.trim(),
          phone: numero,
          email: email.trim() || null,
          nif: nif.trim() || null,
          provincia_id: provincia || null,
          message: mensagem.trim() || null,
          source: "site",
        }),
      });

      const dados = (await resposta.json()) as { ok?: boolean; error?: string };
      if (!resposta.ok) throw new Error(dados.error ?? "Não foi possível enviar.");

      setEnviado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente.");
    } finally {
      setAEnviar(false);
    }
  }

  if (enviado) {
    return (
      <div className="rounded-2xl border border-[#1F3D2B] bg-[#0F1F16] p-8 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#C9A962]/15 text-[#C9A962]">
          <Check className="h-6 w-6" />
        </span>
        <h3 className="text-lg font-medium text-[#F5F5F5]">Candidatura recebida</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#A3A3A3]">
          O gerente da sua província vai analisar os dados e entrar em contacto pelo número que
          deixou. Se for aprovado, recebe acesso ao catálogo de grosso.
        </p>
        <button
          onClick={() => {
            setEnviado(false);
            setNome("");
            setTelefone("");
            setEmail("");
            setNif("");
            setProvincia("");
            setMensagem("");
          }}
          className="mt-6 text-xs text-[#6F6F6F] underline-offset-4 transition hover:text-[#C9A962] hover:underline"
        >
          Enviar outra candidatura
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="rounded-2xl border border-[#262626] bg-[#141414] p-6 sm:p-8"
    >
      <h2 className="text-lg font-medium text-[#F5F5F5]">Ser revendedor INUKA</h2>
      <p className="mt-1 text-xs text-[#6F6F6F]">
        Deixe os seus dados. A gestão da sua província recebe a candidatura e responde.
      </p>

      {/* Empresa ou pessoa: muda o rótulo do nome e pede NIF só à empresa. */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTipo("empresa")}
          className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
            tipo === "empresa"
              ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#C9A962]"
              : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/40 hover:text-[#C9A962]"
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          Empresa
        </button>
        <button
          type="button"
          onClick={() => setTipo("pessoa")}
          className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
            tipo === "pessoa"
              ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#C9A962]"
              : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/40 hover:text-[#C9A962]"
          }`}
        >
          <User className="h-3.5 w-3.5" />
          Pessoa
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            {tipo === "empresa" ? "Nome da empresa *" : "Nome completo *"}
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={tipo === "empresa" ? "Ex.: Kianda Comércio Lda" : "Ex.: Ana Manuel"}
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            Telefone / WhatsApp *
          </span>
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            inputMode="tel"
            placeholder="+244 9xx xxx xxx"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            Província
          </span>
          <select
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            <option value="">Prefiro indicar depois</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            E-mail
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="opcional"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            {tipo === "empresa" ? "NIF" : "Nº do BI"}
          </span>
          <input
            value={nif}
            onChange={(e) => setNif(e.target.value)}
            placeholder="opcional"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            O que pretende revender?
          </span>
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={3}
            maxLength={800}
            placeholder="Ex.: perfumes e óleos, cerca de 30 unidades por mês, venda em loja física no Uíge."
            className="w-full resize-y rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>
      </div>

      {erro && (
        <p className="mt-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={aEnviar}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] px-5 py-3 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50 sm:w-auto"
      >
        <Send className="h-4 w-4" />
        {aEnviar ? "A enviar…" : "Enviar candidatura"}
      </button>

      <p className="mt-3 text-[11px] text-[#525252]">
        Os seus dados são usados apenas para esta candidatura. Não são partilhados com terceiros.
      </p>
    </form>
  );
}
