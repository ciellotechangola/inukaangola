-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 5/5 : GESTÃO MULTIPROVINCIAL
-- =============================================================================
-- O que esta migração acrescenta:
--   1. Tabela `provincias` (18 províncias de Angola) que funciona também como
--      registo de delegações.
--   2. `provincia_id` em perfis, produtos, stock, movimentos, encomendas,
--      reservas, vendas e distribuidores.
--   3. Funções de identidade provincial: my_province(), is_national(),
--      can_see_province(), can_manage_province().
--   4. RLS reescrita: cada utilizador provincial só vê a sua província;
--      a administração nacional vê tudo.
--   5. Stock por província (uma linha de inventário por produto e província)
--      e transferências entre províncias com aprovação nacional.
--   6. Código de referência único por pessoa (`profiles.referencia`).
--
-- PRINCÍPIO: nada é apagado. Os registos existentes são preservados e ficam
-- atribuídos de forma DETERMINÍSTICA (nunca aleatória) à província-sede.
--
-- É idempotente: pode ser executada mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PROVÍNCIAS / DELEGAÇÕES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provincias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL UNIQUE,
  codigo             text NOT NULL UNIQUE,
  slug               text NOT NULL UNIQUE,
  capital            text,
  -- Dados da delegação. Uma província activa com delegação é, na prática,
  -- uma delegação da INUKA.
  delegacao_nome     text,
  delegacao_endereco text,
  delegacao_telefone text,
  is_default         boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provincias_codigo_format CHECK (codigo ~ '^[A-Z]{3}$'),
  CONSTRAINT provincias_slug_format   CHECK (slug ~ '^[a-z0-9-]+$')
);

-- Só pode existir uma província-sede (destino dos registos antigos).
CREATE UNIQUE INDEX IF NOT EXISTS provincias_uma_sede
  ON public.provincias (is_default) WHERE is_default;

INSERT INTO public.provincias (nome, codigo, slug, capital, delegacao_nome, is_default)
VALUES
  ('Bengo',          'BGO', 'bengo',          'Caxito',       'Delegação do Bengo',          false),
  ('Benguela',       'BGL', 'benguela',       'Benguela',     'Delegação de Benguela',       false),
  ('Bié',            'BIE', 'bie',            'Kuito',        'Delegação do Bié',            false),
  ('Cabinda',        'CAB', 'cabinda',        'Cabinda',      'Delegação de Cabinda',        false),
  ('Cuando Cubango', 'CCU', 'cuando-cubango', 'Menongue',     'Delegação do Cuando Cubango', false),
  ('Cuanza Norte',   'CNO', 'cuanza-norte',   'N''dalatando', 'Delegação do Cuanza Norte',   false),
  ('Cuanza Sul',     'CSU', 'cuanza-sul',     'Sumbe',        'Delegação do Cuanza Sul',     false),
  ('Cunene',         'CNN', 'cunene',         'Ondjiva',      'Delegação do Cunene',         false),
  ('Huambo',         'HUA', 'huambo',         'Huambo',       'Delegação do Huambo',         false),
  ('Huíla',          'HLA', 'huila',          'Lubango',      'Delegação da Huíla',          false),
  ('Luanda',         'LDA', 'luanda',         'Luanda',       'Delegação de Luanda',         true),
  ('Lunda Norte',    'LNO', 'lunda-norte',    'Dundo',        'Delegação da Lunda Norte',    false),
  ('Lunda Sul',      'LSU', 'lunda-sul',      'Saurimo',      'Delegação da Lunda Sul',      false),
  ('Malanje',        'MAL', 'malanje',        'Malanje',      'Delegação de Malanje',        false),
  ('Moxico',         'MOX', 'moxico',         'Luena',        'Delegação do Moxico',         false),
  ('Namibe',         'NAM', 'namibe',         'Moçâmedes',    'Delegação do Namibe',         false),
  ('Uíge',           'UIG', 'uige',           'Uíge',         'Delegação do Uíge',           false),
  ('Zaire',          'ZAI', 'zaire',          'Mbanza Kongo', 'Delegação do Zaire',          false)
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. COLUNAS DE PROVÍNCIA
-- -----------------------------------------------------------------------------
-- Perfis: `NULL` = ainda não atribuído (vê tudo, como hoje). A administração
-- nacional marca-se com `is_national_admin`.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS provincia_id      uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_national_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referencia        text;

-- Produtos: `NULL` = produto nacional, visível em todas as províncias.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

-- Stock: uma linha por (produto, província). `NULL` = armazém-sede (legado).
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

-- O stock deixou de ser único por produto: passa a ser único por
-- (produto, província). A linha da sede (provincia_id NULL) mantém-se única.
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_product_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_produto_provincia
  ON public.inventory (product_id, provincia_id) WHERE provincia_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_produto_sede
  ON public.inventory (product_id) WHERE provincia_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_provincia   ON public.profiles (provincia_id);
CREATE INDEX IF NOT EXISTS idx_products_provincia   ON public.products (provincia_id);
CREATE INDEX IF NOT EXISTS idx_inventory_provincia  ON public.inventory (provincia_id);
CREATE INDEX IF NOT EXISTS idx_movements_provincia  ON public.inventory_movements (provincia_id);
CREATE INDEX IF NOT EXISTS idx_orders_provincia     ON public.orders (provincia_id);
CREATE INDEX IF NOT EXISTS idx_sales_provincia      ON public.sales (provincia_id);
CREATE INDEX IF NOT EXISTS idx_reservas_provincia   ON public.reservations (provincia_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referencia
  ON public.profiles (referencia) WHERE referencia IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. CÓDIGO DE REFERÊNCIA
-- -----------------------------------------------------------------------------
-- Cada pessoa (colaborador ou cliente) recebe uma referência legível e única,
-- com o código da província. Ex.: INK-UIG-00042.
CREATE SEQUENCE IF NOT EXISTS public.referencia_seq START 1;

CREATE OR REPLACE FUNCTION public.gerar_referencia(p_provincia_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
BEGIN
  SELECT pr.codigo INTO v_codigo
  FROM public.provincias pr WHERE pr.id = p_provincia_id;

  RETURN 'INK-' || COALESCE(v_codigo, 'NAC') || '-'
      || lpad(nextval('public.referencia_seq')::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.fill_referencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
BEGIN
  SELECT pr.codigo INTO v_codigo
  FROM public.provincias pr WHERE pr.id = NEW.provincia_id;

  IF NEW.referencia IS NULL OR btrim(NEW.referencia) = '' THEN
    NEW.referencia := public.gerar_referencia(NEW.provincia_id);
    RETURN NEW;
  END IF;

  -- Mudou de província: o prefixo acompanha, o número NÃO.
  -- `INK-NAC-00003` → `INK-UIG-00003`. O número é a identidade da pessoa e
  -- pode já estar impresso num cartão; o prefixo é que diz a que delegação
  -- pertence. Sem isto, quem foi atribuído depois da migração ficava com o
  -- prefixo `NAC` para sempre.
  IF TG_OP = 'UPDATE' AND NEW.provincia_id IS DISTINCT FROM OLD.provincia_id THEN
    NEW.referencia := regexp_replace(
      NEW.referencia,
      '^INK-[A-Z]{3}-',
      'INK-' || COALESCE(v_codigo, 'NAC') || '-'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_referencia ON public.profiles;
CREATE TRIGGER trg_fill_referencia
BEFORE INSERT OR UPDATE OF provincia_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fill_referencia();

-- O registo pode indicar a província nos metadados (slug, código ou nome).
-- Se não indicar, fica sem província e o gestor atribui depois.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_chave text := NULLIF(btrim(COALESCE(
    NEW.raw_user_meta_data->>'provincia_slug',
    NEW.raw_user_meta_data->>'provincia',
    NEW.raw_user_meta_data->>'province'
  )), '');
  v_prov uuid;
BEGIN
  IF v_chave IS NOT NULL THEN
    SELECT pr.id INTO v_prov
    FROM public.provincias pr
    WHERE pr.slug = lower(v_chave)
       OR pr.codigo = upper(v_chave)
       OR pr.nome ILIKE v_chave
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, role, full_name, phone, email, neighborhood, provincia_id)
  VALUES (
    NEW.id,
    'customer'::public.user_role,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(COALESCE(NEW.email, 'Utilizador'), '@', 1)),
    public.normalize_phone(COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone)),
    NEW.email,
    NULLIF(btrim(NEW.raw_user_meta_data->>'neighborhood'), ''),
    v_prov
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. IDENTIDADE PROVINCIAL (funções de apoio ao RLS)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_province()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT p.provincia_id FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- Administração nacional: marcada explicitamente OU sem província atribuída.
-- O segundo caso protege as contas que já existiam antes desta migração —
-- nenhuma delas fica sem acesso por não ter província.
CREATE OR REPLACE FUNCTION public.is_national()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.is_national_admin OR p.provincia_id IS NULL
     FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

-- Posso VER um registo desta província?
--   - administração nacional / sem província: vê tudo
--   - registo nacional (provincia_id NULL): visível a todos
--   - caso contrário: só a minha província
CREATE OR REPLACE FUNCTION public.can_see_province(p_provincia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_national()
      OR p_provincia_id IS NULL
      OR p_provincia_id = public.my_province();
$$;

-- Posso GERIR um registo desta província?
-- (gerir é mais restrito do que ver: um registo nacional só é gerível pela
-- administração nacional)
CREATE OR REPLACE FUNCTION public.can_manage_province(p_provincia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_national()
      OR (p_provincia_id IS NOT NULL AND p_provincia_id = public.my_province());
$$;

CREATE OR REPLACE FUNCTION public.default_province()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pr.id FROM public.provincias pr WHERE pr.is_default LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 5. PROTEÇÃO: ninguém muda a própria província
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_province_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- SQL Editor / service_role / migrações não transportam JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_national() THEN
    IF NEW.provincia_id IS DISTINCT FROM OLD.provincia_id THEN
      RAISE EXCEPTION 'A província só pode ser alterada pela administração nacional'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.is_national_admin IS DISTINCT FROM OLD.is_national_admin THEN
      RAISE EXCEPTION 'Apenas a administração nacional pode alterar este campo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_province_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_province_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_province_escalation();

-- -----------------------------------------------------------------------------
-- 6. PREENCHIMENTO AUTOMÁTICO DA PROVÍNCIA
-- O cliente nunca escolhe a província: ela vem do perfil de quem escreve.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_province()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me uuid := public.my_province();
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'INSERT' AND NEW.provincia_id IS NULL
       AND v_me IS NOT NULL AND NOT public.is_national() THEN
      NEW.provincia_id := v_me;
    ELSIF TG_OP = 'UPDATE' AND NEW.provincia_id IS DISTINCT FROM OLD.provincia_id
       AND NOT public.can_manage_province(NEW.provincia_id) THEN
      RAISE EXCEPTION 'Não pode mover produtos entre províncias' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory' THEN
    IF TG_OP = 'INSERT' AND NEW.provincia_id IS NULL
       AND v_me IS NOT NULL AND NOT public.is_national() THEN
      NEW.provincia_id := v_me;
    END IF;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'INSERT' THEN
      -- Numa inserção feita por um utilizador com sessão, a província é
      -- SEMPRE derivada do perfil — o valor enviado pelo cliente é ignorado.
      -- Sem sessão (service_role, SQL Editor) respeita-se o valor indicado.
      IF auth.uid() IS NOT NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      ELSIF NEW.provincia_id IS NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'sales' THEN
    IF TG_OP = 'INSERT' THEN
      IF auth.uid() IS NOT NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      ELSIF NEW.provincia_id IS NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'reservations' THEN
    IF TG_OP = 'INSERT' THEN
      IF auth.uid() IS NOT NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          public.default_province()
        );
      ELSIF NEW.provincia_id IS NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          public.default_province()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_province_products ON public.products;
CREATE TRIGGER trg_fill_province_products
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_inventory ON public.inventory;
CREATE TRIGGER trg_fill_province_inventory
BEFORE INSERT ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_orders ON public.orders;
CREATE TRIGGER trg_fill_province_orders
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_sales ON public.sales;
CREATE TRIGGER trg_fill_province_sales
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_reservations ON public.reservations;
CREATE TRIGGER trg_fill_province_reservations
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

-- Manter o distribuidor alinhado com o perfil
CREATE OR REPLACE FUNCTION public.sync_seller_province()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.provincia_id IS DISTINCT FROM OLD.provincia_id THEN
    UPDATE public.seller_profiles sp
    SET provincia_id = NEW.provincia_id, updated_at = now()
    WHERE sp.id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_seller_province ON public.profiles;
CREATE TRIGGER trg_sync_seller_province
AFTER UPDATE OF provincia_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_seller_province();

-- -----------------------------------------------------------------------------
-- 7. PRESERVAR OS DADOS EXISTENTES (atribuição determinística)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_sede uuid := public.default_province();
BEGIN
  IF v_sede IS NULL THEN
    RAISE EXCEPTION 'Não existe província-sede (is_default). Migração abortada.';
  END IF;

  -- Gestores que já existiam passam a ser administração nacional.
  UPDATE public.profiles p
  SET is_national_admin = true
  WHERE p.role = 'manager' AND p.is_national_admin = false;

  -- Referências em falta
  UPDATE public.profiles p
  SET referencia = public.gerar_referencia(p.provincia_id)
  WHERE p.referencia IS NULL;

  -- Referências com o prefixo de outra província. Acontece a quem é atribuído
  -- depois da migração (a referência nasceu quando ninguém tinha província e
  -- ficou `INK-NAC-...`). O número fica, o prefixo corrige-se.
  UPDATE public.profiles p
  SET referencia = regexp_replace(
        p.referencia,
        '^INK-[A-Z]{3}-',
        'INK-' || COALESCE(
          (SELECT pr.codigo FROM public.provincias pr WHERE pr.id = p.provincia_id),
          'NAC'
        ) || '-'
      )
  WHERE p.referencia ~ '^INK-[A-Z]{3}-'
    AND p.referencia NOT LIKE 'INK-' || COALESCE(
          (SELECT pr.codigo FROM public.provincias pr WHERE pr.id = p.provincia_id),
          'NAC'
        ) || '-%';

  -- Stock existente: passa a ser o stock da sede.
  UPDATE public.inventory i
  SET provincia_id = v_sede
  WHERE i.provincia_id IS NULL;

  -- Movimentos: herdam a província da linha de stock.
  UPDATE public.inventory_movements m
  SET provincia_id = i.provincia_id
  FROM public.inventory i
  WHERE i.product_id = m.product_id AND m.provincia_id IS NULL;

  UPDATE public.inventory_movements m
  SET provincia_id = v_sede
  WHERE m.provincia_id IS NULL;

  -- Encomendas: província do colaborador que acompanha, senão do cliente.
  UPDATE public.orders o
  SET provincia_id = COALESCE(
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = o.seller_id),
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = o.customer_id),
    v_sede
  )
  WHERE o.provincia_id IS NULL;

  UPDATE public.reservations r
  SET provincia_id = COALESCE(
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = r.customer_id),
    v_sede
  )
  WHERE r.provincia_id IS NULL;

  UPDATE public.sales s
  SET provincia_id = COALESCE(
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = s.seller_id),
    v_sede
  )
  WHERE s.provincia_id IS NULL;

  UPDATE public.seller_profiles sp
  SET provincia_id = (SELECT p.provincia_id FROM public.profiles p WHERE p.id = sp.id)
  WHERE sp.provincia_id IS NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 8. TRANSFERÊNCIAS DE STOCK ENTRE PROVÍNCIAS
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.transferencia_seq START 1;

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL UNIQUE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  to_provincia_id   uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_provincias_distintas
    CHECK (from_provincia_id IS DISTINCT FROM to_provincia_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_status ON public.stock_transfers (status, created_at DESC);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 9. RPC: ATRIBUIR PROVÍNCIA A UM UTILIZADOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_province(
  p_user_id      uuid,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode atribuir províncias' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_province(p_provincia_id) THEN
    RAISE EXCEPTION 'Só pode atribuir a sua própria província' USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilizador inexistente';
  END IF;

  UPDATE public.profiles p
  SET provincia_id = p_provincia_id, updated_at = now()
  WHERE p.id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'provincia_id', p_provincia_id,
    'role', v_role
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. RPC: INDICADORES POR PROVÍNCIA (administração nacional)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.province_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_national() THEN
    RAISE EXCEPTION 'Apenas a administração nacional pode comparar províncias'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY t.nome)
    FROM (
      SELECT
        pr.id,
        pr.nome,
        pr.codigo,
        pr.slug,
        pr.delegacao_nome,
        pr.is_active,
        (SELECT COUNT(*) FROM public.profiles p
          WHERE p.provincia_id = pr.id AND p.role = 'seller' AND p.is_active)::int AS colaboradores,
        (SELECT COUNT(*) FROM public.profiles p
          WHERE p.provincia_id = pr.id AND p.role = 'customer')::int AS clientes,
        (SELECT COUNT(*) FROM public.products pd
          WHERE pd.provincia_id = pr.id AND pd.is_active)::int AS produtos,
        (SELECT COALESCE(SUM(i.quantity), 0) FROM public.inventory i
          WHERE i.provincia_id = pr.id)::int AS stock_total,
        (SELECT COUNT(*) FROM public.inventory i
          WHERE i.provincia_id = pr.id AND i.quantity <= i.low_stock_threshold)::int AS stock_baixo,
        (SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
          WHERE s.provincia_id = pr.id) AS vendas_valor,
        (SELECT COUNT(*) FROM public.sales s WHERE s.provincia_id = pr.id)::int AS vendas_count,
        (SELECT COUNT(*) FROM public.orders o WHERE o.provincia_id = pr.id)::int AS encomendas_count
      FROM public.provincias pr
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPC: TRANSFERÊNCIAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_stock_transfer(
  p_product_id uuid,
  p_from       uuid,
  p_to         uuid,
  p_quantity   int,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ref text;
  v_id  uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pedir transferências' USING ERRCODE = '42501';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  IF p_from IS NOT DISTINCT FROM p_to THEN
    RAISE EXCEPTION 'A origem e o destino têm de ser províncias diferentes';
  END IF;

  IF p_to IS NULL THEN
    RAISE EXCEPTION 'Indique a província de destino';
  END IF;

  IF NOT public.is_national() AND p_from IS DISTINCT FROM public.my_province() THEN
    RAISE EXCEPTION 'Só pode transferir a partir da sua província' USING ERRCODE = '42501';
  END IF;

  v_ref := 'TRF-' || lpad(nextval('public.transferencia_seq')::text, 5, '0');

  INSERT INTO public.stock_transfers (
    reference, product_id, from_provincia_id, to_provincia_id,
    quantity, status, requested_by, notes
  )
  VALUES (
    v_ref, p_product_id, p_from, p_to, p_quantity, 'pending', auth.uid(),
    NULLIF(btrim(p_notes), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('transfer_id', v_id, 'reference', v_ref, 'status', 'pending');
END;
$$;

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
  v_tr     public.stock_transfers;
  v_origem int;
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

  SELECT i.quantity INTO v_origem
  FROM public.inventory i
  WHERE i.product_id = v_tr.product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_tr.from_provincia_id
  FOR UPDATE;

  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'A província de origem não tem stock deste produto';
  END IF;

  IF v_origem < v_tr.quantity THEN
    RAISE EXCEPTION 'Stock insuficiente na origem (disponível: %)', v_origem;
  END IF;

  UPDATE public.inventory i
  SET quantity = i.quantity - v_tr.quantity, updated_at = now()
  WHERE i.product_id = v_tr.product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_tr.from_provincia_id;

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
  )
  VALUES (
    v_tr.product_id, v_tr.from_provincia_id, 'out', v_tr.quantity,
    v_origem, v_origem - v_tr.quantity, v_tr.reference,
    'Transferência enviada', auth.uid()
  );

  -- Destino: pode ainda não ter linha de stock
  INSERT INTO public.inventory (product_id, provincia_id, quantity)
  VALUES (v_tr.product_id, v_tr.to_provincia_id, v_tr.quantity)
  ON CONFLICT (product_id, provincia_id) WHERE provincia_id IS NOT NULL
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
  )
  SELECT
    v_tr.product_id, v_tr.to_provincia_id, 'in', v_tr.quantity,
    i.quantity - v_tr.quantity, i.quantity, v_tr.reference,
    'Transferência recebida', auth.uid()
  FROM public.inventory i
  WHERE i.product_id = v_tr.product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_tr.to_provincia_id;

  UPDATE public.stock_transfers t
  SET status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE t.id = v_tr.id;

  RETURN jsonb_build_object('transfer_id', v_tr.id, 'status', 'approved');
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. STOCK POR PROVÍNCIA
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_product_stock(uuid, int, text);

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
  v_prev int := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode alterar stock' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode alterar stock da sua província' USING ERRCODE = '42501';
  END IF;

  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade não pode ser negativa';
  END IF;

  SELECT COALESCE(i.quantity, 0) INTO v_prev
  FROM public.inventory i
  WHERE i.product_id = p_product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_prov;

  v_prev := COALESCE(v_prev, 0);

  IF v_prov IS NULL THEN
    INSERT INTO public.inventory (product_id, provincia_id, quantity)
    VALUES (p_product_id, NULL, p_quantity)
    ON CONFLICT (product_id) WHERE provincia_id IS NULL
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  ELSE
    INSERT INTO public.inventory (product_id, provincia_id, quantity)
    VALUES (p_product_id, v_prov, p_quantity)
    ON CONFLICT (product_id, provincia_id) WHERE provincia_id IS NOT NULL
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, notes, created_by
  )
  VALUES (
    p_product_id, v_prov, 'adjustment', p_quantity - v_prev, v_prev, p_quantity,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Ajuste manual de stock'), auth.uid()
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'provincia_id', v_prov,
    'quantity', p_quantity
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. ENCOMENDAS COM STOCK PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_items            jsonb,
  p_delivery_method  text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_contact_phone    text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_client_ref       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_existing public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem criar encomendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio';
  END IF;

  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Modalidade de entrega inválida';
  END IF;

  IF p_delivery_method = 'delivery' AND COALESCE(btrim(p_delivery_address), '') = '' THEN
    RAISE EXCEPTION 'Indique o endereço de entrega';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.orders o
    WHERE o.customer_id = v_uid AND o.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_order_reference();
  -- A província da encomenda vem do perfil do cliente (nunca do cliente HTTP).
  v_prov := public.my_province();

  INSERT INTO public.orders (
    reference, client_ref, customer_id, status, delivery_method,
    delivery_address, contact_phone, notes, payment_status, provincia_id
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 'pending', p_delivery_method,
    NULLIF(btrim(p_delivery_address), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_notes), ''), 'pending', v_prov
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível: %', v_prod.name;
    END IF;

    -- Produto provincial só se vende na sua província
    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    -- Linha de stock: a da província do cliente; se não existir, a da sede.
    SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    -- Última tentativa: o armazém-sede. A sede é a província marcada
    -- `is_default` (Luanda). Sem este passo, um cliente sem província — conta
    -- antiga ou criada pela gestão sem província — comprava **sem reservar
    -- stock nenhum**: a linha `provincia_id IS NULL` deixou de existir quando
    -- o inventário legado passou a pertencer à sede como província real.
    IF v_inv.id IS NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      JOIN public.provincias pr ON pr.id = i.provincia_id
      WHERE i.product_id = v_prod.id AND pr.is_default
      ORDER BY i.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
    VALUES (v_order_id, v_prod.id, v_qty, v_price, v_price * v_qty);
  END LOOP;

  SELECT COALESCE(SUM(oi.total_price), 0) INTO v_total
  FROM public.order_items oi WHERE oi.order_id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
  VALUES (v_order_id, 'pending', NULL, v_uid, 'Encomenda criada');

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ref,
    'total', v_total,
    'duplicated', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_item  record;
  v_inv   record;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda inexistente';
  END IF;

  IF NOT (
    public.is_manager()
    OR v_order.customer_id = auth.uid()
    OR COALESCE(v_order.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta encomenda' USING ERRCODE = '42501';
  END IF;

  IF public.is_manager()
     AND NOT public.can_manage_province(v_order.provincia_id) THEN
    RAISE EXCEPTION 'Encomenda de outra província' USING ERRCODE = '42501';
  END IF;

  IF v_order.customer_id = auth.uid()
     AND NOT public.is_manager()
     AND p_status <> 'cancelled' THEN
    RAISE EXCEPTION 'O cliente apenas pode cancelar a encomenda' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Encomenda já concluída não pode ser alterada';
  END IF;

  IF p_status = v_order.status THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'changed', false);
  END IF;

  IF p_status = 'completed' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      SELECT i.id, i.quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_item.product_id
        AND i.provincia_id IS NOT DISTINCT FROM v_order.provincia_id
      LIMIT 1;

      IF NOT FOUND AND v_order.provincia_id IS NOT NULL THEN
        SELECT i.id, i.quantity INTO v_inv
        FROM public.inventory i
        WHERE i.product_id = v_item.product_id AND i.provincia_id IS NULL
        LIMIT 1;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.inventory i
        SET quantity = i.quantity - v_item.quantity,
            reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
            updated_at = now()
        WHERE i.id = v_inv.id;

        INSERT INTO public.inventory_movements (
          product_id, provincia_id, type, quantity, previous_quantity, new_quantity,
          reference, notes, created_by
        )
        VALUES (
          v_item.product_id, v_order.provincia_id, 'out', v_item.quantity,
          v_inv.quantity, v_inv.quantity - v_item.quantity,
          v_order.reference, 'Encomenda concluída', auth.uid()
        );
      END IF;
    END LOOP;
  END IF;

  IF p_status = 'cancelled' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_item.product_id
        AND i.provincia_id IS NOT DISTINCT FROM v_order.provincia_id
      LIMIT 1;

      IF NOT FOUND AND v_order.provincia_id IS NOT NULL THEN
        SELECT i.id INTO v_inv
        FROM public.inventory i
        WHERE i.product_id = v_item.product_id AND i.provincia_id IS NULL
        LIMIT 1;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.inventory i
        SET reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
            updated_at = now()
        WHERE i.id = v_inv.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET status = p_status,
      notes = COALESCE(p_notes, o.notes),
      payment_status = CASE WHEN p_status = 'completed' THEN 'paid'::public.payment_status ELSE o.payment_status END,
      updated_at = now()
  WHERE o.id = v_order.id;

  UPDATE public.order_status_history h
  SET notes = p_notes
  WHERE h.order_id = v_order.id
    AND h.id = (
      SELECT h2.id FROM public.order_status_history h2
      WHERE h2.order_id = v_order.id
      ORDER BY h2.created_at DESC LIMIT 1
    );

  RETURN jsonb_build_object('order_id', v_order.id, 'status', p_status, 'changed', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. RESERVAS COM STOCK PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_reservation(
  p_items      jsonb,
  p_expires_at timestamptz DEFAULT NULL,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_item  jsonb;
  v_prod  record;
  v_inv   record;
  v_prov  uuid;
  v_qty   int;
  v_price numeric(12,2);
  v_hours int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem reservar' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  IF p_expires_at IS NULL THEN
    SELECT COALESCE((value->>'value')::int, 48) INTO v_hours
    FROM public.platform_settings WHERE key = 'reservation_expiry_hours';
    v_hours := COALESCE(v_hours, 48);
    p_expires_at := now() + (v_hours || ' hours')::interval;
  END IF;

  v_prov := public.my_province();

  INSERT INTO public.reservations (customer_id, status, expires_at, notes, provincia_id)
  VALUES (v_uid, 'active', p_expires_at, NULLIF(btrim(p_notes), ''), v_prov)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível';
    END IF;

    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    SELECT i.id INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.reservation_items (reservation_id, product_id, quantity, unit_price)
    VALUES (v_id, v_prod.id, v_qty, v_price);
  END LOOP;

  RETURN jsonb_build_object('reservation_id', v_id, 'expires_at', p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res public.reservations;
  v_it  record;
  v_inv record;
BEGIN
  SELECT * INTO v_res FROM public.reservations r WHERE r.id = p_reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva inexistente';
  END IF;

  IF NOT (
    public.is_manager()
    OR v_res.customer_id = auth.uid()
    OR COALESCE(v_res.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  FOR v_it IN SELECT ri.product_id, ri.quantity FROM public.reservation_items ri WHERE ri.reservation_id = v_res.id
  LOOP
    SELECT i.id INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_it.product_id
      AND i.provincia_id IS NOT DISTINCT FROM v_res.provincia_id
    LIMIT 1;

    IF NOT FOUND AND v_res.provincia_id IS NOT NULL THEN
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_it.product_id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = GREATEST(i.reserved_quantity - v_it.quantity, 0),
          updated_at = now()
      WHERE i.id = v_inv.id;
    END IF;
  END LOOP;

  UPDATE public.reservations r
  SET status = 'cancelled', updated_at = now()
  WHERE r.id = v_res.id;

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_reservations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res record;
  v_it  record;
  v_inv record;
  v_count int := 0;
BEGIN
  FOR v_res IN
    SELECT r.id, r.provincia_id FROM public.reservations r
    WHERE r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now()
    FOR UPDATE
  LOOP
    FOR v_it IN SELECT ri.product_id, ri.quantity FROM public.reservation_items ri WHERE ri.reservation_id = v_res.id
    LOOP
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_it.product_id
        AND i.provincia_id IS NOT DISTINCT FROM v_res.provincia_id
      LIMIT 1;

      IF NOT FOUND AND v_res.provincia_id IS NOT NULL THEN
        SELECT i.id INTO v_inv
        FROM public.inventory i
        WHERE i.product_id = v_it.product_id AND i.provincia_id IS NULL
        LIMIT 1;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.inventory i
        SET reserved_quantity = GREATEST(i.reserved_quantity - v_it.quantity, 0),
            updated_at = now()
        WHERE i.id = v_inv.id;
      END IF;
    END LOOP;

    UPDATE public.reservations r SET status = 'expired', updated_at = now() WHERE r.id = v_res.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. VENDAS COM STOCK PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_sale(
  p_items          jsonb,
  p_customer_id    uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_sale_id  uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_existing public.sales;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem registar vendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  IF p_customer_id IS NOT NULL
     AND NOT public.is_manager()
     AND NOT public.is_my_customer(p_customer_id) THEN
    RAISE EXCEPTION 'Cliente não associado a este vendedor' USING ERRCODE = '42501';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.sales s
    WHERE s.seller_id = v_uid AND s.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_sale_reference();
  v_prov := public.my_province();

  INSERT INTO public.sales (
    reference, client_ref, seller_id, customer_id, payment_method,
    payment_status, notes, is_offline, sync_status, provincia_id
  )
  VALUES (
    v_ref, p_client_ref, v_uid, p_customer_id,
    NULLIF(btrim(p_payment_method), ''), p_payment_status,
    NULLIF(btrim(p_notes), ''), p_client_ref IS NOT NULL, 'synced', v_prov
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.sku, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível';
    END IF;

    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    SELECT i.id, i.quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      IF v_inv.quantity < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente para % (disponível: %)', v_prod.name, v_inv.quantity;
      END IF;

      UPDATE public.inventory i
      SET quantity = i.quantity - v_qty, updated_at = now()
      WHERE i.id = v_inv.id;

      INSERT INTO public.inventory_movements (
        product_id, provincia_id, type, quantity, previous_quantity, new_quantity,
        reference, notes, created_by
      )
      VALUES (
        v_prod.id, v_prov, 'out', v_qty, v_inv.quantity, v_inv.quantity - v_qty,
        v_ref, 'Venda registada', v_uid
      );
    END IF;

    INSERT INTO public.sale_items (
      sale_id, product_id, quantity, unit_price, total_price, product_snapshot
    )
    VALUES (
      v_sale_id, v_prod.id, v_qty, v_price, v_price * v_qty,
      jsonb_build_object(
        'name', v_prod.name,
        'sku', v_prod.sku,
        'official_price', v_prod.official_price,
        'promotional_price', v_prod.promotional_price,
        'sold_at', now()
      )
    );
  END LOOP;

  SELECT COALESCE(SUM(si.total_price), 0) INTO v_total
  FROM public.sale_items si WHERE si.sale_id = v_sale_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'reference', v_ref,
    'total', v_total,
    'duplicated', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. PERFIL COM IDENTIDADE PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
  v_prov    public.provincias;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_profile.provincia_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.provincias pr WHERE pr.id = v_profile.provincia_id;
  END IF;

  RETURN to_jsonb(v_profile) || jsonb_build_object(
    'provincia_nome',     v_prov.nome,
    'provincia_codigo',   v_prov.codigo,
    'provincia_slug',     v_prov.slug,
    'delegacao_nome',     v_prov.delegacao_nome,
    'delegacao_endereco', v_prov.delegacao_endereco,
    'delegacao_telefone', v_prov.delegacao_telefone,
    'is_national',        public.is_national()
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 17. INDICADORES DA GERÊNCIA (por província)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_stats(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.dashboard_stats(
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
  -- A administração nacional pode escolher uma província; um gestor
  -- provincial só pode ver a sua, mesmo que peça outra.
  v_prov uuid := CASE
                   WHEN public.is_national() THEN p_provincia_id
                   ELSE public.my_province()
                 END;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar indicadores' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'provincia_id', v_prov,
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'sales_total_value', (
      SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'sales_count', (
      SELECT COUNT(*) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'orders_count', (
      SELECT COUNT(*) FROM public.orders o
      WHERE o.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR o.provincia_id = v_prov)
    ),
    'orders_by_status', (
      SELECT COALESCE(jsonb_object_agg(t.status, t.qty), '{}'::jsonb)
      FROM (
        SELECT o.status::text AS status, COUNT(*) AS qty
        FROM public.orders o
        WHERE o.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR o.provincia_id = v_prov)
        GROUP BY o.status
      ) t
    ),
    'customers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'customer'
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'sellers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'seller' AND p.is_active = true
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'active_reservations', (
      SELECT COUNT(*) FROM public.reservations r
      WHERE r.status = 'active'
        AND (v_prov IS NULL OR r.provincia_id = v_prov)
    ),
    'pending_discounts', (
      SELECT COUNT(*) FROM public.discount_requests d
      WHERE d.status = 'pending'
        AND (v_prov IS NULL OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = d.customer_id AND p.provincia_id = v_prov
        ))
    ),
    'low_stock_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.name, i.quantity, i.low_stock_threshold, pr.nome AS provincia
        FROM public.inventory i
        JOIN public.products p ON p.id = i.product_id
        LEFT JOIN public.provincias pr ON pr.id = i.provincia_id
        WHERE i.quantity <= i.low_stock_threshold
          AND (v_prov IS NULL OR i.provincia_id = v_prov)
        ORDER BY i.quantity ASC
        LIMIT 20
      ) t
    ),
    'sales_by_seller', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT pr.full_name AS seller, COUNT(*) AS sales, SUM(s.total_amount) AS value
        FROM public.sales s
        JOIN public.profiles pr ON pr.id = s.seller_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY pr.full_name
        ORDER BY SUM(s.total_amount) DESC
        LIMIT 20
      ) t
    ),
    'top_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY si.product_snapshot->>'name'
        ORDER BY SUM(si.quantity) DESC
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 18. COLABORADORES: província na promoção
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.promote_to_seller(text, text);

CREATE OR REPLACE FUNCTION public.promote_to_seller(
  p_phone        text,
  p_region       text DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone text := public.normalize_phone(p_phone);
  v_id    uuid;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido';
  END IF;

  SELECT p.id INTO v_id FROM public.profiles p WHERE p.phone = v_phone;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum perfil com o telefone %', v_phone;
  END IF;

  UPDATE public.profiles p
  SET role = 'seller',
      provincia_id = COALESCE(p_provincia_id, p.provincia_id)
  WHERE p.id = v_id;

  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (v_id, 'seller', v_id)
  ON CONFLICT (user_id) DO UPDATE SET role = 'seller', assigned_at = now();

  INSERT INTO public.seller_profiles (id, region, provincia_id)
  VALUES (v_id, p_region, p_provincia_id)
  ON CONFLICT (id) DO UPDATE
    SET provincia_id = COALESCE(EXCLUDED.provincia_id, public.seller_profiles.provincia_id);

  RETURN jsonb_build_object('user_id', v_id, 'role', 'seller', 'provincia_id', p_provincia_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 19. RLS PROVINCIAL
-- -----------------------------------------------------------------------------
ALTER TABLE public.provincias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provincias_read ON public.provincias;
CREATE POLICY provincias_read ON public.provincias
  FOR SELECT TO anon, authenticated
  USING (provincias.is_active = true OR public.is_manager());

DROP POLICY IF EXISTS provincias_manager_write ON public.provincias;
CREATE POLICY provincias_manager_write ON public.provincias
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.is_national())
  WITH CHECK (public.is_manager() AND public.is_national());

-- PERFIS ---------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    profiles.id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(profiles.provincia_id)
        AND (public.is_national() OR profiles.provincia_id = public.my_province()))
    OR (public.is_seller() AND public.is_my_customer(profiles.id))
    -- O cliente vê o colaborador que lhe está atribuído (aba de referência).
    OR EXISTS (
      SELECT 1 FROM public.seller_customers sc
      WHERE sc.customer_id = auth.uid()
        AND sc.seller_id = profiles.id
        AND sc.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members me
      JOIN public.conversation_members outro
        ON outro.conversation_id = me.conversation_id
      WHERE me.user_id = auth.uid()
        AND outro.user_id = profiles.id
    )
  );

-- CATÁLOGO -------------------------------------------------------------
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (
    -- A administração nacional vê tudo, incluindo inactivos.
    public.is_national()
    OR (
      (products.is_active = true OR public.is_manager() OR public.is_seller())
      AND (
        auth.uid() IS NULL                      -- visitante: montra pública
        OR products.provincia_id IS NULL        -- produto nacional
        OR products.provincia_id = public.my_province()
      )
    )
  );

DROP POLICY IF EXISTS products_manager_write ON public.products;
CREATE POLICY products_manager_write ON public.products
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(products.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(products.provincia_id));

DROP POLICY IF EXISTS inventory_read ON public.inventory;
CREATE POLICY inventory_read ON public.inventory
  FOR SELECT TO authenticated
  USING (public.can_see_province(inventory.provincia_id));

DROP POLICY IF EXISTS inventory_manager_write ON public.inventory;
CREATE POLICY inventory_manager_write ON public.inventory
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(inventory.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(inventory.provincia_id));

DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (
    (public.is_manager() OR public.is_seller())
    AND public.can_see_province(inventory_movements.provincia_id)
  );

DROP POLICY IF EXISTS inventory_movements_manager_write ON public.inventory_movements;
CREATE POLICY inventory_movements_manager_write ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(inventory_movements.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(inventory_movements.provincia_id));

DROP POLICY IF EXISTS seller_profiles_select ON public.seller_profiles;
CREATE POLICY seller_profiles_select ON public.seller_profiles
  FOR SELECT TO authenticated
  USING (
    seller_profiles.id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(seller_profiles.provincia_id))
  );

DROP POLICY IF EXISTS seller_profiles_manager_write ON public.seller_profiles;
CREATE POLICY seller_profiles_manager_write ON public.seller_profiles
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(seller_profiles.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(seller_profiles.provincia_id));

-- ENCOMENDAS / VENDAS --------------------------------------------------
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (
    (
      orders.customer_id = auth.uid()
      OR orders.seller_id = auth.uid()
      OR public.is_manager()
      OR (public.is_seller() AND public.is_my_customer(orders.customer_id))
    )
    AND public.can_see_province(orders.provincia_id)
  );

DROP POLICY IF EXISTS orders_update_manager_seller ON public.orders;
CREATE POLICY orders_update_manager_seller ON public.orders
  FOR UPDATE TO authenticated
  USING (
    (
      public.is_manager()
      OR orders.seller_id = auth.uid()
      OR (orders.customer_id = auth.uid() AND orders.status = 'pending')
    )
    AND public.can_see_province(orders.provincia_id)
  )
  WITH CHECK (
    (
      public.is_manager()
      OR orders.seller_id = auth.uid()
      OR orders.customer_id = auth.uid()
    )
    AND public.can_see_province(orders.provincia_id)
  );

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (
    (sales.seller_id = auth.uid() OR public.is_manager())
    AND public.can_see_province(sales.provincia_id)
  );

DROP POLICY IF EXISTS sales_update_manager ON public.sales;
CREATE POLICY sales_update_manager ON public.sales
  FOR UPDATE TO authenticated
  USING (public.is_manager() AND public.can_manage_province(sales.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(sales.provincia_id));

DROP POLICY IF EXISTS reservations_select ON public.reservations;
CREATE POLICY reservations_select ON public.reservations
  FOR SELECT TO authenticated
  USING (
    (
      reservations.customer_id = auth.uid()
      OR reservations.seller_id = auth.uid()
      OR public.is_manager()
      OR (public.is_seller() AND public.is_my_customer(reservations.customer_id))
    )
    AND public.can_see_province(reservations.provincia_id)
  );

-- TRANSFERÊNCIAS -------------------------------------------------------
DROP POLICY IF EXISTS stock_transfers_select ON public.stock_transfers;
CREATE POLICY stock_transfers_select ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    AND (
      public.is_national()
      OR stock_transfers.from_provincia_id = public.my_province()
      OR stock_transfers.to_provincia_id = public.my_province()
    )
  );

DROP POLICY IF EXISTS stock_transfers_insert ON public.stock_transfers;
CREATE POLICY stock_transfers_insert ON public.stock_transfers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- 20. PERMISSÕES DE EXECUÇÃO
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.my_province()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_national()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_province(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_province(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_province()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_province(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.province_overview()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_stock_transfer(uuid, uuid, uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_stock_transfer(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid, int, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_stats(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_referencia(uuid)         TO authenticated;

REVOKE ALL ON FUNCTION public.promote_to_seller(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Realtime: as transferências aparecem na hora a quem aprova
DO $$
BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_transfers';
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN undefined_object THEN NULL;
END $$;
