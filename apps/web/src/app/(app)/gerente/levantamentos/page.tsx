import GestaoLevantamentos from "@/components/levantamentos/GestaoLevantamentos";

export const dynamic = "force-dynamic";

/**
 * Painel da gestão para os pedidos de levantamento.
 *
 * Quem pode ver o quê é decidido na base de dados (`levantamentos_equipa` filtra
 * por `can_manage_province`), por isso a página não repete a regra.
 */
export default function GestaoLevantamentosPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <GestaoLevantamentos />
    </main>
  );
}
