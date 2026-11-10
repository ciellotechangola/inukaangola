/**
 * Promoções com âmbito de província.
 *
 * A regra que decide o preço vive na base de dados (`promocao_do_produto` /
 * `preco_efetivo`), porque é ela que cobra. Este ficheiro só descreve o que a
 * interface mostra e formata — não recalcula preços por conta própria.
 */

/** Chave em `platform_settings` para o mínimo de vendas do levantamento. */
export const CHAVE_LEVANTAMENTO = "levantamento";

export type TipoPromocao = "percentagem" | "preco";

export interface Promocao {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: TipoPromocao;
  valor: number;
  starts_at: string;
  ends_at: string | null;
  ativo: boolean;
  vigente: boolean;
  /** Sem províncias escolhidas = vale no país inteiro. */
  nacional: boolean;
  provincia_ids: string[];
  provincias: string[];
  /** Sem produtos escolhidos = vale para todo o catálogo. */
  product_ids: string[];
  produtos: number;
}

/** Normaliza a resposta de `promocoes_lista()`. */
export function normalizarPromocoes(bruto: unknown): Promocao[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((r) => {
    const p = r as Record<string, unknown>;
    return {
      id: String(p.id),
      nome: String(p.nome ?? ""),
      descricao: (p.descricao as string | null) ?? null,
      tipo: p.tipo === "preco" ? "preco" : "percentagem",
      valor: Number(p.valor ?? 0),
      starts_at: String(p.starts_at ?? ""),
      ends_at: (p.ends_at as string | null) ?? null,
      ativo: p.ativo !== false,
      vigente: p.vigente === true,
      nacional: p.nacional !== false,
      provincia_ids: Array.isArray(p.provincia_ids) ? (p.provincia_ids as string[]) : [],
      provincias: Array.isArray(p.provincias) ? (p.provincias as string[]) : [],
      product_ids: Array.isArray(p.product_ids) ? (p.product_ids as string[]) : [],
      produtos: Number(p.produtos ?? 0),
    };
  });
}

/** «20 %» ou «12 000 Kz». */
export function etiquetaValor(p: Pick<Promocao, "tipo" | "valor">, formatarKz: (n: number) => string): string {
  return p.tipo === "percentagem"
    ? `${String(p.valor).replace(".", ",")} %`
    : formatarKz(p.valor);
}

/** Onde a promoção se aplica, em texto curto. */
export function ambitoGeografico(p: Pick<Promocao, "nacional" | "provincias">): string {
  if (p.nacional) return "Todo o país";
  if (p.provincias.length === 0) return "Todo o país";
  if (p.provincias.length <= 3) return p.provincias.join(" · ");
  return `${p.provincias.slice(0, 2).join(" · ")} +${p.provincias.length - 2}`;
}

/** A que produtos se aplica. */
export function ambitoCatalogo(p: Pick<Promocao, "produtos">): string {
  return p.produtos === 0 ? "Todo o catálogo" : `${p.produtos} produto${p.produtos > 1 ? "s" : ""}`;
}

/**
 * Estado da campanha, para o selo da lista.
 *
 * `vigente` vem do servidor (ativo + dentro do prazo). Aqui só se distingue
 * o que está agendado do que já terminou.
 */
export function estadoPromocao(p: Promocao, agora = new Date()): "activa" | "agendada" | "terminada" | "desligada" {
  if (!p.ativo) return "desligada";
  const inicio = new Date(p.starts_at);
  if (!Number.isNaN(inicio.getTime()) && inicio > agora) return "agendada";
  if (p.ends_at) {
    const fim = new Date(p.ends_at);
    if (!Number.isNaN(fim.getTime()) && fim < agora) return "terminada";
  }
  return p.vigente ? "activa" : "agendada";
}

export const ROTULO_ESTADO: Record<ReturnType<typeof estadoPromocao>, string> = {
  activa: "A decorrer",
  agendada: "Agendada",
  terminada: "Terminada",
  desligada: "Desligada",
};

/** `<input type="datetime-local">` ↔ ISO. */
export function paraInputData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function deInputData(valor: string): string | null {
  if (!valor.trim()) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Campanha a decorrer, tal como `promocoes_vigentes()` a devolve.
 *
 * É a versão que a montra vê: só o que já começou, ainda não acabou e vale na
 * província de quem está a olhar. Sem os ids das províncias — para a loja só
 * interessa «é nacional ou é desta província».
 */
export interface CampanhaVigente {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: TipoPromocao;
  valor: number;
  starts_at: string;
  ends_at: string | null;
  nacional: boolean;
  provincias: string[];
  produtos: number;
}

export function normalizarCampanhasVigentes(bruto: unknown): CampanhaVigente[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((r) => {
    const c = r as Record<string, unknown>;
    return {
      id: String(c.id ?? ""),
      nome: String(c.nome ?? ""),
      descricao: (c.descricao as string | null) ?? null,
      tipo: c.tipo === "preco" ? "preco" : "percentagem",
      valor: Number(c.valor ?? 0),
      starts_at: String(c.starts_at ?? ""),
      ends_at: (c.ends_at as string | null) ?? null,
      nacional: c.nacional === true,
      provincias: Array.isArray(c.provincias) ? (c.provincias as string[]) : [],
      produtos: Number(c.produtos ?? 0),
    };
  });
}

/** Quantos dias faltam até uma data. `null` = sem data legível. */
export function diasAte(iso: string | null, agora = new Date()): number | null {
  if (!iso) return null;
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return null;
  return Math.ceil((alvo - agora.getTime()) / 86_400_000);
}

/** «Termina hoje» / «Termina em 3 dias» / «Sem data de fim». */
export function validadeCampanha(c: Pick<CampanhaVigente, "ends_at">): string {
  const dias = diasAte(c.ends_at);
  if (dias === null) return "Sem data de fim";
  if (dias <= 0) return "Termina hoje";
  if (dias === 1) return "Termina amanhã";
  return `Termina em ${dias} dias`;
}
