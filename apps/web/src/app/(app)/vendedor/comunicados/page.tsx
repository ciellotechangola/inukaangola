import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { CartaoConteudo } from "@/components/conteudos/CartaoConteudo";
import type { Conteudo } from "@/lib/conteudos";

export const dynamic = "force-dynamic";

/**
 * Feed de comunicados da gestão.
 *
 * Só colaboradores e gestão entram aqui. O RLS garante que um cliente não vê
 * estas linhas, mas a página também redirecciona — não vale a pena mostrar uma
 * lista vazia a quem não devia estar a ler.
 */
export default async function ComunicadosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "seller" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: "comunicado",
    p_limit: 40,
  });

  const comunicados = (data ?? []) as Conteudo[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Área de colaborador
      </p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Comunicados da gestão</h1>
        <nav className="flex gap-2 text-xs">
          <Link
            href="/vendedor/comunicados"
            className="rounded-lg border border-[#C9A962] px-3 py-1.5 text-[#C9A962]"
          >
            Comunicados
          </Link>
          <Link
            href="/vendedor/formacao"
            className="rounded-lg border border-[#333] px-3 py-1.5 text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            Formação
          </Link>
        </nav>
      </div>
      <p className="mb-8 text-sm text-[#A3A3A3]">
        Avisos oficiais da administração INUKA. Os comunicados importantes ficam no topo.
      </p>

      {error && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar os comunicados: {error.message}
        </div>
      )}

      {!error && comunicados.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <Megaphone className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há comunicados publicados.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            Quando a gestão publicar um comunicado no estúdio, ele aparece aqui.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {comunicados.map((c) => (
          <CartaoConteudo key={c.id} conteudo={c} variante="feed" />
        ))}
      </div>
    </main>
  );
}
