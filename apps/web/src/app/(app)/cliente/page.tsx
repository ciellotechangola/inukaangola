import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CustomerDashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">Olá, {profile.full_name.split(" ")[0]}</h1>
      <p className="mb-8 text-[#A3A3A3]">Bem-vindo à sua área de cliente INUKA.</p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard href="/cliente/encomendas" title="As minhas encomendas" description="Consulte e acompanhe os seus pedidos." />
        <DashboardCard href="/cliente/reservas" title="Reservas" description="Veja as reservas ativas e histórico." />
        <DashboardCard href="/cliente/favoritos" title="Favoritos" description="Os seus produtos preferidos." />
        <DashboardCard href="/cliente/conversas" title="Mensagens" description="Converse com o seu colaborador." />
        <DashboardCard
          href="/cliente/testemunhos"
          title="Testemunhos de Clientes"
          description="Histórias reais de quem já usa INUKA."
        />
      </div>
    </div>
  );
}

function DashboardCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6 transition hover:border-[#C9A962]/40"
    >
      <h3 className="mb-2 text-lg font-medium text-[#C9A962]">{title}</h3>
      <p className="text-sm text-[#A3A3A3]">{description}</p>
    </Link>
  );
}
