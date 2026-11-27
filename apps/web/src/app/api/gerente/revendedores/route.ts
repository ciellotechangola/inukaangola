import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/utils";
import { phoneToEmail } from "@/lib/phone-email";

export const dynamic = "force-dynamic";

/**
 * POST /api/gerente/revendedores
 *
 * Aprova uma candidatura a revendedor e cria a conta.
 *
 * Porque é que a conta não nasce com a candidatura: um formulário público não
 * é prova de nada. A conta só existe depois de a gestão falar com a pessoa e
 * decidir as condições (desconto e mínimo de unidades). Até lá, o pedido é
 * apenas um contacto.
 *
 * A Admin API (`auth.admin.createUser`) só existe com `service_role` — daí
 * esta rota de servidor. A chave nunca chega ao browser.
 */
export async function POST(request: Request) {
  const gestor = await getProfile();
  if (!gestor || gestor.role !== "manager") {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const tipo = corpo.tipo === "pessoa" ? "pessoa" : "empresa";
  const nome = String(corpo.nome ?? "").trim();
  const password = String(corpo.password ?? "");
  const nif = String(corpo.nif ?? "").trim();
  const email = String(corpo.email ?? "").trim();
  const candidaturaId = String(corpo.candidatura_id ?? "").trim();

  const descontoBruto = corpo.desconto;
  const temDesconto =
    descontoBruto !== undefined && descontoBruto !== null && String(descontoBruto).trim() !== "";
  const desconto = temDesconto ? Number(descontoBruto) : null;

  const minimoBruto = Number(corpo.minimo ?? 5);
  const minimo = Number.isFinite(minimoBruto) ? Math.max(1, Math.round(minimoBruto)) : 5;

  if (nome.length < 3) {
    return NextResponse.json(
      { error: "Indique o nome da empresa ou da pessoa (mínimo 3 caracteres)." },
      { status: 400 }
    );
  }

  const phone = normalizePhone(String(corpo.telefone ?? ""));
  if (!/^\+244\d{9}$/.test(phone)) {
    return NextResponse.json(
      { error: "Telefone inválido. Use o formato +244 9xx xxx xxx." },
      { status: 400 }
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  if (desconto !== null && (!Number.isFinite(desconto) || desconto < 0 || desconto > 0.9)) {
    return NextResponse.json(
      { error: "O desconto tem de estar entre 0% e 90%." },
      { status: 400 }
    );
  }

  // --- Província: um gestor provincial só cria revendedores na sua ---
  const nacional = gestor.is_national_admin || gestor.provincia_id === null;
  let provinciaId: string | null = null;

  if (nacional) {
    const pedida = String(corpo.provincia_id ?? "").trim();
    if (pedida) {
      const { data: prov } = await supabaseAdmin
        .from("provincias")
        .select("id")
        .eq("id", pedida)
        .maybeSingle();
      if (!prov) {
        return NextResponse.json({ error: "Província inválida." }, { status: 400 });
      }
      provinciaId = pedida;
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
  // Uma conta de cliente não é um obstáculo: é o caso normal de quem já compra
  // INUKA e agora quer revender. Promove-se a mesma conta — o histórico de
  // compras fica. Só as contas de equipa é que não se misturam.
  const { data: existente } = await supabaseAdmin
    .from("profiles")
    .select("id, role, full_name")
    .eq("phone", phone)
    .maybeSingle();

  let id: string;
  let contaExistente = false;

  if (existente) {
    const papel = (existente as { role: string }).role;

    if (papel === "reseller") {
      return NextResponse.json(
        { error: "Este telefone já é de um revendedor. Abra a ficha em vez de criar outra." },
        { status: 409 }
      );
    }

    if (papel !== "customer") {
      return NextResponse.json(
        {
          error:
            "Este telefone pertence a uma conta de equipa (colaborador, loja ou gestão). Use outro número para o revendedor.",
        },
        { status: 409 }
      );
    }

    id = (existente as { id: string }).id;
    contaExistente = true;
  } else {
    // --- Conta nova ---
    // A palavra-passe só é exigida a quem ainda não tem conta: uma conta de
    // cliente promovida continua a entrar com a que já usa.
    if (password.length < 6) {
      return NextResponse.json(
        { error: "A palavra-passe provisória precisa de pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    const { data: criado, error: erroConta } = await supabaseAdmin.auth.admin.createUser({
      email: phoneToEmail(phone),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: nome,
        phone,
        ...(provincia?.slug ? { provincia_slug: provincia.slug } : {}),
      },
    });

    if (erroConta || !criado?.user) {
      const mensagem = erroConta?.message ?? "";
      if (/already|exists|registered/i.test(mensagem)) {
        return NextResponse.json({ error: "Este telefone já tem conta." }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Não foi possível criar a conta. Tente novamente." },
        { status: 500 }
      );
    }

    id = criado.user.id;
  }

  // Falhou a seguir? Não deixar uma conta órfã sem ficha. Uma conta que já
  // existia nunca é apagada por um erro nesta rota.
  async function desfazer() {
    if (contaExistente) {
      // Voltar ao papel anterior: a conta continua a ser de cliente.
      await supabaseAdmin.from("profiles").update({ role: "customer" }).eq("id", id);
      return;
    }
    await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
  }

  const perfil: Record<string, unknown> = { is_active: true };
  // A conta nova nasce com os dados da candidatura; a conta de cliente já tem
  // os seus e não se reescrevem por causa de uma candidatura.
  if (!contaExistente) {
    perfil.full_name = nome;
    perfil.phone = phone;
    perfil.email = email || null;
  }
  if (provinciaId) perfil.provincia_id = provinciaId;

  const { error: erroPerfil } = await supabaseAdmin.from("profiles").update(perfil).eq("id", id);
  if (erroPerfil) {
    await desfazer();
    return NextResponse.json(
      { error: "Não foi possível guardar o perfil. Tente novamente." },
      { status: 500 }
    );
  }

  // O papel tem de ser escrito depois do perfil existir. Com `service_role`
  // não há JWT (`auth.uid()` é NULL) e o gatilho de escalada deixa passar —
  // é o mesmo caminho que a criação de colaboradores já usa.
  const { error: erroPapel } = await supabaseAdmin
    .from("profiles")
    .update({ role: "reseller" })
    .eq("id", id);

  if (erroPapel) {
    await desfazer();
    return NextResponse.json({ error: erroPapel.message }, { status: 400 });
  }

  const { data: ficha, error: erroFicha } = await supabaseAdmin
    .from("revendedores")
    .insert({
      user_id: id,
      tipo,
      nome,
      nif: nif || null,
      telefone: phone,
      email: email || null,
      provincia_id: provinciaId,
      manager_id: gestor.id,
      desconto,
      minimo_unidades: minimo,
      status: "activo",
      created_by: gestor.id,
    })
    .select("id")
    .single();

  if (erroFicha) {
    await desfazer();
    return NextResponse.json(
      {
        error: /revendedores_nif_uidx|duplicate key/i.test(erroFicha.message)
          ? "Esse NIF já está registado noutro revendedor."
          : erroFicha.message,
      },
      { status: 400 }
    );
  }

  // A candidatura fica ligada à ficha: quem tratar do assunto amanhã vê que
  // esta pessoa já foi aprovada e com que conta.
  if (candidaturaId) {
    await supabaseAdmin
      .from("revendedor_candidaturas")
      .update({
        status: "aprovado",
        handled_at: new Date().toISOString(),
        handled_by: gestor.id,
        revendedor_id: (ficha as { id: string }).id,
      })
      .eq("id", candidaturaId);
  }

  return NextResponse.json({
    ok: true,
    id,
    revendedor_id: (ficha as { id: string }).id,
    telefone: phone,
    conta_existente: contaExistente,
  });
}
