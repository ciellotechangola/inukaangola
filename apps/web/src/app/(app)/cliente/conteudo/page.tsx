import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Sparkles } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import type { Conteudo } from "@/lib/conteudos";
import { FeedClientes } from "./FeedClientes";

export const dynamic = "force-dynamic";

/** O que o cliente pode ver aqui. A base de dados já o garante; isto é a rede. */
const DO_CLIENTE = new Set(["promocao", "testemunho"]);

/**
 * Feed Clientes — o feed do cliente.
 *
 * Promoções e testemunhos de quem já usa INUKA. Os comunicados da gestão não
 * aparecem: são avisos internos, exclusivos da equipa (migração 0019). O que
 * está aqui é o que a gestão publicou para o cliente ver, com o mesmo cartão
 * do Feed Inuka.
 *
 * Uma só chamada (`conteudo_feed`) traz tudo o que um cartão precisa: texto,
 * imagem, produtos, contagem de reacções e comentários, e a reacção de quem
 * está a ver. A gestão vê ainda quem reagiu, em cada cartão.
 */
export default async function FeedClientesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "customer" && profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: null,
    p_limit: 40,
  });

  // A gestão recebe o feed inteiro (é gestora) — aqui só entram os dois tipos
  // que o cliente vê, para as duas vistas serem o mesmo ecrã.
  const publicacoes = ((data ?? []) as Conteudo[]).filter((c) => DO_CLIENTE.has(c.kind));
  const gestor = profile.role === "manager";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Área de cliente
      </p>
      <h1 className="text-3xl font-light text-[#F5F5F5]">Feed Clientes</h1>
      <p className="mb-6 mt-2 max-w-xl text-sm text-[#A3A3A3]">
        Promoções em curso e testemunhos de quem já usa INUKA. Reaja e comente — a equipa lê.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-[#2A1010] p-3 text-sm text-[#F87171]">
          Não foi possível carregar o feed: {error.message}
        </div>
      )}

      {!error && (
        <FeedClientes
          itens={publicacoes}
          hrefNovo={gestor ? "/gerente/conteudos/novo?tipo=promocao" : undefined}
          gerirReacoes={gestor}
        />
      )}

      <div className="mx-auto mt-10 max-w-[560px] rounded-xl border border-[#262626] bg-[#141414] p-5 text-center">
        <p className="mb-3 text-sm text-[#A3A3A3]">Tem uma dúvida sobre uma publicação?</p>
        <Link
          href="/referencia"
          className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962]/40 px-4 py-2 text-sm text-[#C9A962] transition hover:bg-[#C9A962]/10"
        >
          <MessageSquare className="h-4 w-4" />
          Falar com a equipa
        </Link>
      </div>

      <p className="mx-auto mt-4 flex max-w-[560px] items-center justify-center gap-1.5 text-[10px] text-[#4F4F4F]">
        <Sparkles className="h-3 w-3" /> Publicado pela gestão INUKA
      </p>
    </main>
  );
}
