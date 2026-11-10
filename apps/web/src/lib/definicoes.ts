import { EMAIL_INUKA, TELEFONES_INUKA } from "@/lib/contactos";

/**
 * Definições da loja — o que a gerência muda sem tocar em código.
 *
 * Vive numa única linha de `platform_settings` (chave `loja`). Uma chave só,
 * e não uma por campo, porque isto é lido em duas páginas públicas (entrada e
 * área de download) e um conjunto de valores meio actualizado — e-mail novo,
 * link velho — dá a impressão de que nada foi gravado.
 *
 * Este ficheiro é **puro**: pode ser importado por um componente de browser.
 * A leitura e a escrita na base ficam em `definicoes-server.ts`, que usa a
 * chave de serviço e por isso nunca pode chegar ao cliente.
 */

/** Chave em `platform_settings`. */
export const CHAVE_DEFINICOES = "loja";

export interface DefinicoesLoja {
  /** E-mail de atendimento mostrado ao público. */
  email: string;
  /** Números de atendimento, já formatados para leitura. */
  telefones: string[];
  /**
   * Link do APK Android. Pode ser do Google Drive, Dropbox ou um ficheiro
   * servido pelo próprio site (`/downloads/…`).
   */
  androidUrl: string | null;
  /** Link da app iPhone (TestFlight, App Store ou ficheiro `.ipa`). */
  iosUrl: string | null;
  /** Versão mostrada na área de download. */
  versao: string;
  /** Uma linha sobre o que mudou nesta versão. */
  novidades: string | null;
  /** ISO da última gravação, para mostrar «actualizado em». */
  actualizadoEm: string | null;
}

/** Valores de origem, quando a base ainda não tem nada gravado. */
export const DEFINICOES_PADRAO: DefinicoesLoja = {
  email: EMAIL_INUKA,
  telefones: [...TELEFONES_INUKA],
  androidUrl: null,
  iosUrl: null,
  versao: "1.2.2",
  novidades:
    "Uma só Área de Colaborador: dados pessoais, carteira, comissões e levantamentos no mesmo sítio. A app abre logo na sua área. A referência aparece uma vez só. «Ser revendedor» passou a «Ser colaborador».",
  actualizadoEm: null,
};

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t ? t : null;
}

/**
 * Aceita o que vier da base e devolve sempre um objecto completo.
 *
 * Nunca lança: um valor estragado em `platform_settings` não pode deixar a
 * loja sem contactos nem sem área de download.
 */
export function normalizarDefinicoes(valor: unknown): DefinicoesLoja {
  const cru = (valor ?? {}) as Record<string, unknown>;

  const telefones = Array.isArray(cru.telefones)
    ? cru.telefones.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
    : [];

  return {
    email: texto(cru.email) ?? DEFINICOES_PADRAO.email,
    telefones: telefones.length ? telefones : DEFINICOES_PADRAO.telefones,
    androidUrl: texto(cru.androidUrl),
    iosUrl: texto(cru.iosUrl),
    versao: texto(cru.versao) ?? DEFINICOES_PADRAO.versao,
    novidades: texto(cru.novidades),
    actualizadoEm: texto(cru.actualizadoEm),
  };
}

/**
 * Transforma um link de partilha num link que **descarrega**.
 *
 * O gestor vai colar o que tem à mão — normalmente «Partilhar → Copiar link»
 * do Google Drive, que abre uma pré-visualização com botão «Transferir» em vez
 * de descarregar. Quem clica no site quer o ficheiro, não uma página do Drive
 * com outro botão pelo meio.
 *
 *   drive.google.com/file/d/<id>/view   →  drive.google.com/uc?export=download&id=<id>
 *   dropbox.com/s/…?dl=0                →  dropbox.com/s/…?dl=1
 *
 * Tudo o resto passa tal e qual: um `.apk` no próprio site, uma página do
 * TestFlight ou um link da App Store não têm nada a converter.
 */
export function linkDeDownload(url: string | null | undefined): string | null {
  const t = (url ?? "").trim();
  if (!t) return null;

  const drive =
    t.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/) ??
    t.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,})/);
  if (drive) {
    return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  }

  if (/dropbox\.com/.test(t)) {
    return t.includes("dl=0") ? t.replace("dl=0", "dl=1") : t;
  }

  return t;
}

/** Nome curto da origem, para o utilizador saber de onde vem o ficheiro. */
export function origemDoLink(url: string | null | undefined): string {
  const t = (url ?? "").trim();
  if (!t) return "sem link";
  if (t.startsWith("/")) return "Servidor INUKA";
  if (/drive\.google\.com/.test(t)) return "Google Drive";
  if (/dropbox\.com/.test(t)) return "Dropbox";
  if (/testflight\.apple\.com/.test(t)) return "TestFlight";
  if (/apps\.apple\.com/.test(t)) return "App Store";
  if (/github\.com|githubusercontent\.com/.test(t)) return "GitHub";
  try {
    return new URL(t).hostname.replace(/^www\./, "");
  } catch {
    return "link externo";
  }
}

/** Um link só serve se for http(s) ou um caminho do próprio site. */
export function linkValido(url: string | null | undefined): boolean {
  const t = (url ?? "").trim();
  if (!t) return false;
  if (t.startsWith("/")) return true;
  return /^https?:\/\//i.test(t);
}
