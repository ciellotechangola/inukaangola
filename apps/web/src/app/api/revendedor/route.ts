import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/revendedor
 *
 * Candidatura pública «Ser revendedor INUKA». Não exige sessão — quem se
 * candidata pode nem ter conta, e é isso que se quer: a conta nasce depois da
 * aprovação, não antes.
 *
 * A escrita passa pelo servidor por duas razões:
 *   1. `service_role` é o único caminho que não precisa de política de INSERT
 *      aberta a anónimos (uma tabela de candidaturas aberta a escrita pública
 *      é um alvo fácil).
 *   2. Só aqui se consegue verificar o telefone antes de gravar e travar
 *      candidaturas repetidas do mesmo número.
 */
export async function POST(pedido: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await pedido.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const tipo = corpo.tipo === "pessoa" ? "pessoa" : "empresa";
  const nome = String(corpo.full_name ?? "").trim();
  const telefone = normalizePhone(String(corpo.phone ?? ""));
  const email = String(corpo.email ?? "").trim();
  const nif = String(corpo.nif ?? "").trim();
  const mensagem = String(corpo.message ?? "").trim();
  const provinciaId = String(corpo.provincia_id ?? "").trim();
  const origem = String(corpo.source ?? "").trim().slice(0, 60) || "site";

  if (nome.length < 2 || nome.length > 140) {
    return NextResponse.json(
      { error: tipo === "empresa" ? "Indique o nome da empresa." : "Indique o seu nome completo." },
      { status: 400 }
    );
  }

  if (!telefone) {
    return NextResponse.json(
      { error: "Indique um número de telefone válido (ex.: +244 9xx xxx xxx)." },
      { status: 400 }
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  if (mensagem.length > 800) {
    return NextResponse.json({ error: "A mensagem é demasiado longa." }, { status: 400 });
  }

  // Confirma que a província existe antes de a guardar: um id inventado daria
  // erro de chave estrangeira e a pessoa veria «falha de rede».
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

  // Uma candidatura por número a cada 10 minutos. Um clique repetido não pode
  // encher a caixa do gerente com duplicados.
  const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recente } = await supabaseAdmin
    .from("revendedor_candidaturas")
    .select("id")
    .eq("telefone", telefone)
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

  const { error } = await supabaseAdmin.from("revendedor_candidaturas").insert({
    tipo,
    nome,
    telefone,
    email: email || null,
    nif: nif || null,
    provincia_id: provincia,
    mensagem: mensagem || null,
    origem,
    status: "novo",
  });

  if (error) {
    // A tabela em falta é o caso provável numa base que ainda não recebeu a
    // migração — vale mais dizer isso do que «erro 500».
    if (/relation .* does not exist|PGRST205/i.test(error.message)) {
      return NextResponse.json(
        { error: "O formulário ainda não está activo. Falta aplicar a migração 0026." },
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
