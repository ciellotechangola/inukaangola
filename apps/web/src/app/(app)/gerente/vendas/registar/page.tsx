import { redirect } from "next/navigation";
import FormularioVenda, { type ColaboradorDaVenda } from "@/components/vendas/FormularioVenda";
import { getProfile } from "@/lib/auth";
import { createClientServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Registar venda na gestão.
 *
 * A diferença em relação à tela do colaborador é uma só: aqui escolhe-se a
 * quem pertence a venda. Sem escolha, a venda é da casa (fica com o gestor e
 * não gera comissão); com escolha, a comissão e a carteira do cliente vão para
 * esse colaborador. Um gestor provincial só vê os colaboradores da sua
 * província — a base de dados recusa os outros de qualquer forma.
 */
export default async function RegistoDeVendaDaGestao() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const nacional = profile.is_national_admin || profile.provincia_id === null;

  let consulta = supabase
    .from("profiles")
    .select("id, full_name, provincia:provincias(nome)")
    .eq("role", "seller")
    .eq("is_active", true)
    .order("full_name");

  if (!nacional && profile.provincia_id) {
    consulta = consulta.eq("provincia_id", profile.provincia_id);
  }

  const { data } = await consulta;

  // O PostgREST devolve o embutido de uma relação muitos-para-um como objecto,
  // mas a inferência do cliente Supabase não sabe disso e tipa-o como lista.
  type Linha = {
    id: string;
    full_name: string;
    provincia: { nome: string } | { nome: string }[] | null;
  };

  const colaboradores: ColaboradorDaVenda[] = ((data ?? []) as unknown as Linha[]).map((c) => ({
    id: c.id,
    nome: c.full_name,
    provincia: Array.isArray(c.provincia) ? (c.provincia[0]?.nome ?? null) : (c.provincia?.nome ?? null),
  }));

  return (
    <FormularioVenda
      colaboradores={colaboradores}
      podeEscolherColaborador
      voltar={{ href: "/gerente", label: "Painel de gestão" }}
      titulo="Registar venda"
    />
  );
}
