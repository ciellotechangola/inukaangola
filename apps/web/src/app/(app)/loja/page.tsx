import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  ClipboardList,
  Package,
  ShoppingCart,
} from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface LinhaStock {
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  low_stock_threshold: number;
  products: { name: string; sku: string | null } | null;
}

/**
 * Painel do vendedor de loja.
 *
 * Tudo o que aqui aparece é da província de quem entrou. As políticas de stock
 * e de encomendas já filtram; a consulta reforça com `provincia_id` para a
 * gestão nacional não somar províncias que não são a loja em foco.
 */
export default async function LojaPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "store_seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const provincia = profile.provincia_id;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const stockQuery = supabase
    .from("inventory")
    .select("product_id, quantity, reserved_quantity, low_stock_threshold, products(name, sku)");
  const encomendasQuery = supabase
    .from("orders")
    .select("id, status")
    .in("status", ["pending", "confirmed", "preparing", "ready_pickup"]);

  if (provincia) {
    stockQuery.eq("provincia_id", provincia);
    encomendasQuery.eq("provincia_id", provincia);
  } else {
    stockQuery.is("provincia_id", null);
    encomendasQuery.is("provincia_id", null);
  }

  const [stockRes, vendasRes, encomendasRes] = await Promise.all([
    stockQuery.limit(1000),
    supabase
      .from("sales")
      .select("id, total_amount, created_at")
      .gte("created_at", inicioDoDia.toISOString())
      .limit(500),
    encomendasQuery.limit(500),
  ]);

  const stock = (stockRes.data ?? []) as unknown as LinhaStock[];
  const vendas = (vendasRes.data ?? []) as { id: string; total_amount: number }[];
  const encomendas = (encomendasRes.data ?? []) as { id: string; status: string }[];

  const disponivel = (l: LinhaStock) => Math.max(0, l.quantity - l.reserved_quantity);
  const baixos = stock
    .filter((l) => disponivel(l) <= l.low_stock_threshold)
    .sort((a, b) => disponivel(a) - disponivel(b));

  const totalHoje = vendas.reduce((s, v) => s + Number(v.total_amount), 0);
  const porPreparar = encomendas.filter((e) => e.status !== "ready_pickup").length;
  const prontas = encomendas.filter((e) => e.status === "ready_pickup").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <h1 className="mb-1 text-3xl font-light text-[#F5F5F5]">Loja</h1>
        <p className="text-[#A3A3A3]">
          {profile.full_name.split(" ")[0]}, este é o pulso da loja
          {provincia ? " da sua província" : " da sede"}.
        </p>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Banknote className="h-4 w-4" />}
          label="Vendas hoje"
          value={formatCurrency(totalHoje)}
          nota={`${vendas.length} venda(s)`}
        />
        <Stat
          icon={<Package className="h-4 w-4" />}
          label="Referências com stock"
          value={String(stock.filter((l) => disponivel(l) > 0).length)}
          nota={`${stock.length} com registo`}
        />
        <Stat
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Stock baixo"
          value={String(baixos.length)}
          nota="No limiar ou abaixo"
          alerta={baixos.length > 0}
        />
        <Stat
          icon={<ClipboardList className="h-4 w-4" />}
          label="Encomendas por preparar"
          value={String(porPreparar)}
          nota={`${prontas} pronta(s) para entrega`}
        />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Acao
          href="/loja/vendas"
          icon={<ShoppingCart className="h-5 w-5" />}
          titulo="Vender ao balcão"
          descricao="Regista a venda e dá baixa no stock na hora."
          destaque
        />
        <Acao
          href="/loja/stock"
          icon={<Package className="h-5 w-5" />}
          titulo="Contar stock"
          descricao="Entradas, contagens e correcções com histórico."
        />
        <Acao
          href="/loja/encomendas"
          icon={<ClipboardList className="h-5 w-5" />}
          titulo="Encomendas"
          descricao="Confirmar, preparar e entregar pedidos de clientes."
        />
      </div>

      <section className="rounded-xl border border-[#262626] bg-[#141414] p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-[#F5F5F5]">Repor primeiro</h2>
          <Link
            href="/loja/stock"
            className="inline-flex items-center gap-1 text-xs text-[#C9A962] hover:underline"
          >
            Ver todo o stock <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {baixos.length === 0 ? (
          <p className="text-sm text-[#525252]">
            Nada em falta. Todas as referências estão acima do limiar.
          </p>
        ) : (
          <ul className="divide-y divide-[#1F1F1F]">
            {baixos.slice(0, 8).map((l) => (
              <li key={l.product_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#EDEDED]">{l.products?.name ?? "Produto"}</p>
                  <p className="font-mono text-[10px] text-[#525252]">{l.products?.sku ?? "—"}</p>
                </div>
                <span
                  className={`shrink-0 text-sm ${
                    disponivel(l) === 0 ? "text-[#F87171]" : "text-[#E3D5A7]"
                  }`}
                >
                  {disponivel(l)} un.
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
  nota,
  alerta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  nota: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-[#525252]">
        <span className={alerta ? "text-[#F87171]" : "text-[#C9A962]"}>{icon}</span>
        {label}
      </p>
      <p className={`text-xl font-medium ${alerta ? "text-[#F87171]" : "text-[#C9A962]"}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-[#6F6F6F]">{nota}</p>
    </div>
  );
}

function Acao({
  href,
  icon,
  titulo,
  descricao,
  destaque,
}: {
  href: string;
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  destaque?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group rounded-xl border p-5 transition ${
        destaque
          ? "border-[#5FBF8F]/40 bg-[#5FBF8F]/5 hover:border-[#5FBF8F]"
          : "border-[#262626] bg-[#1A1A1A] hover:border-[#C9A962]/40"
      }`}
    >
      <span
        className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${
          destaque ? "bg-[#5FBF8F]/15 text-[#5FBF8F]" : "bg-[#C9A962]/10 text-[#C9A962]"
        }`}
      >
        {icon}
      </span>
      <p className="mb-1 text-sm font-medium text-[#F5F5F5]">{titulo}</p>
      <p className="text-xs text-[#8A8A8A]">{descricao}</p>
    </Link>
  );
}
