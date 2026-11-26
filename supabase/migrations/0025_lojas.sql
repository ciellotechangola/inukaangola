-- =============================================================================
-- 0025 — LOJAS: CADA MOVIMENTO PERTENCE A UMA LOJA
-- =============================================================================
-- O PROBLEMA
-- A operação estava organizada por província. Uma província podia ter várias
-- lojas e todas as vendas, stock e despesas caíam no mesmo saco — não havia
-- forma de saber o que era de cada loja, nem de dar a cada gerente o controlo
-- do seu espaço.
--
-- A SOLUÇÃO
-- Uma tabela `lojas` com código, nome e província. Cada loja tem um gerente
-- (um `manager` com `loja_id` e `provincia_id`) e todos os fluxos passam a ter
-- `loja_id`: perfis, stock, movimentos de stock, vendas, encomendas, reservas
-- e despesas.
--
-- NADA SE PERDE
-- A migração cria uma loja principal por província (código `<PROV>-01`, nome
-- «Loja <Província>») e liga todo o histórico existente a ela. Os registos
-- antigos sem província ficam na loja da sede (Luanda). A partir daí podem
-- ser criadas mais lojas na mesma província; a primeira é a principal.
--
-- CÁLCULO AUTOMÁTICO
-- Cada loja calcula stock, vendas, despesas, investimento, valores a pagar,
-- caixa e saldo a partir dos seus próprios movimentos. O gerente da loja pode
-- corrigir caixa, saldo, investimento e valores a pagar (`lojas_indicadores`);
-- o automático continua visível ao lado e nunca é apagado.
--
-- QUEM MANDA
--   manager nacional  — cria/edita lojas em qualquer província, mas só corrige
--                       valores na sua zona (Luanda). O resto é automático.
--   manager provincial— vê e gere as lojas da sua província; corrige a loja
--                       de que é gerente.
--   store_seller      — vê e opera apenas a sua loja (stock, balcão).
--
-- IDEMPOTENTE: pode voltar a correr.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LOJAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lojas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       text NOT NULL,
  nome         text NOT NULL,
  provincia_id uuid NOT NULL REFERENCES public.provincias(id) ON DELETE RESTRICT,
  manager_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  telefone     text,
  endereco     text,
  nota         text,
  is_default   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lojas_codigo_preenchido CHECK (btrim(codigo) <> ''),
  CONSTRAINT lojas_nome_preenchido   CHECK (btrim(nome) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS lojas_codigo_unico
  ON public.lojas (upper(codigo));
CREATE UNIQUE INDEX IF NOT EXISTS lojas_default_provincia
  ON public.lojas (provincia_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_lojas_provincia ON public.lojas (provincia_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lojas_manager   ON public.lojas (manager_id);

DROP TRIGGER IF EXISTS trg_lojas_updated ON public.lojas;
CREATE TRIGGER trg_lojas_updated
  BEFORE UPDATE ON public.lojas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.lojas IS
  'Lojas da INUKA. Cada uma tem código, nome, província e gerente; todos os fluxos apontam para aqui.';

-- -----------------------------------------------------------------------------
-- 2. A LOJA PRINCIPAL DE CADA PROVÍNCIA (histórico incluído)
-- -----------------------------------------------------------------------------
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

-- O gerente provincial existente passa a ser gerente da loja principal.
UPDATE public.lojas l
SET manager_id = (
  SELECT p.id
  FROM public.profiles p
  WHERE p.role = 'manager'
    AND p.is_active
    AND p.provincia_id = l.provincia_id
  ORDER BY p.created_at
  LIMIT 1
)
WHERE l.manager_id IS NULL;

-- -----------------------------------------------------------------------------
-- 3. `loja_id` EM TODOS OS FLUXOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

ALTER TABLE public.despesas
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_loja    ON public.profiles (loja_id);
CREATE INDEX IF NOT EXISTS idx_inventory_loja   ON public.inventory (loja_id);
CREATE INDEX IF NOT EXISTS idx_movements_loja   ON public.inventory_movements (loja_id);
CREATE INDEX IF NOT EXISTS idx_sales_loja       ON public.sales (loja_id);
CREATE INDEX IF NOT EXISTS idx_orders_loja      ON public.orders (loja_id);
CREATE INDEX IF NOT EXISTS idx_reservas_loja    ON public.reservations (loja_id);
CREATE INDEX IF NOT EXISTS idx_despesas_loja    ON public.despesas (loja_id);

-- Perfis: quem tem província fica na loja principal dessa província. A
-- administração nacional fica sem loja (vê todas).
UPDATE public.profiles p
SET loja_id = (
  SELECT l.id FROM public.lojas l
  WHERE l.provincia_id = p.provincia_id AND l.is_default
  LIMIT 1
)
WHERE p.loja_id IS NULL
  AND p.provincia_id IS NOT NULL;

-- Fluxos: loja principal da província; sem província, a loja da sede.
DO $$
DECLARE
  v_tabela text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'inventory', 'inventory_movements', 'sales', 'orders', 'reservations', 'despesas'
  ] LOOP
    EXECUTE format($f$
      UPDATE public.%I x
      SET loja_id = COALESCE(
        (SELECT l.id FROM public.lojas l
         WHERE l.provincia_id = x.provincia_id AND l.is_default LIMIT 1),
        (SELECT l.id FROM public.lojas l
         WHERE l.provincia_id = public.default_province() AND l.is_default LIMIT 1)
      )
      WHERE x.loja_id IS NULL
    $f$, v_tabela);
  END LOOP;
END $$;

-- O stock deixa de ser único por (produto, província) e passa a ser único por
-- (produto, loja): duas lojas da mesma província podem ter o mesmo produto.
DROP INDEX IF EXISTS public.inventory_produto_provincia;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_produto_loja
  ON public.inventory (product_id, loja_id) WHERE loja_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. QUEM É QUEM
-- -----------------------------------------------------------------------------
-- Loja principal de uma província (ou da sede, quando a província é nula).
CREATE OR REPLACE FUNCTION public.loja_da_provincia(p_provincia_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT l.id
  FROM public.lojas l
  WHERE l.is_active
    AND l.provincia_id = COALESCE(p_provincia_id, public.default_province())
  ORDER BY l.is_default DESC, l.created_at
  LIMIT 1;
$$;

-- A loja de quem está autenticado. Sem loja atribuída, cai na principal da
-- sua província — ninguém fica sem loja por esquecimento.
CREATE OR REPLACE FUNCTION public.minha_loja()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.loja_id FROM public.profiles p WHERE p.id = auth.uid()),
    public.loja_da_provincia(public.my_province())
  );
$$;

-- Gerir a loja (criar, editar, atribuir gerente): gestão da província.
CREATE OR REPLACE FUNCTION public.can_manage_loja(p_loja_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lojas l
    WHERE l.id = p_loja_id
      AND public.is_manager()
      AND public.can_manage_province(l.provincia_id)
  );
$$;

-- Corrigir os valores da loja: o gerente da loja; a administração nacional
-- apenas na sua zona (Luanda). Todo o resto é automático.
CREATE OR REPLACE FUNCTION public.pode_editar_loja(p_loja_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lojas l
    WHERE l.id = p_loja_id
      AND public.is_manager()
      AND (
        (public.is_national() AND l.provincia_id = public.default_province())
        OR l.manager_id = auth.uid()
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.loja_da_provincia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_loja()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_loja(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_editar_loja(uuid)  TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. PREENCHER A LOJA AUTOMATICAMENTE
-- -----------------------------------------------------------------------------
-- Corre depois dos triggers `trg_fill_province_*` (o nome começa por
-- `trg_zfill`), para já encontrar a província preenchida.
CREATE OR REPLACE FUNCTION public.fill_loja()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.loja_id IS NULL THEN
    NEW.loja_id := public.loja_da_provincia(NEW.provincia_id);
  ELSIF TG_OP = 'UPDATE'
        AND NEW.provincia_id IS DISTINCT FROM OLD.provincia_id
        AND (SELECT l.provincia_id FROM public.lojas l WHERE l.id = NEW.loja_id)
            IS DISTINCT FROM NEW.provincia_id THEN
    NEW.loja_id := public.loja_da_provincia(NEW.provincia_id);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_tabela text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'profiles', 'inventory', 'inventory_movements', 'sales', 'orders',
    'reservations', 'despesas'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_zfill_loja_%1$s ON public.%1$I', v_tabela);
    EXECUTE format(
      'CREATE TRIGGER trg_zfill_loja_%1$s BEFORE INSERT OR UPDATE OF provincia_id
       ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.fill_loja()', v_tabela);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lojas_read ON public.lojas;
CREATE POLICY lojas_read ON public.lojas
  FOR SELECT TO authenticated
  USING (
    public.is_national()
    OR (public.is_manager() AND public.can_see_province(lojas.provincia_id))
    OR lojas.id = public.minha_loja()
  );

DROP POLICY IF EXISTS lojas_write ON public.lojas;
CREATE POLICY lojas_write ON public.lojas
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(lojas.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(lojas.provincia_id));

-- O vendedor de loja deixa de ver o stock da província inteira: passa a ver o
-- da sua loja. A gestão continua a ver a província (ou o país).
DROP POLICY IF EXISTS inventory_read ON public.inventory;
CREATE POLICY inventory_read ON public.inventory
  FOR SELECT TO authenticated
  USING (
    public.can_see_province(inventory.provincia_id)
    AND (
      NOT public.is_store_seller()
      OR inventory.loja_id = public.minha_loja()
    )
  );

DROP POLICY IF EXISTS inventory_manager_write ON public.inventory;
CREATE POLICY inventory_manager_write ON public.inventory
  FOR ALL TO authenticated
  USING (
    (public.is_manager() AND public.can_manage_province(inventory.provincia_id))
    OR (public.is_store_seller() AND inventory.loja_id = public.minha_loja())
  )
  WITH CHECK (
    (public.is_manager() AND public.can_manage_province(inventory.provincia_id))
    OR (public.is_store_seller() AND inventory.loja_id = public.minha_loja())
  );

DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (
    (public.is_manager() OR public.is_seller() OR public.is_store_seller())
    AND public.can_see_province(inventory_movements.provincia_id)
    AND (
      NOT public.is_store_seller()
      OR inventory_movements.loja_id = public.minha_loja()
    )
  );

DROP POLICY IF EXISTS inventory_movements_manager_write ON public.inventory_movements;
CREATE POLICY inventory_movements_manager_write ON public.inventory_movements
  FOR ALL TO authenticated
  USING (
    (public.is_manager() AND public.can_manage_province(inventory_movements.provincia_id))
    OR (public.is_store_seller() AND inventory_movements.loja_id = public.minha_loja())
  )
  WITH CHECK (
    (public.is_manager() AND public.can_manage_province(inventory_movements.provincia_id))
    OR (public.is_store_seller() AND inventory_movements.loja_id = public.minha_loja())
  );

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (
    (sales.seller_id = auth.uid() OR public.is_manager() OR public.is_store_seller())
    AND public.can_see_province(sales.provincia_id)
    AND (
      NOT public.is_store_seller()
      OR sales.loja_id = public.minha_loja()
    )
  );

DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (
    (
      orders.customer_id = auth.uid()
      OR orders.seller_id = auth.uid()
      OR public.is_manager()
      OR public.is_store_seller()
      OR (public.is_seller() AND public.is_my_customer(orders.customer_id))
    )
    AND public.can_see_province(orders.provincia_id)
    AND (
      NOT public.is_store_seller()
      OR orders.loja_id = public.minha_loja()
    )
  );

-- -----------------------------------------------------------------------------
-- 7. CRIAR / EDITAR LOJA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_loja(
  p_codigo       text,
  p_nome         text,
  p_provincia_id uuid,
  p_manager_id   uuid DEFAULT NULL,
  p_telefone     text DEFAULT NULL,
  p_endereco     text DEFAULT NULL,
  p_nota         text DEFAULT NULL,
  p_is_active    boolean DEFAULT true,
  p_id           uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_codigo   text := upper(btrim(COALESCE(p_codigo, '')));
  v_nome     text := btrim(COALESCE(p_nome, ''));
  v_id       uuid := p_id;
  v_default  boolean := false;
  v_antiga   uuid;
  v_existe   uuid;
  v_tem_uso  boolean;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão cria ou edita lojas' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_province(p_provincia_id) THEN
    RAISE EXCEPTION 'Só pode gerir lojas da província que gere' USING ERRCODE = '42501';
  END IF;

  IF v_codigo !~ '^[A-Z0-9][A-Z0-9-]{1,14}$' THEN
    RAISE EXCEPTION 'Código inválido. Use 2 a 15 letras/números (ex.: UIG-02)'
      USING ERRCODE = '22023';
  END IF;

  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Indique o nome da loja' USING ERRCODE = '22023';
  END IF;

  SELECT l.id INTO v_existe
  FROM public.lojas l
  WHERE upper(l.codigo) = v_codigo
    AND (p_id IS NULL OR l.id <> p_id);

  IF v_existe IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe uma loja com o código %', v_codigo USING ERRCODE = '23505';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT l.provincia_id INTO v_antiga FROM public.lojas l WHERE l.id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Loja inexistente' USING ERRCODE = 'P0002';
    END IF;

    -- Mudar de província só enquanto a loja não tem movimentos: senão o
    -- histórico passava a pertencer a outra província sem ninguém saber.
    IF v_antiga IS DISTINCT FROM p_provincia_id THEN
      SELECT EXISTS (
        SELECT 1 FROM public.inventory i WHERE i.loja_id = p_id
        UNION ALL
        SELECT 1 FROM public.sales s WHERE s.loja_id = p_id
        UNION ALL
        SELECT 1 FROM public.despesas d WHERE d.loja_id = p_id
      ) INTO v_tem_uso;

      IF v_tem_uso THEN
        RAISE EXCEPTION 'Esta loja já tem movimentos. Não pode mudar de província.'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    -- A primeira loja da província é a principal.
    SELECT NOT EXISTS (
      SELECT 1 FROM public.lojas l WHERE l.provincia_id = p_provincia_id
    ) INTO v_default;
  END IF;

  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_manager_id
        AND p.role = 'manager'
        AND p.is_active
        AND (p.provincia_id = p_provincia_id OR p.is_national_admin)
    ) THEN
      RAISE EXCEPTION 'O gerente tem de ser um gestor da província da loja'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.lojas
      (codigo, nome, provincia_id, manager_id, telefone, endereco, nota, is_default, is_active)
    VALUES
      (v_codigo, v_nome, p_provincia_id, p_manager_id,
       NULLIF(btrim(COALESCE(p_telefone, '')), ''),
       NULLIF(btrim(COALESCE(p_endereco, '')), ''),
       NULLIF(btrim(COALESCE(p_nota, '')), ''),
       v_default, COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lojas
       SET codigo      = v_codigo,
           nome        = v_nome,
           provincia_id = p_provincia_id,
           manager_id  = p_manager_id,
           telefone    = NULLIF(btrim(COALESCE(p_telefone, '')), ''),
           endereco    = NULLIF(btrim(COALESCE(p_endereco, '')), ''),
           nota        = NULLIF(btrim(COALESCE(p_nota, '')), ''),
           is_active   = COALESCE(p_is_active, true),
           updated_at  = now()
     WHERE id = v_id;
  END IF;

  -- O gerente fica ligado à loja e à província dela.
  IF p_manager_id IS NOT NULL THEN
    UPDATE public.profiles
       SET loja_id = v_id,
           provincia_id = CASE
                            WHEN is_national_admin THEN provincia_id
                            ELSE p_provincia_id
                          END,
           updated_at = now()
     WHERE id = p_manager_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'loja_criada' ELSE 'loja_editada' END,
          'lojas', v_id,
          jsonb_build_object('codigo', v_codigo, 'nome', v_nome,
                             'provincia_id', p_provincia_id,
                             'manager_id', p_manager_id));

  RETURN (
    SELECT jsonb_build_object(
             'id', l.id, 'codigo', l.codigo, 'nome', l.nome,
             'provincia_id', l.provincia_id,
             'provincia', pr.nome,
             'manager_id', l.manager_id,
             'manager', p.full_name,
             'is_default', l.is_default,
             'is_active', l.is_active
           )
    FROM public.lojas l
    LEFT JOIN public.provincias pr ON pr.id = l.provincia_id
    LEFT JOIN public.profiles  p  ON p.id = l.manager_id
    WHERE l.id = v_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. VALORES DA LOJA (caixa, saldo, investimento, a pagar)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lojas_indicadores (
  loja_id         uuid PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
  caixa           numeric(14,2) CHECK (caixa           IS NULL OR caixa           >= 0),
  saldo           numeric(14,2),
  investimento    numeric(14,2) CHECK (investimento    IS NULL OR investimento    >= 0),
  valores_a_pagar numeric(14,2) CHECK (valores_a_pagar IS NULL OR valores_a_pagar >= 0),
  nota            text,
  definido_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lojas_indicadores_nota CHECK (nota IS NULL OR btrim(nota) <> '')
);

CREATE TABLE IF NOT EXISTS public.lojas_indicadores_hist (
  id             bigserial PRIMARY KEY,
  loja_id        uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  campo          text NOT NULL,
  valor_anterior numeric(14,2),
  valor_novo     numeric(14,2),
  nota           text,
  alterado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lojas_hist
  ON public.lojas_indicadores_hist (loja_id, created_at DESC);

ALTER TABLE public.lojas_indicadores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lojas_indicadores_hist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lojas_indicadores_read ON public.lojas_indicadores;
CREATE POLICY lojas_indicadores_read ON public.lojas_indicadores
  FOR SELECT TO authenticated
  USING (public.can_manage_loja(lojas_indicadores.loja_id)
         OR public.pode_editar_loja(lojas_indicadores.loja_id));

DROP POLICY IF EXISTS lojas_hist_read ON public.lojas_indicadores_hist;
CREATE POLICY lojas_hist_read ON public.lojas_indicadores_hist
  FOR SELECT TO authenticated
  USING (public.can_manage_loja(lojas_indicadores_hist.loja_id)
         OR public.pode_editar_loja(lojas_indicadores_hist.loja_id));

-- Gravar os quatro valores da loja. Chave ausente = mantém; null = automático.
CREATE OR REPLACE FUNCTION public.guardar_indicadores_loja(
  p_loja_id uuid,
  p_valores jsonb,
  p_nota    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_nota   text := NULLIF(btrim(COALESCE(p_nota, '')), '');
  v_row    public.lojas_indicadores%ROWTYPE;
  v_caixa  numeric;
  v_saldo  numeric;
  v_inv    numeric;
  v_vp     numeric;
  v_campo  text;
  v_ant    numeric;
  v_nov    numeric;
  v_alt    jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.pode_editar_loja(p_loja_id) THEN
    RAISE EXCEPTION 'Só o gerente desta loja (ou a administração na sua zona) corrige estes valores'
      USING ERRCODE = '42501';
  END IF;

  IF p_valores IS NULL OR jsonb_typeof(p_valores) <> 'object' THEN
    RAISE EXCEPTION 'Indique os valores a guardar' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.lojas_indicadores WHERE loja_id = p_loja_id;

  v_caixa := CASE WHEN p_valores ? 'caixa'
                  THEN NULLIF(p_valores->>'caixa', '')::numeric ELSE v_row.caixa END;
  v_saldo := CASE WHEN p_valores ? 'saldo'
                  THEN NULLIF(p_valores->>'saldo', '')::numeric ELSE v_row.saldo END;
  v_inv   := CASE WHEN p_valores ? 'investimento'
                  THEN NULLIF(p_valores->>'investimento', '')::numeric ELSE v_row.investimento END;
  v_vp    := CASE WHEN p_valores ? 'valores_a_pagar'
                  THEN NULLIF(p_valores->>'valores_a_pagar', '')::numeric ELSE v_row.valores_a_pagar END;

  IF v_caixa IS NOT NULL AND v_caixa < 0 THEN
    RAISE EXCEPTION 'O caixa não pode ser negativo' USING ERRCODE = '22023';
  END IF;
  IF v_inv IS NOT NULL AND v_inv < 0 THEN
    RAISE EXCEPTION 'O investimento não pode ser negativo' USING ERRCODE = '22023';
  END IF;
  IF v_vp IS NOT NULL AND v_vp < 0 THEN
    RAISE EXCEPTION 'Os valores a pagar não podem ser negativos' USING ERRCODE = '22023';
  END IF;

  FOR v_campo, v_ant, v_nov IN
    SELECT * FROM (VALUES
      ('caixa',           v_row.caixa,           v_caixa),
      ('saldo',           v_row.saldo,           v_saldo),
      ('investimento',    v_row.investimento,    v_inv),
      ('valores_a_pagar', v_row.valores_a_pagar, v_vp)
    ) AS t(campo, anterior, novo)
    WHERE anterior IS DISTINCT FROM novo
  LOOP
    INSERT INTO public.lojas_indicadores_hist
      (loja_id, campo, valor_anterior, valor_novo, nota, alterado_por)
    VALUES (p_loja_id, v_campo, v_ant, v_nov, v_nota, v_uid);
    v_alt := v_alt || to_jsonb(v_campo);
  END LOOP;

  IF v_caixa IS NULL AND v_saldo IS NULL AND v_inv IS NULL AND v_vp IS NULL THEN
    DELETE FROM public.lojas_indicadores WHERE loja_id = p_loja_id;
  ELSIF v_row.loja_id IS NULL THEN
    INSERT INTO public.lojas_indicadores
      (loja_id, caixa, saldo, investimento, valores_a_pagar, nota, definido_por)
    VALUES (p_loja_id, v_caixa, v_saldo, v_inv, v_vp, v_nota, v_uid);
  ELSE
    UPDATE public.lojas_indicadores
       SET caixa = v_caixa, saldo = v_saldo, investimento = v_inv,
           valores_a_pagar = v_vp, nota = v_nota, definido_por = v_uid,
           updated_at = now()
     WHERE loja_id = p_loja_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, 'loja_indicadores_guardados', 'lojas_indicadores', p_loja_id,
          jsonb_build_object('alterados', v_alt, 'nota', v_nota));

  RETURN jsonb_build_object('loja_id', p_loja_id, 'alterados', v_alt);
END;
$$;

CREATE OR REPLACE FUNCTION public.limpar_indicadores_loja(p_loja_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n   int := 0;
BEGIN
  IF NOT public.pode_editar_loja(p_loja_id) THEN
    RAISE EXCEPTION 'Só o gerente desta loja corrige estes valores' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.lojas_indicadores WHERE loja_id = p_loja_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO public.lojas_indicadores_hist
      (loja_id, campo, nota, alterado_por)
    VALUES (p_loja_id, 'todos', 'Loja reposta no automático', v_uid);
  END IF;

  RETURN jsonb_build_object('removido', v_n > 0, 'loja_id', p_loja_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. VISÃO POR LOJA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lojas_overview(p_provincia_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov   uuid;
  v_lojas  jsonb;
  v_total  jsonb;
BEGIN
  IF NOT (public.is_manager() OR public.is_store_seller()) THEN
    RAISE EXCEPTION 'Apenas a loja e a gestão consultam as lojas' USING ERRCODE = '42501';
  END IF;

  IF public.is_national() THEN
    v_prov := p_provincia_id;
  ELSE
    v_prov := public.my_province();
  END IF;

  WITH stock AS (
    SELECT i.loja_id,
           COALESCE(SUM(i.quantity), 0)::int AS unidades,
           COALESCE(SUM(i.quantity * p.official_price), 0)::numeric AS valor
    FROM public.inventory i
    JOIN public.products p ON p.id = i.product_id
    WHERE p.is_active AND i.loja_id IS NOT NULL
    GROUP BY 1
  ),
  vendas AS (
    SELECT s.loja_id,
           COALESCE(SUM(s.total_amount), 0)::numeric AS valor,
           COUNT(*) AS qtd
    FROM public.sales s
    WHERE s.status <> 'cancelled' AND s.loja_id IS NOT NULL
    GROUP BY 1
  ),
  gastos AS (
    SELECT d.loja_id,
           COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'despesa'), 0)::numeric AS pagas,
           COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'investimento'), 0)::numeric AS investimento,
           COALESCE(SUM(GREATEST(d.valor - public.despesa_coberto(d.id), 0))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS por_pagar,
           COALESCE(SUM(LEAST(public.despesa_coberto(d.id), d.valor))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS ja_coberto,
           COUNT(*) FILTER (WHERE d.estado = 'pendente') AS pendentes
    FROM public.despesas d
    WHERE d.estado <> 'anulada' AND d.loja_id IS NOT NULL
    GROUP BY 1
  ),
  comissoes AS (
    SELECT s.loja_id,
           COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'pending'), 0)::numeric AS pendente
    FROM public.sale_commissions c
    JOIN public.sales s ON s.id = c.sale_id
    WHERE s.loja_id IS NOT NULL
    GROUP BY 1
  ),
  base AS (
    SELECT l.id,
           l.codigo,
           l.nome,
           l.provincia_id,
           pr.nome AS provincia,
           l.manager_id,
           p.full_name AS manager,
           l.is_default,
           l.is_active,
           COALESCE(st.unidades, 0)     AS stock_unidades,
           COALESCE(st.valor, 0)        AS stock_valor,
           COALESCE(v.valor, 0)         AS vendas,
           COALESCE(v.qtd, 0)           AS vendas_count,
           COALESCE(g.pagas, 0)         AS despesas_pagas,
           COALESCE(g.investimento, 0)  AS investimento_pago,
           COALESCE(g.por_pagar, 0)     AS por_pagar,
           COALESCE(g.ja_coberto, 0)    AS ja_coberto,
           COALESCE(g.pendentes, 0)     AS pendentes_count,
           COALESCE(cm.pendente, 0)     AS comissoes_pendentes,
           li.caixa                     AS m_caixa,
           li.saldo                     AS m_saldo,
           li.investimento              AS m_inv,
           li.valores_a_pagar           AS m_vp,
           li.nota,
           li.updated_at,
           public.pode_editar_loja(l.id) AS pode_editar
    FROM public.lojas l
    JOIN public.provincias pr ON pr.id = l.provincia_id
    LEFT JOIN public.profiles p ON p.id = l.manager_id
    LEFT JOIN stock st      ON st.loja_id = l.id
    LEFT JOIN vendas v      ON v.loja_id = l.id
    LEFT JOIN gastos g      ON g.loja_id = l.id
    LEFT JOIN comissoes cm  ON cm.loja_id = l.id
    LEFT JOIN public.lojas_indicadores li ON li.loja_id = l.id
    WHERE (v_prov IS NULL OR l.provincia_id = v_prov)
      AND (
        public.is_national()
        OR public.can_manage_province(l.provincia_id)
        OR l.id = public.minha_loja()
      )
  ),
  ef AS (
    SELECT *,
           COALESCE(m_caixa, vendas - despesas_pagas - investimento_pago) AS caixa,
           COALESCE(m_saldo, vendas - (despesas_pagas + investimento_pago
                                       + ja_coberto + por_pagar)) AS saldo,
           COALESCE(m_inv, investimento_pago) AS investimento,
           COALESCE(m_vp, por_pagar + comissoes_pendentes) AS valores_a_pagar
    FROM base
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id', id, 'codigo', codigo, 'nome', nome,
               'provincia_id', provincia_id, 'provincia', provincia,
               'manager_id', manager_id, 'manager', manager,
               'is_default', is_default, 'is_active', is_active,
               'stock_unidades', stock_unidades, 'stock_valor', stock_valor,
               'vendas', vendas, 'vendas_count', vendas_count,
               'despesas_pagas', despesas_pagas,
               'investimento_pago', investimento_pago,
               'por_pagar', por_pagar, 'ja_coberto', ja_coberto,
               'pendentes_count', pendentes_count,
               'comissoes_pendentes', comissoes_pendentes,
               'caixa', jsonb_build_object(
                 'automatico', vendas - despesas_pagas - investimento_pago,
                 'manual', m_caixa, 'valor', caixa,
                 'origem', CASE WHEN m_caixa IS NULL THEN 'automatico' ELSE 'gestor' END),
               'saldo', jsonb_build_object(
                 'automatico', vendas - (despesas_pagas + investimento_pago
                                         + ja_coberto + por_pagar),
                 'manual', m_saldo, 'valor', saldo,
                 'origem', CASE WHEN m_saldo IS NULL THEN 'automatico' ELSE 'gestor' END),
               'investimento', jsonb_build_object(
                 'automatico', investimento_pago,
                 'manual', m_inv, 'valor', investimento,
                 'origem', CASE WHEN m_inv IS NULL THEN 'automatico' ELSE 'gestor' END),
               'valores_a_pagar', jsonb_build_object(
                 'automatico', por_pagar + comissoes_pendentes,
                 'manual', m_vp, 'valor', valores_a_pagar,
                 'origem', CASE WHEN m_vp IS NULL THEN 'automatico' ELSE 'gestor' END),
               'pode_editar', pode_editar,
               'nota', nota, 'updated_at', updated_at
             )
             ORDER BY is_default DESC, nome
           ),
           '[]'::jsonb
         )
  INTO v_lojas
  FROM ef;

  SELECT jsonb_build_object(
           'lojas',          COUNT(*),
           'stock_unidades', COALESCE(SUM((l->>'stock_unidades')::int), 0),
           'stock_valor',    COALESCE(SUM((l->>'stock_valor')::numeric), 0),
           'vendas',         COALESCE(SUM((l->>'vendas')::numeric), 0),
           'despesas_pagas', COALESCE(SUM((l->>'despesas_pagas')::numeric), 0),
           'investimento_pago', COALESCE(SUM((l->>'investimento_pago')::numeric), 0),
           'por_pagar',      COALESCE(SUM((l->>'por_pagar')::numeric), 0),
           'caixa',          COALESCE(SUM((l->'caixa'->>'valor')::numeric), 0),
           'saldo',          COALESCE(SUM((l->'saldo'->>'valor')::numeric), 0)
         )
  INTO v_total
  FROM jsonb_array_elements(v_lojas) l;

  RETURN jsonb_build_object(
    'scope',        CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'provincia_id', v_prov,
    'provincia',    (SELECT pr.nome FROM public.provincias pr WHERE pr.id = v_prov),
    'lojas',        v_lojas,
    'total',        v_total
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. STOCK PASSA A SER POR LOJA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id   uuid,
  p_quantity     int,
  p_reason       text DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid := COALESCE(p_provincia_id, public.my_province());
  v_loja uuid;
  v_prev int := 0;
  v_nome text;
BEGIN
  IF NOT public.can_manage_stock() THEN
    RAISE EXCEPTION 'Apenas a loja e a gerência podem alterar stock'
      USING ERRCODE = '42501';
  END IF;

  IF public.is_manager() THEN
    IF NOT public.can_manage_province(v_prov) THEN
      RAISE EXCEPTION 'Só pode alterar stock da sua província' USING ERRCODE = '42501';
    END IF;
  ELSIF v_prov IS DISTINCT FROM public.my_province() THEN
    RAISE EXCEPTION 'Só pode alterar stock da sua província' USING ERRCODE = '42501';
  END IF;

  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade não pode ser negativa';
  END IF;

  SELECT name INTO v_nome FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;

  -- A loja de quem está a mexer, se for da mesma província; senão a principal.
  SELECT l.id INTO v_loja
  FROM public.lojas l
  WHERE l.id = public.minha_loja()
    AND l.provincia_id IS NOT DISTINCT FROM v_prov;

  v_loja := COALESCE(v_loja, public.loja_da_provincia(v_prov));

  SELECT COALESCE(i.quantity, 0) INTO v_prev
  FROM public.inventory i
  WHERE i.product_id = p_product_id
    AND i.loja_id = v_loja;

  v_prev := COALESCE(v_prev, 0);

  INSERT INTO public.inventory (product_id, provincia_id, loja_id, quantity)
  VALUES (p_product_id, v_prov, v_loja, p_quantity)
  ON CONFLICT (product_id, loja_id) WHERE loja_id IS NOT NULL
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, loja_id, type, quantity, previous_quantity,
    new_quantity, notes, created_by
  )
  VALUES (
    p_product_id, v_prov, v_loja, 'adjustment', p_quantity - v_prev, v_prev,
    p_quantity, COALESCE(NULLIF(btrim(p_reason), ''), 'Ajuste manual de stock'),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'product_name', v_nome,
    'provincia_id', v_prov,
    'loja_id', v_loja,
    'quantity', p_quantity
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10.1 TRANSFERÊNCIAS DE STOCK ENTRE PROVÍNCIAS
-- -----------------------------------------------------------------------------
-- A versão antiga escrevia no stock «da província» com
-- `ON CONFLICT (product_id, provincia_id)`. Esse índice deixou de existir
-- (agora o stock é único por loja), por isso a função é rescrita: a
-- transferência entra e sai pela loja principal de cada província.
CREATE OR REPLACE FUNCTION public.decide_stock_transfer(
  p_transfer_id uuid,
  p_approve     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tr       public.stock_transfers;
  v_origem   int;
  v_loja_ori uuid;
  v_loja_dst uuid;
BEGIN
  -- A aprovação é sempre nacional: é o controlo central das quantidades.
  IF NOT public.is_national() THEN
    RAISE EXCEPTION 'Apenas a administração nacional aprova transferências'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tr FROM public.stock_transfers t
  WHERE t.id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferência inexistente';
  END IF;

  IF v_tr.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta transferência já foi decidida (estado: %)', v_tr.status;
  END IF;

  IF NOT p_approve THEN
    UPDATE public.stock_transfers t
    SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE t.id = v_tr.id;

    RETURN jsonb_build_object('transfer_id', v_tr.id, 'status', 'rejected');
  END IF;

  -- As lojas principais das duas províncias (a da sede quando a província é nula).
  v_loja_ori := public.loja_da_provincia(v_tr.from_provincia_id);
  v_loja_dst := public.loja_da_provincia(v_tr.to_provincia_id);

  IF v_loja_ori IS NULL OR v_loja_dst IS NULL THEN
    RAISE EXCEPTION 'Não há loja registada numa das províncias desta transferência';
  END IF;

  SELECT i.quantity INTO v_origem
  FROM public.inventory i
  WHERE i.product_id = v_tr.product_id
    AND i.loja_id = v_loja_ori
  FOR UPDATE;

  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'A loja de origem não tem stock deste produto';
  END IF;

  IF v_origem < v_tr.quantity THEN
    RAISE EXCEPTION 'Stock insuficiente na origem (disponível: %)', v_origem;
  END IF;

  UPDATE public.inventory i
  SET quantity = i.quantity - v_tr.quantity, updated_at = now()
  WHERE i.product_id = v_tr.product_id
    AND i.loja_id = v_loja_ori;

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, loja_id, type, quantity, previous_quantity,
    new_quantity, reference, notes, created_by
  )
  VALUES (
    v_tr.product_id, v_tr.from_provincia_id, v_loja_ori, 'out', v_tr.quantity,
    v_origem, v_origem - v_tr.quantity, v_tr.reference,
    'Transferência enviada', auth.uid()
  );

  -- Destino: pode ainda não ter linha de stock
  INSERT INTO public.inventory (product_id, provincia_id, loja_id, quantity)
  VALUES (v_tr.product_id, v_tr.to_provincia_id, v_loja_dst, v_tr.quantity)
  ON CONFLICT (product_id, loja_id) WHERE loja_id IS NOT NULL
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, loja_id, type, quantity, previous_quantity,
    new_quantity, reference, notes, created_by
  )
  SELECT
    v_tr.product_id, v_tr.to_provincia_id, v_loja_dst, 'in', v_tr.quantity,
    i.quantity - v_tr.quantity, i.quantity, v_tr.reference,
    'Transferência recebida', auth.uid()
  FROM public.inventory i
  WHERE i.product_id = v_tr.product_id
    AND i.loja_id = v_loja_dst;

  UPDATE public.stock_transfers t
  SET status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE t.id = v_tr.id;

  RETURN jsonb_build_object('transfer_id', v_tr.id, 'status', 'approved');
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. A ADMINISTRAÇÃO NACIONAL SÓ CORRIGE A SUA ZONA
-- -----------------------------------------------------------------------------
-- O painel financeiro da província continua a existir, mas o gestor nacional
-- não pode escrever valores fora de Luanda: o resto do país é automático.
-- A linha da empresa (provincia_id nulo) continua a ser dele — é o painel
-- global, não a correcção de outra província.
CREATE OR REPLACE FUNCTION public.protege_indicadores_nacional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF public.is_national()
     AND NEW.provincia_id IS NOT NULL
     AND NEW.provincia_id IS DISTINCT FROM public.default_province() THEN
    RAISE EXCEPTION 'A administração nacional só corrige a sua zona (Luanda). As outras províncias calculam automaticamente.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protege_indicadores_nacional ON public.indicadores_financeiros;
CREATE TRIGGER trg_protege_indicadores_nacional
  BEFORE INSERT OR UPDATE ON public.indicadores_financeiros
  FOR EACH ROW EXECUTE FUNCTION public.protege_indicadores_nacional();

-- -----------------------------------------------------------------------------
-- 12. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.guardar_loja(text, text, uuid, uuid, text, text, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_indicadores_loja(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_indicadores_loja(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.lojas_overview(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid, int, text, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_stock_transfer(uuid, boolean)        TO authenticated;
