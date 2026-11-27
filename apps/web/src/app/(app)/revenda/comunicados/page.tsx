import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { FeedConteudos } from "@/components/conteudos/FeedConteudos";
import type { Conteudo } from "@/lib/conteudos";

export const dynamic = "force-dynamic";

/**
 * Feed Inuka — o mesmo feed do colaborador.
 *
 * A migração 0030 abriu `pode_ver_kind()` ao revendedor, por isso esta página
 * não filtra nada por papel: chama a mesma RPC que `/vendedor/comunicados` e
 * recebe a mesma lista. Se um dia a gestão publicar um comunicado novo, ele
 * aparece aqui e lá ao mesmo tempo — não há duas cópias para manter.
 *
 * O revendedor é leitor. Publicar continua a ser só da gestão, e é por isso
 * que `hrefNovo` não é passado.
 */
export default async function RevendaComunicadosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/revenda/comunicados");
  if (profile.role === "manager") redirect("/vendedor/comunicados");
  if (profile.role !== "reseller") redirect("/");

  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: "comunicado",
    p_limit: 40,
  });

  const comunicados = (data ?? []) as Conteudo[];
  const semMigracao = !!error && /PGRST202|PGRST205|does not exist/i.test(error.message);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
        Rede INUKA · revenda
      </p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Feed Inuka</h1>
        <span className="rounded-full border border-[#C9A962]/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#C9A962]">
          O mesmo feed da equipa
        </span>
      </div>
      <p className="mb-8 max-w-2xl text-sm leading-relaxed text-[#A3A3A3]">
        Tudo o que a administração publica para a equipa aparece aqui — os mesmos avisos, as mesmas
        imagens, à mesma hora. Toque num comunicado para ler tudo; pode descarregar o que precisar
        de guardar ou reenviar.
      </p>

      {semMigracao && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0030 (<code>PATCH_REVENDEDORES_FEED.sql</code>) — até lá o feed
          fica vazio.
        </div>
      )}

      {error && !semMigracao && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar os comunicados: {error.message}
        </div>
      )}

      {!error && comunicados.length === 0 && (
        <div className="mx-auto mb-5 flex max-w-[560px] flex-col items-center gap-3 rounded-2xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <Megaphone className="h-7 w-7 text-[#3F3F3F]" />
          <p className="text-sm text-[#A3A3A3]">Ainda não há comunicados publicados.</p>
          <p className="max-w-sm text-xs text-[#5F5F5F]">
            Quando a gestão publicar um comunicado para a equipa, ele aparece aqui — é o mesmo feed
            que os colaboradores vêem.
          </p>
        </div>
      )}

      {!error && (
        <FeedConteudos itens={comunicados} />
      )}
    </main>
  );
}
