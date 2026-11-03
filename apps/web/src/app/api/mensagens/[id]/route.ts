import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { BUCKET_ANEXOS } from "@/lib/chat-shared";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/mensagens/[id]
 *
 * Quem pode apagar: o autor da mensagem ou a gerência.
 *
 * A decisão é tomada com a **sessão do utilizador** (`createClientServer`), não
 * com o `service_role`: a política `messages_delete_sender` já exprime
 * exactamente esta regra (`sender_id = auth.uid() OR is_manager()`). O
 * `service_role` só entra depois, para apagar os ficheiros do bucket — as
 * políticas de Storage não têm DELETE, e sem isto ficavam órfãos.
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

  const { data: mensagem, error: erroLeitura } = await supabase
    .from("messages")
    .select("id, sender_id, conversation_id, anexos:message_attachments(storage_path)")
    .eq("id", id)
    .single();

  if (erroLeitura || !mensagem) {
    return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
  }

  const { data: perfil } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const gestor = (perfil as { role?: string } | null)?.role === "manager";
  const autor = (mensagem as { sender_id: string }).sender_id === user.id;

  if (!gestor && !autor) {
    return NextResponse.json(
      { error: "Só o autor ou a gerência podem apagar esta mensagem." },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const caminhos = ((mensagem as { anexos?: { storage_path: string }[] }).anexos ?? [])
    .map((a) => a.storage_path)
    .filter(Boolean);

  if (caminhos.length > 0) {
    await supabaseAdmin.storage.from(BUCKET_ANEXOS).remove(caminhos);
  }

  return NextResponse.json({ ok: true, anexos: caminhos.length });
}
