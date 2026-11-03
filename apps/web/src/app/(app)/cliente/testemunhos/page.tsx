import { redirect } from "next/navigation";
import Link from "next/link";
import { Quote } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { CartaoConteudo } from "@/components/conteudos/CartaoConteudo";
import type { Conteudo } from "@/lib/conteudos";

export const dynamic = "force-dynamic";

/**
 * Testemunhos de clientes.
 *
 * Só aparecem os publicados pela gestão. O nome ou identificação do cliente é
 * o que a gestão escreveu no campo `author_name` — a base não guarda aqui o
 * perfil de ninguém, precisamente para não expor dados de quem deu o depoimento.
 */
export default async function TestemunhosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/cliente/testemunhos");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: "testemunho",
    p_limit: 40,
  });

  const testemunhos = (data ?? []) as Conteudo[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Área de cliente
      </p>
      <h1 className="text-3xl font-light text-[#F5F5F5]">Testemunhos de Clientes</h1>
      <p className="mb-8 mt-2 max-w-2xl text-sm text-[#A3A3A3]">
        Histórias de quem já usa os produtos INUKA. Publicados pela gestão, com autorização de
        quem os deu.
      </p>

      {error && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar os testemunhos: {error.message}
        </div>
      )}

      {!error && testemunhos.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <Quote className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há testemunhos publicados.</p>
          <Link href="/catalogo" className="mt-2 text-xs text-[#C9A962] hover:underline">
            Ver o catálogo
          </Link>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {testemunhos.map((c) => (
          <CartaoConteudo
            key={c.id}
            conteudo={c}
            variante="testemunho"
            detalheHref={`/cliente/testemunhos/${c.id}`}
          />
        ))}
      </div>
    </main>
  );
}
