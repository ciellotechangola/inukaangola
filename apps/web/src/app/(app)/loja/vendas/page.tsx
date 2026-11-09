import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import Balcao, { type ProdutoBalcao } from "./Balcao";

export const dynamic = "force-dynamic";

interface Produto {
  id: string;
  name: string;
  sku: string | null;
  official_price: number;
  promotional_price: number | null;
}

interface Inventario {
  product_id: string;
  quantity: number;
  reserved_quantity: number;
}

interface Venda {
  id: string;
  reference: string;
  total_amount: number;
  payment_method: string | null;
  created_at: string;
}

export default async function VendasPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "store_seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const provincia = profile.provincia_id;

  const produtosQuery = supabase
    .from("products")
    .select("id, name, sku, official_price, promotional_price")
    .eq("is_active", true);

  const inventarioQuery = supabase
    .from("inventory")
    .select("product_id, quantity, reserved_quantity");

  if (provincia) {
    produtosQuery.or(`provincia_id.eq.${provincia},provincia_id.is.null`);
    inventarioQuery.eq("provincia_id", provincia);
  } else {
    produtosQuery.is("provincia_id", null);
    inventarioQuery.is("provincia_id", null);
  }

  const [{ data: produtosRaw }, { data: inventarioRaw }, { data: vendasRaw }] = await Promise.all([
    produtosQuery.order("name"),
    inventarioQuery,
    supabase
      .from("sales")
      .select("id, reference, total_amount, payment_method, created_at")
      .eq("seller_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const inventario = new Map<string, Inventario>();
  for (const i of (inventarioRaw ?? []) as Inventario[]) inventario.set(i.product_id, i);

  const produtos: ProdutoBalcao[] = ((produtosRaw ?? []) as Produto[])
    .map((p) => {
      const inv = inventario.get(p.id);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: Number(p.promotional_price ?? p.official_price),
        disponivel: inv ? Math.max(0, inv.quantity - inv.reserved_quantity) : 0,
      };
    })
    .sort((a, b) => b.disponivel - a.disponivel || a.name.localeCompare(b.name, "pt"));

  const vendas = (vendasRaw ?? []) as Venda[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-6">
        <h1 className="mb-1 text-3xl font-light text-[#F5F5F5]">Vender ao balcão</h1>
        <p className="text-[#A3A3A3]">
          A venda sai do stock desta província no momento em que é registada.
        </p>
      </header>

      <Balcao produtos={produtos} provinciaId={provincia} />

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-medium text-[#F5F5F5]">Últimas vendas</h2>
        {vendas.length === 0 ? (
          <p className="rounded-xl border border-[#262626] bg-[#141414] p-6 text-sm text-[#6F6F6F]">
            Ainda não registou vendas.
          </p>
        ) : (
          <ul className="divide-y divide-[#1F1F1F] overflow-hidden rounded-xl border border-[#262626]">
            {vendas.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-[#121212] px-4 py-3"
              >
                <div>
                  <p className="font-mono text-xs text-[#C9A962]">{v.reference}</p>
                  <p className="text-[11px] text-[#6F6F6F]">
                    {new Date(v.created_at).toLocaleString("pt-PT", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {v.payment_method ? ` · ${v.payment_method}` : ""}
                  </p>
                </div>
                <span className="text-sm font-medium text-[#EDEDED]">
                  {formatCurrency(Number(v.total_amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
