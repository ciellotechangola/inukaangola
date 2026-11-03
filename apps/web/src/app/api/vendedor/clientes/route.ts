import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/utils";
import { phoneToEmail } from "@/lib/phone-email";

export const dynamic = "force-dynamic";

/**
 * POST /api/vendedor/clientes
 *
 * O colaborador acrescenta um cliente à sua carteira quando a pessoa ainda não
 * tem conta. Faz-se no servidor porque criar um utilizador exige a Admin API
 * (`auth.admin.createUser`, só com `service_role`) — a chave nunca vai para o
 * browser.
 *
 * Duas regras que não são negociáveis:
 *  - a província do cliente é a do colaborador que o cria. Um colaborador não
 *    pode semear clientes noutra província (a separação provincial é o que
 *    impede duas delegações de mexerem no mesmo cliente);
 *  - o papel é sempre `customer`. Um colaborador não cria colegas.
 *
 * O vínculo é escrito aqui, e não numa segunda chamada do cliente, para não
 * ficar uma conta criada sem carteira se a rede cair a meio.
 */

/** Palavra-passe provisória legível ao telefone: INUKA + 6 dígitos. */
function palavraProvisoria(): string {
  const digitos = Math.floor(100000 + Math.random() * 900000);
  return `INUKA${digitos}`;
}

export async function POST(request: Request) {
  const perfil = await getProfile();
  if (!perfil || (perfil.role !== "seller" && perfil.role !== "manager")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const full_name = String(corpo.full_name ?? "").trim();
  const rawPhone = String(corpo.phone ?? "").trim();
  const neighborhood = String(corpo.neighborhood ?? "").trim();

  if (full_name.length < 3) {
    return NextResponse.json(
      { error: "Indique o nome do cliente (mínimo 3 caracteres)." },
      { status: 400 }
    );
  }

  const phone = normalizePhone(rawPhone);
  if (!/^\+244\d{9}$/.test(phone)) {
    return NextResponse.json(
      { error: "Telefone inválido. Use o formato +244 9xx xxx xxx." },
      { status: 400 }
    );
  }

  // Um gestor pode indicar a província; um colaborador fica sempre na dele.
  let provinciaId: string | null = perfil.provincia_id;
  if (perfil.role === "manager") {
    const pedida = String(corpo.provincia_id ?? "").trim();
    if (pedida) provinciaId = pedida;
  }

  const { data: provincia } = provinciaId
    ? await supabaseAdmin
        .from("provincias")
        .select("slug, nome")
        .eq("id", provinciaId)
        .maybeSingle()
    : { data: null };

  // --- Telefone já tem conta? Então não se cria outra: faz-se o vínculo. ---
  const { data: existente } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .eq("phone", phone)
    .maybeSingle();

  if (existente) {
    const alvo = existente as { id: string; full_name: string; role: string };
    if (alvo.role !== "customer") {
      return NextResponse.json(
        { error: "Este telefone pertence a uma conta interna (colaborador ou gestão)." },
        { status: 409 }
      );
    }

    const { data: outro } = await supabaseAdmin
      .from("seller_customers")
      .select("seller_id")
      .eq("customer_id", alvo.id)
      .eq("is_active", true)
      .neq("seller_id", perfil.id)
      .maybeSingle();

    if (outro) {
      return NextResponse.json(
        {
          error:
            "Este cliente já está na carteira de outro colaborador. Peça a transferência à gestão.",
        },
        { status: 409 }
      );
    }

    const { error: erroVinculo } = await supabaseAdmin
      .from("seller_customers")
      .upsert(
        { seller_id: perfil.id, customer_id: alvo.id, assigned_by: perfil.id, is_active: true },
        { onConflict: "seller_id,customer_id" }
      );

    if (erroVinculo) {
      return NextResponse.json({ error: erroVinculo.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      existente: true,
      id: alvo.id,
      nome: alvo.full_name,
      telefone: phone,
    });
  }

  // --- Conta nova ---
  const password = palavraProvisoria();

  const { data: criado, error: erroConta } = await supabaseAdmin.auth.admin.createUser({
    email: phoneToEmail(phone),
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      phone,
      neighborhood,
      ...(provincia?.slug ? { provincia_slug: provincia.slug } : {}),
    },
  });

  if (erroConta || !criado?.user) {
    if (/already|exists|registered/i.test(erroConta?.message ?? "")) {
      return NextResponse.json({ error: "Este telefone já tem conta." }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Não foi possível criar a conta. Tente novamente." },
      { status: 500 }
    );
  }

  const id = criado.user.id;

  async function desfazer() {
    await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
  }

  const campos: Record<string, unknown> = {
    full_name,
    phone,
    neighborhood: neighborhood || null,
    role: "customer",
  };
  if (provinciaId) campos.provincia_id = provinciaId;

  const { error: erroPerfil } = await supabaseAdmin.from("profiles").update(campos).eq("id", id);
  if (erroPerfil) {
    await desfazer();
    return NextResponse.json({ error: "Não foi possível guardar o perfil." }, { status: 500 });
  }

  const { error: erroVinculo } = await supabaseAdmin.from("seller_customers").insert({
    seller_id: perfil.id,
    customer_id: id,
    assigned_by: perfil.id,
  });

  if (erroVinculo) {
    // Sem carteira a conta não serve para nada: não deixar lixo.
    await desfazer();
    return NextResponse.json({ error: erroVinculo.message }, { status: 400 });
  }

  const { data: final } = await supabaseAdmin
    .from("profiles")
    .select("referencia")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    existente: false,
    id,
    nome: full_name,
    telefone: phone,
    referencia: (final as { referencia: string | null } | null)?.referencia ?? null,
    password,
    provincia: (provincia as { nome?: string } | null)?.nome ?? null,
  });
}
