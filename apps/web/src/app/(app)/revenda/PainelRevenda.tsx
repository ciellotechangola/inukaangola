"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  Headphones,
  MessageSquare,
  Package,
  Percent,
  ShoppingCart,
  User,
} from "lucide-react";
import { abrirConversaDirecta } from "@/lib/chat";
import { formatCurrency } from "@/lib/utils";
import { ESTADOS, estadoDe, type MinhaRevenda, type PedidoGrosso } from "@/lib/revenda";

/**
 * Ecrã de entrada do revendedor.
 *
 * A ordem é deliberada: primeiro quem é e quanto já comprou; depois a única
 * acção que dá dinheiro (catálogo); só no fim o histórico e as conversas.
 */
export default function PainelRevenda({
  painel,
  pedidos,
  semMigracao,
}: {
  painel: MinhaRevenda;
  pedidos: PedidoGrosso[];
  semMigracao: boolean;
}) {
  const router = useRouter();
  const [aAbrir, setAAbrir] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const rev = painel.revendedor!;

  async function falarCom(quem: "provincia" | "nacional") {
    const gestor = painel.gestores[quem];
    if (!gestor) {
      setErro(
        quem === "provincia"
          ? "Ainda não há gerente atribuído à sua província. Fale com a administração nacional."
          : "Ainda não há administração nacional disponível."
      );
      return;
    }

    setErro("");
    setAAbrir(quem);
    try {
      const conversa = await abrirConversaDirecta(gestor.id);
      router.push(`/revenda/conversas?c=${conversa}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir a conversa.");
      setAAbrir(null);
    }
  }

  const suspenso = rev.status !== "activo";

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
            Revenda INUKA · preço de grosso
          </p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-light text-[#F5F5F5]">
            {rev.tipo === "empresa" ? (
              <Building2 className="h-6 w-6 text-[#C9A962]" />
            ) : (
              <User className="h-6 w-6 text-[#C9A962]" />
            )}
            {rev.nome}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-[#8A8A8A]">
            {rev.provincia && <span>{rev.provincia}</span>}
            {rev.telefone && <span>· {rev.telefone}</span>}
            <span className="rounded-full bg-[#C9A962]/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#C9A962]">
              {rev.tipo === "empresa" ? "Empresa" : "Pessoa"}
            </span>
          </p>
        </div>

        <Link
          href="/revenda/catalogo"
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
        >
          <ShoppingCart className="h-4 w-4" />
          Fazer pedido de grosso
        </Link>
      </header>

      {semMigracao && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0026 (`PATCH_REVENDEDORES.sql`) — a base ainda não tem as
          tabelas da revenda.
        </div>
      )}

      {suspenso && (
        <div className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          A sua conta de revendedor está{" "}
          {rev.status === "suspenso" ? "suspensa" : "encerrada"}. Não é possível fazer pedidos
          novos até a gestão reactivar. Pode continuar a falar com o gerente.
        </div>
      )}

      {erro && (
        <p className="mb-6 rounded-xl border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </p>
      )}

      {/* ------------------------------------------------------------- NÚMEROS */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Pedidos" valor={String(painel.stats.pedidos)} />
        <Kpi rotulo="Em curso" valor={String(painel.stats.em_curso)} destaque />
        <Kpi rotulo="Entregues" valor={String(painel.stats.entregues)} />
        <Kpi
          rotulo="Valor em curso"
          valor={formatCurrency(painel.stats.valor_em_curso)}
          detalhe={`Total histórico: ${formatCurrency(painel.stats.valor_total)}`}
        />
      </section>

      {/* ------------------------------------------------------------- ACÇÕES */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          href="/revenda/catalogo"
          className="group flex items-start gap-3 rounded-xl border border-[#262626] bg-[#141414] p-5 transition hover:border-[#C9A962]/50 hover:bg-[#181818]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#C9A962]/10 text-[#C9A962]">
            <Package className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[#F5F5F5]">Catálogo de grosso</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[#8A8A8A]">
              Preço de revenda ao lado do preço de loja. Mínimo de {rev.minimo_unidades} unidades
              por produto.
            </span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[#4A4A4A] transition group-hover:translate-x-0.5 group-hover:text-[#C9A962]" />
        </Link>

        <Link
          href="/revenda/pedidos"
          className="group flex items-start gap-3 rounded-xl border border-[#262626] bg-[#141414] p-5 transition hover:border-[#C9A962]/50 hover:bg-[#181818]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#C9A962]/10 text-[#C9A962]">
            <ClipboardList className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[#F5F5F5]">Os meus pedidos</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[#8A8A8A]">
              Estado de cada pedido, cotação e resposta da gestão.
            </span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[#4A4A4A] transition group-hover:translate-x-0.5 group-hover:text-[#C9A962]" />
        </Link>
      </section>

      {/* --------------------------------------------------------- CONVERSAS */}
      <section className="mt-6 rounded-xl border border-[#262626] bg-[#141414] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
              <Headphones className="h-4 w-4 text-[#C9A962]" />
              Falar com a gestão
            </p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-[#8A8A8A]">
              O gerente da sua província trata do dia-a-dia. A administração nacional decide
              preços e condições especiais.
            </p>
          </div>
          <span className="rounded-full bg-[#C9A962]/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-[#C9A962]">
            Desconto {Math.round(rev.desconto * 100)}%
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => falarCom("provincia")}
            disabled={aAbrir !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-[#C9A962]/50 bg-[#C9A962]/5 px-4 py-2 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A] disabled:opacity-50"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {aAbrir === "provincia"
              ? "A abrir…"
              : `Gerente ${painel.gestores.provincia ? `· ${painel.gestores.provincia.nome}` : "da província"}`}
          </button>

          <button
            type="button"
            onClick={() => falarCom("nacional")}
            disabled={aAbrir !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-4 py-2 text-xs font-medium text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-50"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {aAbrir === "nacional"
              ? "A abrir…"
              : `Administração nacional${painel.gestores.nacional ? ` · ${painel.gestores.nacional.nome.split(" ")[0]}` : ""}`}
          </button>
        </div>
      </section>

      {/* ----------------------------------------------------------- HISTÓRICO */}
      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-light text-[#F5F5F5]">Pedidos recentes</h2>
            <p className="text-xs text-[#6F6F6F]">
              Cada pedido tem número e estado — do primeiro clique à entrega.
            </p>
          </div>
          <Link href="/revenda/pedidos" className="text-xs text-[#C9A962] hover:text-[#E3D5A7]">
            Ver todos →
          </Link>
        </div>

        {pedidos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-12 text-center">
            <Percent className="mx-auto mb-3 h-6 w-6 text-[#3A3A3A]" />
            <p className="text-sm text-[#A3A3A3]">Ainda não fez nenhum pedido de grosso.</p>
            <Link
              href="/revenda/catalogo"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#C9A962] hover:underline"
            >
              Abrir o catálogo
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#262626]">
            <table className="w-full text-sm">
              <thead className="bg-[#141414] text-left text-[10px] uppercase tracking-wide text-[#6F6F6F]">
                <tr>
                  <th className="px-4 py-2.5">Pedido</th>
                  <th className="px-4 py-2.5">Unidades</th>
                  <th className="px-4 py-2.5">Valor</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Data</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const estado = estadoDe(p.status);
                  return (
                    <tr key={p.id} className="border-t border-[#1F1F1F] bg-[#0F0F0F]">
                      <td className="px-4 py-3 font-mono text-xs text-[#E5E5E5]">{p.numero}</td>
                      <td className="px-4 py-3 text-[#A3A3A3]">{p.total_unidades}</td>
                      <td className="px-4 py-3 text-[#E5E5E5]">
                        {formatCurrency(p.valor_estimado)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADOS[estado].cor}`}>
                          {ESTADOS[estado].rotulo}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6F6F6F]">
                        {new Date(p.created_at).toLocaleDateString("pt-PT")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-8 text-[11px] leading-relaxed text-[#525252]">
        O preço de grosso é o seu custo de compra. O preço de venda ao público é decisão sua —
        a INUKA não impõe margem. Condições e descontos podem ser ajustados pela gestão.
      </p>
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#141414] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-xl font-light ${destaque ? "text-[#E3D5A7]" : "text-[#F5F5F5]"}`}>
        {valor}
      </p>
      {detalhe && <p className="mt-1 text-[10px] text-[#525252]">{detalhe}</p>}
    </div>
  );
}
