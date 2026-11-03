/**
 * Números de atendimento da INUKA.
 *
 * Ficam num sítio só porque aparecem em vários ecrãs (loja, contactos, aba de
 * referência) e um número desactualizado num deles é pior do que não ter
 * nenhum: o cliente liga e ninguém atende.
 *
 * O primeiro é o número comercial; o segundo é a linha de apoio.
 */
export const TELEFONES_INUKA = ["+244 927 991 441", "+244 930 800 698"] as const;

/** Número principal, para sítios onde só cabe um. */
export const TELEFONE_PRINCIPAL = TELEFONES_INUKA[0];

/** `tel:` sem espaços nem formatação. */
export function telHref(telefone: string): string {
  return `tel:${telefone.replace(/[^\d+]/g, "")}`;
}

/** Link de WhatsApp (wa.me) a partir de um número formatado. */
export function whatsappHref(telefone: string): string {
  return `https://wa.me/${telefone.replace(/\D/g, "")}`;
}
