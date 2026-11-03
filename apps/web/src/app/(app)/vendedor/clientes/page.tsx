import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { CarteiraClientes, type ClienteCarteira, type TotaisCliente } from "./CarteiraClientes";

export const dynamic = "force-dynamic";

/**
 * Carteira do colaborador.
 *
 * Os dados são lidos no servidor e passados prontos ao componente interactivo.
 * Fazer a leitura no browser deixava o primeiro ecrã vazio e, pior, mostrava
 * «Ainda não tem clientes» a quem tinha — o React só preenchia depois da
 * hidratação. A carteira é a lista de trabalho do colaborador: tem de estar lá
 * à primeira pintura.
 */
export default async function SellerCustomersPage() {
  const perfil = await getProfile();
  if (!perfil) redirect("/login?redirect=/vendedor/clientes");
  if (perfil.role !== "seller" && perfil.role !== "manager") redirect("/cliente");

  const supabase = await createClientServer();

  // `seller_customers.customer_id` referencia `auth.users`, não `profiles`:
  // um embed `profiles!seller_customers_customer_id_fkey` não resolve e o
  // PostgREST devolve erro (a lista aparecia sempre vazia). Lê-se o vínculo e
  // depois os perfis, por id.
  const { data: vinculos, error } = await supabase
    .from("seller_customers")
    .select("id, customer_id, assigned_at")
    .eq("is_active", true)
    .order("assigned_at", { ascending: false });

  const linhas = (vinculos ?? []) as {
    id: string;
    customer_id: string;
    assigned_at: string;
  }[];

  const ids = linhas.map((l) => l.customer_id);

  const { data: perfis } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, phone, neighborhood")
        .in("id", ids)
    : { data: [] as { id: string; full_name: string; phone: string | null; neighborhood: string | null }[] };

  const porId = new Map(
    ((perfis ?? []) as {
      id: string;
      full_name: string;
      phone: string | null;
      neighborhood: string | null;
    }[]).map((p) => [p.id, p])
  );

  // Totais por cliente: só as vendas deste colaborador. O RLS de `sales` já
  // esconde as dos colegas, por isso não há aqui nada a filtrar à mão.
  const totais: Record<string, TotaisCliente> = {};
  if (ids.length) {
    const { data: vendas } = await supabase
      .from("sales")
      .select("customer_id, total_amount, created_at")
      .in("customer_id", ids)
      .order("created_at", { ascending: false });

    for (const v of (vendas ?? []) as {
      customer_id: string | null;
      total_amount: number | string;
      created_at: string;
    }[]) {
      if (!v.customer_id) continue;
      const atual = totais[v.customer_id] ?? { total: 0, compras: 0, ultima: null };
      atual.total += Number(v.total_amount) || 0;
      atual.compras += 1;
      if (!atual.ultima) atual.ultima = v.created_at;
      totais[v.customer_id] = atual;
    }
  }

  const clientes: ClienteCarteira[] = linhas
    .map((l) => ({
      vinculoId: l.id,
      desde: l.assigned_at,
      cliente: porId.get(l.customer_id) ?? null,
    }))
    // Um perfil apagado deixa o vínculo órfão: não se mostra uma linha vazia.
    .filter((c) => c.cliente !== null);

  return (
    <CarteiraClientes
      iniciais={clientes}
      totaisIniciais={totais}
      erroInicial={error?.message ?? null}
    />
  );
}
