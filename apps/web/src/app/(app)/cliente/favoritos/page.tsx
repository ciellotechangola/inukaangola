"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ProductImage from "@/components/ProductImage";
import { Heart, ShoppingBag } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { listFavorites, toggleFavorite } from "@/lib/api";
import { useCart } from "@/components/cart-context";
import { formatCurrency } from "@/lib/utils";

interface FavRow {
  product_id: string;
  product: {
    id: string;
    name: string;
    official_price: number;
    promotional_price: number | null;
    images?: { url: string | null }[];
  } | null;
}

export default function FavoritesPage() {
  const { add } = useCart();
  const [rows, setRows] = useState<FavRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (uid: string) => {
    try {
      const data = await listFavorites(uid);
      setRows(data as unknown as FavRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClientBrowser();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        load(data.user.id);
      } else {
        setLoading(false);
      }
    });
  }, [load]);

  async function remove(productId: string) {
    if (!userId) return;
    await toggleFavorite(userId, productId);
    setRows((prev) => prev.filter((r) => r.product_id !== productId));
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/cliente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Área de cliente
      </Link>
      <h1 className="mb-8 text-3xl font-light text-[#F5F5F5]">Favoritos</h1>

      {loading ? (
        <p className="text-[#A3A3A3]">A carregar...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
          <Heart className="mx-auto mb-3 h-8 w-8 text-[#404040]" />
          <p className="text-[#A3A3A3]">Ainda não tem favoritos.</p>
          <Link
            href="/catalogo"
            className="mt-6 inline-flex rounded-lg bg-[#C9A962] px-6 py-2.5 font-medium text-[#0A0A0A]"
          >
            Ver catálogo
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => {
            const p = row.product;
            if (!p) return null;
            const price = Number(p.promotional_price ?? p.official_price);
            const image = p.images?.[0]?.url ?? null;

            return (
              <div
                key={row.product_id}
                className="flex gap-4 rounded-xl border border-[#262626] bg-[#1A1A1A] p-4"
              >
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#0A0A0A]">
                  {image ? (
                    <ProductImage
                      src={image}
                      alt={p.name}
                      width={80}
                      height={80}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-[#404040]">
                      INUKA
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <Link href={`/produto/${p.id}`} className="block truncate text-[#F5F5F5] hover:text-[#C9A962]">
                    {p.name}
                  </Link>
                  <p className="mb-2 text-sm text-[#C9A962]">{formatCurrency(price)}</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => add({ product_id: p.id, name: p.name, price, image })}
                      className="inline-flex items-center gap-1 text-xs text-[#F5F5F5] hover:text-[#C9A962]"
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      Adicionar
                    </button>
                    <button
                      onClick={() => remove(row.product_id)}
                      className="text-xs text-[#A3A3A3] hover:text-[#DC2626]"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
