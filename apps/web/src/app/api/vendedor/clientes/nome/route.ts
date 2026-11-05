import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/vendedor/clientes/nome
 *
 * Dá nome a uma reserva que nasceu de uma venda. Quando o colaborador regista
 * uma venda a um número sem conta, `register_sale_by_phone` cria a reserva
 * sozinho mas não sabe quem é a pessoa — a linha ficava na carteira como
 * «Cliente por activar», igual a todas as outras.
 *
 * Fica numa rota e não numa função SQL por uma razão prática: a venda já está
 * gravada quando isto corre, por isso um falhanço aqui não pode desfazer nada.
 * O pior que acontece é a reserva continuar sem nome.
 *
 * Regras:
 *  - só toca em reservas do próprio colaborador (`seller_id`);
 *  - só enquanto estão por activar (`status = 'reservado'`);
 *  - só preenche um nome em falta — nunca substitui um que já lá esteja.
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

  const nome = String(corpo.full_name ?? "").trim();
  const phone = normalizePhone(String(corpo.phone ?? "").trim());

  if (!/^\+244\d{9}$/.test(phone)) {
    return NextResponse.json({ error: "Telefone inválido." }, { status: 400 });
  }
  if (nome.length < 3) {
    return NextResponse.json({ ok: true, anotado: false, motivo: "sem_nome" });
  }

  const { data: reserva } = await supabaseAdmin
    .from("reserved_customers")
    .select("id, seller_id, status, full_name")
    .eq("phone", phone)
    .maybeSingle();

  if (!reserva) {
    return NextResponse.json({ ok: true, anotado: false, motivo: "sem_reserva" });
  }

  const r = reserva as {
    id: string;
    seller_id: string;
    status: string;
    full_name: string | null;
  };

  // Reserva de outro colaborador, já ligada, ou já com nome: não se mexe.
  if (r.seller_id !== perfil.id || r.status !== "reservado" || r.full_name?.trim()) {
    return NextResponse.json({ ok: true, anotado: false, motivo: "nao_aplicavel" });
  }

  const { error } = await supabaseAdmin
    .from("reserved_customers")
    .update({ full_name: nome })
    .eq("id", r.id);

  if (error) {
    // A venda já está registada; isto é um extra. Não se devolve erro.
    return NextResponse.json({ ok: true, anotado: false, motivo: "erro_escrita" });
  }

  return NextResponse.json({ ok: true, anotado: true, nome, telefone: phone });
}
