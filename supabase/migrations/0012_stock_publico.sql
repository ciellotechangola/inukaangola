-- =============================================================================
--  0012 — DISPONIBILIDADE VISÍVEL A QUEM NÃO TEM CONTA
-- =============================================================================
--  O QUE ESTAVA MAL
--    `inventory` só é legível por contas autenticadas (é a política certa: o
--    stock é informação da empresa). Mas a loja usava exactamente essa leitura
--    para decidir se mostrava «Esgotado». Resultado: um visitante — a maioria
--    de quem entra no catálogo — nunca via o produto esgotado e, na página do
--    produto, ficava sem o formulário de reserva. O aviso de rutura só existia
--    para quem já tinha sessão.
--
--  O QUE PASSA A ACONTECER
--    `stock_produtos(uuid[])` devolve, por produto, as unidades disponíveis
--    (quantidade menos reservado), em bloco e numa só chamada:
--      · número  → há inventário registado; é este o valor a mostrar;
--      · NULL    → não há linha de inventário (produto sem controlo de stock),
--                  que é diferente de zero — zero quer dizer esgotado.
--    `SECURITY DEFINER` para poder ler `inventory` mesmo sem sessão; expõe
--    apenas o número por produto, nunca o resto da tabela.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.stock_produtos(p_ids uuid[])
RETURNS TABLE (product_id uuid, disponivel int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- `LEFT JOIN` para os produtos sem inventário aparecerem com NULL em vez
  -- de desaparecerem da resposta (o chamador distingue «sem controlo» de
  -- «esgotado»).
  SELECT t.pid AS product_id,
         CASE
           WHEN i.product_id IS NULL THEN NULL
           ELSE GREATEST(0, i.quantity - i.reserved_quantity)
         END AS disponivel
  FROM unnest(COALESCE(p_ids, '{}'::uuid[])) AS t(pid)
  LEFT JOIN public.inventory i ON i.product_id = t.pid;
$$;

-- ------------------------------------------------------------ PERMISSÕES
-- A loja pública é servida a `anon`; sem este GRANT o catálogo continuaria
-- cego para visitantes.
GRANT EXECUTE ON FUNCTION public.stock_produtos(uuid[]) TO anon, authenticated;
