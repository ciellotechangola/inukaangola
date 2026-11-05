import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/utils";
import { phoneToEmail } from "@/lib/phone-email";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/registo
 *
 * Cria a conta de utilizador no Supabase Auth.
 *
 * Porque é que o registo NÃO é feito no cliente?
 *  1. `signUp` envia um email de confirmação. Os nossos emails são sintéticos
 *     (`u<telefone>@inuka.ao`) e nunca poderiam ser confirmados — a conta
 *     ficaria inutilizável.
 *  2. O Supabase rejeita domínios sem registo MX com `email_address_invalid`.
 *  3. O limite de envio de emails (2/hora no plano gratuito) bloquearia
 *     registos legítimos.
 *  4. A verificação de telefone duplicado precisa de ler `profiles`, que o RLS
 *     esconde de utilizadores anónimos — e não deve ser exposto.
 *
 * A Admin API (`auth.admin.createUser` com `email_confirm: true`) contorna os
 * quatro problemas e mantém a validação no servidor.
 */
export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const full_name = String(payload.full_name ?? "").trim();
  const rawPhone = String(payload.phone ?? "").trim();
  const realEmail = String(payload.email ?? "").trim();
  const neighborhood = String(payload.neighborhood ?? "").trim();
  const provinciaSlug = String(payload.provincia ?? "").trim();
  const password = String(payload.password ?? "");

  // --- Validação ---
  if (full_name.length < 3) {
    return NextResponse.json(
      { error: "Indique o nome completo (mínimo 3 caracteres)." },
      { status: 400 },
    );
  }

  const phone = normalizePhone(rawPhone);
  if (!/^\+244\d{9}$/.test(phone)) {
    return NextResponse.json(
      { error: "Telefone inválido. Use o formato +244 9xx xxx xxx." },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "A palavra-passe deve ter pelo menos 6 caracteres." },
      { status: 400 },
    );
  }

  if (realEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(realEmail)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  // --- Telefone já registado? (service_role ignora RLS, não expõe dados) ---
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: "Não foi possível validar o telefone. Tente novamente." },
      { status: 500 },
    );
  }

  if (existing) {
    return NextResponse.json(
      { error: "Este telefone já está registado. Inicie sessão." },
      { status: 409 },
    );
  }

  // --- Criar utilizador ---
  const email = phoneToEmail(phone);

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, phone },
  });

  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already|exists|registered/i.test(message)) {
      return NextResponse.json(
        { error: "Este telefone já está registado. Inicie sessão." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Não foi possível criar a conta. Tente novamente." },
      { status: 500 },
    );
  }

  // --- Província (opcional) ---
  // Resolvida no servidor a partir do slug: o cliente nunca envia um uuid.
  let provinciaId: string | null = null;
  if (provinciaSlug) {
    const { data: prov } = await supabaseAdmin
      .from("provincias")
      .select("id")
      .eq("slug", provinciaSlug)
      .maybeSingle();

    if (!prov) {
      return NextResponse.json({ error: "Província inválida." }, { status: 400 });
    }
    provinciaId = (prov as { id: string }).id;
  }

  // --- Completar perfil (o trigger handle_new_user já criou a linha) ---
  // `provincia_id` só entra no UPDATE quando há província: numa base ainda sem
  // a migração provincial, o registo continua a funcionar.
  const perfil: Record<string, unknown> = {
    full_name,
    phone,
    email: realEmail || null,
    neighborhood: neighborhood || null,
  };
  if (provinciaId) perfil.provincia_id = provinciaId;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update(perfil)
    .eq("id", created.user.id);

  if (profileError) {
    // Não deixar uma conta órfã sem perfil
    await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return NextResponse.json(
      { error: "Não foi possível guardar o perfil. Tente novamente." },
      { status: 500 },
    );
  }

  // --- Reserva do colaborador ------------------------------------------------
  // Se alguém já tinha reservado este número na carteira, é aqui que o vínculo
  // se fecha — e as vendas registadas com o telefone antes do registo passam a
  // ter dono. Idempotente: sem reserva, não faz nada. Falhar aqui não invalida
  // o registo (a conta já está criada e o cliente tem de poder entrar); a
  // gestão consegue ligar a reserva mais tarde pela mesma função.
  let ligacao: { reservas_ligadas?: number; vendas_atribuidas?: number } | null = null;
  try {
    const { data } = await supabaseAdmin.rpc("ligar_reserva_ao_cliente", {
      p_customer_id: created.user.id,
    });
    ligacao = (data ?? null) as typeof ligacao;
  } catch {
    ligacao = null;
  }

  return NextResponse.json({
    ok: true,
    email,
    phone,
    reserva: ligacao,
  });
}
