import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { BUCKET_ANEXOS } from "@/lib/chat-shared";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/conversas/[id]
 *
 * Apaga a conversa (directa ou grupo) e tudo o que está dentro dela.
 *
 * **Só a gerência.** `conversations` não tem política de DELETE — ninguém apaga
 * uma conversa pelo cliente, nem o autor. A autorização é verificada aqui com a
 * sessão do utilizador e a eliminação é feita com `service_role`, porque o
 * `ON DELETE CASCADE` trata de `messages`, `conversation_members`,
 * `message_attachments` e `groups`, mas **não** dos ficheiros no Storage.
 *
 * A pasta `<conversaId>/` do bucket é esvaziada antes: depois do DELETE já não
 * haveria como descobrir os caminhos.
 */
export async function DELETE(
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

  const { data: perfil } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if ((perfil as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json(
      { error: "Só a gerência pode apagar conversas." },
      { status: 403 }
    );
  }

  // A gerência lê qualquer conversa (`is_manager()`), mas convém distinguir
  // "não existe" de "sem permissão".
  const { data: conversa } = await supabase
    .from("conversations")
    .select("id, type, title")
    .eq("id", id)
    .single();

  if (!conversa) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  // 1. Ficheiros do bucket (a pasta é o id da conversa).
  let ficheirosApagados = 0;
  const { data: ficheiros } = await supabaseAdmin.storage
    .from(BUCKET_ANEXOS)
    .list(id, { limit: 1000 });

  if (ficheiros && ficheiros.length > 0) {
    const caminhos = ficheiros.map((f) => `${id}/${f.name}`);
    const { error: erroFicheiros } = await supabaseAdmin.storage
      .from(BUCKET_ANEXOS)
      .remove(caminhos);
    if (!erroFicheiros) ficheirosApagados = caminhos.length;
  }

  // 2. A conversa. O CASCADE leva mensagens, membros, anexos e a ficha do grupo.
  const { error } = await supabaseAdmin.from("conversations").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    tipo: (conversa as { type: string }).type,
    ficheiros: ficheirosApagados,
  });
}
