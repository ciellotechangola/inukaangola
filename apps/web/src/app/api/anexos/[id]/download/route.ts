import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { BUCKET_ANEXOS } from "@/lib/chat-shared";
import { paraPng } from "@/lib/imagem-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/anexos/[id]/download
 *
 * Guarda um anexo do chat — **imagens sempre em PNG**, o resto no formato
 * original.
 *
 * O cartão do anexo era uma ligação ao URL assinado do bucket. Num telemóvel
 * isso abria a fotografia numa aba nova (o `download` de um `<a>` não vale
 * entre domínios) e o ficheiro nunca chegava à galeria. Passa a sair daqui,
 * com `Content-Disposition: attachment`, para o browser guardar directamente.
 *
 * Quem entra: quem pode ver a mensagem. A leitura é feita com o cliente da
 * **sessão** — a política `message_attachments_select` já diz que só os membros
 * da conversa vêem o anexo. O `service_role` só serve para ir buscar os bytes
 * ao bucket privado, depois de a permissão estar decidida.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Id inválido." }, { status: 400 });
  }

  const supabase = await createClientServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "É necessário iniciar sessão." }, { status: 401 });
  }

  const { data } = await supabase
    .from("message_attachments")
    .select("storage_path, file_name, file_type")
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  }

  const anexo = data as { storage_path: string; file_name: string; file_type: string | null };

  const { data: ficheiro, error } = await supabaseAdmin.storage
    .from(BUCKET_ANEXOS)
    .download(anexo.storage_path);

  if (error || !ficheiro) {
    return NextResponse.json({ error: "Ficheiro indisponível." }, { status: 404 });
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());
  const tipo = anexo.file_type ?? ficheiro.type ?? "application/octet-stream";
  const base = nomeBase(anexo.file_name);

  if (tipo.startsWith("image/")) {
    try {
      return resposta(await paraPng(bytes), "image/png", `${base}.png`);
    } catch {
      // Formato que o conversor não lê: entrega-se a imagem como está.
    }
  }

  return resposta(bytes, tipo, anexo.file_name || `${base}.bin`);
}

function resposta(bytes: Buffer, tipo: string, ficheiro: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename="${ficheiro.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

/** `foto.jpg` → `foto`. O nome antigo não serve: a extensão agora é outra. */
function nomeBase(nome: string): string {
  const semExtensao = (nome || "anexo").replace(/\.[a-z0-9]{1,8}$/i, "");
  const limpo = semExtensao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return limpo || "anexo";
}
