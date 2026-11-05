import Link from "next/link";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
  Apple,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { lerDefinicoes } from "@/lib/definicoes-server";
import { linkDeDownload, linkValido, origemDoLink } from "@/lib/definicoes";
import { mailHref, telHref, whatsappHref } from "@/lib/contactos";

export const dynamic = "force-dynamic";

/** APK que o site serve sozinho, quando o gestor não indicou outro link. */
const APK_LOCAL = "/downloads/inuka-angola.apk";

/**
 * Tamanho do APK em disco, para o botão dizer o que vai ser descarregado.
 *
 * Num telemóvel com dados caros, «descarregar» sem dizer quanto pesa é um
 * convite a desistir. Se o ficheiro não existir (base sem APK publicado),
 * devolve `null` e a linha desaparece — não se inventa um número.
 */
function tamanhoDoApk(): string | null {
  try {
    const bytes = statSync(resolve(process.cwd(), "public", "downloads", "inuka-angola.apk")).size;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  } catch {
    return null;
  }
}

export default async function DownloadPage() {
  const defs = await lerDefinicoes();

  // O gestor manda: se configurou um link (Drive, Dropbox, TestFlight), é esse
  // que vale. Sem link, o site serve o APK que tem em `public/downloads`.
  const tamanho = tamanhoDoApk();
  const androidBruto = linkValido(defs.androidUrl)
    ? defs.androidUrl
    : tamanho
      ? APK_LOCAL
      : null;

  const androidLink = linkDeDownload(androidBruto);
  const iosLink = linkValido(defs.iosUrl) ? defs.iosUrl : null;
  const iosDescarrega = linkDeDownload(iosLink);

  const tamanhoLegivel = androidBruto === APK_LOCAL ? tamanho : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-14">
      <p className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.28em] text-[#C9A962]">
        <Sparkles className="h-3.5 w-3.5" />
        Aplicações INUKA
      </p>
      <h1 className="max-w-2xl text-3xl font-light leading-tight tracking-tight text-[#F5F5F5] sm:text-4xl">
        A INUKA no teu telemóvel
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#A3A3A3]">
        Instala a aplicação oficial e acompanha as tuas encomendas, as tuas compras e as novidades
        sem abrir o browser. Escolhe o teu sistema.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {/* ------------------------------------------------------------ ANDROID */}
        <section className="flex flex-col rounded-2xl border border-[#2A2A2A] bg-[linear-gradient(160deg,#161616,#0D0D0D)] p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#3A3324] bg-[#1A1710]">
                <Smartphone className="h-5 w-5 text-[#C9A962]" />
              </span>
              <div>
                <h2 className="text-lg font-light text-[#F5F5F5]">Android</h2>
                <p className="text-[11px] uppercase tracking-wider text-[#6F6F6F]">
                  Ficheiro APK · versão {defs.versao}
                </p>
              </div>
            </div>
            {androidLink && (
              <span className="rounded-full border border-[#1F4D2E] bg-[#12291B] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#B9E6C8]">
                disponível
              </span>
            )}
          </div>

          {androidLink ? (
            <>
              <a
                href={androidLink}
                download
                rel="noopener"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] px-5 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
              >
                <Download className="h-4 w-4" />
                Descarregar APK
              </a>
              <p className="mt-2 flex items-center justify-between text-[11px] text-[#5F5F5F]">
                <span>{tamanhoLegivel ? `${tamanhoLegivel} · descarga directa` : "descarga directa"}</span>
                <span>{origemDoLink(androidBruto)}</span>
              </p>
            </>
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-[#333] bg-[#111] p-4">
              <p className="text-sm text-[#A3A3A3]">Ainda não há APK publicado.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#5F5F5F]">
                A gestão coloca o link em Definições. Entretanto, peça a aplicação por WhatsApp.
              </p>
              <a
                href={whatsappHref(defs.telefones[0])}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-semibold text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
              >
                Pedir por WhatsApp
              </a>
            </div>
          )}

          <ol className="mt-5 space-y-2 border-t border-[#242424] pt-4 text-[11px] leading-relaxed text-[#7A7A7A]">
            <li className="flex gap-2">
              <span className="text-[#C9A962]">1.</span> Toque em «Descarregar APK». O ficheiro vai
              para as transferências do telemóvel.
            </li>
            <li className="flex gap-2">
              <span className="text-[#C9A962]">2.</span> Abra-o. Se o Android avisar que a origem não
              é conhecida, permita a instalação para o browser ou gestor de ficheiros.
            </li>
            <li className="flex gap-2">
              <span className="text-[#C9A962]">3.</span> Instalar. A aplicação fica com o ícone
              INUKA no ecrã principal.
            </li>
          </ol>
        </section>

        {/* -------------------------------------------------------------- iPHONE */}
        <section className="flex flex-col rounded-2xl border border-[#2A2A2A] bg-[linear-gradient(160deg,#161616,#0D0D0D)] p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#3A3324] bg-[#1A1710]">
                <Apple className="h-5 w-5 text-[#C9A962]" />
              </span>
              <div>
                <h2 className="text-lg font-light text-[#F5F5F5]">iPhone</h2>
                <p className="text-[11px] uppercase tracking-wider text-[#6F6F6F]">
                  {iosLink ? "Aplicação iOS" : "Instalar pelo Safari"}
                </p>
              </div>
            </div>
            {iosLink && (
              <span className="rounded-full border border-[#1F4D2E] bg-[#12291B] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#B9E6C8]">
                disponível
              </span>
            )}
          </div>

          {iosLink ? (
            <>
              <a
                href={iosDescarrega ?? iosLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A962] px-5 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
              >
                <Download className="h-4 w-4" />
                Instalar no iPhone
              </a>
              <p className="mt-2 flex items-center justify-between text-[11px] text-[#5F5F5F]">
                <span>abre num iPhone ou iPad</span>
                <span>{origemDoLink(iosLink)}</span>
              </p>
            </>
          ) : (
            <div className="mt-6 rounded-lg border border-[#333] bg-[#111] p-4">
              <p className="flex items-center gap-2 text-sm text-[#E5E5E5]">
                <Share2 className="h-4 w-4 text-[#C9A962]" />
                Adicionar ao ecrã principal
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-[#7A7A7A]">
                Abre este site no <strong className="text-[#A3A3A3]">Safari</strong>, toca em
                Partilhar e escolhe «Adicionar ao ecrã principal». Fica com o ícone da INUKA e abre
                como uma aplicação, sem barra do browser.
              </p>
            </div>
          )}

          <ol className="mt-5 space-y-2 border-t border-[#242424] pt-4 text-[11px] leading-relaxed text-[#7A7A7A]">
            <li className="flex gap-2">
              <span className="text-[#C9A962]">1.</span> Use o Safari — no Chrome do iPhone a opção
              «Adicionar ao ecrã principal» não aparece.
            </li>
            <li className="flex gap-2">
              <span className="text-[#C9A962]">2.</span> Toque no botão Partilhar, na barra de baixo.
            </li>
            <li className="flex gap-2">
              <span className="text-[#C9A962]">3.</span> Escolha «Adicionar ao ecrã principal» e
              confirme.
            </li>
          </ol>
        </section>
      </div>

      {/* ------------------------------------------------------------ confiança */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          {
            Icone: ShieldCheck,
            titulo: "Só canais oficiais",
            texto: "Os ficheiros vêm da INUKA. Não instale cópias recebidas por mensagem.",
          },
          {
            Icone: CheckCircle2,
            titulo: `Versão ${defs.versao}`,
            texto: defs.novidades ?? "Sempre a versão mais recente publicada pela gestão.",
          },
          {
            Icone: ExternalLink,
            titulo: "Precisa de ajuda?",
            texto: "Falamos consigo e instalamos passo a passo.",
          },
        ].map(({ Icone, titulo, texto }) => (
          <div key={titulo} className="rounded-xl border border-[#242424] bg-[#121212] p-4">
            <Icone className="h-4 w-4 text-[#C9A962]" />
            <p className="mt-2 text-sm text-[#E5E5E5]">{titulo}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#6F6F6F]">{texto}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262626] bg-[#141414] p-5">
        <div>
          <p className="text-sm text-[#E5E5E5]">Não consegue instalar?</p>
          <p className="mt-1 text-[11px] text-[#6F6F6F]">
            Ligue ou escreva — respondemos em português.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={telHref(defs.telefones[0])}
            className="rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-semibold text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
          >
            {defs.telefones[0]}
          </a>
          <a
            href={mailHref(defs.email)}
            className="rounded-lg border border-[#333] px-4 py-2 text-xs text-[#D4D4D4] transition hover:border-[#C9A962] hover:text-[#C9A962]"
          >
            {defs.email}
          </a>
        </div>
      </div>

      <p className="mt-8 text-xs text-[#525252]">
        Prefere usar no browser?{" "}
        <Link href="/catalogo" className="text-[#C9A962] hover:underline">
          Ver catálogo
          <ArrowRight className="ml-1 inline h-3 w-3" />
        </Link>
      </p>
    </main>
  );
}
