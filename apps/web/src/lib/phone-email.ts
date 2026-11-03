import { normalizePhone } from "./utils";

/**
 * Domínio interno usado para transformar telefone em email.
 *
 * O Supabase Auth exige um email para autenticação por palavra-passe.
 * Como o INUKA Angola autentica por TELEFONE, geramos um email sintético
 * determinístico a partir do número:
 *
 *   +244 900 000 009  ->  u244900000009@inuka.ao
 *
 * Ser determinístico (em vez de aleatório) é essencial: é o que permite
 * ao ecrã de login reconstruir o email a partir do telefone, sem precisar
 * de consultar `profiles` (que o RLS bloqueia para utilizadores anónimos).
 *
 * Este domínio NÃO recebe correio. Os utilizadores são criados via
 * Admin API com `email_confirm: true`, pelo que nenhum email é enviado.
 */
export const INTERNAL_EMAIL_DOMAIN = "inuka.ao";

/** Converte um telefone normalizado no email interno de autenticação. */
export function phoneToEmail(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  return `u${normalized.replace(/^\+/, "")}@${INTERNAL_EMAIL_DOMAIN}`;
}

/** Indica se a string parece um email interno gerado pelo sistema. */
export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return new RegExp(`^u\\d+@${INTERNAL_EMAIL_DOMAIN}$`).test(email);
}
