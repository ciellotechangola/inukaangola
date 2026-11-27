import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  GraduationCap,
  HandCoins,
  Headphones,
  MonitorSmartphone,
  PackageCheck,
  Percent,
  TrendingUp,
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
 *
 * A página tem duas metades: em cima o que se ganha a comprar ao grosso (com
 * o formulário ao lado), em baixo o que significa pertencer à marca. A
 * contagem de províncias vem da base, não está escrita à mão: quando a divisão
 * administrativa mudar, o número muda sozinho.
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
            <Numero valor={String(provincias.length)} rotulo="províncias" />
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

        <div id="solicitar" className="scroll-mt-24 lg:sticky lg:top-24">
          <FormularioRevendedor provincias={provincias} />

          <div className="mt-4 rounded-xl border border-[#262626] bg-[#111] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#525252]">
              Como funciona
            </p>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-[#8A8A8A]">
              <Passo n="1" titulo="Envia a solicitação">
                Escolhe <strong className="font-medium text-[#A3A3A3]">Individual</strong> ou{" "}
                <strong className="font-medium text-[#A3A3A3]">Empresarial</strong> e preenche os
                dados. A província decide quem a recebe.
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

      {/* -------------------------------------------------- PERTENCER À MARCA */}
      <section className="mt-16 border-t border-[#1F1F1F] pt-14 sm:mt-20 sm:pt-16">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
          INUKA Angola Business
        </p>

        <h2 className="mt-4 max-w-3xl text-3xl font-light leading-tight tracking-tight text-[#F5F5F5] sm:text-4xl">
          Seja revendedor <span className="text-[#C9A962]">INUKA Angola</span>
        </h2>

        <p className="mt-5 max-w-2xl text-base leading-relaxed text-[#E5E5E5] sm:text-lg">
          Mais do que vender. É crescer, empreender e fazer parte de uma marca.
        </p>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#A3A3A3]">
          Faça parte da INUKA Angola Business e transforme a sua vontade de empreender numa
          oportunidade de negócio. Tenha acesso a produtos, acompanhamento, formação e uma
          plataforma digital criada para facilitar o seu trabalho e impulsionar os seus resultados.
        </p>

        <h3 className="mt-12 text-[10px] uppercase tracking-[0.18em] text-[#C9A962]">
          Por que ser revendedor INUKA?
        </h3>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Beneficio
            n="1"
            icone={<TrendingUp className="h-4 w-4" />}
            titulo="Ganhos e oportunidades de lucro"
            itens={[
              "Possibilidade de obter lucros através da revenda.",
              "Trabalhe com diferentes categorias de produtos.",
              "Aumente os seus rendimentos de acordo com as suas vendas e dedicação.",
            ]}
          />
          <Beneficio
            n="2"
            icone={<BadgeCheck className="h-4 w-4" />}
            titulo="Faça parte de uma marca"
            itens={[
              "Identificação como revendedor INUKA.",
              "Acesso ao catálogo de produtos da marca.",
              "Possibilidade de construir a sua própria carteira de clientes.",
              "Crescimento dentro de uma rede comercial.",
            ]}
          />
          <Beneficio
            n="3"
            icone={<GraduationCap className="h-4 w-4" />}
            titulo="Formação e acompanhamento"
            itens={[
              "Orientação sobre produtos e técnicas de venda.",
              "Apoio para desenvolver competências comerciais.",
              "Acompanhamento e motivação para alcançar melhores resultados.",
            ]}
          />
          <Beneficio
            n="4"
            icone={<MonitorSmartphone className="h-4 w-4" />}
            titulo="Acesso à nossa plataforma digital"
            intro="Trabalhe com uma ferramenta criada para tornar a revenda mais profissional:"
            itens={[
              "Consulte o catálogo de produtos.",
              "Acompanhe preços e oportunidades de venda.",
              "Consulte os seus pedidos e histórico.",
              "Acompanhe o seu desempenho comercial.",
              "Tenha acesso às informações da sua actividade.",
              "Trabalhe de forma mais organizada através do telemóvel ou computador.",
            ]}
          />
          <Beneficio
            n="5"
            icone={<Clock className="h-4 w-4" />}
            titulo="Flexibilidade e autonomia"
            itens={[
              "Trabalhe ao seu ritmo.",
              "Desenvolva a sua actividade na sua província.",
              "Organize os seus horários e a sua carteira de clientes.",
              "Cresça de acordo com os seus objectivos.",
            ]}
          />
        </div>

        {/* ------------------------------------------------------- FECHO */}
        <div className="mt-12 overflow-hidden rounded-2xl border border-[#C9A962]/25 bg-[#C9A962]/[0.04]">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9A962]/60 to-transparent" />
          <div className="p-7 sm:p-10">
            <h3 className="max-w-2xl text-xl font-light leading-snug text-[#F5F5F5] sm:text-2xl">
              O seu negócio. A nossa marca.
              <span className="block text-[#C9A962]">Uma nova oportunidade.</span>
            </h3>

            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#A3A3A3]">
              Na INUKA acreditamos que cada revendedor tem potencial para construir algo maior.
              Por isso, combinamos produtos, acompanhamento e tecnologia para proporcionar uma
              experiência de revenda mais moderna e organizada.
            </p>

            <p className="mt-8 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
              Está pronto para fazer parte?
            </p>
            <p className="mt-2 max-w-xl text-sm text-[#E5E5E5]">
              Junte-se à INUKA Angola Business e comece hoje a construir o seu futuro comercial.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="#solicitar"
                className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-6 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
              >
                Quero ser revendedor
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={telHref(TELEFONES_INUKA[0])}
                className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962]/40 px-6 py-3 text-sm font-medium text-[#C9A962] transition hover:bg-[#C9A962]/10"
              >
                <Headphones className="h-4 w-4" />
                Falar com a INUKA
              </a>
            </div>

            <div className="mt-10 border-t border-[#C9A962]/15 pt-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[#8A8A8A]">
                INUKA Angola
              </p>
              <p className="mt-1 text-sm italic text-[#C9A962]">
                Beleza, oportunidade e crescimento.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Beneficio({
  n,
  icone,
  titulo,
  intro,
  itens,
}: {
  n: string;
  icone: React.ReactNode;
  titulo: string;
  intro?: string;
  itens: string[];
}) {
  return (
    <article className="rounded-xl border border-[#262626] bg-[#141414] p-5 transition hover:border-[#C9A962]/35">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#C9A962]/10 text-[#C9A962]">
          {icone}
        </span>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#6F6F6F]">{n}</p>
      </div>

      <h4 className="mt-3 text-sm font-medium text-[#F5F5F5]">{titulo}</h4>

      {intro && <p className="mt-2 text-xs leading-relaxed text-[#8A8A8A]">{intro}</p>}

      <ul className="mt-3 space-y-1.5">
        {itens.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-relaxed text-[#A3A3A3]">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C9A962]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
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
