/**
 * Canais de atendimento da INUKA.
 *
 * Ficam num sítio só porque aparecem em vários ecrãs (loja, contactos, aba de
 * referência) e um número desactualizado num deles é pior do que não ter
 * nenhum: o cliente liga e ninguém atende.
 *
 * O primeiro é o número comercial; o segundo é a linha de apoio.
 *
 * O gestor pode mudar tudo isto em **Definições** (`/gerente/definicoes`); o
 * que está aqui são os valores de origem, usados quando a base ainda não tem
 * definições gravadas ou quando a leitura falha.
 */
export const TELEFONES_INUKA = ["+244 927 991 441", "+244 930 800 698"] as const;

/** Número principal, para sítios onde só cabe um. */
export const TELEFONE_PRINCIPAL = TELEFONES_INUKA[0];

/** E-mail oficial de atendimento. */
export const EMAIL_INUKA = "inukaangolaa@gmail.com";

/** `tel:` sem espaços nem formatação. */
export function telHref(telefone: string): string {
  return `tel:${telefone.replace(/[^\d+]/g, "")}`;
}

/** Link de WhatsApp (wa.me) a partir de um número formatado. */
export function whatsappHref(telefone: string): string {
  return `https://wa.me/${telefone.replace(/\D/g, "")}`;
}

/** `mailto:` do e-mail de atendimento. */
export function mailHref(email: string = EMAIL_INUKA): string {
  return `mailto:${email}`;
}
