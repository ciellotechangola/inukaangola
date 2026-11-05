import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { CarteiraClientes, type LinhaCarteira, type TotaisCliente } from "./CarteiraClientes";

export const dynamic = "force-dynamic";

/**
 * Carteira do colaborador.
 *
 * A lista junta duas coisas com o mesmo aspecto mas naturezas diferentes:
 *
 *  - **clientes** — contas reais, ligadas por `seller_customers`;
 *  - **reservados** — pessoas que o colaborador registou mas que ainda não
 *    abriram conta (`reserved_customers`). Não têm acesso, não têm palavra-
 *    passe, não podem receber mensagens: só existem para que, no dia em que se
 *    registarem com aquele número, fiquem automaticamente com quem as registou.
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

  const ligacoes = (vinculos ?? []) as {
    id: string;
    customer_id: string;
    assigned_at: string;
  }[];

  const ids = ligacoes.map((l) => l.customer_id);

  const { data: perfis } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, phone, neighborhood")
        .in("id", ids)
    : {
        data: [] as {
          id: string;
          full_name: string;
          phone: string | null;
          neighborhood: string | null;
        }[],
      };

  const porId = new Map(
    (
      (perfis ?? []) as {
        id: string;
        full_name: string;
        phone: string | null;
        neighborhood: string | null;
      }[]
    ).map((p) => [p.id, p])
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

  // --- Reservas por activar -------------------------------------------------
  const { data: reservas, error: erroReservas } = await supabase
    .from("reserved_customers")
    .select("id, full_name, phone, neighborhood, provincia_id, notes, created_at")
    .eq("status", "reservado")
    .order("created_at", { ascending: false });

  const reservasLidas = (reservas ?? []) as {
    id: string;
    full_name: string | null;
    phone: string;
    neighborhood: string | null;
    provincia_id: string | null;
    notes: string | null;
    created_at: string;
  }[];

  // Nome da província de cada reserva (a do colaborador, na prática).
  const provIds = [...new Set(reservasLidas.map((r) => r.provincia_id).filter(Boolean))] as string[];
  const { data: provincias } = provIds.length
    ? await supabase.from("provincias").select("id, nome").in("id", provIds)
    : { data: [] as { id: string; nome: string }[] };

  const provinciaPorId = new Map(
    ((provincias ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome])
  );

  // Compras registadas com estes telefones e ainda sem dono. É o que o cliente
  // vai herdar no registo — o colaborador tem de o ver antes, para saber que
  // vale a pena ir atrás da pessoa.
  const pendentesPorTelefone = new Map<
    string,
    { compras: number; total: number; produtos: { nome: string; quantidade: number }[] }
  >();
  const telefones = reservasLidas.map((r) => r.phone);
  if (telefones.length) {
    const { data: pendentes } = await supabase
      .from("sales")
      .select("id, customer_phone, total_amount")
      .is("customer_id", null)
      .in("customer_phone", telefones);

    const vendasPendentes = (pendentes ?? []) as {
      id: string;
      customer_phone: string | null;
      total_amount: number | string;
    }[];

    const telefoneDaVenda = new Map<string, string>();
    for (const v of vendasPendentes) {
      if (!v.customer_phone) continue;
      telefoneDaVenda.set(v.id, v.customer_phone);
      const atual = pendentesPorTelefone.get(v.customer_phone) ?? {
        compras: 0,
        total: 0,
        produtos: [],
      };
      atual.compras += 1;
      atual.total += Number(v.total_amount) || 0;
      pendentesPorTelefone.set(v.customer_phone, atual);
    }

    // O que foi comprado, produto a produto. Sem isto a linha da carteira só
    // sabia dizer «2 compras» — e o colaborador tinha de abrir a venda para
    // saber o quê.
    if (telefoneDaVenda.size) {
      const { data: itens } = await supabase
        .from("sale_items")
        .select("sale_id, quantity, product_snapshot")
        .in("sale_id", [...telefoneDaVenda.keys()]);

      for (const it of (itens ?? []) as {
        sale_id: string;
        quantity: number;
        product_snapshot: { name?: string } | null;
      }[]) {
        const telefone = telefoneDaVenda.get(it.sale_id);
        if (!telefone) continue;
        const registo = pendentesPorTelefone.get(telefone);
        if (!registo) continue;
        registo.produtos.push({
          nome: it.product_snapshot?.name?.trim() || "Produto",
          quantidade: it.quantity,
        });
      }
    }
  }

  const linhas: LinhaCarteira[] = [
    ...reservasLidas.map((r) => {
      const pendente = pendentesPorTelefone.get(r.phone);
      return {
        id: r.id,
        tipo: "reservado" as const,
        desde: r.created_at,
        nome: r.full_name?.trim() || "Cliente por activar",
        telefone: r.phone,
        bairro: r.neighborhood,
        provincia: r.provincia_id ? provinciaPorId.get(r.provincia_id) ?? null : null,
        customerId: null,
        notas: r.notes,
        comprasPendentes: pendente?.compras ?? 0,
        valorPendente: pendente?.total ?? 0,
        produtos: pendente?.produtos ?? [],
      };
    }),
    ...ligacoes
      .map((l) => {
        const p = porId.get(l.customer_id);
        return {
          id: l.id,
          tipo: "cliente" as const,
          desde: l.assigned_at,
          nome: p?.full_name ?? "Cliente",
          telefone: p?.phone ?? null,
          bairro: p?.neighborhood ?? null,
          provincia: null,
          customerId: p?.id ?? null,
          notas: null,
          comprasPendentes: 0,
          valorPendente: 0,
          produtos: [],
        };
      })
      // Um perfil apagado deixa o vínculo órfão: não se mostra uma linha vazia.
      .filter((l) => l.customerId !== null),
  ];

  const erroInicial = erroReservas
    ? "A lista de clientes por activar ainda não existe na base de dados. Aplique supabase/PATCH_RESERVAS.sql no SQL Editor do Supabase."
    : error?.message ?? null;

  // Total vendido por este colaborador. Conta **todas** as vendas dele, com
  // conta associada ou não: somar só os clientes já vinculados deixava de fora
  // as vendas a telefones por activar, e o colaborador via um número abaixo
  // do que realmente vendeu.
  const { data: minhasVendas } = await supabase
    .from("sales")
    .select("total_amount")
    .eq("seller_id", perfil.id);

  const totalVendido = ((minhasVendas ?? []) as { total_amount: number | string }[]).reduce(
    (n, v) => n + (Number(v.total_amount) || 0),
    0
  );

  return (
    <CarteiraClientes
      iniciais={linhas}
      totaisIniciais={totais}
      totalVendido={totalVendido}
      erroInicial={erroInicial}
    />
  );
}
