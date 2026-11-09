-- =============================================================================
--  INUKA ANGOLA — PATCH: DISPONIBILIDADE VISÍVEL A QUEM NÃO TEM CONTA
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0012_stock_publico.sql (mesmo conteúdo).
--
--  O QUE RESOLVE
--    Um visitante sem conta passa a ver «Esgotado» no catálogo e o formulário
--    de reserva na página do produto. Antes só quem tinha sessão via a rutura,
--    porque o stock só é legível por contas autenticadas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.stock_produtos(p_ids uuid[])
RETURNS TABLE (product_id uuid, disponivel int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.pid AS product_id,
         CASE
           WHEN i.product_id IS NULL THEN NULL
           ELSE GREATEST(0, i.quantity - i.reserved_quantity)
         END AS disponivel
  FROM unnest(COALESCE(p_ids, '{}'::uuid[])) AS t(pid)
  LEFT JOIN public.inventory i ON i.product_id = t.pid;
$$;

GRANT EXECUTE ON FUNCTION public.stock_produtos(uuid[]) TO anon, authenticated;
