import { formatCurrency } from "@/lib/utils";

/**
 * Entrega: quanto custa e onde é gratuita.
 *
 * A regra do negócio é uma só — **a entrega é gratuita no Uíge; nas outras
 * províncias paga-se uma taxa** — mas os valores vivem em `platform_settings`
 * (chave `entrega`), para a gerência poder mudar a taxa sem tocar em código.
 *
 * Este ficheiro é **puro** (importado por componentes de browser). A mesma
 * regra existe em SQL, dentro de `public.taxa_entrega()`, que é quem manda:
 * o cliente vê aqui a estimativa, mas o valor gravado na encomenda é o que a
 * base calcular. As duas implementações têm de andar de mãos dadas — se mudar
 * uma, mude a outra (`supabase/migrations/0010_taxa_entrega.sql`).
 */

/** Chave em `platform_settings`. */
export const CHAVE_ENTREGA = "entrega";

export interface DefinicoesEntrega {
  /** Taxa cobrada nas províncias sem isenção, em kwanzas. */
  taxaPadrao: number;
  /** Slugs (`provincias.slug`) das províncias com entrega gratuita. */
  gratis: string[];
  /** Uma linha que a gerência queira acrescentar (ex.: prazo de entrega). */
  nota: string | null;
}

/**
 * O que a loja faz quando ninguém configurou nada: grátis no Uíge, 2 000 Kz
 * nas restantes províncias. É este o valor que o SQL também assume.
 */
export const ENTREGA_PADRAO: DefinicoesEntrega = {
  taxaPadrao: 2000,
  gratis: ["uige"],
  nota: null,
};

function numero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor) && valor >= 0) return valor;
  if (typeof valor === "string" && valor.trim()) {
    const n = Number(valor.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function slug(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim().toLowerCase();
  return s ? s : null;
}

/**
 * Aceita o que vier da base e devolve sempre um objecto completo.
 *
 * Nunca lança: um valor estragado em `platform_settings` não pode deixar a
 * loja a cobrar uma taxa inventada nem a oferecer entrega grátis em todo o
 * país. Se o que está gravado não servir, volta-se ao padrão.
 */
export function normalizarEntrega(valor: unknown): DefinicoesEntrega {
  const cru = (valor ?? {}) as Record<string, unknown>;

  const gratis = Array.isArray(cru.gratis)
    ? cru.gratis.map(slug).filter((s): s is string => Boolean(s))
    : ENTREGA_PADRAO.gratis;

  const taxa = numero(cru.taxaPadrao);

  return {
    taxaPadrao: taxa === null ? ENTREGA_PADRAO.taxaPadrao : Math.round(taxa),
    gratis,
    nota: typeof cru.nota === "string" && cru.nota.trim() ? cru.nota.trim() : null,
  };
}

/** A província (por slug) tem entrega gratuita? */
export function provinciaGratis(
  provinciaSlug: string | null | undefined,
  defs: DefinicoesEntrega
): boolean {
  const s = slug(provinciaSlug);
  return s ? defs.gratis.includes(s) : false;
}

/**
 * Taxa aplicada a uma província. `0` significa entrega gratuita.
 *
 * Sem província conhecida assume-se a taxa padrão: cobrar a mais é corrigível
 * no balcão, cobrar a menos é dinheiro que não volta.
 */
export function taxaDeEntrega(
  provinciaSlug: string | null | undefined,
  defs: DefinicoesEntrega
): number {
  if (provinciaGratis(provinciaSlug, defs)) return 0;
  return defs.taxaPadrao;
}

/** «Grátis» ou «2 000 Kz». */
export function etiquetaTaxa(valor: number): string {
  return valor <= 0 ? "Grátis" : formatCurrency(valor);
}

/**
 * O que a rota `/api/entrega` devolve ao carrinho.
 *
 * Vive aqui (e não em `entrega-server.ts`) para o componente de browser poder
 * importar o tipo sem arrastar consigo o cliente de serviço do Supabase.
 */
export interface EstadoEntrega {
  /** Província do cliente (do perfil); `null` se ainda não tem. */
  provincia: { slug: string; nome: string } | null;
  /** Taxa que esta encomenda paga. `0` = grátis. */
  taxa: number;
  gratis: boolean;
  taxaPadrao: number;
  /** Nomes das províncias isentas, para o texto genérico. */
  gratisNomes: string[];
  nota: string | null;
}

/**
 * Frase para o cliente, com os nomes das províncias isentas já resolvidos.
 *
 *   «Entrega grátis no Uíge · 2 000 Kz nas outras províncias»
 */
export function resumoEntrega(
  defs: DefinicoesEntrega,
  nomesGratis: string[] = []
): string {
  // Sem preposição à frente do nome da província: «no Uíge» está certo, mas
  // «no Huíla» não. Uma lista resolve todos os casos sem errar gramática.
  const nomes = (nomesGratis.length ? nomesGratis : ["Uíge"]).join(" · ");

  if (defs.taxaPadrao <= 0) return "Entrega grátis em todo o país";
  return `Entrega grátis: ${nomes} · ${formatCurrency(defs.taxaPadrao)} nas outras províncias`;
}
