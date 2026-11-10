import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgePercent, HandCoins, PackageCheck, Users } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias } from "@/lib/provincias";
import { TELEFONES_INUKA, telHref } from "@/lib/contactos";
import FormularioRevendedor from "./FormularioRevendedor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quero ser colaborador · INUKA Angola",
  description:
    "Candidate-se a colaborador INUKA: perfumes e produtos de beleza com comissão por produto vendido e acompanhamento da equipa.",
};

/**
 * Candidatura a colaborador.
 *
 * Página pública: quem chega aqui pode nem ter conta. O pedido cai em
 * `reseller_applications` e aparece ao gestor em `/gerente/revendedores`.
 *
 * Quem já é da equipa não vê esta página: manda-se para a área dele. Um
 * colaborador não se candidata ao que já é.
 */
export default async function RevendedorPage() {
  const perfil = await getProfile();
  if (perfil?.role === "seller") redirect("/vendedor");
  if (perfil?.role === "store_seller") redirect("/loja");
  if (perfil?.role === "manager") redirect("/gerente");

  const supabase = await createClientServer();
  const provincias = await listarProvincias(supabase);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
            INUKA Angola · equipa de vendas
          </p>

          <h1 className="mt-4 text-3xl font-light leading-tight tracking-tight text-[#F5F5F5] sm:text-5xl">
            Venda INUKA
            <span className="block text-[#C9A962]">na sua zona.</span>
          </h1>

          <p className="mt-5 max-w-lg text-sm leading-relaxed text-[#A3A3A3] sm:text-base">
            Perfumes e produtos de beleza com comissão por produto vendido, carteira de clientes
            própria e apoio da equipa. Deixe o seu contacto — a gestão fala consigo.
          </p>

          <ul className="mt-8 space-y-4">
            <Vantagem
              icone={<HandCoins className="h-4 w-4" />}
              titulo="Comissão por produto"
              texto="Uma percentagem definida pela empresa, igual para toda a equipa, paga sobre cada produto vendido."
            />
            <Vantagem
              icone={<Users className="h-4 w-4" />}
              titulo="Carteira de clientes"
              texto="Os seus clientes ficam associados à sua referência INUKA — e o histórico é seu."
            />
            <Vantagem
              icone={<PackageCheck className="h-4 w-4" />}
              titulo="Produtos com stock real"
              texto="Só se vende o que existe, na sua província. Sem prometer o que não há."
            />
            <Vantagem
              icone={<BadgePercent className="h-4 w-4" />}
              titulo="Formação INUKA"
              texto="Cursos, comunicados e materiais da marca na área de colaborador."
            />
          </ul>

          <div className="mt-9 rounded-xl border border-[#262626] bg-[#141414] p-5">
            <p className="text-xs text-[#6F6F6F]">Prefere falar já com alguém?</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {TELEFONES_INUKA.map((t) => (
                <a
                  key={t}
                  href={telHref(t)}
                  className="text-[#C9A962] transition hover:text-[#E3D5A7]"
                >
                  {t}
                </a>
              ))}
            </p>
          </div>
        </div>

        <div className="lg:sticky lg:top-24">
          <FormularioRevendedor provincias={provincias} />

          <p className="mt-4 text-center text-[11px] text-[#525252]">
            Já é cliente INUKA?{" "}
            <Link href="/login" className="text-[#C9A962] hover:underline">
              Entre na sua conta
            </Link>{" "}
            — a gestão também pode promover a sua conta a colaborador.
          </p>
        </div>
      </div>
    </main>
  );
}

function Vantagem({
  icone,
  titulo,
  texto,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#C9A962]/10 text-[#C9A962]">
        {icone}
      </span>
      <div>
        <p className="text-sm text-[#F5F5F5]">{titulo}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#8A8A8A]">{texto}</p>
      </div>
    </li>
  );
}
