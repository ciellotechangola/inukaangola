import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import GestorStock, { type LinhaStock } from "./GestorStock";

export const dynamic = "force-dynamic";

interface Produto {
  id: string;
  name: string;
  sku: string | null;
  official_price: number;
  promotional_price: number | null;
  is_active: boolean;
}

interface Inventario {
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  low_stock_threshold: number;
}

export default async function StockPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "store_seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const provincia = profile.provincia_id;

  const produtosQuery = supabase
    .from("products")
    .select("id, name, sku, official_price, promotional_price, is_active");

  const inventarioQuery = supabase
    .from("inventory")
    .select("product_id, quantity, reserved_quantity, low_stock_threshold");

  if (provincia) {
    produtosQuery.or(`provincia_id.eq.${provincia},provincia_id.is.null`);
    inventarioQuery.eq("provincia_id", provincia);
  } else {
    produtosQuery.is("provincia_id", null);
    inventarioQuery.is("provincia_id", null);
  }

  const [{ data: produtosRaw }, { data: inventarioRaw }] = await Promise.all([
    produtosQuery.order("name"),
    inventarioQuery,
  ]);

  const inventario = new Map<string, Inventario>();
  for (const i of (inventarioRaw ?? []) as Inventario[]) {
    inventario.set(i.product_id, i);
  }

  const linhas: LinhaStock[] = ((produtosRaw ?? []) as Produto[]).map((p) => {
    const inv = inventario.get(p.id);
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: Number(p.promotional_price ?? p.official_price),
      is_active: p.is_active,
      quantity: inv?.quantity ?? 0,
      reserved: inv?.reserved_quantity ?? 0,
      threshold: inv?.low_stock_threshold ?? 5,
    };
  });

  // O que precisa de atenção primeiro; o resto por nome.
  linhas.sort((a, b) => {
    const da = Math.max(0, a.quantity - a.reserved);
    const db = Math.max(0, b.quantity - b.reserved);
    const baixoA = da <= a.threshold ? 0 : 1;
    const baixoB = db <= b.threshold ? 0 : 1;
    if (baixoA !== baixoB) return baixoA - baixoB;
    return a.name.localeCompare(b.name, "pt");
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-6">
        <h1 className="mb-1 text-3xl font-light text-[#F5F5F5]">Stock</h1>
        <p className="text-[#A3A3A3]">
          Contagem da loja {provincia ? "da sua província" : "da sede"}. Escreva a quantidade
          contada e guarde — o movimento fica registado.
        </p>
      </header>

      <GestorStock linhas={linhas} provinciaId={provincia} />
    </main>
  );
}
