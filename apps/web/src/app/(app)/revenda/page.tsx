import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizarMinhaRevenda, normalizarPedido } from "@/lib/revenda";
import PainelRevenda from "./PainelRevenda";

export const dynamic = "force-dynamic";

/**
 * Casa do revendedor.
 *
 * Tudo o que o ecrã de entrada precisa vem numa só chamada (`minha_revenda`):
 * a ficha, os números e as duas pessoas com quem pode falar. Os pedidos vêm
 * à parte porque são uma lista, não um número.
 */
export default async function RevendaPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/revenda");
  if (profile.role === "manager") redirect("/gerente/revendedores");
  if (profile.role !== "reseller") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("minha_revenda");
  const painel = normalizarMinhaRevenda(data);

  // Sem ficha (ou com a migração por aplicar) não há painel: manda-se para a
  // candidatura em vez de mostrar um ecrã vazio.
  const semMigracao = !!error && /PGRST202|PGRST205|does not exist/i.test(error.message);
  if (!painel.revendedor) redirect("/revendedor");

  const { data: pedidosRaw } = await supabase
    .from("revendedor_pedidos")
    .select(
      "id, numero, status, mensagem, total_unidades, valor_estimado, resposta, respondido_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(6);

  const pedidos = ((pedidosRaw ?? []) as unknown[]).map(normalizarPedido);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <PainelRevenda painel={painel} pedidos={pedidos} semMigracao={!!semMigracao} />
    </main>
  );
}
