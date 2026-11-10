import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/vendedor/clientes
 *
 * Acrescenta alguém à carteira do colaborador. **Não cria contas.**
 *
 * A versão anterior chamava `auth.admin.createUser` e devolvia uma palavra-passe
 * provisória (`INUKA######`) para o colaborador comunicar ao cliente. Isso
 * punha uma conta na mão de quem nunca a pediu, com uma palavra-passe que
 * circulava por telefone, e deixava de fora o que interessa: as compras que o
 * cliente já tinha feito antes de existir conta nenhuma.
 *
 * Agora há dois casos:
 *
 *  - **O telefone já tem conta** → faz-se só o vínculo (`seller_customers`),
 *    como sempre. É a operação segura: a pessoa já é dona do seu acesso.
 *  - **O telefone não tem conta** → grava-se uma *reserva* em
 *    `reserved_customers`: nome, telefone, bairro e província. Nada em
 *    `auth.users`. Quando a pessoa se registar com esse número,
 *    `ligar_reserva_ao_cliente` fecha a reserva, cria o vínculo e entrega-lhe
 *    as vendas que já estejam registadas com o telefone.
 *
 * Regras que continuam a valer:
 *  - a província é a do colaborador (a gestão pode escolher outra) — é o que
 *    impede duas delegações de mexerem no mesmo cliente;
 *  - um cliente só pertence a um colaborador; a transferência é da gestão.
 */
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
  const notas = String(corpo.notes ?? "").trim();

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

  const nomeProvincia = (provincia as { nome?: string } | null)?.nome ?? null;

  // ---------------------------------------------------------------- já tem conta
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

    // Esta rota faz o seu próprio teste de exclusividade em vez de chamar
    // `garantir_cliente_na_carteira` (0017) de propósito: é o caminho manual da
    // carteira e tem de continuar a funcionar numa base que ainda não recebeu
    // esse patch. A regra é a mesma; quando as duas divergirem, manda a da base.
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

    // Consome uma reserva antiga e entrega as compras que estavam à espera
    // deste número. É idempotente: sem reserva, não faz nada.
    await supabaseAdmin.rpc("ligar_reserva_ao_cliente", { p_customer_id: alvo.id });

    return NextResponse.json({
      ok: true,
      existente: true,
      reservado: false,
      id: alvo.id,
      nome: alvo.full_name,
      telefone: phone,
    });
  }

  // ---------------------------------------------------------------- reserva
  const { data: reservaExistente } = await supabaseAdmin
    .from("reserved_customers")
    .select("id, seller_id, status")
    .eq("phone", phone)
    .maybeSingle();

  if (reservaExistente) {
    const r = reservaExistente as { id: string; seller_id: string; status: string };

    if (r.seller_id !== perfil.id && r.status === "reservado") {
      return NextResponse.json(
        {
          error:
            "Este número já está reservado por outro colaborador. Peça a transferência à gestão.",
        },
        { status: 409 }
      );
    }

    // Mesmo colaborador a corrigir os dados, ou reserva já fechada a ser
    // reaberta: actualiza-se em vez de duplicar.
    const { error: erroReserva } = await supabaseAdmin
      .from("reserved_customers")
      .update({
        seller_id: perfil.id,
        created_by: perfil.id,
        full_name,
        neighborhood: neighborhood || null,
        provincia_id: provinciaId,
        notes: notas || null,
        status: "reservado",
        customer_id: null,
        linked_at: null,
      })
      .eq("id", r.id);

    if (erroReserva) {
      return NextResponse.json({ error: erroReserva.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      existente: false,
      reservado: true,
      id: r.id,
      nome: full_name,
      telefone: phone,
      provincia: nomeProvincia,
    });
  }

  const { data: criada, error: erroReserva } = await supabaseAdmin
    .from("reserved_customers")
    .insert({
      seller_id: perfil.id,
      created_by: perfil.id,
      full_name,
      phone,
      neighborhood: neighborhood || null,
      provincia_id: provinciaId,
      notes: notas || null,
      status: "reservado",
    })
    .select("id")
    .single();

  if (erroReserva || !criada) {
    // PGRST205 = tabela inexistente. Acontece numa base que ainda não recebeu
    // a migração 0009; sem esta tradução o colaborador lia o erro do PostgREST.
    if (
      (erroReserva as { code?: string } | null)?.code === "PGRST205" ||
      /Could not find the table/i.test(erroReserva?.message ?? "")
    ) {
      return NextResponse.json(
        {
          error:
            "A carteira de reservas ainda não existe na base de dados. Aplique supabase/PATCH_RESERVAS.sql no SQL Editor do Supabase e tente outra vez.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: erroReserva?.message ?? "Não foi possível reservar o cliente." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    existente: false,
    reservado: true,
    id: (criada as { id: string }).id,
    nome: full_name,
    telefone: phone,
    provincia: nomeProvincia,
  });
}

/**
 * PATCH /api/vendedor/clientes
 *
 * Corrige os dados de uma reserva por activar — nome, telefone, bairro.
 *
 * Serve os dois lados: o colaborador que escreveu mal o número do cliente e a
 * gestão, que até aqui não conseguia sequer ver as reservas. Sem isto, um
 * telefone mal digitado só se resolvia cancelando a reserva e perdendo o
 * histórico de compras que estivesse à espera daquele número.
 *
 * `phone` é único e é a chave de ligação: mudá-lo não arrasta as vendas que já
 * estejam registadas com o número antigo (essas continuam órfãs até alguém as
 * tratar) — por isso a resposta avisa quantas ficaram para trás.
 */
export async function PATCH(request: Request) {
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

  const id = String(corpo.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Reserva não indicada." }, { status: 400 });

  const { data: reserva } = await supabaseAdmin
    .from("reserved_customers")
    .select("id, seller_id, status, phone")
    .eq("id", id)
    .maybeSingle();

  if (!reserva) return NextResponse.json({ error: "Reserva não encontrada." }, { status: 404 });

  const r = reserva as { id: string; seller_id: string; status: string; phone: string };

  if (perfil.role !== "manager" && r.seller_id !== perfil.id) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  if (r.status !== "reservado") {
    return NextResponse.json(
      { error: "Esta reserva já foi ligada a uma conta. Altere os dados em Clientes." },
      { status: 409 }
    );
  }

  const atualizacao: Record<string, unknown> = {};
  let vendasOrfas = 0;

  if (typeof corpo.full_name === "string") {
    const nome = corpo.full_name.trim();
    if (nome.length < 3) {
      return NextResponse.json(
        { error: "Indique o nome do cliente (mínimo 3 caracteres)." },
        { status: 400 }
      );
    }
    atualizacao.full_name = nome;
  }

  if (typeof corpo.neighborhood === "string") {
    atualizacao.neighborhood = corpo.neighborhood.trim() || null;
  }

  if (typeof corpo.phone === "string" && corpo.phone.trim()) {
    const telefone = normalizePhone(corpo.phone.trim());
    if (!/^\+244\d{9}$/.test(telefone)) {
      return NextResponse.json(
        { error: "Telefone inválido. Use o formato +244 9xx xxx xxx." },
        { status: 400 }
      );
    }

    if (telefone !== r.phone) {
      const [{ data: conta }, { data: outraReserva }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id").eq("phone", telefone).maybeSingle(),
        supabaseAdmin.from("reserved_customers").select("id").eq("phone", telefone).maybeSingle(),
      ]);

      if (conta) {
        return NextResponse.json(
          { error: "Este número já tem conta. Use «Já tem conta» para o associar à carteira." },
          { status: 409 }
        );
      }
      if (outraReserva) {
        return NextResponse.json(
          { error: "Este número já está reservado. Cancele a outra reserva primeiro." },
          { status: 409 }
        );
      }

      const { count } = await supabaseAdmin
        .from("sales")
        .select("id", { count: "exact", head: true })
        .is("customer_id", null)
        .eq("customer_phone", r.phone);
      vendasOrfas = count ?? 0;

      atualizacao.phone = telefone;
    }
  }

  if (Object.keys(atualizacao).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("reserved_customers")
    .update(atualizacao)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, vendas_orfaas: vendasOrfas });
}

/**
 * DELETE /api/vendedor/clientes?id=<reserva>
 *
 * Cancela uma reserva por activar. Sem isto, um número mal digitado ficava
 * preso para sempre: `reserved_customers.phone` é único, e a reserva errada
 * impedia o dono do número de ser reservado por outro colaborador.
 *
 * Só apaga reservas ainda por activar — uma reserva já ligada é um vínculo
 * real na carteira e retirá-la é transferência, que é da gestão.
 */
export async function DELETE(request: Request) {
  const perfil = await getProfile();
  if (!perfil || (perfil.role !== "seller" && perfil.role !== "manager")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Reserva não indicada." }, { status: 400 });
  }

  const { data: reserva } = await supabaseAdmin
    .from("reserved_customers")
    .select("id, seller_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!reserva) {
    return NextResponse.json({ error: "Reserva não encontrada." }, { status: 404 });
  }

  const r = reserva as { id: string; seller_id: string; status: string };

  if (perfil.role !== "manager" && r.seller_id !== perfil.id) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  if (r.status !== "reservado") {
    return NextResponse.json(
      { error: "Esta reserva já foi ligada a uma conta. A transferência é feita pela gestão." },
      { status: 409 }
    );
  }

  const { error } = await supabaseAdmin.from("reserved_customers").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
