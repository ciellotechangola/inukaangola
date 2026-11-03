import { redirect } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, MapPin, Phone, Users, Wallet } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { TELEFONES_INUKA, telHref } from "@/lib/contactos";
import { faltaPatchProvincial, AVISO_PATCH_PROVINCIAL } from "@/lib/provincias";
import type { Provincia } from "@/types";
import FalarComEquipa from "./FalarComEquipa";

export const dynamic = "force-dynamic";

const PAPEL: Record<string, string> = {
  manager: "Gestão",
  seller: "Colaborador",
  customer: "Cliente",
  visitor: "Visitante",
};

/**
 * Aba de referência — carrega logo após o início de sessão.
 *
 * Mostra a identidade operacional da pessoa: o código de referência, a
 * província e a delegação a que pertence, e quem é o seu interlocutor
 * (o colaborador, no caso do cliente; a carteira, no caso do colaborador).
 */
export default async function ReferenciaPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClientServer();

  const SEM_PROVINCIA = "00000000-0000-0000-0000-000000000000";

  const [provinciaRes, vinculoRes] = await Promise.all([
    supabase
      .from("provincias")
      .select(
        "id, nome, codigo, slug, delegacao_nome, delegacao_endereco, delegacao_telefone, is_default, is_active"
      )
      .eq("id", profile.provincia_id ?? SEM_PROVINCIA)
      .maybeSingle(),
    profile.role === "customer"
      ? supabase
          .from("seller_customers")
          .select("seller_id")
          .eq("customer_id", profile.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const provincia = (provinciaRes.data ?? null) as Provincia | null;
  const erroEsquema = faltaPatchProvincial(provinciaRes.error?.message);

  let colaborador: { full_name: string; phone: string | null } | null = null;
  if (vinculoRes.data) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", (vinculoRes.data as { seller_id: string }).seller_id)
      .maybeSingle();
    colaborador = (data ?? null) as { full_name: string; phone: string | null } | null;
  }

  let carteira: { clientes: number; vendido: number } | null = null;
  if (profile.role === "seller") {
    const [{ count: clientes }, { data: vendas }] = await Promise.all([
      supabase
        .from("seller_customers")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", profile.id)
        .eq("is_active", true),
      supabase.from("sales").select("total_amount").eq("seller_id", profile.id),
    ]);
    const vendido = ((vendas ?? []) as { total_amount: number }[]).reduce(
      (s, v) => s + Number(v.total_amount),
      0
    );
    carteira = { clientes: clientes ?? 0, vendido };
  }

  const painel =
    profile.role === "manager"
      ? "/gerente"
      : profile.role === "seller"
        ? "/vendedor"
        : "/cliente";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#525252]">A minha referência</p>
        <h1 className="mt-1 text-3xl font-light text-[#F5F5F5]">{profile.full_name}</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          {PAPEL[profile.role] ?? profile.role} ·{" "}
          {provincia ? `Província do ${provincia.nome}` : "Administração nacional"}
        </p>
      </div>

      {erroEsquema && (
        <div className="mb-6 rounded-lg border border-[#C9A962]/40 bg-[#C9A962]/10 p-3 text-sm text-[#E3D5A7]">
          {AVISO_PATCH_PROVINCIAL}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-[#C9A962]/30 bg-gradient-to-br from-[#1A1A1A] to-[#121212] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8A8A8A]">
              Código de referência
            </p>
            <p className="mt-1 font-mono text-2xl tracking-[0.08em] text-[#C9A962]">
              {profile.referencia ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#C9A962]/30 px-4 py-2 text-xs text-[#C9A962]">
            <BadgeCheck className="h-4 w-4" />
            {provincia ? provincia.codigo : "NAC"}
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[#6F6F6F]">
          Indique este código sempre que falar com a INUKA — identifica a sua conta e a província
          a que está associado.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Campo
          icone={<MapPin className="h-4 w-4" />}
          rotulo="Província"
          valor={provincia?.nome ?? "Nacional (todas as províncias)"}
        />
        <Campo
          icone={<MapPin className="h-4 w-4" />}
          rotulo="Delegação"
          valor={provincia?.delegacao_nome ?? "Administração nacional"}
          nota={provincia?.delegacao_endereco ?? undefined}
        />
        <Campo
          icone={<Phone className="h-4 w-4" />}
          rotulo="Telefone"
          telefones={[...TELEFONES_INUKA]}
          nota={
            provincia?.delegacao_telefone
              ? `Delegação: ${provincia.delegacao_telefone}`
              : undefined
          }
        />
        <Campo
          icone={<BadgeCheck className="h-4 w-4" />}
          rotulo="Conta desde"
          valor={new Date(profile.created_at).toLocaleDateString("pt-PT")}
        />
      </div>

      {profile.role === "customer" && (
        <div className="mb-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <h2 className="mb-1 text-lg font-medium text-[#F5F5F5]">Falar com a equipa INUKA</h2>
          <p className="mb-4 text-xs text-[#6F6F6F]">
            Uma só conversa com quem trata da sua conta — o seu colaborador e a gestão.
          </p>
          {colaborador ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[#F5F5F5]">{colaborador.full_name}</p>
                <p className="text-xs text-[#8A8A8A]">{colaborador.phone ?? "sem telefone"}</p>
              </div>
              <FalarComEquipa temColaborador />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#8A8A8A]">
                Ainda não tem colaborador associado. Fale com a delegação da sua província.
              </p>
              <FalarComEquipa temColaborador={false} />
            </div>
          )}
        </div>
      )}

      {profile.role === "seller" && carteira && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Link
            href="/vendedor/clientes"
            className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6 transition hover:border-[#C9A962]/50"
          >
            <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[#525252]">
              <Users className="h-3.5 w-3.5" /> Clientes na carteira
            </p>
            <p className="text-xl font-medium text-[#C9A962]">{carteira.clientes}</p>
            <p className="mt-1 text-[11px] text-[#6F6F6F]">
              Abrir, acrescentar e contactar →
            </p>
          </Link>
          <Link
            href="/vendedor/vendas"
            className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6 transition hover:border-[#C9A962]/50"
          >
            <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[#525252]">
              <Wallet className="h-3.5 w-3.5" /> Total vendido
            </p>
            <p className="text-xl font-medium text-[#C9A962]">{formatCurrency(carteira.vendido)}</p>
            <p className="mt-1 text-[11px] text-[#6F6F6F]">Ver histórico de vendas →</p>
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href={painel}
          className="rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
        >
          Continuar para o painel
        </Link>
        {profile.role === "seller" && (
          <Link
            href="/vendedor/clientes"
            className="rounded-lg border border-[#404040] px-5 py-2.5 text-sm text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
          >
            A minha carteira
          </Link>
        )}
        <Link
          href="/catalogo"
          className="rounded-lg border border-[#404040] px-5 py-2.5 text-sm text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
        >
          Ver catálogo
        </Link>
      </div>
    </main>
  );
}

function Campo({
  icone,
  rotulo,
  valor,
  telefones,
  nota,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor?: string;
  /** Vários números — cada um abre o marcador. */
  telefones?: string[];
  nota?: string;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[#525252]">
        <span className="text-[#6F6F6F]">{icone}</span>
        {rotulo}
      </p>
      {telefones ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[#F5F5F5]">
          {telefones.map((t) => (
            <a
              key={t}
              href={telHref(t)}
              className="whitespace-nowrap transition hover:text-[#C9A962]"
            >
              {t}
            </a>
          ))}
        </p>
      ) : (
        <p className="text-[#F5F5F5]">{valor ?? "—"}</p>
      )}
      {nota && <p className="mt-1 text-xs text-[#6F6F6F]">{nota}</p>}
    </div>
  );
}
