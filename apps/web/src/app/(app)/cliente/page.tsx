import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BadgeCheck,
  ChevronRight,
  Heart,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import CopiarReferencia from "@/components/CopiarReferencia";
import type { Provincia } from "@/types";

export const dynamic = "force-dynamic";

/** UUID nulo: `eq` com `null` não devolve linha nenhuma. */
const SEM_PROVINCIA = "00000000-0000-0000-0000-000000000000";

/**
 * Perfil do cliente — a área de cliente inteira numa tela.
 *
 * Antes eram quatro cartões soltos (Notícias, Encomendas, Reservas,
 * Favoritos…) e a referência vivia noutra aba. Quem entra quer saber três
 * coisas: quem é, qual é o seu código e com quem fala. Está tudo aqui, por esta
 * ordem, e os atalhos vêm depois.
 *
 * A tela chama-se «Perfil» no menu e é o destino do botão com o nome da pessoa
 * no cabeçalho — o mesmo sítio, dois caminhos.
 */
export default async function PerfilClientePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?redirect=/cliente");

  const supabase = await createClientServer();

  const [provinciaRes, vinculoRes, encomendasRes, favoritosRes, conversasRes] =
    await Promise.all([
      supabase
        .from("provincias")
        .select("id, nome, codigo, delegacao_nome, delegacao_telefone")
        .eq("id", profile.provincia_id ?? SEM_PROVINCIA)
        .maybeSingle(),
      // O colaborador que acompanha este cliente. `customer_id` aponta para
      // `auth.users`, por isso o nome vem numa segunda consulta.
      supabase
        .from("seller_customers")
        .select("seller_id")
        .eq("customer_id", profile.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", profile.id),
      supabase
        .from("favorites")
        .select("product_id", { count: "exact", head: true })
        .eq("user_id", profile.id),
      supabase
        .from("conversation_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id),
    ]);

  const provincia = (provinciaRes.data ?? null) as Provincia | null;

  let colaborador: { full_name: string; phone: string | null } | null = null;
  if (vinculoRes.data) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", (vinculoRes.data as { seller_id: string }).seller_id)
      .maybeSingle();
    colaborador = (data ?? null) as { full_name: string; phone: string | null } | null;
  }

  const primeiro = profile.full_name.trim().split(/\s+/)[0] || "Cliente";
  const encomendas = encomendasRes.count ?? 0;
  const favoritos = favoritosRes.count ?? 0;
  const conversas = conversasRes.count ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      {/* ------------------------------------------------------- identidade */}
      <section className="overflow-hidden rounded-2xl border border-[#262626] bg-gradient-to-br from-[#161410] via-[#121212] to-[#0E0E0E]">
        <div className="flex items-start gap-4 p-5 sm:p-6">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E3D5A7] to-[#8A6F2E] text-lg font-bold text-[#0A0A0A]">
            {iniciais(profile.full_name)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
              Área de cliente
            </p>
            <h1 className="mt-0.5 text-2xl font-light leading-tight text-[#F5F5F5] sm:text-3xl">
              Olá, {primeiro}
            </h1>
            <p className="mt-1 text-sm text-[#A3A3A3]">
              Bem-vindo à sua área de cliente INUKA.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A962]/40 bg-[#1D1A12] px-2 py-0.5 text-[#C9A962]">
                <BadgeCheck className="h-3 w-3" /> Cliente INUKA
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#2E2E2E] px-2 py-0.5 text-[#A3A3A3]">
                Cliente · {provincia?.nome ?? "Nacional"}
              </span>
              {provincia?.delegacao_nome && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#2E2E2E] px-2 py-0.5 text-[#6F6F6F]">
                  <MapPin className="h-3 w-3" /> {provincia.delegacao_nome}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* --------------------------------------------- minha referência */}
        <div className="border-t border-[#232323] bg-[#0C0C0C]/60 px-5 py-4 sm:px-6">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
            Minha referência
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <p className="font-mono text-xl tracking-[0.12em] text-[#E3D5A7]">
              {profile.referencia ?? "—"}
            </p>
            {profile.referencia && <CopiarReferencia valor={profile.referencia} />}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#6F6F6F]">
            É este o código que identifica a sua conta. Diga-o ao seu colaborador quando
            encomendar — é assim que as suas compras ficam ligadas a si.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------- o seu colaborador */}
      <section className="mt-5 rounded-2xl border border-[#262626] bg-[#141414] p-5">
        <h2 className="text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
          O seu colaborador
        </h2>

        {colaborador ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#C9A962]/30 bg-[#0A0A0A] text-xs text-[#C9A962]">
              {iniciais(colaborador.full_name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[#F5F5F5]">{colaborador.full_name}</p>
              <p className="text-[11px] text-[#6F6F6F]">
                {colaborador.phone ?? "Telefone por indicar"} · Acompanha as suas compras
              </p>
            </div>
            <div className="flex gap-2">
              {colaborador.phone && (
                <a
                  href={`tel:${colaborador.phone.replace(/\s+/g, "")}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-[11px] text-[#C9A962] transition hover:border-[#C9A962]"
                >
                  <Phone className="h-3.5 w-3.5" /> Ligar
                </a>
              )}
              <Link
                href="/cliente/conversas"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-[11px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
              >
                <MessageSquare className="h-3.5 w-3.5" /> Mensagens
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#A3A3A3]">
              Ainda não tem colaborador atribuído.
              <span className="mt-0.5 block text-[11px] text-[#5F5F5F]">
                Pode comprar na mesma — a equipa INUKA acompanha-o assim que houver um
                colaborador na sua província.
              </span>
            </p>
            <Link
              href="/referencia"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#C9A962]/40 px-3 py-2 text-[11px] text-[#C9A962] transition hover:bg-[#C9A962]/10"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Falar com a equipa
            </Link>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- atalhos */}
      <section className="mt-5">
        <h2 className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
          O que precisa
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <Atalho
            href="/cliente/encomendas"
            Icon={Package}
            titulo="As minhas encomendas"
            detalhe={encomendas > 0 ? `${encomendas} ${encomendas === 1 ? "encomenda" : "encomendas"}` : "Acompanhe os seus pedidos"}
          />
          <Atalho
            href="/cliente/compras"
            Icon={ShoppingBag}
            titulo="Compras"
            detalhe="Tudo o que já comprou, incluindo antes da conta"
          />
          <Atalho
            href="/cliente/favoritos"
            Icon={Heart}
            titulo="Favoritos"
            detalhe={favoritos > 0 ? `${favoritos} ${favoritos === 1 ? "produto guardado" : "produtos guardados"}` : "Guarde os produtos de que gosta"}
          />
          <Atalho
            href="/cliente/conversas"
            Icon={MessageSquare}
            titulo="Mensagens"
            detalhe={conversas > 0 ? `${conversas} ${conversas === 1 ? "conversa" : "conversas"}` : "Converse com a equipa"}
          />
          <Atalho
            href="/cliente/conteudo"
            Icon={Sparkles}
            titulo="Feed Clientes"
            detalhe="Promoções e testemunhos de quem já usa INUKA"
          />
          <Atalho
            href="/cliente/reservas"
            Icon={Package}
            titulo="Reservas"
            detalhe="Artigos esgotados que guardou para si"
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- conta */}
      <section className="mt-5 rounded-2xl border border-[#262626] bg-[#141414] p-5">
        <h2 className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#6F6F6F]">
          A minha conta
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Linha rotulo="Nome" valor={profile.full_name} />
          <Linha rotulo="Telefone" valor={profile.phone ?? "—"} />
          <Linha rotulo="Email" valor={profile.email ?? "—"} />
          <Linha rotulo="Província" valor={provincia?.nome ?? "Nacional"} />
          <Linha rotulo="Referência" valor={profile.referencia ?? "—"} />
          <Linha rotulo="Cliente desde" valor={dataLonga(profile.created_at)} />
        </dl>
        <p className="mt-3 text-[11px] text-[#5F5F5F]">
          Para alterar o nome, o telefone ou a província, fale com a equipa — é a gestão que
          mantém os dados da conta.
        </p>
      </section>

      <p className="mt-6 text-center text-[10px] text-[#4F4F4F]">
        INUKA Angola · Área de cliente
      </p>
    </main>
  );
}

function Atalho({
  href,
  Icon,
  titulo,
  detalhe,
}: {
  href: string;
  Icon: typeof Package;
  titulo: string;
  detalhe: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-[#262626] bg-[#1A1A1A] px-4 py-3.5 transition hover:border-[#C9A962]/50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0F0F0F] text-[#C9A962]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[#F5F5F5]">{titulo}</span>
        <span className="block truncate text-[11px] text-[#6F6F6F]">{detalhe}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#3A3A3A] transition group-hover:text-[#C9A962]" />
    </Link>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#1F1F1F] py-1.5">
      <dt className="shrink-0 text-[11px] uppercase tracking-wider text-[#5F5F5F]">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] text-[#E5E5E5]">{valor}</dd>
    </div>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[partes.length - 1]?.[0] ?? "")).toUpperCase();
}

function dataLonga(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" });
}
