import GestaoPromocoes from "@/components/promocoes/GestaoPromocoes";

export const dynamic = "force-dynamic";

/**
 * Promoções da gestão.
 *
 * A página é um invólucro fino: o ecrã vive no componente de cliente porque
 * criar e editar promoções é interactivo e a lista muda a cada gravação. O
 * acesso já é barrado pelo `proxy.ts` (`/gerente` é só de gestão) e as RPCs
 * voltam a verificar `is_manager()` na base.
 */
export default function PromocoesPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <GestaoPromocoes />
    </main>
  );
}
