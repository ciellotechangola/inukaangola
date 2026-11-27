import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { normalizarRede } from "@/lib/rede";
import RedeVendedores, { type SolicitacaoLinha } from "./RedeVendedores";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rede de vendedores · gestão INUKA",
};

interface PedidoBruto {
  id: string;
  numero: string;
  status: string;
  total_unidades: number;
  valor_estimado: string | number;
  mensagem: string | null;
  resposta: string | null;
  created_at: string;
  revendedor: {
    id: string;
    nome: string;
    tipo: string;
    telefone: string;
    nif: string | null;
  } | null;
  provincia: { nome: string } | null;
}

/**
 * Rede de vendedores (revendedores) — a vista que faltava à gestão.
 *
 * Junta duas coisas que estavam separadas: quem já é revendedor (com os
 * números do mês corrente) e o que os revendedores pediram. A administração
 * nacional vê o país; o gestor provincial vê a sua província. A regra vive na
 * função `rede_revendedores()` e no RLS — a página não a repete.
 */
export default async function RedeDeVendedoresPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();

  const [redeRes, pedidosRes] = await Promise.all([
    supabase.rpc("rede_revendedores"),
    supabase
      .from("revendedor_pedidos")
      .select(
        "id, numero, status, total_unidades, valor_estimado, mensagem, resposta, created_at, revendedor:revendedores(id, nome, tipo, telefone, nif), provincia:provincias(nome)"
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const rede = normalizarRede(redeRes.data);
  const emFalta = /PGRST202|PGRST205|does not exist/i.test(redeRes.error?.message ?? "");

  const pedidos: SolicitacaoLinha[] = (
    (pedidosRes.data ?? []) as unknown as PedidoBruto[]
  ).map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    unidades: Number(p.total_unidades ?? 0),
    valor: Number(p.valor_estimado ?? 0),
    mensagem: p.mensagem,
    resposta: p.resposta,
    created_at: p.created_at,
    revendedor_id: p.revendedor?.id ?? null,
    revendedor: p.revendedor?.nome ?? "—",
    tipo: p.revendedor?.tipo ?? "pessoa",
    telefone: p.revendedor?.telefone ?? "",
    nif: p.revendedor?.nif ?? null,
    provincia: p.provincia?.nome ?? null,
  }));

  // Nome da província em foco (só no âmbito provincial).
  let nomeProvincia: string | null = null;
  if (rede?.scope === "provincial" && rede.provincia_id) {
    const { data } = await supabase
      .from("provincias")
      .select("nome")
      .eq("id", rede.provincia_id)
      .maybeSingle();
    nomeProvincia = (data as { nome: string } | null)?.nome ?? null;
  }

  const ambito =
    rede?.scope === "nacional"
      ? "Todas as províncias · mês corrente"
      : `${nomeProvincia ?? "A sua província"} · mês corrente`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link
        href="/gerente"
        className="mb-6 inline-block text-sm text-[#A3A3A3] transition hover:text-[#C9A962]"
      >
        ← Painel de gestão
      </Link>

      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
          INUKA Angola · grosso e revenda
        </p>
        <h1 className="mt-2 text-3xl font-light text-[#F5F5F5]">Rede de vendedores</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#A3A3A3]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C9A962]/30 bg-[#C9A962]/5 px-3 py-1 text-[11px] text-[#C9A962]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#C9A962]" />
            {ambito}
          </span>
          <span className="text-xs text-[#6F6F6F]">
            Revendedores cadastrados, pedidos de grosso e números do período.
          </span>
        </p>
      </header>

      {emFalta && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0029 — cole{" "}
          <code className="font-mono text-xs">supabase/PATCH_REDE_REVENDEDORES.sql</code> no SQL
          Editor do Supabase. Até lá esta página fica vazia.
        </div>
      )}

      {rede ? (
        <RedeVendedores rede={rede} pedidos={pedidos} nomeProvincia={nomeProvincia} />
      ) : (
        <p className="rounded-xl border border-[#262626] bg-[#141414] p-6 text-sm text-[#8A8A8A]">
          Sem dados da rede. Ainda não há revendedores registados — aprove uma candidatura em{" "}
          <Link href="/gerente/revendedores" className="text-[#C9A962] hover:underline">
            Revendedores e grosso
          </Link>
          .
        </p>
      )}

      {rede && rede.totais.valor === 0 && (
        <p className="mt-4 text-[11px] text-[#525252]">
          Os valores mostrados são de grosso e referem-se ao período indicado. Um revendedor sem
          pedidos aparece a zeros — não é erro, é um revendedor por activar.
        </p>
      )}

      <p className="mt-6 text-[11px] text-[#525252]">
        Total em curso: {formatCurrency(rede?.totais.valor_em_curso ?? 0)} em{" "}
        {rede?.totais.em_curso ?? 0} pedido(s) por fechar.
      </p>
    </main>
  );
}
