"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Truck } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import {
  CHAVE_DEFINICOES,
  linkDeDownload,
  linkValido,
  origemDoLink,
  type DefinicoesLoja,
} from "@/lib/definicoes";
import {
  CHAVE_ENTREGA,
  normalizarEntrega,
  resumoEntrega,
  type DefinicoesEntrega,
} from "@/lib/entrega";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

interface Props {
  iniciais: DefinicoesLoja;
  entregaInicial: DefinicoesEntrega;
  /** Províncias activas, para escolher onde a entrega é gratuita. */
  provincias: { slug: string; nome: string }[];
}

/**
 * Formulário das definições da loja.
 *
 * Grava em duas linhas de `platform_settings` (chaves `loja` e `entrega`):
 * cada assunto num valor só, para a loja nunca ficar a mostrar metade de uma
 * alteração.
 */
export default function FormularioDefinicoes({
  iniciais,
  entregaInicial,
  provincias,
}: Props) {
  const router = useRouter();

  const [email, setEmail] = useState(iniciais.email);
  const [telefones, setTelefones] = useState(iniciais.telefones.join("\n"));
  const [androidUrl, setAndroidUrl] = useState(iniciais.androidUrl ?? "");
  const [iosUrl, setIosUrl] = useState(iniciais.iosUrl ?? "");
  const [versao, setVersao] = useState(iniciais.versao);
  const [novidades, setNovidades] = useState(iniciais.novidades ?? "");

  const [taxaPadrao, setTaxaPadrao] = useState(String(entregaInicial.taxaPadrao));
  const [gratis, setGratis] = useState<string[]>(entregaInicial.gratis);
  const [nota, setNota] = useState(entregaInicial.nota ?? "");

  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aGravar, setAGravar] = useState(false);

  const androidDirecto = linkDeDownload(androidUrl);
  const iosDirecto = linkDeDownload(iosUrl);

  const entregaPrevia = normalizarEntrega({
    taxaPadrao,
    gratis,
    nota,
  });
  const nomesGratis = gratis
    .map((s) => provincias.find((p) => p.slug === s)?.nome)
    .filter((n): n is string => Boolean(n));

  function alternarGratis(slug: string) {
    setGratis((atual) =>
      atual.includes(slug) ? atual.filter((s) => s !== slug) : [...atual, slug]
    );
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");

    const lista = telefones
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setErro("E-mail inválido.");
      return;
    }
    if (!lista.length) {
      setErro("Indique pelo menos um telefone de atendimento.");
      return;
    }
    if (lista.some((t) => t.replace(/\D/g, "").length < 9)) {
      setErro("Um dos telefones tem poucos dígitos. Use +244 9xx xxx xxx.");
      return;
    }
    for (const [campo, valor] of [
      ["Android", androidUrl],
      ["iPhone", iosUrl],
    ] as const) {
      if (valor.trim() && !linkValido(valor.trim())) {
        setErro(`O link de ${campo} tem de começar por https:// (ou / para um ficheiro do site).`);
        return;
      }
    }

    const taxa = Number(String(taxaPadrao).replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(taxa) || taxa < 0) {
      setErro("A taxa de entrega tem de ser um número igual ou superior a zero.");
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { data: sessao } = await supabase.auth.getUser();
    const agora = new Date().toISOString();
    const autor = sessao.user?.id ?? null;

    const { error: erroLoja } = await supabase.from("platform_settings").upsert(
      {
        key: CHAVE_DEFINICOES,
        value: {
          email: email.trim(),
          telefones: lista,
          androidUrl: androidUrl.trim() || null,
          iosUrl: iosUrl.trim() || null,
          versao: versao.trim() || "1.0.0",
          novidades: novidades.trim() || null,
        },
        updated_by: autor,
        updated_at: agora,
      },
      { onConflict: "key" }
    );

    if (erroLoja) {
      setAGravar(false);
      setErro(erroLoja.message);
      return;
    }

    const { error: erroEntrega } = await supabase.from("platform_settings").upsert(
      {
        key: CHAVE_ENTREGA,
        value: {
          taxaPadrao: Math.round(taxa),
          gratis,
          nota: nota.trim() || null,
        },
        updated_by: autor,
        updated_at: agora,
      },
      { onConflict: "key" }
    );

    setAGravar(false);
    if (erroEntrega) {
      setErro(erroEntrega.message);
      return;
    }
    setAviso("Definições guardadas. A loja já mostra estes valores.");
    router.refresh();
  }

  return (
    <form onSubmit={guardar} className="space-y-6">
      {erro && (
        <div className="rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="rounded-lg border border-[#1F4D2E] bg-[#12291B] p-3 text-sm text-[#B9E6C8]">
          {aviso}
        </div>
      )}

      {/* --------------------------------------------------------- contactos */}
      <section className="rounded-xl border border-[#262626] bg-[#141414] p-5">
        <h2 className="mb-1 text-sm font-medium text-[#F5F5F5]">Contactos</h2>
        <p className="mb-4 text-[11px] text-[#6F6F6F]">
          Aparecem na página de contactos, no rodapé e na área de download.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={ROTULO} htmlFor="email">
              E-mail de atendimento
            </label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="inukaangolaa@gmail.com"
              className={ENTRADA}
              required
            />
          </div>
          <div>
            <label className={ROTULO} htmlFor="telefones">
              Telefones (um por linha)
            </label>
            <textarea
              id="telefones"
              value={telefones}
              onChange={(e) => setTelefones(e.target.value)}
              rows={2}
              placeholder={"+244 927 991 441\n+244 930 800 698"}
              className={ENTRADA}
              required
            />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- aplicações */}
      <section className="rounded-xl border border-[#262626] bg-[#141414] p-5">
        <h2 className="mb-1 text-sm font-medium text-[#F5F5F5]">Aplicações para descarregar</h2>
        <p className="mb-4 text-[11px] leading-relaxed text-[#6F6F6F]">
          Cole aqui o link do Google Drive, Dropbox, TestFlight ou de um ficheiro no próprio site. Um
          link de partilha do Drive é convertido sozinho em descarga directa — não precisa de mexer
          em nada.
        </p>

        <div className="space-y-4">
          <div>
            <label className={ROTULO} htmlFor="android">
              APK Android
            </label>
            <input
              id="android"
              value={androidUrl}
              onChange={(e) => setAndroidUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
              className={ENTRADA}
            />
            <LinhaLink url={androidUrl} directo={androidDirecto} />
            <p className="mt-1 text-[11px] text-[#525252]">
              Vazio = o site serve o APK que tem em <code>public/downloads/inuka-angola.apk</code>,
              quando existir.
            </p>
          </div>

          <div>
            <label className={ROTULO} htmlFor="ios">
              iPhone (TestFlight, App Store ou .ipa)
            </label>
            <input
              id="ios"
              value={iosUrl}
              onChange={(e) => setIosUrl(e.target.value)}
              placeholder="https://testflight.apple.com/join/…"
              className={ENTRADA}
            />
            <LinhaLink url={iosUrl} directo={iosDirecto} />
            <p className="mt-1 text-[11px] text-[#525252]">
              Vazio = a área de download ensina a instalar pelo Safari («Adicionar ao ecrã
              principal»).
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div>
              <label className={ROTULO} htmlFor="versao">
                Versão
              </label>
              <input
                id="versao"
                value={versao}
                onChange={(e) => setVersao(e.target.value)}
                placeholder="1.0.3"
                className={ENTRADA}
              />
            </div>
            <div>
              <label className={ROTULO} htmlFor="novidades">
                O que mudou (opcional)
              </label>
              <input
                id="novidades"
                value={novidades}
                onChange={(e) => setNovidades(e.target.value)}
                placeholder="Compras do cliente, carteira do colaborador…"
                className={ENTRADA}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- entrega */}
      <section className="rounded-xl border border-[#262626] bg-[#141414] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
          <Truck className="h-4 w-4 text-[#C9A962]" />
          Taxa de entrega
        </h2>
        <p className="mb-4 text-[11px] leading-relaxed text-[#6F6F6F]">
          A entrega ao domicílio é gratuita nas províncias assinaladas e paga nas restantes. O
          levantamento na delegação nunca tem taxa.
        </p>

        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <div>
            <label className={ROTULO} htmlFor="taxa">
              Taxa padrão (Kz)
            </label>
            <input
              id="taxa"
              value={taxaPadrao}
              onChange={(e) => setTaxaPadrao(e.target.value)}
              inputMode="numeric"
              placeholder="2000"
              className={ENTRADA}
            />
            <p className="mt-1 text-[11px] text-[#525252]">0 = entrega grátis em todo o país.</p>
          </div>
          <div>
            <label className={ROTULO} htmlFor="nota-entrega">
              Nota para o cliente (opcional)
            </label>
            <input
              id="nota-entrega"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Entrega em 24 a 48 horas úteis"
              className={ENTRADA}
            />
            <p className="mt-1 text-[11px] text-[#525252]">
              Aparece no carrinho, junto à taxa.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className={ROTULO}>Entrega gratuita em</p>
          <div className="mt-1 grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] p-2.5 sm:grid-cols-3">
            {provincias.map((p) => {
              const marcada = gratis.includes(p.slug);
              return (
                <label
                  key={p.slug}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                    marcada
                      ? "bg-[#C9A962]/10 text-[#C9A962]"
                      : "text-[#A3A3A3] hover:bg-[#1A1A1A]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={marcada}
                    onChange={() => alternarGratis(p.slug)}
                    className="accent-[#C9A962]"
                  />
                  {p.nome}
                </label>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[#C9A962]/25 bg-[#0F0F0F] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[#6F6F6F]">Como o cliente vê</p>
          <p className="mt-1 text-xs text-[#E5E5E5]">
            {resumoEntrega(entregaPrevia, nomesGratis)}
          </p>
          {entregaPrevia.gratis.length === 0 && entregaPrevia.taxaPadrao > 0 && (
            <p className="mt-1 text-[11px] text-[#F59E0B]">
              Nenhuma província isenta: toda a entrega é paga.
            </p>
          )}
          {entregaPrevia.taxaPadrao <= 0 && (
            <p className="mt-1 text-[11px] text-[#F59E0B]">
              Taxa a zero: a entrega fica gratuita em todo o país.
            </p>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[#525252]">
          A taxa é somada ao total da encomenda pelo servidor, a partir da província do perfil do
          cliente — não vem do browser, por isso não pode ser alterada por quem compra.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={aGravar}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
        >
          {aGravar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {aGravar ? "A guardar…" : "Guardar definições"}
        </button>
        <a
          href="/download"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[#A3A3A3] transition hover:text-[#C9A962]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Ver a área de download
        </a>
      </div>
    </form>
  );
}

/** Mostra como o link vai ficar depois de normalizado — antes de gravar. */
function LinhaLink({ url, directo }: { url: string; directo: string | null }) {
  if (!url.trim()) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-[#5F5F5F]">
      <span className="text-[#C9A962]">{origemDoLink(url)}</span>
      {directo && directo !== url.trim() ? (
        <span className="truncate">→ descarrega por {directo.slice(0, 60)}…</span>
      ) : (
        <span>→ abre directamente</span>
      )}
    </p>
  );
}
