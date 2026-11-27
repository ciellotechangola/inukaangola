import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/revendedor
 *
 * Candidatura pública «Ser revendedor INUKA», em dois percursos:
 *   • INDIVIDUAL  (tipo = pessoa)   — nome completo, telefone, NIF ou BI
 *   • EMPRESARIAL (tipo = empresa)  — empresa, telefone, NIF, área, representante
 *
 * Não exige sessão — quem se candidata pode nem ter conta, e é isso que se
 * quer: a conta nasce depois da aprovação, não antes.
 *
 * A escrita passa pelo servidor por três razões:
 *   1. `service_role` é o único caminho que não precisa de política de INSERT
 *      aberta a anónimos (uma tabela de candidaturas aberta a escrita pública
 *      é um alvo fácil).
 *   2. Só aqui se consegue verificar o telefone antes de gravar e travar
 *      candidaturas repetidas do mesmo número.
 *   3. As regras de validação ficam num sítio só, iguais para os dois tipos.
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
  const areaAtuacao = String(corpo.area_atuacao ?? "").trim();
  const representante = String(corpo.representante ?? "").trim();
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

  if (nif.length < 4 || nif.length > 40) {
    return NextResponse.json(
      {
        error:
          tipo === "empresa"
            ? "Indique o NIF da empresa."
            : "Indique o número do NIF ou do BI.",
      },
      { status: 400 }
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  if (mensagem.length > 800) {
    return NextResponse.json({ error: "A mensagem é demasiado longa." }, { status: 400 });
  }

  if (areaAtuacao.length > 80) {
    return NextResponse.json({ error: "A área de atuação é demasiado longa." }, { status: 400 });
  }

  if (representante.length > 120) {
    return NextResponse.json({ error: "O nome do representante é demasiado longo." }, { status: 400 });
  }

  // A província não é decoração: é ela que decide qual gestor recebe a
  // candidatura. Sem província a solicitação não teria dono, por isso é
  // obrigatória nos dois tipos.
  if (!provinciaId) {
    return NextResponse.json(
      { error: "Escolha a província onde pretende revender." },
      { status: 400 }
    );
  }

  // Confirma que a província existe antes de a guardar: um id inventado daria
  // erro de chave estrangeira e a pessoa veria «falha de rede».
  const { data: provincia } = await supabaseAdmin
    .from("provincias")
    .select("id")
    .eq("id", provinciaId)
    .eq("is_active", true)
    .maybeSingle();

  if (!provincia) {
    return NextResponse.json({ error: "Província inválida." }, { status: 400 });
  }

  // Uma candidatura em aberto por número. Um clique repetido — ou um segundo
  // envio no dia seguinte — não pode encher a caixa do gestor com duplicados.
  // Se a anterior já foi aprovada ou recusada, esta passa: o processo fechou.
  const { data: aberta } = await supabaseAdmin
    .from("revendedor_candidaturas")
    .select("id, created_at")
    .eq("telefone", telefone)
    .in("status", ["novo", "em_contacto"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aberta) {
    return NextResponse.json({
      ok: true,
      repetido: true,
      referencia: String(aberta.id).slice(0, 8).toUpperCase(),
      mensagem: "Já recebemos uma solicitação deste número. A gestão vai entrar em contacto.",
    });
  }

  const { data: criada, error } = await supabaseAdmin
    .from("revendedor_candidaturas")
    .insert({
      tipo,
      nome,
      telefone,
      email: email || null,
      nif,
      area_atuacao: tipo === "empresa" ? areaAtuacao || null : null,
      representante: tipo === "empresa" ? representante || null : null,
      provincia_id: provinciaId,
      mensagem: mensagem || null,
      origem,
      status: "novo",
    })
    .select("id")
    .single();

  if (error) {
    // A tabela em falta é o caso provável numa base que ainda não recebeu a
    // migração — vale mais dizer isso do que «erro 500».
    if (/relation .* does not exist|PGRST205/i.test(error.message)) {
      return NextResponse.json(
        { error: "O formulário ainda não está activo. Falta aplicar a migração 0026." },
        { status: 503 }
      );
    }
    // Coluna em falta = base sem a 0027.
    if (/PGRST204|column .* does not exist/i.test(error.message)) {
      return NextResponse.json(
        { error: "O formulário ainda não está activo. Falta aplicar a migração 0027." },
        { status: 503 }
      );
    }
    // Corrida entre dois cliques: o índice parcial travou o segundo INSERT.
    if (error.code === "23505") {
      return NextResponse.json({
        ok: true,
        repetido: true,
        mensagem: "Já recebemos uma solicitação deste número. A gestão vai entrar em contacto.",
      });
    }
    return NextResponse.json(
      { error: "Não foi possível enviar a solicitação. Tente novamente." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    id: criada.id,
    referencia: String(criada.id).slice(0, 8).toUpperCase(),
  });
}
