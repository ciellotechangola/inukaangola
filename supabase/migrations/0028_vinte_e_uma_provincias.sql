-- =============================================================================
-- 0028 — 21 PROVÍNCIAS
-- =============================================================================
-- A divisão político-administrativa de 2024 passou Angola de 18 para 21
-- províncias. As três novas nascem de desdobramentos:
--
--   · Icolo e Bengo  — saiu de Luanda (capital Catete)
--   · Cuando         — saiu do Cuando Cubango (capital Mavinga)
--   · Moxico Leste   — saiu do Moxico (capital Cazombo)
--
-- E o Cuando Cubango passou a chamar-se **Cubango** (mesmo código CCU, mesmo
-- id): sem isso ficavam duas províncias com «Cuando» no nome, uma delas a
-- designar um território que já não lhe pertence.
--
-- Cada província nova recebe a sua loja principal, com o código nascido do
-- código da província (`ICB-01`, `CDO-01`, `MXL-01`), tal como as outras 18.
-- Sem isso, os fluxos de stock, vendas e despesas dessas províncias não teriam
-- loja a que pertencer.
--
-- Idempotente: pode ser executada mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AS TRÊS PROVÍNCIAS NOVAS
-- -----------------------------------------------------------------------------
INSERT INTO public.provincias (nome, codigo, slug, capital, delegacao_nome, is_default)
VALUES
  ('Icolo e Bengo', 'ICB', 'icolo-e-bengo', 'Catete',  'Delegação do Icolo e Bengo', false),
  ('Cuando',        'CDO', 'cuando',         'Mavinga', 'Delegação do Cuando',        false),
  ('Moxico Leste',  'MXL', 'moxico-leste',   'Cazombo', 'Delegação do Moxico Leste',  false)
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. CUANDO CUBANGO PASSA A CHAMAR-SE CUBANGO
-- -----------------------------------------------------------------------------
-- `nome` é UNIQUE: o `NOT EXISTS` evita rebentar numa base onde já alguém
-- tenha criado «Cubango» à mão.
UPDATE public.provincias
   SET nome          = 'Cubango',
       delegacao_nome = 'Delegação do Cubango',
       updated_at    = now()
 WHERE codigo = 'CCU'
   AND nome = 'Cuando Cubango'
   AND NOT EXISTS (SELECT 1 FROM public.provincias WHERE nome = 'Cubango');

-- -----------------------------------------------------------------------------
-- 3. A LOJA PRINCIPAL DE CADA PROVÍNCIA NOVA
-- -----------------------------------------------------------------------------
-- Mesma regra da 0025: uma loja principal por província, código `<COD>-01`.
INSERT INTO public.lojas (codigo, nome, provincia_id, is_default)
SELECT pr.codigo || '-01',
       'Loja ' || pr.nome,
       pr.id,
       true
FROM public.provincias pr
WHERE NOT EXISTS (
        SELECT 1 FROM public.lojas l
        WHERE l.provincia_id = pr.id AND l.is_default
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.lojas l
        WHERE upper(l.codigo) = upper(pr.codigo || '-01')
      );

-- -----------------------------------------------------------------------------
-- 4. CONFERÊNCIA
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_total int;
  v_sem_loja int;
BEGIN
  SELECT count(*) INTO v_total FROM public.provincias WHERE is_active;
  IF v_total < 21 THEN
    RAISE WARNING 'Só há % províncias activas (esperadas 21).', v_total;
  END IF;

  SELECT count(*) INTO v_sem_loja
  FROM public.provincias pr
  WHERE pr.is_active
    AND NOT EXISTS (
      SELECT 1 FROM public.lojas l WHERE l.provincia_id = pr.id AND l.is_default
    );
  IF v_sem_loja > 0 THEN
    RAISE WARNING '% província(s) activa(s) sem loja principal.', v_sem_loja;
  END IF;
END $$;
