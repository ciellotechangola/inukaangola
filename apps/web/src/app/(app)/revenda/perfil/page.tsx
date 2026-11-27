import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { normalizarFicha } from "@/lib/rede";
import FichaRevendedorProfissional from "@/components/revenda/FichaRevendedorProfissional";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "O meu perfil de revendedor · INUKA",
};

/**
 * O perfil do revendedor, visto por ele.
 *
 * É a mesma ficha que a gestão abre em `/gerente/rede/[id]` — identidade,
 * condições de grosso, números, histórico de 6 meses e pedidos com itens —
 * sem o painel de edição. Um revendedor profissional tem de poder mostrar o
 * que fez, não apenas vê-lo num WhatsApp.
 */
export default async function PerfilRevendaPage() {
  const perfil = await getProfile();
  if (!perfil) redirect("/login");
  // A gestão tem a rede inteira em /gerente/rede — não precisa de uma ficha só.
  if (perfil.role === "manager") redirect("/gerente/rede");
  if (perfil.role !== "reseller") redirect("/");

  const supabase = await createClientServer();
  const { data: id } = await supabase.rpc("meu_revendedor");

  if (!id) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
          INUKA Angola · grosso e revenda
        </p>
        <h1 className="mt-3 text-2xl font-light text-[#F5F5F5]">A sua ficha está a ser criada</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#A3A3A3]">
          A conta de revendedor existe, mas a ficha comercial ainda não foi emitida pela gestão.
          Fale com o gerente da sua província — assim que a ficha estiver pronta, o perfil aparece
          aqui com o seu histórico e as suas condições de grosso.
        </p>
        <Link
          href="/revenda"
          className="mt-6 inline-block rounded-lg border border-[#C9A962]/40 px-5 py-2.5 text-sm text-[#C9A962] transition hover:bg-[#C9A962]/10"
        >
          Voltar à área de revenda
        </Link>
      </main>
    );
  }

  const { data, error } = await supabase.rpc("revendedor_ficha", { p_id: id as string });
  const ficha = normalizarFicha(data);

  if (error || !ficha) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-light text-[#F5F5F5]">Não foi possível abrir o perfil</h1>
        <p className="mt-3 text-sm text-[#A3A3A3]">
          {error?.message ?? "A ficha não devolveu dados."}
        </p>
        <Link
          href="/revenda"
          className="mt-6 inline-block rounded-lg border border-[#C9A962]/40 px-5 py-2.5 text-sm text-[#C9A962] transition hover:bg-[#C9A962]/10"
        >
          Voltar à área de revenda
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <FichaRevendedorProfissional
        ficha={ficha}
        modo="proprio"
        voltar={{ href: "/revenda", label: "Área de revenda" }}
      />
    </main>
  );
}
