import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/utils";
import { phoneToEmail } from "@/lib/phone-email";

export const dynamic = "force-dynamic";

/**
 * POST /api/gerente/utilizadores
 *
 * Cria uma conta nova (colaborador ou cliente) a partir do painel de gestão.
 *
 * Porque é que isto NÃO pode ser feito no browser: criar um utilizador exige a
 * Admin API (`auth.admin.createUser`), que só existe com `service_role`. A
 * chave nunca vai para o cliente — daí a rota de servidor.
 *
 * A província segue em `user_metadata.provincia_slug` de propósito: o trigger
 * `handle_new_user` (migração 0005) lê-a e cria o perfil já com
 * `provincia_id`, o que faz o `fill_referencia` gerar a referência na
 * sequência certa à primeira. Se a província só fosse escrita num UPDATE
 * posterior, a pessoa ficava com um número da sequência nacional e a
 * numeração da província ganhava um salto.
 */
export async function POST(request: Request) {
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

  const papel = corpo.role === "seller" ? "seller" : "customer";
  const full_name = String(corpo.full_name ?? "").trim();
  const rawPhone = String(corpo.phone ?? "").trim();
  const password = String(corpo.password ?? "");
  const email = String(corpo.email ?? "").trim();
  const neighborhood = String(corpo.neighborhood ?? "").trim();

  if (full_name.length < 3) {
    return NextResponse.json(
      { error: "Indique o nome completo (mínimo 3 caracteres)." },
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

  if (password.length < 6) {
    return NextResponse.json(
      { error: "A palavra-passe provisória precisa de pelo menos 6 caracteres." },
      { status: 400 }
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  // --- Província: um gestor provincial só cria gente na sua província ---
  const nacional = gestor.is_national_admin || gestor.provincia_id === null;
  let provinciaId: string | null = null;

  if (nacional) {
    const pedida = String(corpo.provincia_id ?? "").trim();
    if (pedida) {
      const { data: prov } = await supabaseAdmin
        .from("provincias")
        .select("id, codigo")
        .eq("id", pedida)
        .maybeSingle();
      if (!prov) {
        return NextResponse.json({ error: "Província inválida." }, { status: 400 });
      }
      provinciaId = (prov as { id: string }).id;
    }
  } else {
    provinciaId = gestor.provincia_id;
  }

  const { data: provincia } = provinciaId
    ? await supabaseAdmin
        .from("provincias")
        .select("slug")
        .eq("id", provinciaId)
        .maybeSingle()
    : { data: null };

  // --- Telefone já registado? ---
  const { data: existente } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (existente) {
    return NextResponse.json(
      { error: "Este telefone já tem conta. Use «Promover cliente» para lhe dar acesso de colaborador." },
      { status: 409 }
    );
  }

  // --- Conta ---
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
    const mensagem = erroConta?.message ?? "";
    if (/already|exists|registered/i.test(mensagem)) {
      return NextResponse.json(
        { error: "Este telefone já tem conta." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Não foi possível criar a conta. Tente novamente." },
      { status: 500 }
    );
  }

  const id = criado.user.id;

  // Falhou a seguir? Não deixar uma conta órfã sem perfil coerente.
  async function desfazer() {
    await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
  }

  const perfil: Record<string, unknown> = {
    full_name,
    phone,
    email: email || null,
    neighborhood: neighborhood || null,
    is_active: corpo.is_active === false ? false : true,
  };
  if (provinciaId) perfil.provincia_id = provinciaId;

  const { error: erroPerfil } = await supabaseAdmin.from("profiles").update(perfil).eq("id", id);
  if (erroPerfil) {
    await desfazer();
    return NextResponse.json(
      { error: "Não foi possível guardar o perfil. Tente novamente." },
      { status: 500 }
    );
  }

  if (papel === "seller") {
    // Vazio = herda a taxa da empresa (NULL), que é o caso normal. Só se
    // grava uma taxa pessoal quando o formulário traz mesmo um número.
    const taxaBruta = corpo.commission_rate;
    const temTaxa = taxaBruta !== undefined && taxaBruta !== null && String(taxaBruta).trim() !== "";
    const taxa = temTaxa ? Number(taxaBruta) : null;

    const { error: erroVendedor } = await supabaseAdmin.from("seller_profiles").upsert(
      {
        id,
        region: String(corpo.region ?? "").trim() || null,
        commission_rate:
          taxa !== null && Number.isFinite(taxa) && taxa >= 0 && taxa <= 1 ? taxa : null,
        bi_number: String(corpo.bi_number ?? "").trim() || null,
        birth_date: String(corpo.birth_date ?? "").trim() || null,
        whatsapp: String(corpo.whatsapp ?? "").trim() || null,
        address: String(corpo.address ?? "").trim() || null,
        municipio: String(corpo.municipio ?? "").trim() || null,
        job_title: String(corpo.job_title ?? "").trim() || null,
        category: String(corpo.category ?? "").trim() || null,
        hired_at: String(corpo.hired_at ?? "").trim() || null,
      },
      { onConflict: "id" }
    );

    if (erroVendedor) {
      await desfazer();
      return NextResponse.json(
        {
          error: /uq_seller_bi|duplicate key/i.test(erroVendedor.message)
            ? "Esse número de BI já está registado noutro colaborador."
            : erroVendedor.message,
        },
        { status: 400 }
      );
    }

    const { error: erroPapel } = await supabaseAdmin
      .from("profiles")
      .update({ role: "seller" })
      .eq("id", id);

    if (erroPapel) {
      await desfazer();
      return NextResponse.json({ error: erroPapel.message }, { status: 400 });
    }
  }

  const { data: final } = await supabaseAdmin
    .from("profiles")
    .select("id, referencia")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    id,
    referencia: (final as { referencia: string | null } | null)?.referencia ?? null,
    telefone: phone,
  });
}
