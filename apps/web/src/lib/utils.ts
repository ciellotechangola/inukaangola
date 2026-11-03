export function normalizePhone(phone: string): string {
  let cleaned = (phone || "").replace(/[^0-9+]/g, "");

  // 00244... -> +244...
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);

  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (!/^\d{9,15}$/.test(digits)) return "";
    return "+" + digits;
  }

  if (!/^\d{9,15}$/.test(cleaned)) return "";

  // Já inclui o indicativo angolano (244 + 9 dígitos)
  if (cleaned.startsWith("244") && cleaned.length === 12) return "+" + cleaned;

  // Número local angolano (9 dígitos)
  return "+244" + cleaned;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-AO", {
    style: "currency",
    currency: "AOA",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
