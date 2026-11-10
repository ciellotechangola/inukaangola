import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/conteudos/[id]/download
 *
 * Descarrega o que a pessoa está a ver no feed.
 *
 * A imagem vive num bucket público do Supabase, noutro domínio — o atributo
 * `download` de um `<a>` é ignorado em ligações cross-origin, por isso o
 * browser abria a imagem em vez de a guardar. É preciso servir os bytes daqui,
 * com `Content-Disposition: attachment`.
 *
 * Sem imagem (um comunicado só de texto), devolve o texto num `.txt`: quem lê
 * um aviso da gestão pode querer guardá-lo ou reenviá-lo tal e qual.
 *
 * Quem entra: quem tem sessão **e** pode ver o conteúdo. A verificação é feita
 * com o cliente da sessão (não com a chave de serviço) para passar pelas
 * políticas — sem ela, o download era uma porta lateral ao RLS: bastava saber
 * o id de um comunicado para o receber, mesmo sendo cliente.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const perfil = await getProfile();
  if (!perfil) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await params;

  // Primeiro procura-se (404 para um id que não existe), depois verifica-se a
  // visibilidade com a sessão de quem pede (403). Ao contrário, um id inventado
  // respondia 403 em vez de 404.
  const { data } = await supabaseAdmin
    .from("content_items")
    .select("title, subtitle, body, image_url, status, published_at")
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
    status: string;
  };

  if (item.status !== "publicado" && perfil.role !== "manager") {
    return NextResponse.json({ error: "Conteúdo não publicado." }, { status: 404 });
  }

  const nome = nomeDeFicheiro(item.title);

  if (item.image_url) {
    try {
      const resposta = await fetch(item.image_url, { cache: "no-store" });
      if (resposta.ok) {
        const tipo = resposta.headers.get("content-type") ?? "image/jpeg";
        const bytes = Buffer.from(await resposta.arrayBuffer());
        return new NextResponse(bytes, {
          headers: {
            "Content-Type": tipo,
            "Content-Disposition": `attachment; filename="${nome}.${extensaoDe(tipo)}"`,
            "Content-Length": String(bytes.length),
            "Cache-Control": "private, no-store",
          },
        });
      }
    } catch {
      // Sem rede para o bucket: cai para o texto em vez de dar erro.
    }
  }

  const texto = [item.title, item.subtitle ?? "", "", item.body ?? ""]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return new NextResponse(`${texto}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}.txt"`,
      "Cache-Control": "private, no-store",
    },
  });
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
  return "jpg";
}
