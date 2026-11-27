import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/contactos
 *
 * Quem pode esta pessoa iniciar uma conversa?
 *
 * Porque é que isto vive no servidor?
 * O `profiles_select` só deixa ver o perfil de quem já partilha uma conversa
 * (ou, ao colaborador, os seus clientes). Isso é correcto — mas torna
 * impossível *começar* uma conversa, porque para chamar
 * `get_or_create_direct_conversation` é preciso o uuid do destinatário e o
 * cliente não o consegue ler.
 *
 * A regra de negócio é decidida aqui, com o `service_role`, e devolve-se só o
 * mínimo (id, nome, papel) — nunca telefone, email ou morada.
 *
 *   gestor      → toda a gente activa
 *   colaborador → os seus clientes + a gerência
 *   cliente     → o seu colaborador + a gerência
 */
export async function GET() {
  const supabase = await createClientServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "É necessário iniciar sessão." }, { status: 401 });
  }

  const { data: eu } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!eu) {
    return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
  }

  const papel = (eu as { role: string }).role;
  const ids = new Set<string>();

  if (papel === "manager") {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .neq("id", user.id)
      .neq("is_active", false);
    for (const p of data ?? []) ids.add((p as { id: string }).id);
  } else if (papel === "reseller") {
    // O revendedor fala com a gestão: o gerente da sua província e a
    // administração nacional. Não precisa de ver os gestores das outras
    // províncias — cada um responde pelo seu território.
    const { data: euRev } = await supabaseAdmin
      .from("revendedores")
      .select("provincia_id, manager_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const minhaProvincia = (euRev as { provincia_id: string | null } | null)?.provincia_id ?? null;
    const gerenteDirecto = (euRev as { manager_id: string | null } | null)?.manager_id ?? null;

    const { data: gestores } = await supabaseAdmin
      .from("profiles")
      .select("id, provincia_id, is_national_admin")
      .eq("role", "manager")
      .neq("id", user.id)
      .neq("is_active", false);

    for (const g of gestores ?? []) {
      const linha = g as { id: string; provincia_id: string | null; is_national_admin: boolean };
      const nacional = linha.is_national_admin || linha.provincia_id === null;
      if (nacional || linha.id === gerenteDirecto || linha.provincia_id === minhaProvincia) {
        ids.add(linha.id);
      }
    }
  } else {
    // A gerência está sempre disponível para todos.
    const { data: gestores } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("role", "manager")
      .neq("id", user.id);
    for (const p of gestores ?? []) ids.add((p as { id: string }).id);

    if (papel === "seller") {
      const { data: vinculos } = await supabaseAdmin
        .from("seller_customers")
        .select("customer_id")
        .eq("seller_id", user.id)
        .eq("is_active", true);
      for (const v of vinculos ?? []) ids.add((v as { customer_id: string }).customer_id);
    } else {
      const { data: vinculos } = await supabaseAdmin
        .from("seller_customers")
        .select("seller_id")
        .eq("customer_id", user.id)
        .eq("is_active", true);
      for (const v of vinculos ?? []) ids.add((v as { seller_id: string }).seller_id);
    }
  }

  if (ids.size === 0) {
    return NextResponse.json({ contactos: [] });
  }

  const { data: perfis, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .in("id", [...ids])
    .neq("is_active", false)
    .order("role")
    .order("full_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contactos: perfis ?? [] });
}
