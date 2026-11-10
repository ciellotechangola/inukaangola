import Link from "next/link";
import { ArrowRight, CalendarClock, Clock, Sparkles, Tag } from "lucide-react";
import { createClientServer } from "@/lib/supabase-server";
import { CartaoConteudo } from "@/components/conteudos/CartaoConteudo";
import { dataConteudo, estadoDaPromocao, type Conteudo } from "@/lib/conteudos";
import {
  ambitoCatalogo,
  etiquetaValor,
  normalizarCampanhasVigentes,
  validadeCampanha,
  type CampanhaVigente,
} from "@/lib/promocoes";
import { provinciaDoVisitante } from "@/lib/promocoes-server";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Dias inteiros que faltam até uma data. Negativo = já passou. */
function diasAte(iso: string | null): number | null {
  if (!iso) return null;
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return null;
  return Math.ceil((alvo - Date.now()) / 86_400_000);
}

/** "Termina hoje" / "Termina amanhã" / "Faltam 6 dias". */
function validade(c: Conteudo): string | null {
  const dias = diasAte(c.ends_at);
  if (dias === null) return null;
  if (dias < 0) return "Terminada";
  if (dias === 0) return "Termina hoje";
  if (dias === 1) return "Termina amanhã";
  return `Termina em ${dias} dias`;
}

/**
 * Promoções da loja.
 *
 * O que a gestão publica no estúdio aparece aqui sem mais nenhum passo. As
 * campanhas fora das datas deixam de ser mostradas como ativas: quem tem
 * sessão vê-as numa secção "Encerradas", o visitante não as vê de todo.
 */
export default async function PromocoesPage() {
  const supabase = await createClientServer();
  const { data, error } = await supabase.rpc("conteudo_feed", {
    p_kind: "promocao",
    p_limit: 40,
  });

  // Campanhas de preço: as que valem na província de quem está a ver. Sem
  // sessão, ou sem província no perfil, só aparecem as nacionais — é a mesma
  // regra que `preco_efetivo` aplica ao cobrar.
  const provinciaId = await provinciaDoVisitante();
  const { data: campanhasBrutas } = await supabase.rpc("promocoes_vigentes", {
    p_provincia: provinciaId,
  });
  const campanhas: CampanhaVigente[] = normalizarCampanhasVigentes(campanhasBrutas);

  const promocoes = (data ?? []) as Conteudo[];
  const ativas = promocoes.filter((p) => estadoDaPromocao(p) === "ativa");
  const breves = promocoes.filter((p) => estadoDaPromocao(p) === "breve");
  const encerradas = promocoes.filter((p) => estadoDaPromocao(p) === "terminada");

  // A campanha em destaque é a que acaba primeiro entre as que já começaram —
  // é a que a pessoa tem mais pressa em ver.
  const destaque =
    [...ativas].sort((a, b) => {
      const da = diasAte(a.ends_at) ?? Number.MAX_SAFE_INTEGER;
      const db = diasAte(b.ends_at) ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    })[0] ?? null;

  const restantes = ativas.filter((p) => p.id !== destaque?.id);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
      {/* ------------------------------------------------------------------ */}
      {/* Cabeçalho                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative overflow-hidden rounded-3xl border border-[#C9A962]/25 bg-[radial-gradient(120%_120%_at_0%_0%,#2A2417_0%,#141414_45%,#0C0C0C_100%)] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#C9A962]/10 blur-3xl" />

        <div className="relative max-w-2xl">
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
            <Sparkles className="h-3 w-3" />
            Loja INUKA · campanhas
          </p>

          <h1 className="mt-4 text-3xl font-light leading-tight tracking-tight text-[#F5F5F5] sm:text-5xl">
            Beleza que chega
            <span className="block text-[#C9A962]">com vantagem.</span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#A3A3A3] sm:text-base">
            As campanhas em curso na INUKA Angola, com os produtos abrangidos e o tempo que
            ainda têm. Quando uma campanha termina, deixa de estar aqui — nunca fica a parecer
            que ainda vale.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/catalogo"
              className="inline-flex items-center gap-2 rounded-full bg-[#C9A962] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
            >
              Ver o catálogo
              <ArrowRight className="h-4 w-4" />
            </Link>

            {ativas.length > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#C9A962]/30 px-4 py-2 text-xs text-[#E3D5A7]">
                <Tag className="h-3.5 w-3.5" />
                {ativas.length === 1 ? "1 campanha em curso" : `${ativas.length} campanhas em curso`}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Campanhas de preço (aplicadas ao cobrar)                            */}
      {/* ------------------------------------------------------------------ */}
      {campanhas.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-light text-[#F5F5F5]">Campanhas de preço</h2>
              <p className="mt-1 text-xs text-[#6F6F6F]">
                O desconto já está no preço que a encomenda cobra
                {provinciaId ? " na sua província." : " em todo o país."}
              </p>
            </div>
            <Link
              href="/catalogo?promo=1"
              className="text-[11px] text-[#C9A962] transition hover:text-[#D8BC7A]"
            >
              Ver produtos em promoção →
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campanhas.map((c) => {
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-[#C9A962]/25 bg-gradient-to-br from-[#191919] to-[#111] p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-[#F5F5F5]">{c.nome}</h3>
                    <span className="rounded-full bg-[#C9A962] px-2 py-0.5 text-[10px] font-bold text-[#0A0A0A]">
                      {etiquetaValor(c, formatCurrency)}
                    </span>
                  </div>

                  {c.descricao && (
                    <p className="mt-2 text-xs leading-relaxed text-[#A3A3A3]">{c.descricao}</p>
                  )}

                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#6F6F6F]">
                    <span className="text-[#E3D5A7]">
                      {c.nacional ? "Todo o país" : c.provincias.join(" · ")}
                    </span>
                    <span>·</span>
                    <span>{ambitoCatalogo(c)}</span>
                  </p>

                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#C9A962]">
                    <Clock className="h-3 w-3" />
                    {validadeCampanha(c)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {error && (
        <div className="mt-8 rounded-xl border border-[#4A2020] bg-[#2A1010] p-4 text-sm text-[#F87171]">
          Não foi possível carregar as promoções: {error.message}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Sem campanhas                                                       */}
      {/* ------------------------------------------------------------------ */}
      {!error && ativas.length === 0 && breves.length === 0 && (
        <section className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-20 text-center">
          <Tag className="h-8 w-8 text-[#3F3F3F]" />
          <p className="text-base text-[#D4D4D4]">Não há promoções em curso neste momento.</p>
          <p className="max-w-sm text-sm text-[#6F6F6F]">
            O catálogo continua aberto — e os preços de campanha aparecem aqui assim que a
            gestão os publicar.
          </p>
          <Link
            href="/catalogo"
            className="mt-3 rounded-lg border border-[#C9A962] px-4 py-2 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
          >
            Ver o catálogo
          </Link>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Destaque                                                            */}
      {/* ------------------------------------------------------------------ */}
      {destaque && (
        <section className="mt-10">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-light text-[#F5F5F5]">Em destaque</h2>
            {validade(destaque) && (
              <span className="flex items-center gap-1.5 text-[11px] text-[#C9A962]">
                <Clock className="h-3 w-3" />
                {validade(destaque)}
              </span>
            )}
          </div>

          <div className="grid overflow-hidden rounded-2xl border border-[#C9A962]/30 bg-gradient-to-br from-[#1A1A1A] to-[#101010] lg:grid-cols-2">
            <div className="relative min-h-[220px] bg-[#0A0A0A] lg:min-h-[340px]">
              {destaque.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={destaque.image_url}
                  alt={destaque.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center text-xs text-[#3F3F3F]">
                  Campanha INUKA
                </div>
              )}
              <span className="absolute left-4 top-4 rounded-full bg-[#0A0A0A]/80 px-3 py-1 text-[10px] uppercase tracking-wider text-[#C9A962] backdrop-blur">
                Em curso
              </span>
            </div>

            <div className="flex flex-col justify-center p-6 sm:p-9">
              <h3 className="text-2xl font-light text-[#F5F5F5] sm:text-3xl">{destaque.title}</h3>
              {destaque.subtitle && (
                <p className="mt-2 text-sm text-[#C9A962]">{destaque.subtitle}</p>
              )}
              {destaque.body && (
                <p className="mt-4 text-sm leading-relaxed text-[#A3A3A3]">{destaque.body}</p>
              )}

              <p className="mt-5 flex items-center gap-2 text-[11px] text-[#6F6F6F]">
                <CalendarClock className="h-3.5 w-3.5" />
                {destaque.starts_at ? `Desde ${dataConteudo(destaque.starts_at)}` : "Sem data de início"}
                {destaque.ends_at ? ` até ${dataConteudo(destaque.ends_at)}` : ""}
              </p>

              {destaque.produtos?.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">
                    Produtos abrangidos
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {destaque.produtos.slice(0, 6).map((p) => (
                      <Link
                        key={p.id}
                        href={`/produto/${p.id}`}
                        className="rounded-full border border-[#333] px-3 py-1 text-[11px] text-[#D4D4D4] transition hover:border-[#C9A962] hover:text-[#C9A962]"
                      >
                        {p.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-7 flex flex-wrap gap-3">
                {destaque.cta_label && destaque.cta_href ? (
                  <Link
                    href={destaque.cta_href}
                    className="inline-flex items-center gap-2 rounded-full bg-[#C9A962] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
                  >
                    {destaque.cta_label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    href="/catalogo"
                    className="inline-flex items-center gap-2 rounded-full bg-[#C9A962] px-5 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
                  >
                    Aproveitar
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Restantes em curso                                                  */}
      {/* ------------------------------------------------------------------ */}
      {restantes.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-5 text-lg font-light text-[#F5F5F5]">
            {destaque ? "Também em curso" : "Campanhas em curso"}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {restantes.map((p) => (
              <CartaoConteudo key={p.id} conteudo={p} variante="loja" />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* A começar                                                           */}
      {/* ------------------------------------------------------------------ */}
      {breves.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-light text-[#F5F5F5]">A começar</h2>
          <p className="mt-1 text-xs text-[#5F5F5F]">
            Já publicadas, ainda fora do prazo. Ficam visíveis para poder planear a compra.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {breves.map((p) => (
              <div key={p.id} className="relative">
                <span className="absolute -top-2 left-3 z-10 rounded-full bg-[#2A2410] px-2.5 py-0.5 text-[10px] text-[#E3D5A7]">
                  {p.starts_at ? `Começa a ${dataConteudo(p.starts_at)}` : "Em breve"}
                </span>
                <CartaoConteudo conteudo={p} variante="loja" mostrarInteracoes={false} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Encerradas                                                          */}
      {/* ------------------------------------------------------------------ */}
      {encerradas.length > 0 && (
        <section className="mt-14 rounded-2xl border border-[#1F1F1F] bg-[#0F0F0F] p-5 sm:p-6">
          <h2 className="text-sm font-medium text-[#8A8A8A]">Campanhas encerradas</h2>
          <p className="mt-1 text-xs text-[#5F5F5F]">
            Já não estão válidas. Ficam visíveis apenas para consulta — não voltam a estar em
            curso sozinhas.
          </p>
          <div className="mt-5 grid gap-5 opacity-50 sm:grid-cols-2 lg:grid-cols-3">
            {encerradas.map((p) => (
              <CartaoConteudo key={p.id} conteudo={p} variante="loja" mostrarInteracoes={false} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Fecho                                                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="mt-14 flex flex-col items-center gap-3 rounded-2xl border border-[#262626] bg-[#141414] px-6 py-10 text-center">
        <p className="text-sm text-[#A3A3A3]">
          Não encontrou o que procura? O catálogo tem tudo o que está disponível hoje.
        </p>
        <Link
          href="/catalogo"
          className="inline-flex items-center gap-2 rounded-full border border-[#C9A962] px-5 py-2.5 text-sm text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
        >
          Explorar o catálogo
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
