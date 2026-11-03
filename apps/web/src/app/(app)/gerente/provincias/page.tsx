import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import GestaoProvincias from "./GestaoProvincias";

export const dynamic = "force-dynamic";

export interface LinhaProvincia {
  id: string;
  nome: string;
  codigo: string;
  slug: string;
  delegacao_nome: string | null;
  is_active: boolean;
  colaboradores: number;
  clientes: number;
  produtos: number;
  stock_total: number;
  stock_baixo: number;
  vendas_valor: number;
  vendas_count: number;
  encomendas_count: number;
}

export default async function ProvinciasPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const nacional = profile.is_national_admin || profile.provincia_id === null;

  const [visaoRes, produtosRes, transferenciasRes] = await Promise.all([
    nacional
      ? supabase.rpc("province_overview")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("products")
      .select("id, name, provincia_id")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("stock_transfers")
      .select(
        "id, reference, quantity, status, created_at, product_id, from_provincia_id, to_provincia_id, notes"
      )
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const linhas = ((visaoRes.data ?? []) as LinhaProvincia[]).slice();
  const produtos = (produtosRes.data ?? []) as {
    id: string;
    name: string;
    provincia_id: string | null;
  }[];
  const transferencias = (transferenciasRes.data ?? []) as {
    id: string;
    reference: string;
    quantity: number;
    status: string;
    created_at: string;
    product_id: string;
    from_provincia_id: string | null;
    to_provincia_id: string | null;
    notes: string | null;
  }[];

  const totalStock = linhas.reduce((s, l) => s + l.stock_total, 0);
  const totalVendas = linhas.reduce((s, l) => s + Number(l.vendas_valor), 0);
  const totalColab = linhas.reduce((s, l) => s + l.colaboradores, 0);
  const pendentes = transferencias.filter((t) => t.status === "pending");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Províncias e delegações</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          {nacional
            ? "Comparação de stock, vendas e equipas em todas as províncias."
            : "A sua província. A comparação nacional é feita pela administração central."}
        </p>
      </div>

      {!nacional ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <p className="text-sm text-[#A3A3A3]">
            Está associado a uma província. O stock e as vendas que vê são apenas os da sua
            província — a comparação entre províncias está reservada à administração nacional.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi rotulo="Províncias ativas" valor={String(linhas.filter((l) => l.is_active).length)} />
            <Kpi rotulo="Colaboradores" valor={String(totalColab)} />
            <Kpi rotulo="Stock total" valor={`${totalStock} un.`} />
            <Kpi rotulo="Vendas" valor={formatCurrency(totalVendas)} />
          </div>

          <div className="tabela-deslizante mb-8 rounded-xl border border-[#262626]">
            <table className="w-full text-sm">
              <thead className="bg-[#141414] text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
                <tr>
                  <th className="px-4 py-3 font-normal">Província</th>
                  <th className="px-4 py-3 font-normal">Delegação</th>
                  <th className="px-4 py-3 text-right font-normal">Colab.</th>
                  <th className="px-4 py-3 text-right font-normal">Clientes</th>
                  <th className="px-4 py-3 text-right font-normal">Produtos</th>
                  <th className="px-4 py-3 text-right font-normal">Stock</th>
                  <th className="px-4 py-3 text-right font-normal">Vendas</th>
                  <th className="px-4 py-3 text-right font-normal">Encomendas</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className="border-t border-[#1F1F1F] bg-[#1A1A1A]">
                    <td className="px-4 py-3">
                      <p className="text-[#F5F5F5]">{l.nome}</p>
                      <p className="text-[11px] text-[#525252]">{l.codigo}</p>
                    </td>
                    <td className="px-4 py-3 text-[#A3A3A3]">{l.delegacao_nome ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-[#A3A3A3]">{l.colaboradores}</td>
                    <td className="px-4 py-3 text-right text-[#A3A3A3]">{l.clientes}</td>
                    <td className="px-4 py-3 text-right text-[#A3A3A3]">{l.produtos}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={l.stock_baixo > 0 ? "text-[#DC2626]" : "text-[#A3A3A3]"}>
                        {l.stock_total} un.
                      </span>
                      {l.stock_baixo > 0 && (
                        <span className="ml-2 text-[10px] text-[#DC2626]">
                          {l.stock_baixo} em falta
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[#C9A962]">
                      {formatCurrency(Number(l.vendas_valor))}
                    </td>
                    <td className="px-4 py-3 text-right text-[#A3A3A3]">{l.encomendas_count}</td>
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-[#8A8A8A]">
                      Sem dados por província. Confirme que aplicou o patch provincial.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <GestaoProvincias
            provincias={linhas.map((l) => ({
              id: l.id,
              nome: l.nome,
              delegacao_nome: l.delegacao_nome,
            }))}
            produtos={produtos}
            transferencias={transferencias}
            pendentes={pendentes.length}
          />
        </>
      )}
    </main>
  );
}

function Kpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <p className="mb-1 text-xs uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className="text-xl font-medium text-[#C9A962]">{valor}</p>
    </div>
  );
}
