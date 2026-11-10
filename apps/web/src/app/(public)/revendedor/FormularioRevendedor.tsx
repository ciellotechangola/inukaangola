"use client";

import { useState } from "react";
import { Check, Send } from "lucide-react";
import { normalizePhone } from "@/lib/utils";
import type { Provincia } from "@/lib/provincias";

/**
 * Formulário público de candidatura a revendedor.
 *
 * Três campos obrigatórios e nada mais: cada campo a mais é uma pessoa que
 * desiste. O telefone é normalizado antes de sair daqui, para a gestão não
 * receber "+244 923 111 444" e "923111444" como duas pessoas diferentes.
 */
export default function FormularioRevendedor({ provincias }: { provincias: Provincia[] }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [provincia, setProvincia] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (nome.trim().length < 2) {
      setErro("Indique o seu nome completo.");
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
          full_name: nome.trim(),
          phone: numero,
          provincia_id: provincia || null,
          message: mensagem.trim() || null,
          source: "loja",
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
          A gestão INUKA vai analisar os seus dados e entrar em contacto pelo número que deixou.
        </p>
        <button
          onClick={() => {
            setEnviado(false);
            setNome("");
            setTelefone("");
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
      <h2 className="text-lg font-medium text-[#F5F5F5]">Quero ser colaborador INUKA</h2>
      <p className="mt-1 text-xs text-[#6F6F6F]">
        Deixe o seu contacto. A gestão recebe a candidatura e responde.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            Nome completo *
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Ana Manuel"
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

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#6F6F6F]">
            Mensagem (opcional)
          </span>
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={3}
            maxLength={800}
            placeholder="Conte-nos onde vende, que produtos lhe interessam, ou o que precisar."
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
