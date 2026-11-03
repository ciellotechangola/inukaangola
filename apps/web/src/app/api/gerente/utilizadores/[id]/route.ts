import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/utils";
import { phoneToEmail } from "@/lib/phone-email";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/gerente/utilizadores/[id]
 *
 * Edita os campos que o RLS do browser não deixa mexer em nome de outra
 * pessoa (telefone, que muda o email de login) e a província. O resto —
 * nome, BI, função, comissão — passa pela RPC `atualizar_perfil_colaborador`,
 * que já valida as permissões na base de dados.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gestor = await getProfile();
  if (!gestor || gestor.role !== "manager") {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const { data: alvo } = await supabaseAdmin
    .from("profiles")
    .select("id, role, phone, provincia_id")
    .eq("id", id)
    .maybeSingle();

  if (!alvo) {
    return NextResponse.json({ error: "Utilizador não encontrado." }, { status: 404 });
  }

  const nacional = gestor.is_national_admin || gestor.provincia_id === null;
  const alvoProvincia = (alvo as { provincia_id: string | null }).provincia_id;

  // Um gestor provincial só toca em quem é da sua província.
  if (!nacional && alvoProvincia !== gestor.provincia_id) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const atualizacao: Record<string, unknown> = {};

  if (typeof corpo.full_name === "string") {
    const nome = corpo.full_name.trim();
    if (nome.length < 3) {
      return NextResponse.json(
        { error: "Indique o nome completo (mínimo 3 caracteres)." },
        { status: 400 }
      );
    }
    atualizacao.full_name = nome;
  }

  if (typeof corpo.neighborhood === "string") {
    atualizacao.neighborhood = corpo.neighborhood.trim() || null;
  }

  if (typeof corpo.is_active === "boolean") {
    atualizacao.is_active = corpo.is_active;
  }

  // --- Telefone: muda também o email de login, senão a pessoa deixa de entrar ---
  if (typeof corpo.phone === "string" && corpo.phone.trim()) {
    const telefone = normalizePhone(corpo.phone.trim());
    if (!/^\+244\d{9}$/.test(telefone)) {
      return NextResponse.json(
        { error: "Telefone inválido. Use o formato +244 9xx xxx xxx." },
        { status: 400 }
      );
    }

    if (telefone !== (alvo as { phone: string | null }).phone) {
      const { data: ocupado } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", telefone)
        .neq("id", id)
        .maybeSingle();

      if (ocupado) {
        return NextResponse.json(
          { error: "Esse telefone já pertence a outra conta." },
          { status: 409 }
        );
      }

      const { error: erroAuth } = await supabaseAdmin.auth.admin.updateUserById(id, {
        email: phoneToEmail(telefone),
        email_confirm: true,
        user_metadata: { phone: telefone },
      });

      if (erroAuth) {
        return NextResponse.json(
          { error: "Não foi possível alterar o telefone de acesso." },
          { status: 500 }
        );
      }

      atualizacao.phone = telefone;
      atualizacao.email = phoneToEmail(telefone);
    }
  }

  // --- Província: só a administração nacional ---
  if ("provincia_id" in corpo) {
    if (!nacional) {
      return NextResponse.json(
        { error: "Só a administração nacional muda a província de alguém." },
        { status: 403 }
      );
    }

    const pedida = String(corpo.provincia_id ?? "").trim() || null;
    if (pedida) {
      const { data: prov } = await supabaseAdmin
        .from("provincias")
        .select("id")
        .eq("id", pedida)
        .maybeSingle();
      if (!prov) {
        return NextResponse.json({ error: "Província inválida." }, { status: 400 });
      }
    }

    // O trigger `fill_referencia` troca o prefixo; o número fica.
    atualizacao.provincia_id = pedida;
  }

  if (Object.keys(atualizacao).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("profiles").update(atualizacao).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/gerente/utilizadores/[id]
 *
 * Só apaga contas **sem histórico**. Quem tem vendas, encomendas ou
 * comissões não pode ser apagado sem partir a contabilidade — a base de
 * dados recusa (`sales.seller_id` é RESTRICT) e a resposta diz porquê, em vez
 * de deixar o gestor a olhar para um erro de chave estrangeira.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gestor = await getProfile();
  if (!gestor || gestor.role !== "manager") {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  if (id === gestor.id) {
    return NextResponse.json(
      { error: "Não pode apagar a própria conta." },
      { status: 400 }
    );
  }

  const { data: alvo } = await supabaseAdmin
    .from("profiles")
    .select("id, role, full_name, provincia_id")
    .eq("id", id)
    .maybeSingle();

  if (!alvo) {
    return NextResponse.json({ error: "Utilizador não encontrado." }, { status: 404 });
  }

  const nacional = gestor.is_national_admin || gestor.provincia_id === null;
  const alvoProvincia = (alvo as { provincia_id: string | null }).provincia_id;
  if (!nacional && alvoProvincia !== gestor.provincia_id) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const [{ count: vendas }, { count: encomendas }, { count: comissoes }] = await Promise.all([
    supabaseAdmin.from("sales").select("id", { count: "exact", head: true }).eq("seller_id", id),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id),
    supabaseAdmin.from("sale_commissions").select("id", { count: "exact", head: true }).eq("seller_id", id),
  ]);

  const historico = (vendas ?? 0) + (encomendas ?? 0) + (comissoes ?? 0);
  if (historico > 0) {
    return NextResponse.json(
      {
        error: `Esta conta tem histórico (${vendas ?? 0} vendas, ${encomendas ?? 0} encomendas, ${
          comissoes ?? 0
        } comissões) e não pode ser apagada. Desative o acesso — o histórico mantém-se intacto.`,
      },
      { status: 409 }
    );
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
