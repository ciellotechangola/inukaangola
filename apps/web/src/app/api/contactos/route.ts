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
 *   revendedor  → o gestor ligado à sua província + o Gestor Máximo
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
  /** Ordem de apresentação, quando a lista tem uma ordem de negócio. */
  let ordem: string[] = [];

  if (papel === "manager") {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .neq("id", user.id)
      .neq("is_active", false);
    for (const p of data ?? []) ids.add((p as { id: string }).id);
  } else if (papel === "reseller") {
    // O revendedor fala com duas pessoas: o **gestor ligado à sua província** e
    // o **Gestor Máximo**. Não é a lista toda da gestão — um revendedor não tem
    // nada a tratar com o gerente de outra província, e uma lista de vinte
    // nomes não é um contacto, é um directório.
    const { data: euRev } = await supabaseAdmin
      .from("revendedores")
      .select("id, provincia_id, manager_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: meuPerfil } = await supabaseAdmin
      .from("profiles")
      .select("provincia_id")
      .eq("id", user.id)
      .maybeSingle();

    const ficha = euRev as
      | { id: string; provincia_id: string | null; manager_id: string | null }
      | null;

    // A província vem da ficha de revendedor; o perfil serve de rede quando a
    // ficha não a tem (revendedor criado ao balcão sem província escolhida).
    const minhaProvincia =
      ficha?.provincia_id ??
      (meuPerfil as { provincia_id: string | null } | null)?.provincia_id ??
      null;
    const gerenteDirecto = ficha?.manager_id ?? null;

    const { data: gestores } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, provincia_id, is_national_admin, created_at")
      .eq("role", "manager")
      .neq("id", user.id)
      .neq("is_active", false)
      .order("created_at");

    const lista = (gestores ?? []) as {
      id: string;
      full_name: string | null;
      provincia_id: string | null;
      is_national_admin: boolean;
    }[];

    const eNacional = (g: (typeof lista)[number]) =>
      g.is_national_admin || g.provincia_id === null;

    // 1. O gestor da província: quem já acompanha a ficha manda; senão, o
    //    gerente **provincial** (não nacional) da província do revendedor.
    const provincial =
      lista.find((g) => g.id === gerenteDirecto) ??
      lista.find((g) => !eNacional(g) && g.provincia_id === minhaProvincia) ??
      null;

    if (provincial) ids.add(provincial.id);

    // 2. O Gestor Máximo — a administração nacional. Um revendedor pode
    //    precisar de condições especiais, e é lá que se decidem.
    for (const g of lista) if (eNacional(g)) ids.add(g.id);

    // Província sem gerente e sem administração marcada: mais vale dar a
    // gestão toda do que deixar o revendedor sem ninguém com quem falar.
    if (ids.size === 0) for (const g of lista) ids.add(g.id);

    // O dia-a-dia primeiro, as decisões depois.
    ordem = [
      ...(provincial ? [provincial.id] : []),
      ...lista.filter((g) => eNacional(g) && g.id !== provincial?.id).map((g) => g.id),
    ];
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

  const contactos = (perfis ?? []) as { id: string; full_name: string | null; role: string }[];

  // O revendedor tem uma ordem de negócio, não alfabética: primeiro quem lhe
  // responde no dia-a-dia, depois quem decide. O resto fica por papel e nome.
  if (ordem.length > 0) {
    const posicao = new Map(ordem.map((id, i) => [id, i]));
    contactos.sort((a, b) => {
      const pa = posicao.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const pb = posicao.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
  }

  return NextResponse.json({ contactos });
}
