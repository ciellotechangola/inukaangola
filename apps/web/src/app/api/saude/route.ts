import { NextResponse } from "next/server";

/**
 * Verificação de vida usada pela app Android (ecrã "Servidor").
 *
 * Existe para o utilizador poder confirmar, antes de criar conta, que o
 * endereço que escreveu é mesmo este servidor — sem isto o único sintoma de um
 * endereço errado era "não foi possível criar conta".
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, app: "inuka-web", agora: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
