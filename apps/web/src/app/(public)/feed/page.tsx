import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LogIn, Sparkles, UserPlus } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import type { Conteudo } from "@/lib/conteudos";
import { FeedClientes } from "@/components/conteudos/FeedClientes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feed Clientes — promoções e testemunhos | INUKA Angola",
  description:
    "As promoções em curso e os testemunhos de quem já usa INUKA Angola. Aberto a todos, sem precisar de conta.",
};

/**
 * Feed Clientes público.
 *
 * A mesma coisa que o cliente vê dentro da área dele, mas sem sessão: um
 * visitante que chega do Instagram ou de um link de WhatsApp tem de conseguir
 * ver as promoções e os testemunhos sem criar conta. Pedir registo antes de
 * mostrar o que a marca tem para oferecer é a maneira mais rápida de perder
 * quem estava interessado.
 *
 * A base de dados já limita o que sai daqui: `conteudo_feed` só devolve
 * `promocao` e `testemunho` a quem não tem sessão, dentro das datas e da
 * província. Os comunicados internos nunca aparecem.
 */
export default async function FeedPublicoPage() {
  const [supabase, perfil] = await Promise.all([createClientServer(), getProfile()]);

  // Duas chamadas porque a RPC filtra por tipo. Pedir `null` traria também os
  // comunicados a quem é da equipa — e esta página é do cliente.
  const [promocoes, testemunhos] = await Promise.all([
    supabase.rpc("conteudo_feed", { p_kind: "promocao", p_limit: 40 }),
    supabase.rpc("conteudo_feed", { p_kind: "testemunho", p_limit: 40 }),
  ]);

  const erro = promocoes.error ?? testemunhos.error ?? null;

  const itens = [...((promocoes.data ?? []) as Conteudo[]), ...((testemunhos.data ?? []) as Conteudo[])]
    // Fixado primeiro, depois o mais recente — a mesma ordem da RPC.
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
    });

  const casa = perfil
    ? perfil.role === "manager"
      ? "/gerente"
      : perfil.role === "seller"
        ? "/vendedor"
        : perfil.role === "store_seller"
          ? "/loja"
          : "/cliente"
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:pt-14">
      <header className="mb-8">
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
          <Sparkles className="h-3 w-3" />
          INUKA Angola · aberto a todos
        </p>
        <h1 className="mt-3 text-3xl font-light leading-tight text-[#F5F5F5] sm:text-4xl">
          Feed Clientes
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#A3A3A3]">
          As promoções em curso e os testemunhos de quem já usa INUKA. Não precisa de conta para
          ver — para reagir e comentar, entra ou cria a sua em menos de um minuto.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {casa ? (
            <Link
              href={casa}
              className="inline-flex items-center gap-2 rounded-full bg-[#C9A962] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
            >
              A minha área
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link
                href="/login?next=/feed"
                className="inline-flex items-center gap-2 rounded-full bg-[#C9A962] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
              >
                <LogIn className="h-4 w-4" />
                Iniciar sessão
              </Link>
              <Link
                href="/registo"
                className="inline-flex items-center gap-2 rounded-full border border-[#C9A962]/50 px-5 py-2.5 text-sm text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
              >
                <UserPlus className="h-4 w-4" />
                Criar conta de cliente
              </Link>
            </>
          )}
          <Link
            href="/catalogo"
            className="inline-flex items-center gap-1.5 text-sm text-[#A3A3A3] transition hover:text-[#C9A962]"
          >
            Ver o catálogo
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {erro && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar o feed: {erro.message}
        </div>
      )}

      {!erro && (
        <FeedClientes
          itens={itens}
          soLeitura={!perfil}
          vazio="Ainda não há promoções nem testemunhos publicados. Volte em breve — ou veja o catálogo."
        />
      )}

      <p className="mx-auto mt-8 max-w-[560px] text-center text-[10px] text-[#4F4F4F]">
        Publicado pela gestão INUKA · {itens.length}{" "}
        {itens.length === 1 ? "publicação" : "publicações"}
      </p>
    </main>
  );
}
