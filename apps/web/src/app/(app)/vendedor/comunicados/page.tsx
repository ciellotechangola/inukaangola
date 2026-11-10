import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { FeedConteudos } from "@/components/conteudos/FeedConteudos";
import type { Conteudo } from "@/lib/conteudos";

export const dynamic = "force-dynamic";

/**
 * Feed Inuka — comunicados da gestão.
 *
 * É o feed **da equipa**: colaboradores de vendas, vendedores de loja e gestão.
 * Um cliente não entra aqui, e desde a migração 0019 também não vê os
 * comunicados no feed dele: são avisos internos, não notícias da empresa.
 *
 * A gestão é editora (publica e vê quem reagiu), o resto da equipa é leitor. O
 * feed mostra o cartão e o texto completo abre por cima, a pedido — é o formato
 * que a equipa já conhece do telemóvel.
 */
export default async function FeedInukaPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!["seller", "store_seller", "manager"].includes(profile.role)) redirect("/");

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
        Equipa INUKA
      </p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Feed Inuka</h1>
        <nav className="flex gap-2 text-xs">
          <Link
            href="/vendedor/comunicados"
            className="rounded-lg border border-[#C9A962] px-3 py-1.5 text-[#C9A962]"
          >
            Feed Inuka
          </Link>
          {profile.role !== "store_seller" && (
            <Link
              href="/vendedor/formacao"
              className="rounded-lg border border-[#333] px-3 py-1.5 text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            >
              Formação
            </Link>
          )}
        </nav>
      </div>
      <p className="mb-8 text-sm text-[#A3A3A3]">
        {gestor
          ? "Avisos oficiais da administração INUKA. Publique uma imagem ou um texto — a equipa recebe aqui, e só a equipa."
          : "Avisos oficiais da administração INUKA. Toque num comunicado para ler tudo; pode descarregar o que precisar de guardar."}
      </p>

      {error && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar os comunicados: {error.message}
        </div>
      )}

      {!error && comunicados.length === 0 && (
        <div className="mx-auto mb-5 flex max-w-[560px] flex-col items-center gap-3 rounded-2xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <Megaphone className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há comunicados publicados.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            {gestor
              ? "Use «Publicar comunicado» para pôr aqui o primeiro aviso, com imagem se quiser."
              : "Quando a gestão publicar um comunicado, ele aparece aqui."}
          </p>
        </div>
      )}

      {/* Renderizado mesmo vazio: é aqui que vive o botão de publicar da gestão. */}
      {!error && (
        <FeedConteudos
          itens={comunicados}
          hrefNovo={gestor ? "/gerente/conteudos/novo?tipo=comunicado" : undefined}
          rotuloNovo="Publicar comunicado"
          gerirReacoes={gestor}
        />
      )}
    </main>
  );
}
