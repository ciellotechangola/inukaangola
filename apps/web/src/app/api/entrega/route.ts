import { NextResponse } from "next/server";
import { estadoEntrega } from "@/lib/entrega-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/entrega
 *
 * Quanto custa entregar na província de quem está a ver o site.
 *
 * O carrinho é um componente de browser e não pode ler `platform_settings`
 * nem o perfil sem sessão — esta rota resolve as duas coisas do lado do
 * servidor e devolve só o que a interface precisa de mostrar.
 *
 * A taxa que acaba gravada na encomenda não vem daqui: é `place_order` que a
 * calcula outra vez, em SQL. Esta resposta serve para o cliente ver o total
 * antes de confirmar, não para o convencer.
 */
export async function GET() {
  try {
    return NextResponse.json(await estadoEntrega());
  } catch {
    // Nunca rebentar o carrinho por causa de uma etiqueta de preço.
    return NextResponse.json(
      {
        provincia: null,
        taxa: 0,
        gratis: false,
        taxaPadrao: 0,
        gratisNomes: [],
        nota: null,
      },
      { status: 200 }
    );
  }
}
