import type { ReactNode } from "react";
import { BadgeCheck, MapPin, Phone } from "lucide-react";
import CopiarReferencia from "./CopiarReferencia";
import FotoPerfil from "./FotoPerfil";
import { iniciais, dataCurta } from "@/lib/colaborador";

/**
 * Cartão de identidade do colaborador.
 *
 * É o primeiro bloco que a pessoa vê ao entrar: nome, fotografia, referência,
 * província, estado, categoria e data de registo. Sem JavaScript o cartão
 * funciona na mesma — a fotografia editável é que precisa dele.
 */
export default function ColaboradorIdentidade({
  nome,
  referencia,
  avatarUrl,
  provincia,
  delegacao,
  telefone,
  categoria,
  funcao,
  desde,
  ativo,
  acoes,
  nota,
  userId,
  podeEditarFoto = false,
}: {
  nome: string;
  referencia: string | null;
  avatarUrl?: string | null;
  provincia: string | null;
  delegacao?: string | null;
  telefone?: string | null;
  categoria?: string | null;
  funcao?: string | null;
  desde?: string | null;
  ativo: boolean;
  acoes?: ReactNode;
  nota?: string;
  /** Sem `userId` a fotografia é só de leitura. */
  userId?: string;
  podeEditarFoto?: boolean;
}) {
  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-[#C9A962]/30 bg-gradient-to-br from-[#1A1A1A] to-[#101010]">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {userId ? (
            <FotoPerfil
              userId={userId}
              nome={nome}
              url={avatarUrl ?? null}
              podeEditar={podeEditarFoto}
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C9A962]/40 bg-[#0A0A0A]">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={nome} className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg font-medium tracking-wide text-[#C9A962]">
                  {iniciais(nome)}
                </span>
              )}
            </div>
          )}

          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
              Bem-vindo à INUKA Angola
            </p>
            <h1 className="truncate text-2xl font-light text-[#F5F5F5]">{nome}</h1>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#A3A3A3]">
              {referencia && (
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono tracking-wider text-[#C9A962]">{referencia}</span>
                  <CopiarReferencia valor={referencia} />
                </span>
              )}
              {provincia && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-[#525252]" />
                  {provincia}
                  {delegacao ? ` · ${delegacao}` : ""}
                </span>
              )}
              {telefone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3 text-[#525252]" />
                  {telefone}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${
                ativo
                  ? "border-[#1F4D2E] bg-[#0F2A18] text-[#4ADE80]"
                  : "border-[#4A2020] bg-[#2A1010] text-[#F87171]"
              }`}
            >
              <BadgeCheck className="h-3 w-3" />
              {ativo ? "Conta ativa" : "Conta inativa"}
            </span>
            {categoria && (
              <span className="rounded-full border border-[#333] px-2.5 py-1 text-[11px] text-[#A3A3A3]">
                {categoria}
              </span>
            )}
            {funcao && (
              <span className="rounded-full border border-[#333] px-2.5 py-1 text-[11px] text-[#A3A3A3]">
                {funcao}
              </span>
            )}
          </div>

          <p className="text-[11px] text-[#525252]">
            {desde ? `Na INUKA desde ${dataCurta(desde)}` : "Data de entrada por registar"}
          </p>

          {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
        </div>
      </div>

      {nota && (
        <div className="border-t border-[#262626] bg-[#0F0F0F] px-6 py-2 text-[11px] text-[#6F6F6F]">
          {nota}
        </div>
      )}
    </section>
  );
}
