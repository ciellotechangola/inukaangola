import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Newspaper } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import type { Conteudo } from "@/lib/conteudos";
import Feed from "./Feed";

export const dynamic = "force-dynamic";

/**
 * Feed de notícias do cliente.
 *
 * Uma só chamada (`conteudo_feed`) traz tudo o que um cartão precisa: texto,
 * imagem, produtos, contagem de reações e comentários, e a reacção de quem
 * está a ver. É a mesma função que serve as promoções da loja — a diferença
 * está na visibilidade, definida na migração 0013.
 */
export default async function ConteudoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "customer" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: null,
    p_limit: 40,
  });

  const conteudos = (data ?? []) as Conteudo[];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="mb-1 flex items-center gap-2 text-3xl font-light text-[#F5F5F5]">
          <Newspaper className="h-7 w-7 text-[#C9A962]" />
          Notícias
        </h1>
        <p className="text-[#A3A3A3]">
          Comunicados, novidades e promoções da INUKA. Reaja e comente — a equipa lê.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg bg-[#2A1010] p-3 text-sm text-[#F87171]">
          Não foi possível carregar o feed: {error.message}
        </div>
      )}

      <Feed conteudos={conteudos} />

      <div className="mt-8 rounded-xl border border-[#262626] bg-[#141414] p-5 text-center">
        <p className="mb-3 text-sm text-[#A3A3A3]">
          Tem uma dúvida sobre uma publicação?
        </p>
        <Link
          href="/referencia"
          className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962]/40 px-4 py-2 text-sm text-[#C9A962] transition hover:bg-[#C9A962]/10"
        >
          <MessageSquare className="h-4 w-4" />
          Falar com a equipa
        </Link>
      </div>
    </main>
  );
}
