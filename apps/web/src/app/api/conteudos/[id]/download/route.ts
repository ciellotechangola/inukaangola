import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { cartazPng, paraPng } from "@/lib/imagem-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/conteudos/[id]/download
 *
 * Descarrega o que a pessoa está a ver no feed — **sempre em PNG**.
 *
 * A imagem vive num bucket público do Supabase, noutro domínio — o atributo
 * `download` de um `<a>` é ignorado em ligações cross-origin, por isso o
 * browser abria a imagem em vez de a guardar. É preciso servir os bytes daqui,
 * com `Content-Disposition: attachment`.
 *
 * O formato também não é o da origem: uma promoção publicada a partir de uma
 * fotografia em JPEG saía `.jpg` e o comunicado composto saía `.png`. Quem
 * recebe os ficheiros num grupo de WhatsApp ficava com uma pasta misturada.
 * `paraPng` normaliza tudo — e uma publicação sem fotografia (um aviso só de
 * texto) ganha um cartaz PNG com o texto, porque um `.txt` no meio das imagens
 * não serve para reenviar.
 *
 * Quem entra: quem pode ver o conteúdo. A verificação é feita com o cliente
 * da sessão (não com a chave de serviço) para passar pelas políticas — sem
 * ela, o download era uma porta lateral ao RLS: bastava saber o id de um
 * comunicado para o receber, mesmo sendo cliente.
 *
 * **Sem sessão também entra**, desde que a publicação seja pública: o Feed
 * Clientes abre a qualquer visitante (`/feed`) e um botão de descarregar que
 * responde 403 é pior do que não existir. `pode_ver_conteudo` é que decide —
 * com `auth.uid()` nulo só passa promoção e testemunho dentro das datas.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const perfil = await getProfile();
  const { id } = await params;

  // Primeiro procura-se (404 para um id que não existe), depois verifica-se a
  // visibilidade com a sessão de quem pede (403). Ao contrário, um id inventado
  // respondia 403 em vez de 404.
  const { data } = await supabaseAdmin
    .from("content_items")
    .select("title, subtitle, body, image_url, kind, status, published_at")
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "Conteúdo não encontrado." }, { status: 404 });
  }

  const sessao = await createClientServer();
  const { data: podeVer } = await sessao.rpc("pode_ver_conteudo", { p_id: id });
  if (podeVer !== true) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const item = data as {
    title: string;
    subtitle: string | null;
    body: string | null;
    image_url: string | null;
    kind: string | null;
    status: string;
    published_at: string | null;
  };

  if (item.status !== "publicado" && perfil?.role !== "manager") {
    return NextResponse.json({ error: "Conteúdo não publicado." }, { status: 404 });
  }

  const nome = nomeDeFicheiro(item.title);

  // 1. A fotografia da publicação, convertida para PNG.
  if (item.image_url) {
    try {
      const resposta = await fetch(item.image_url, { cache: "no-store" });
      if (resposta.ok) {
        const original = Buffer.from(await resposta.arrayBuffer());
        try {
          const png = await paraPng(original);
          return anexo(png, "image/png", `${nome}.png`);
        } catch {
          // Formato que o conversor não lê: entrega-se tal e qual, com a
          // extensão certa, em vez de um erro.
          const tipo = resposta.headers.get("content-type") ?? "application/octet-stream";
          return anexo(original, tipo, `${nome}.${extensaoDe(tipo)}`);
        }
      }
    } catch {
      // Sem rede para o bucket: cai para o cartaz em vez de dar erro.
    }
  }

  // 2. Sem fotografia (ou bucket fora do ar): cartaz PNG com o texto.
  try {
    const png = await cartazPng({
      tipo: item.kind ?? "inuka",
      titulo: item.title,
      subtitulo: item.subtitle,
      corpo: item.body,
      data: dataCurta(item.published_at),
    });
    return anexo(png, "image/png", `${nome}.png`);
  } catch {
    // 3. Último recurso: o texto simples. Só acontece se o conversor falhar.
  }

  const texto = [item.title, item.subtitle ?? "", "", item.body ?? ""]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return anexo(Buffer.from(`${texto}\n`, "utf8"), "text/plain; charset=utf-8", `${nome}.txt`);
}

/** Bytes em anexo — nunca `inline`: o browser não deve abrir nada. */
function anexo(bytes: Buffer, tipo: string, ficheiro: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename="${ficheiro}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

/** `dd/mm/aaaa` sem depender do locale do servidor. */
function dataCurta(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

/** Nome de ficheiro seguro: sem acentos, sem espaços, sem barras. */
function nomeDeFicheiro(titulo: string): string {
  const limpo = (titulo || "comunicado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return limpo || "comunicado";
}

function extensaoDe(tipo: string): string {
  if (tipo.includes("png")) return "png";
  if (tipo.includes("webp")) return "webp";
  if (tipo.includes("gif")) return "gif";
  if (tipo.includes("svg")) return "svg";
  if (tipo.includes("pdf")) return "pdf";
  return "jpg";
}
