import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { mensagemErro } from "@/lib/colaborador";
import { normalizarSaldosEquipa, normalizarVendasGestao } from "@/lib/vendas";
import GestaoVendas from "./GestaoVendas";

export const dynamic = "force-dynamic";

/**
 * Vendas e saldos — a área onde a gestão confirma o dinheiro.
 *
 * Duas perguntas, por esta ordem:
 *   1. «quem me deve o quê» → os saldos por colaborador;
 *   2. «o que está por confirmar» → as vendas, com o botão que muda o estado.
 *
 * Os números vêm todos da base (`saldos_equipa`, `vendas_gestao`). A página não
 * soma nada no browser: se somasse, dois ecrãs abertos ao mesmo tempo podiam
 * mostrar totais diferentes do mesmo dinheiro.
 */
export default async function VendasPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();

  const [saldosRes, vendasRes] = await Promise.all([
    supabase.rpc("saldos_equipa"),
    supabase.rpc("vendas_gestao", { p_estado: null, p_seller: null, p_limite: 400 }),
  ]);

  // Se a migração 0034 ainda não estiver aplicada, a página diz o que fazer em
  // vez de abrir vazia a fingir que está tudo confirmado.
  if (saldosRes.error || vendasRes.error) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
          ← Painel de gestão
        </Link>
        <h1 className="mb-2 text-3xl font-light text-[#F5F5F5]">Vendas e saldos</h1>
        <div className="mt-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-6">
          <p className="text-sm font-medium text-[#F87171]">
            Falta aplicar a migração 0034 no Supabase.
          </p>
          <p className="mt-1 text-xs text-[#F87171]/80">
            Sem ela não há confirmação de pagamentos nem saldos por colaborador.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[#A3A3A3]">
            Supabase → SQL Editor → New query → colar{" "}
            <code className="text-[#E5E5E5]">supabase/PATCH_SITUACAO_DA_VENDA.sql</code> → RUN.
            Pode correr mais do que uma vez.
          </p>
          <p className="mt-2 text-[11px] text-[#6F6F6F]">{mensagemErro(saldosRes.error ?? vendasRes.error)}</p>
        </div>
      </main>
    );
  }

  const saldos = normalizarSaldosEquipa(saldosRes.data);
  const vendas = normalizarVendasGestao(vendasRes.data);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Vendas e saldos</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            Confirme os pagamentos e acompanhe o que cada colaborador já recebeu.
          </p>
        </div>
        <Link
          href="/gerente/vendas/registar"
          className="rounded-lg bg-[#C9A962] px-4 py-2 text-xs font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
        >
          REGISTAR VENDA
        </Link>
      </div>

      <GestaoVendas saldos={saldos} vendas={vendas} />
    </main>
  );
}
