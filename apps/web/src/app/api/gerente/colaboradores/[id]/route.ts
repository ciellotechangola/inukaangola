import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { mensagemDeErro } from "@/lib/erros";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/gerente/colaboradores/[id]
 *
 * Apaga o colaborador **e as vendas dele**. É irreversível, por isso o corpo
 * do pedido tem de trazer a referência escrita à mão (`confirmar`) — o botão
 * sozinho não chega.
 *
 * A RPC faz o trabalho todo, incluindo apagar a conta em `auth.users`, e corre
 * com o **JWT do gestor**: ela verifica `is_manager()`, e a chave de serviço
 * não tem `auth.uid()`. Depois, por segurança, confirma-se com a Admin API que
 * a conta desapareceu mesmo — se a base não tiver o schema `auth` acessível,
 * é aqui que o login é cortado.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gestor = await getProfile();
  if (!gestor || gestor.role !== "manager") {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let corpo: Record<string, unknown> = {};
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const confirmar = String(corpo.confirmar ?? "").trim();
  const motivo = String(corpo.motivo ?? "").trim();

  if (!confirmar) {
    return NextResponse.json(
      { error: "Escreva a referência do colaborador para confirmar." },
      { status: 400 }
    );
  }
  if (motivo.length < 3) {
    return NextResponse.json({ error: "Indique o motivo da eliminação." }, { status: 400 });
  }

  const supabase = await createClientServer();

  // A referência escrita tem de bater com a da ficha: é o que impede um clique
  // acidental de apagar a pessoa errada.
  const { data: alvo } = await supabase
    .from("profiles")
    .select("id, referencia, full_name")
    .eq("id", id)
    .maybeSingle();

  if (!alvo) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  const referencia = (alvo as { referencia: string | null }).referencia;
  if (!referencia || confirmar.toUpperCase() !== referencia.toUpperCase()) {
    return NextResponse.json(
      { error: "A referência não coincide. Confirme com o código da ficha." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("eliminar_colaborador", {
    p_id: id,
    p_motivo: motivo,
  });

  if (error) {
    // 42501 = sem permissão · P0002 = não existe. O resto é falha da base.
    const estado = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return NextResponse.json(
      {
        error: mensagemDeErro(
          error,
          "supabase/PATCH_ELIMINAR_COLABORADOR.sql",
          "Não foi possível eliminar o colaborador."
        ),
      },
      { status: estado }
    );
  }

  // Rede de segurança: a RPC já apaga a conta, mas se a base não deixar mexer
  // em `auth.users` a conta ficaria viva sem perfil. Aqui corta-se o login.
  try {
    const { error: erroConta } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (erroConta && !/not found|não encontrad/i.test(erroConta.message)) {
      return NextResponse.json(
        {
          error:
            "O perfil e as vendas foram eliminados, mas a conta de acesso não. " +
            "Tente outra vez: " +
            erroConta.message,
        },
        { status: 500 }
      );
    }
  } catch {
    // A conta já não existe — é o resultado desejado.
  }

  return NextResponse.json({ ok: true, eliminado: data });
}
