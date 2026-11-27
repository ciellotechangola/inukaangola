"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  FileText,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  ShieldCheck,
  User,
  UserRound,
} from "lucide-react";
import { normalizePhone } from "@/lib/utils";
import type { Provincia } from "@/lib/provincias";

type Tipo = "pessoa" | "empresa";

const CAMPO =
  "w-full rounded-lg border bg-[#0A0A0A] px-3.5 py-2.5 text-sm text-[#F5F5F5] transition placeholder:text-[#4A4A4A] focus:outline-none focus:ring-1";
const CAMPO_OK = "border-[#2E2E2E] focus:border-[#C9A962] focus:ring-[#C9A962]/25";
const CAMPO_MAU = "border-[#7F1D1D] focus:border-[#EF4444] focus:ring-[#EF4444]/25";

interface Falha {
  campo: string;
  texto: string;
}

/**
 * Formulário público «Ser revendedor INUKA».
 *
 * Dois percursos, um de cada vez: INDIVIDUAL (pessoa singular) e EMPRESARIAL
 * (empresa). Escolher um mostra só os campos que lhe pertencem — pedir «área
 * de atuação» a uma pessoa é ruído, e pedir «nome do representante» a uma
 * empresa é confusão. A transição é animada (`.fade-in`, 0,3 s) para o bloco
 * não parecer que saltou.
 *
 * A província é obrigatória nos dois casos: é ela que decide qual gestor
 * recebe a solicitação. Sem província, a candidatura não teria dono.
 */
export default function FormularioRevendedor({ provincias }: { provincias: Provincia[] }) {
  const [tipo, setTipo] = useState<Tipo>("empresa");

  const [nomeIndividual, setNomeIndividual] = useState("");
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [telefone, setTelefone] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");
  const [provincia, setProvincia] = useState("");
  const [area, setArea] = useState("");
  const [representante, setRepresentante] = useState("");
  const [mensagem, setMensagem] = useState("");

  const [falha, setFalha] = useState<Falha | null>(null);
  const [erro, setErro] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [recibo, setRecibo] = useState<{ referencia: string; repetido: boolean } | null>(null);

  const nome = tipo === "empresa" ? nomeEmpresa : nomeIndividual;
  const definirNome = tipo === "empresa" ? setNomeEmpresa : setNomeIndividual;

  function trocarTipo(novo: Tipo) {
    if (novo === tipo) return;
    setTipo(novo);
    setFalha(null);
    setErro("");
  }

  /** Devolve a primeira falha encontrada, com o campo a que pertence. */
  function validar(): Falha | null {
    if (nome.trim().length < 2) {
      return {
        campo: "nome",
        texto:
          tipo === "empresa"
            ? "Indique o nome da empresa."
            : "Indique o seu nome completo.",
      };
    }
    if (!normalizePhone(telefone)) {
      return { campo: "telefone", texto: "Indique um número de telefone válido." };
    }
    if (nif.trim().length < 4) {
      return {
        campo: "nif",
        texto: tipo === "empresa" ? "Indique o NIF da empresa." : "Indique o número do NIF ou do BI.",
      };
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return { campo: "email", texto: "O e-mail indicado não é válido." };
    }
    if (!provincia) {
      return { campo: "provincia", texto: "Escolha a província onde pretende revender." };
    }
    return null;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");

    const problema = validar();
    if (problema) {
      setFalha(problema);
      document.getElementById(problema.campo)?.focus();
      return;
    }
    setFalha(null);

    setAEnviar(true);
    try {
      const resposta = await fetch("/api/revendedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          full_name: nome.trim(),
          phone: normalizePhone(telefone),
          email: email.trim() || null,
          nif: nif.trim(),
          area_atuacao: tipo === "empresa" ? area.trim() || null : null,
          representante: tipo === "empresa" ? representante.trim() || null : null,
          provincia_id: provincia,
          message: mensagem.trim() || null,
          source: "site",
        }),
      });

      const dados = (await resposta.json()) as {
        ok?: boolean;
        error?: string;
        referencia?: string;
        repetido?: boolean;
      };
      if (!resposta.ok) throw new Error(dados.error ?? "Não foi possível enviar.");

      setRecibo({
        referencia: dados.referencia ?? "",
        repetido: Boolean(dados.repetido),
      });
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente."
      );
    } finally {
      setAEnviar(false);
    }
  }

  function recomecar() {
    setRecibo(null);
    setNomeIndividual("");
    setNomeEmpresa("");
    setTelefone("");
    setNif("");
    setEmail("");
    setProvincia("");
    setArea("");
    setRepresentante("");
    setMensagem("");
    setFalha(null);
    setErro("");
  }

  if (recibo) {
    return (
      <Confirmacao
        referencia={recibo.referencia}
        repetido={recibo.repetido}
        tipo={tipo}
        provincia={provincias.find((p) => p.id === provincia)?.nome ?? null}
        onRecomecar={recomecar}
      />
    );
  }

  return (
    <form
      onSubmit={enviar}
      noValidate
      className="overflow-hidden rounded-2xl border border-[#242424] bg-gradient-to-b from-[#151515] to-[#101010] shadow-[0_24px_60px_-40px_rgba(0,0,0,0.9)]"
    >
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9A962]/60 to-transparent" />

      <div className="p-6 sm:p-8">
        <header>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
            Candidatura
          </p>
          <h2 className="mt-2 text-xl font-light tracking-tight text-[#F5F5F5] sm:text-2xl">
            Ser revendedor INUKA
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-[#8A8A8A]">
            Escolha o tipo de registo e preencha os dados. A gestão da sua província recebe
            a solicitação e responde pelo número indicado.
          </p>
        </header>

        {/* ---------------------------------------------------- TIPO DE REGISTO */}
        <fieldset className="mt-7">
          <legend className="mb-3 flex w-full items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#6F6F6F]">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-[#333] text-[9px] text-[#C9A962]">
              1
            </span>
            Tipo de registo
          </legend>

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de registo">
            <CartaoTipo
              ativo={tipo === "pessoa"}
              onClick={() => trocarTipo("pessoa")}
              icone={<User className="h-4 w-4" />}
              titulo="Individual"
              texto="Para pessoas singulares"
            />
            <CartaoTipo
              ativo={tipo === "empresa"}
              onClick={() => trocarTipo("empresa")}
              icone={<Building2 className="h-4 w-4" />}
              titulo="Empresarial"
              texto="Para empresas e organizações"
            />
          </div>
        </fieldset>

        {/* --------------------------------------------------------- FORMULÁRIO */}
        <div key={tipo} className="fade-in">
          <div className="mt-7 flex items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-[#333] text-[9px] text-[#C9A962]">
              2
            </span>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#6F6F6F]">
              {tipo === "empresa" ? "Dados da empresa" : "Dados pessoais"}
            </p>
            <span className="h-px flex-1 bg-[#242424]" />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Campo
              id="nome"
              rotulo={tipo === "empresa" ? "Nome da empresa" : "Nome completo"}
              obrigatorio
              icone={tipo === "empresa" ? <Building2 className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
              invalido={falha?.campo === "nome"}
              className="sm:col-span-2"
            >
              <input
                id="nome"
                value={nome}
                onChange={(e) => definirNome(e.target.value)}
                autoComplete={tipo === "empresa" ? "organization" : "name"}
                placeholder={tipo === "empresa" ? "Ex.: Kianda Comércio, Lda." : "Ex.: Ana Manuel Domingos"}
                aria-invalid={falha?.campo === "nome"}
                className={`${CAMPO} ${falha?.campo === "nome" ? CAMPO_MAU : CAMPO_OK}`}
              />
            </Campo>

            <Campo
              id="telefone"
              rotulo="Número de telefone"
              obrigatorio
              icone={<Phone className="h-3 w-3" />}
              invalido={falha?.campo === "telefone"}
            >
              <input
                id="telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+244 9xx xxx xxx"
                aria-invalid={falha?.campo === "telefone"}
                className={`${CAMPO} ${falha?.campo === "telefone" ? CAMPO_MAU : CAMPO_OK}`}
              />
            </Campo>

            <Campo
              id="nif"
              rotulo={tipo === "empresa" ? "NIF" : "NIF ou BI"}
              obrigatorio
              icone={<FileText className="h-3 w-3" />}
              invalido={falha?.campo === "nif"}
            >
              <input
                id="nif"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                placeholder={tipo === "empresa" ? "NIF da empresa" : "Nº do BI ou do NIF"}
                aria-invalid={falha?.campo === "nif"}
                className={`${CAMPO} ${falha?.campo === "nif" ? CAMPO_MAU : CAMPO_OK}`}
              />
            </Campo>

            {tipo === "empresa" && (
              <>
                <Campo
                  id="area"
                  rotulo="Área de atuação"
                  icone={<Briefcase className="h-3 w-3" />}
                >
                  <input
                    id="area"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder="Ex.: retalho, cosmética, salão"
                    className={`${CAMPO} ${CAMPO_OK}`}
                  />
                </Campo>

                <Campo
                  id="representante"
                  rotulo="Proprietário / representante"
                  icone={<UserRound className="h-3 w-3" />}
                >
                  <input
                    id="representante"
                    value={representante}
                    onChange={(e) => setRepresentante(e.target.value)}
                    autoComplete="name"
                    placeholder="Nome de quem representa a empresa"
                    className={`${CAMPO} ${CAMPO_OK}`}
                  />
                </Campo>
              </>
            )}

            <Campo
              id="email"
              rotulo="E-mail"
              icone={<Mail className="h-3 w-3" />}
              invalido={falha?.campo === "email"}
            >
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="nome@empresa.ao"
                aria-invalid={falha?.campo === "email"}
                className={`${CAMPO} ${falha?.campo === "email" ? CAMPO_MAU : CAMPO_OK}`}
              />
            </Campo>

            <Campo
              id="provincia"
              rotulo="Província"
              obrigatorio
              icone={<MapPin className="h-3 w-3" />}
              invalido={falha?.campo === "provincia"}
              dica="Define o gestor que recebe a sua solicitação."
            >
              <select
                id="provincia"
                value={provincia}
                onChange={(e) => setProvincia(e.target.value)}
                aria-invalid={falha?.campo === "provincia"}
                className={`${CAMPO} ${falha?.campo === "provincia" ? CAMPO_MAU : CAMPO_OK} ${
                  provincia ? "text-[#F5F5F5]" : "text-[#6F6F6F]"
                }`}
              >
                <option value="">Selecionar província</option>
                {provincias.map((p) => (
                  <option key={p.id} value={p.id} className="text-[#F5F5F5]">
                    {p.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              id="mensagem"
              rotulo="Mensagem"
              icone={<MessageSquare className="h-3 w-3" />}
              className="sm:col-span-2"
            >
              <textarea
                id="mensagem"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={3}
                maxLength={800}
                placeholder={
                  tipo === "empresa"
                    ? "Ex.: loja em Luanda, 40 unidades por mês, queremos revender perfumes e óleos."
                    : "Ex.: revendo porta-a-porta no Uíge, cerca de 20 unidades por mês."
                }
                className={`${CAMPO} resize-y ${CAMPO_OK}`}
              />
            </Campo>
          </div>
        </div>

        {(falha || erro) && (
          <p
            role="alert"
            className="fade-in mt-5 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3.5 py-2.5 text-xs leading-relaxed text-[#F87171]"
          >
            {falha?.texto ?? erro}
          </p>
        )}

        <button
          type="submit"
          disabled={aEnviar}
          className="group mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0A0A0A] transition hover:bg-[#E3D5A7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A962]/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {aEnviar ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {aEnviar ? "A enviar…" : "Enviar solicitação"}
          {!aEnviar && (
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          )}
        </button>

        <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-relaxed text-[#525252]">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Os seus dados são guardados apenas para análise desta solicitação e não são
            partilhados com terceiros. Os campos marcados com{" "}
            <span className="text-[#C9A962]">*</span> são obrigatórios.
          </span>
        </p>
      </div>
    </form>
  );
}

/** Cartão de escolha do tipo de registo. Um `radio` a sério, para teclado e leitor de ecrã. */
function CartaoTipo({
  ativo,
  onClick,
  icone,
  titulo,
  texto,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={onClick}
      className={`group relative flex items-start gap-3 rounded-xl border p-4 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A962]/40 ${
        ativo
          ? "border-[#C9A962]/70 bg-[#C9A962]/[0.08] shadow-[0_10px_30px_-18px_rgba(201,169,98,0.8)]"
          : "border-[#2A2A2A] bg-[#0F0F0F] hover:border-[#C9A962]/40 hover:bg-[#131313]"
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors duration-300 ${
          ativo ? "bg-[#C9A962] text-[#0A0A0A]" : "bg-[#1C1C1C] text-[#C9A962]"
        }`}
      >
        {icone}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
            ativo ? "text-[#E3D5A7]" : "text-[#E5E5E5]"
          }`}
        >
          {titulo}
        </span>
        <span className="mt-1 block text-[11px] leading-snug text-[#8A8A8A]">{texto}</span>
      </span>

      <span
        aria-hidden
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
          ativo ? "border-[#C9A962] bg-[#C9A962]" : "border-[#3A3A3A] bg-transparent"
        }`}
      >
        {ativo && <Check className="h-2.5 w-2.5 text-[#0A0A0A]" strokeWidth={4} />}
      </span>
    </button>
  );
}

/** Rótulo + marca de obrigatório/opcional + o campo. */
function Campo({
  id,
  rotulo,
  obrigatorio,
  icone,
  invalido,
  dica,
  className,
  children,
}: {
  id: string;
  rotulo: string;
  obrigatorio?: boolean;
  icone?: ReactNode;
  invalido?: boolean;
  dica?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8A8A8A]"
      >
        <span className="text-[#6F6F6F]">{icone}</span>
        <span>{rotulo}</span>
        {obrigatorio ? (
          <span className="text-[#C9A962]" aria-label="obrigatório">
            *
          </span>
        ) : (
          <span className="text-[9px] normal-case tracking-normal text-[#4A4A4A]">
            (opcional)
          </span>
        )}
      </label>
      {children}
      {dica && <p className="mt-1 text-[10px] leading-snug text-[#525252]">{dica}</p>}
      {invalido && <p className="mt-1 text-[10px] text-[#F87171]">Verifique este campo.</p>}
    </div>
  );
}

/** Confirmação profissional: referência, tipo, província e o que acontece a seguir. */
function Confirmacao({
  referencia,
  repetido,
  tipo,
  provincia,
  onRecomecar,
}: {
  referencia: string;
  repetido: boolean;
  tipo: Tipo;
  provincia: string | null;
  onRecomecar: () => void;
}) {
  return (
    <div className="fade-in overflow-hidden rounded-2xl border border-[#1F3D2B] bg-gradient-to-b from-[#0F1F16] to-[#0C1810] shadow-[0_24px_60px_-40px_rgba(0,0,0,0.9)]">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9A962]/60 to-transparent" />

      <div className="p-7 text-center sm:p-9">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[#C9A962]/40 bg-[#C9A962]/12 text-[#C9A962]">
          <Check className="h-7 w-7" strokeWidth={2.5} />
        </span>

        <p className="mt-5 text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
          {repetido ? "Solicitação já registada" : "Solicitação recebida"}
        </p>
        <h3 className="mt-2 text-xl font-light text-[#F5F5F5]">
          {repetido ? "Já temos o seu pedido" : "Obrigado. Recebemos os seus dados."}
        </h3>

        <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-[#A3A3A3]">
          {repetido
            ? "Este número já tem uma solicitação em análise. Não precisa de enviar outra — a gestão entra em contacto consigo."
            : "A gestão da sua província vai analisar a solicitação e entrar em contacto pelo número que indicou. Se for aprovada, recebe acesso ao catálogo de grosso."}
        </p>

        <dl className="mx-auto mt-6 max-w-xs divide-y divide-[#1E3A2A] rounded-xl border border-[#1E3A2A] bg-[#0A0A0A]/40 text-left">
          {referencia && (
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-[#6F6F6F]">
                Referência
              </dt>
              <dd className="font-mono text-xs text-[#E3D5A7]">{referencia}</dd>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-2.5">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[#6F6F6F]">Tipo</dt>
            <dd className="text-xs text-[#E5E5E5]">
              {tipo === "empresa" ? "Empresarial" : "Individual"}
            </dd>
          </div>
          {provincia && (
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-[#6F6F6F]">
                Província
              </dt>
              <dd className="text-xs text-[#E5E5E5]">{provincia}</dd>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-2.5">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[#6F6F6F]">Estado</dt>
            <dd className="text-xs text-[#E5E5E5]">
              {repetido ? "Em análise" : "Nova · por contactar"}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onRecomecar}
          className="mt-7 text-[11px] text-[#6F6F6F] underline-offset-4 transition hover:text-[#C9A962] hover:underline"
        >
          Enviar outra solicitação
        </button>
      </div>
    </div>
  );
}
