import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { FeedComunicados } from "@/components/conteudos/FeedComunicados";
import type { Conteudo } from "@/lib/conteudos";

export const dynamic = "force-dynamic";

/**
 * Feed de comunicados da gestão.
 *
 * Só colaboradores e gestão entram aqui. O RLS garante que um cliente não vê
 * estas linhas, mas a página também redirecciona — não vale a pena mostrar uma
 * lista vazia a quem não devia estar a ler.
 *
 * A gestão é editora (publica), o colaborador é leitor. O feed mostra o cartão
 * e o texto completo abre por cima, a pedido — é o formato que o colaborador
 * já conhece do telemóvel.
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
  const gestor = profile.role === "manager";

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
        {gestor
          ? "Avisos oficiais da administração INUKA. Publique uma imagem ou um texto — os colaboradores recebem aqui."
          : "Avisos oficiais da administração INUKA. Toque num comunicado para ler tudo; pode descarregar o que precisar de guardar."}
      </p>

      {error && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar os comunicados: {error.message}
        </div>
      )}

      {!error && comunicados.length === 0 && (
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-3 rounded-2xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <Megaphone className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há comunicados publicados.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            {gestor
              ? "Use «Publicar comunicado» para pôr aqui o primeiro aviso, com imagem se quiser."
              : "Quando a gestão publicar um comunicado, ele aparece aqui."}
          </p>
        </div>
      )}

      {comunicados.length > 0 && (
        <FeedComunicados
          itens={comunicados}
          hrefNovo={gestor ? "/gerente/conteudos/novo" : undefined}
        />
      )}
    </main>
  );
}
