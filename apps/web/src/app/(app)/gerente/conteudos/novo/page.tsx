import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias, type Provincia } from "@/lib/provincias";
import type { TipoConteudo } from "@/lib/conteudos";
import { FormularioConteudo } from "./FormularioConteudo";

export const dynamic = "force-dynamic";

const TIPOS_VALIDOS: TipoConteudo[] = ["comunicado", "promocao", "testemunho", "formacao"];

const TITULO: Record<TipoConteudo, { titulo: string; ajuda: string }> = {
  comunicado: {
    titulo: "Novo comunicado",
    ajuda:
      "Aparece no Feed Inuka — colaboradores, vendedor de loja e gestão. Os clientes não o vêem.",
  },
  promocao: {
    titulo: "Nova promoção",
    ajuda: "Aparece no Feed Clientes e nas promoções da loja, à vista de todos os clientes.",
  },
  testemunho: {
    titulo: "Novo testemunho",
    ajuda: "Aparece no Feed Clientes. Escreva no campo do autor o nome de quem deu o depoimento.",
  },
  formacao: {
    titulo: "Nova formação",
    ajuda: "Fica na área de formação dos colaboradores. Os clientes não a vêem.",
  },
};

/**
 * Publicar um conteúdo — o caminho curto.
 *
 * O estúdio de design continua a ser o sítio para peças compostas (cartazes com
 * preço, produtos anunciados, promoções com datas). Isto é para o que é do dia:
 * um título, um texto e, se houver, uma fotografia. Sem passar pelo estúdio,
 * que era o que afastava a gestão de publicar.
 *
 * O tipo vem no endereço (`?tipo=promocao`) para os botões de cada feed abrirem
 * o formulário já no sítio certo — quem está a olhar para o Feed Clientes não
 * devia ter de escolher outra vez o que quer publicar.
 */
export default async function NovoConteudoPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

  const { tipo } = await searchParams;
  const inicial: TipoConteudo = TIPOS_VALIDOS.includes(tipo as TipoConteudo)
    ? (tipo as TipoConteudo)
    : "comunicado";

  const supabase = await createClientServer();
  const provincias = await listarProvincias(supabase);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/gerente/conteudos"
        className="mb-6 inline-block text-sm text-[#A3A3A3] transition hover:text-[#C9A962]"
      >
        ← Conteúdos
      </Link>

      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">Gestão</p>
      <h1 className="text-3xl font-light text-[#F5F5F5]">{TITULO[inicial].titulo}</h1>
      <p className="mt-2 mb-8 text-sm text-[#A3A3A3]">
        {TITULO[inicial].ajuda} Pode publicar agora ou guardar como rascunho e acabar depois.
      </p>

      <FormularioConteudo provincias={provincias as Provincia[]} inicial={inicial} />
    </main>
  );
}
