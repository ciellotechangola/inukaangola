import { NextResponse } from "next/server";
import { createClientServer, supabaseAdmin } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/revendedor
 *
 * Formulário público "quero ser revendedor". Não exige sessão — quem se
 * candidata pode nem ter conta.
 *
 * Porque é que a escrita não é feita pelo cliente?
 * A política de INSERT aceita anónimos (é um formulário aberto), mas não lhes
 * deixa ler nada. Sem leitura não há como travar candidaturas repetidas do mesmo
 * número, que é o abuso óbvio. Aqui valida-se, verifica-se o telefone e só
 * depois se escreve — com `service_role`, que nunca chega ao browser.
 */
export async function POST(pedido: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await pedido.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const nome = String(corpo.full_name ?? "").trim();
  const telefone = normalizePhone(String(corpo.phone ?? ""));
  const mensagem = String(corpo.message ?? "").trim();
  const provinciaId = String(corpo.provincia_id ?? "").trim();
  const origem = String(corpo.source ?? "").trim().slice(0, 60) || "loja";

  if (nome.length < 2 || nome.length > 120) {
    return NextResponse.json({ error: "Indique o seu nome completo." }, { status: 400 });
  }

  if (!telefone) {
    return NextResponse.json(
      { error: "Indique um número de telefone válido (ex.: +244 9xx xxx xxx)." },
      { status: 400 }
    );
  }

  if (mensagem.length > 800) {
    return NextResponse.json({ error: "A mensagem é demasiado longa." }, { status: 400 });
  }

  // Confirma que a província existe antes de a guardar: um id inventado daria
  // erro de chave estrangeira e a pessoa veria "falha de rede".
  let provincia: string | null = null;
  if (provinciaId) {
    const { data } = await supabaseAdmin
      .from("provincias")
      .select("id")
      .eq("id", provinciaId)
      .eq("is_active", true)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ error: "Província inválida." }, { status: 400 });
    }
    provincia = provinciaId;
  }

  // Uma candidatura por número a cada 10 minutos. Sem isto, um clique repetido
  // (ou um formulário reenviado) enchia a caixa da gestão com duplicados.
  const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recente } = await supabaseAdmin
    .from("reseller_applications")
    .select("id")
    .eq("phone", telefone)
    .gte("created_at", dezMinutosAtras)
    .limit(1)
    .maybeSingle();

  if (recente) {
    return NextResponse.json({
      ok: true,
      repetido: true,
      mensagem: "Já recebemos a sua candidatura. Vamos entrar em contacto.",
    });
  }

  const { error } = await supabaseAdmin.from("reseller_applications").insert({
    full_name: nome,
    phone: telefone,
    provincia_id: provincia,
    message: mensagem || null,
    source: origem,
    status: "novo",
  });

  if (error) {
    // A tabela em falta é o caso provável numa base que ainda não recebeu a
    // migração — vale mais dizer isso do que "erro 500".
    if (/relation .* does not exist|PGRST205/i.test(error.message)) {
      return NextResponse.json(
        { error: "O formulário ainda não está activo. Falta aplicar a migração 0008." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Não foi possível enviar a candidatura. Tente novamente." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/revendedor
 *
 * Lista as candidaturas para a gestão. Não há leitura pública: um telefone de
 * quem se candidatou não é informação de montra.
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
    .select("role")
    .eq("id", user.id)
    .single();

  if ((eu as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("reseller_applications")
    .select("id, full_name, phone, message, source, status, created_at, provincia:provincias(nome)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ candidaturas: data ?? [] });
}
