import Link from "next/link";
import type { ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  Mail,
  MapPin,
  Phone,
  ShoppingBag,
  Store,
  User,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { iniciais } from "@/lib/colaborador";
import { ESTADOS, estadoDe } from "@/lib/revenda";
import {
  COR_ESTADO_REVENDEDOR,
  ROTULO_TIPO,
  type Ficha,
} from "@/lib/rede";

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function mesCurto(chave: string): string {
  const [ano, mes] = chave.split("-");
  const i = Number(mes) - 1;
  return MESES[i] ? `${MESES[i]}/${ano.slice(2)}` : chave;
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Ficha de revendedor, em modo profissional.
 *
 * É a mesma peça para a gestão (`/gerente/rede/[id]`) e para o próprio
 * revendedor (`/revenda/perfil`) — o que muda é o `acoes` (só a gestão edita
 * condições) e a moldura de navegação. Assim a ficha que o revendedor vê é
 * exactamente a que o gerente vê: não há duas verdades.
 */
export default function FichaRevendedorProfissional({
  ficha,
  voltar,
  acoes,
  modo = "gestao",
}: {
  ficha: Ficha;
  voltar?: { href: string; label: string };
  acoes?: ReactNode;
  modo?: "gestao" | "proprio";
}) {
  const r = ficha.revendedor;
  const st = ficha.stats;

  const maxValor = Math.max(1, ...ficha.historico.map((h) => h.valor));
  // Sem acordo próprio o preço vem da tabela de reduções (0032) — dizer
  // «desconto da empresa» era falar de uma percentagem que já não existe.
  const desconto =
    r.desconto === null
      ? "Tabela de reduções"
      : `${Math.round(Number(r.desconto) * 100)}%`;

  return (
    <div className="space-y-6">
      {voltar && (
        <Link
          href={voltar.href}
          className="inline-block text-sm text-[#A3A3A3] transition hover:text-[#C9A962]"
        >
          ← {voltar.label}
        </Link>
      )}

      {/* ------------------------------------------------------- IDENTIDADE */}
      <section className="overflow-hidden rounded-2xl border border-[#262626] bg-[#141414]">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9A962]/60 to-transparent" />
        <div className="p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[#C9A962]/40 bg-[#0A0A0A] text-sm font-medium text-[#C9A962]">
                {iniciais(r.nome)}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {r.tipo === "empresa" ? (
                    <Building2 className="h-4 w-4 text-[#C9A962]" />
                  ) : (
                    <User className="h-4 w-4 text-[#C9A962]" />
                  )}
                  <h1 className="truncate text-xl font-light text-[#F5F5F5] sm:text-2xl">
                    {r.nome}
                  </h1>
                  <span className="rounded-full border border-[#C9A962]/30 bg-[#C9A962]/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#E3D5A7]">
                    {ROTULO_TIPO[r.tipo] ?? r.tipo}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      COR_ESTADO_REVENDEDOR[r.status] ?? "bg-[#262626] text-[#A3A3A3]"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>

                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8A8A8A]">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {r.provincia ?? "sem província"}
                    {r.provincia_codigo && (
                      <span className="font-mono text-[10px] text-[#525252]">
                        {r.provincia_codigo}
                      </span>
                    )}
                  </span>
                  {r.loja_codigo && (
                    <span className="inline-flex items-center gap-1">
                      <Store className="h-3 w-3" />
                      {r.loja_codigo}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    Revendedor desde {dataCurta(r.desde)}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`tel:${r.telefone}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/40 px-3 py-2 text-xs text-[#C9A962] transition hover:bg-[#C9A962]/10"
              >
                <Phone className="h-3.5 w-3.5" />
                {r.telefone}
              </a>
              {r.email && (
                <a
                  href={`mailto:${r.email}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/40 hover:text-[#C9A962]"
                >
                  <Mail className="h-3.5 w-3.5" />
                  E-mail
                </a>
              )}
            </div>
          </div>

          {/* Dados profissionais */}
          <dl className="mt-6 grid gap-3 border-t border-[#1F1F1F] pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <Dado rotulo="NIF" valor={r.nif ?? "—"} mono />
            <Dado rotulo="Telefone" valor={r.telefone} />
            <Dado rotulo="E-mail" valor={r.email ?? "—"} />
            <Dado rotulo="Loja de apoio" valor={r.loja ?? "—"} />
            <Dado
              rotulo="Gestor responsável"
              valor={r.gestor ?? "Administração nacional"}
            />
            <Dado rotulo="Condição de grosso" valor={desconto} />
            <Dado rotulo="Mínimo por produto" valor={`${r.minimo_unidades} unidades`} />
            <Dado
              rotulo="Conta de acesso"
              valor={
                r.conta_activa === null
                  ? "sem conta"
                  : r.conta_activa
                    ? "activa"
                    : "inactiva"
              }
            />
          </dl>

          {r.nota && (
            <p className="mt-4 rounded-lg bg-[#0F0F0F] p-3 text-xs leading-relaxed text-[#A3A3A3]">
              <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-[#525252]">
                Nota da gestão
              </span>
              {r.nota}
            </p>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- NÚMEROS */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Pedidos" valor={String(st.pedidos)} />
        <Kpi rotulo="Valor comprado" valor={formatCurrency(st.valor)} destaque />
        <Kpi rotulo="Unidades" valor={String(st.unidades)} />
        <Kpi rotulo="Ticket médio" valor={formatCurrency(st.ticket_medio)} />
        <Kpi rotulo="Em curso" valor={`${st.em_curso} · ${formatCurrency(st.valor_em_curso)}`} />
        <Kpi rotulo="Entregues" valor={String(st.entregues)} />
        <Kpi rotulo="Cancelados" valor={String(st.cancelados)} />
        <Kpi
          rotulo="Último pedido"
          valor={st.ultimo_pedido ? dataCurta(st.ultimo_pedido) : "nunca"}
        />
      </section>

      {/* ------------------------------------------------- MÊS E HISTÓRICO */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-[#C9A962]/25 bg-[#C9A962]/[0.04] p-5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[#C9A962]">
            Mês corrente
          </p>
          <p className="mt-3 text-2xl font-light text-[#F5F5F5]">
            {formatCurrency(ficha.mes.valor)}
          </p>
          <p className="mt-1 text-xs text-[#8A8A8A]">
            {ficha.mes.pedidos} pedido(s) · {ficha.mes.unidades} unidades
          </p>
          <div className="mt-4 border-t border-[#C9A962]/15 pt-3 text-[11px] leading-relaxed text-[#6F6F6F]">
            {modo === "gestao"
              ? "Valores de grosso, sem IVA. O preço final de venda ao público é decisão do revendedor."
              : "É o que já comprou este mês. O preço de venda ao público é decisão sua."}
          </div>
        </div>

        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5 lg:col-span-2">
          <div className="mb-4 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-[#F5F5F5]">Últimos 6 meses</h2>
              <p className="text-[11px] text-[#6F6F6F]">Valor de grosso por mês.</p>
            </div>
            <p className="text-[10px] text-[#525252]">máx. {formatCurrency(maxValor)}</p>
          </div>

          <div className="flex h-28 items-end gap-2">
            {ficha.historico.map((h) => {
              const altura = Math.max(2, Math.round((h.valor / maxValor) * 100));
              const corrente = h === ficha.historico[ficha.historico.length - 1];
              return (
                <div key={h.mes} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      title={`${mesCurto(h.mes)}: ${formatCurrency(h.valor)}`}
                      style={{ height: `${altura}%` }}
                      className={`w-full rounded-t transition ${
                        corrente ? "bg-[#C9A962]" : "bg-[#C9A962]/30"
                      }`}
                    />
                  </div>
                  <span
                    className={`text-[9px] ${corrente ? "text-[#C9A962]" : "text-[#525252]"}`}
                  >
                    {mesCurto(h.mes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- PEDIDOS */}
      <section className="overflow-hidden rounded-xl border border-[#262626]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F1F] bg-[#141414] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
            <ShoppingBag className="h-4 w-4 text-[#C9A962]" />
            Histórico de pedidos
          </h2>
          <p className="text-[11px] text-[#6F6F6F]">
            {ficha.pedidos.length === 0
              ? "sem pedidos"
              : `${ficha.pedidos.length} pedido(s), do mais recente`}
          </p>
        </div>

        {ficha.pedidos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[#525252]">
            Ainda não há pedidos de grosso.
          </p>
        ) : (
          <ul className="divide-y divide-[#1F1F1F]">
            {ficha.pedidos.map((p) => {
              const estado = estadoDe(p.status);
              return (
                <li key={p.id} className="px-4 py-3">
                  <details className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-mono text-[#F5F5F5]">{p.numero}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADOS[estado].cor}`}>
                        {ESTADOS[estado].rotulo}
                      </span>
                      <span className="text-[#8A8A8A]">{p.unidades} un.</span>
                      <span className="text-[#C9A962]">{formatCurrency(p.valor)}</span>
                      <span className="text-[#525252]">{dataCurta(p.created_at)}</span>
                      <span className="ml-auto text-[10px] text-[#525252] group-open:hidden">
                        ver itens
                      </span>
                    </summary>

                    <div className="mt-2 space-y-2 pl-1">
                      {p.itens.length > 0 && (
                        <ul className="space-y-1">
                          {p.itens.map((i) => (
                            <li
                              key={`${p.id}-${i.nome}`}
                              className="flex flex-wrap items-center gap-x-3 text-[11px] text-[#A3A3A3]"
                            >
                              <span className="text-[#E5E5E5]">{i.nome}</span>
                              {i.sku && <span className="font-mono text-[9px] text-[#525252]">{i.sku}</span>}
                              <span>× {i.quantidade}</span>
                              <span className="text-[#6F6F6F]">{formatCurrency(i.preco)}/un.</span>
                              <span className="ml-auto text-[#C9A962]">{formatCurrency(i.subtotal)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {p.mensagem && (
                        <p className="rounded-lg bg-[#0F0F0F] p-2.5 text-[11px] leading-relaxed text-[#8A8A8A]">
                          {p.mensagem}
                        </p>
                      )}
                      {p.resposta && (
                        <p className="rounded-lg border-l-2 border-[#C9A962]/50 bg-[#0F0F0F] p-2.5 text-[11px] leading-relaxed text-[#C9A962]">
                          <span className="mb-0.5 block text-[9px] uppercase tracking-[0.12em] text-[#525252]">
                            Resposta da gestão
                          </span>
                          {p.resposta}
                        </p>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------ CANDIDATURA */}
      {ficha.candidatura && (
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-5">
          <h2 className="text-sm font-medium text-[#F5F5F5]">Solicitação de origem</h2>
          <p className="mt-1 text-[11px] text-[#6F6F6F]">
            O que esta pessoa ou empresa escreveu quando pediu para ser revendedor.
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Dado rotulo="Tipo" valor={ROTULO_TIPO[ficha.candidatura.tipo] ?? ficha.candidatura.tipo} />
            <Dado rotulo="Recebida" valor={dataCurta(ficha.candidatura.created_at)} />
            <Dado rotulo="Área de atuação" valor={ficha.candidatura.area_atuacao ?? "—"} />
            <Dado rotulo="Representante" valor={ficha.candidatura.representante ?? "—"} />
          </dl>

          {ficha.candidatura.mensagem && (
            <p className="mt-3 whitespace-pre-line rounded-lg bg-[#0F0F0F] p-3 text-xs leading-relaxed text-[#A3A3A3]">
              {ficha.candidatura.mensagem}
            </p>
          )}
          {ficha.candidatura.resposta && (
            <p className="mt-2 whitespace-pre-line rounded-lg border-l-2 border-[#C9A962]/50 bg-[#0F0F0F] p-3 text-xs leading-relaxed text-[#C9A962]">
              {ficha.candidatura.resposta}
            </p>
          )}
        </section>
      )}

      {acoes}
    </div>
  );
}

function Dado({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-[0.12em] text-[#525252]">{rotulo}</dt>
      <dd className={`mt-0.5 text-xs text-[#E5E5E5] ${mono ? "font-mono" : ""}`}>{valor}</dd>
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-lg font-medium ${destaque ? "text-[#E3D5A7]" : "text-[#C9A962]"}`}>
        {valor}
      </p>
    </div>
  );
}

/** Ícones reexportados para os painéis que envolvem esta ficha. */
