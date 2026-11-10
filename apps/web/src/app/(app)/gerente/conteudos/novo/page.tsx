import { redirect } from "next/navigation";
import Link from "next/link";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias, type Provincia } from "@/lib/provincias";
import { FormularioComunicado } from "./FormularioComunicado";

export const dynamic = "force-dynamic";

/**
 * Publicar um comunicado — o caminho curto.
 *
 * O estúdio de design continua a ser o sítio para peças compostas (cartazes com
 * preço, produtos anunciados, promoções com datas). Isto é para o aviso do dia:
 * um título, um texto e, se houver, uma fotografia. Sem passar pelo estúdio,
 * que era o que afastava a gestão de publicar.
 */
export default async function NovoComunicadoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "manager") redirect("/");

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
      <h1 className="text-3xl font-light text-[#F5F5F5]">Novo comunicado</h1>
      <p className="mt-2 mb-8 text-sm text-[#A3A3A3]">
        Aparece no feed dos colaboradores e nas notícias dos clientes. Pode publicar
        agora ou guardar como rascunho e acabar depois.
      </p>

      <FormularioComunicado provincias={provincias as Provincia[]} />
    </main>
  );
}
