import Link from "next/link";
import { redirect } from "next/navigation";
import {
  HandCoins,
  Headphones,
  PackageCheck,
  Percent,
  Truck,
} from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias } from "@/lib/provincias";
import { TELEFONES_INUKA, telHref } from "@/lib/contactos";
import FormularioRevendedor from "./FormularioRevendedor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ser revendedor INUKA · preço de grosso",
  description:
    "Compre INUKA ao preço de grosso, a partir de 5 unidades, e revenda em Angola. Catálogo directo, gerente dedicado na sua província e apoio da administração nacional.",
};

/**
 * Porta pública do revendedor.
 *
 * Quem chega aqui pode nem ter conta: o pedido cai em
 * `revendedor_candidaturas` e aparece à gestão em `/gerente/revendedores`.
 * A conta só é criada depois de a gestão aprovar — um revendedor não nasce
 * de um formulário, nasce de uma conversa.
 */
export default async function SerRevendedorPage() {
  const perfil = await getProfile();
  if (perfil?.role === "reseller") redirect("/revenda");
  if (perfil?.role === "seller") redirect("/vendedor");
  if (perfil?.role === "store_seller") redirect("/loja");
  if (perfil?.role === "manager") redirect("/gerente/revendedores");

  const supabase = await createClientServer();
  const provincias = await listarProvincias(supabase);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
            INUKA Angola · grosso e revenda
          </p>

          <h1 className="mt-4 text-3xl font-light leading-tight tracking-tight text-[#F5F5F5] sm:text-5xl">
            Compre ao preço
            <span className="block text-[#C9A962]">de grosso.</span>
          </h1>

          <p className="mt-5 max-w-lg text-sm leading-relaxed text-[#A3A3A3] sm:text-base">
            Para lojas, salões, marketplaces e quem revende a sério. Compra a partir de{" "}
            <strong className="font-medium text-[#E5E5E5]">5 unidades por produto</strong>, a um
            preço próximo do custo de importação, e revende em Angola com a margem que definir.
          </p>

          <div className="mt-7 grid grid-cols-3 gap-3">
            <Numero valor="5+" rotulo="unidades mínimas" />
            <Numero valor="35%" rotulo="desconto de grosso" />
            <Numero valor="18" rotulo="províncias" />
          </div>

          <ul className="mt-8 space-y-4">
            <Vantagem
              icone={<Percent className="h-4 w-4" />}
              titulo="Preço de grosso, não de montra"
              texto="Cada produto tem um preço de revenda próprio. Quando não tem, aplica-se o desconto de grosso da empresa — sempre visível ao lado do preço de loja."
            />
            <Vantagem
              icone={<PackageCheck className="h-4 w-4" />}
              titulo="Catálogo directo e stock real"
              texto="Entra, vê o que existe na sua província e monta o pedido em minutos. Sem tabelas em PDF nem conversas perdidas no WhatsApp."
            />
            <Vantagem
              icone={<HandCoins className="h-4 w-4" />}
              titulo="Margem sua, preço nosso"
              texto="O preço de revenda é o seu custo. O preço de venda ao público é decisão sua — a INUKA não lhe impõe margem."
            />
            <Vantagem
              icone={<Headphones className="h-4 w-4" />}
              titulo="Gerente da sua província"
              texto="Fala directamente com o gerente provincial e com a administração nacional, dentro da plataforma, com o histórico do pedido ao lado."
            />
            <Vantagem
              icone={<Truck className="h-4 w-4" />}
              titulo="Preparação e entrega acompanhadas"
              texto="Cada pedido tem número e estado: em análise, cotado, aprovado, enviado e entregue. Sabe sempre onde está."
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

          <div className="mt-4 rounded-xl border border-[#262626] bg-[#111] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#525252]">
              Como funciona
            </p>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-[#8A8A8A]">
              <Passo n="1" titulo="Envia a candidatura">
                Nome da empresa ou seu, telefone, província e o que pretende revender.
              </Passo>
              <Passo n="2" titulo="A gestão analisa">
                O gerente da sua província recebe os dados e entra em contacto.
              </Passo>
              <Passo n="3" titulo="Recebe o acesso">
                Conta de revendedor com catálogo de grosso, preços e pedidos.
              </Passo>
              <Passo n="4" titulo="Compra e revende">
                A partir de 5 unidades por produto, com entrega acompanhada.
              </Passo>
            </ol>
          </div>

          <p className="mt-4 text-center text-[11px] text-[#525252]">
            Já é cliente INUKA?{" "}
            <Link href="/login" className="text-[#C9A962] hover:underline">
              Entre na sua conta
            </Link>{" "}
            — a gestão pode promover a sua conta a revendedor.
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

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#141414] px-3 py-3">
      <p className="text-xl font-light text-[#C9A962]">{valor}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-[#6F6F6F]">{rotulo}</p>
    </div>
  );
}

function Passo({ n, titulo, children }: { n: string; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#C9A962]/15 text-[10px] font-medium text-[#C9A962]">
        {n}
      </span>
      <span>
        <span className="text-[#E5E5E5]">{titulo}.</span> {children}
      </span>
    </li>
  );
}
