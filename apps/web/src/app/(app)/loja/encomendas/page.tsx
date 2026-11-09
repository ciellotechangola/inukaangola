import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import EncomendasLoja from "./EncomendasLoja";

export const dynamic = "force-dynamic";

export default async function EncomendasDaLojaPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "store_seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  let nomeProvincia: string | null = null;

  if (profile.provincia_id) {
    const { data } = await supabase
      .from("provincias")
      .select("nome")
      .eq("id", profile.provincia_id)
      .maybeSingle();
    nomeProvincia = (data as { nome: string } | null)?.nome ?? null;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-6">
        <h1 className="mb-1 text-3xl font-light text-[#F5F5F5]">Encomendas</h1>
        <p className="text-[#A3A3A3]">
          Pedidos {nomeProvincia ? `de ${nomeProvincia}` : "da sede"} para confirmar, preparar e
          entregar. Concluir uma encomenda dá baixa no stock desta província.
        </p>
      </header>

      <EncomendasLoja provinciaId={profile.provincia_id} />
    </main>
  );
}
