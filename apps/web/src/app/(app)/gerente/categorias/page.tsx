import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import GestorCategorias, { type Categoria } from "./GestorCategorias";

export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();

  const [categoriasRes, produtosRes] = await Promise.all([
    supabase.from("categories").select("id, name, slug, sort_order, is_active").order("sort_order"),
    supabase.from("products").select("category_id"),
  ]);

  const contagem = new Map<string, number>();
  for (const p of (produtosRes.data ?? []) as { category_id: string | null }[]) {
    if (p.category_id) contagem.set(p.category_id, (contagem.get(p.category_id) ?? 0) + 1);
  }

  const categorias = ((categoriasRes.data ?? []) as Omit<Categoria, "produtos">[]).map((c) => ({
    ...c,
    produtos: contagem.get(c.id) ?? 0,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Categorias</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          {categorias.length} categorias · {categorias.filter((c) => c.is_active).length} activas.
          As categorias activas aparecem no catálogo e na página inicial.
        </p>
      </div>

      {categoriasRes.error && (
        <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">
          {categoriasRes.error.message}
        </div>
      )}

      <GestorCategorias categorias={categorias} />
    </main>
  );
}
