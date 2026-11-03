-- =============================================================================
--  0008 — TAXA DE COMISSÃO, PEDIDOS, CANDIDATURAS DE REVENDEDOR
-- =============================================================================
--  Idempotente. Pode ser colado sobre uma base já existente.
--
--  O QUE RESOLVE
--   1. A taxa de comissão deixa de estar presa a cada colaborador. Passa a
--      haver UMA taxa da empresa (10% por omissão) que a gestão muda num sítio
--      só, e que todos os colaboradores herdam. Uma taxa pessoal continua a ser
--      possível, mas passa a ser a excepção e não a regra.
--   2. O cliente passa a poder confirmar que recebeu a encomenda
--      ("em entrega" -> "concluída"). Antes só podia cancelar.
--   3. Candidaturas a revendedor: o visitante deixa o contacto na loja e a
--      gestão recebe. Tabela própria, sem misturar com encomendas.
--   4. "Falar com a equipa INUKA": uma conversa de grupo com o colaborador
--      vinculado E a gestão, em vez de uma conversa directa só com o vendedor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TAXA DE COMISSÃO DA EMPRESA
-- -----------------------------------------------------------------------------
-- O valor vive em `platform_settings` para não haver um número mágico no
-- código. `{"value": 0.10}` = 10%.
INSERT INTO public.platform_settings (key, value)
VALUES ('commission_rate', '{"value": 0.10}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- `NULL` passa a significar "usa a taxa da empresa".
-- Antes a coluna era NOT NULL DEFAULT 0, e 0 tanto queria dizer "sem comissão"
-- como "ainda ninguém definiu isto" — duas coisas diferentes com o mesmo valor.
ALTER TABLE public.seller_profiles ALTER COLUMN commission_rate DROP NOT NULL;
ALTER TABLE public.seller_profiles ALTER COLUMN commission_rate DROP DEFAULT;

-- Normalização única dos valores antigos.
--
-- Só corre uma vez: sem o marcador, voltar a executar este ficheiro apagaria as
-- taxas pessoais que a gestão tivesse definido depois. O marcador é o que torna
-- a operação segura de repetir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'commission_rate_normalizado') THEN
    -- 0% e 5% eram os valores herdados do formulário antigo, não decisões da
    -- gestão. Passam a herdar a taxa da empresa (10%).
    UPDATE public.seller_profiles SET commission_rate = NULL;

    INSERT INTO public.platform_settings (key, value)
    VALUES ('commission_rate_normalizado', '{"value": true}'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

COMMENT ON COLUMN public.seller_profiles.commission_rate IS
  'Taxa pessoal. NULL = herda a taxa da empresa (platform_settings.commission_rate).';

-- Taxa da empresa. Nunca devolve NULL: sem linha, vale 10%.
CREATE OR REPLACE FUNCTION public.taxa_comissao_global()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value ->> 'value')::numeric
       FROM public.platform_settings WHERE key = 'commission_rate'),
    0.10
  );
$$;

-- Taxa que se aplica a esta pessoa: a pessoal, se existir; senão a da empresa.
CREATE OR REPLACE FUNCTION public.taxa_comissao_efetiva(p_seller uuid DEFAULT auth.uid())
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT sp.commission_rate FROM public.seller_profiles sp WHERE sp.id = p_seller),
    public.taxa_comissao_global()
  );
$$;

-- O que a interface precisa de saber para explicar o número ao colaborador.
-- `p_seller` permite à gestão ver a taxa de qualquer colaborador; qualquer
-- outra pessoa só vê a sua.
CREATE OR REPLACE FUNCTION public.taxa_comissao_de(p_seller uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_global  numeric := public.taxa_comissao_global();
  v_pessoal numeric;
  v_efetiva numeric;
BEGIN
  IF NOT public.is_manager() AND p_seller IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para ver a taxa de outra pessoa' USING ERRCODE = '42501';
  END IF;

  SELECT sp.commission_rate INTO v_pessoal
  FROM public.seller_profiles sp WHERE sp.id = p_seller;

  v_efetiva := COALESCE(v_pessoal, v_global);

  RETURN jsonb_build_object(
    'global',  v_global,
    'pessoal', v_pessoal,
    'efetiva', v_efetiva,
    'origem',  CASE WHEN v_pessoal IS NULL THEN 'empresa' ELSE 'pessoal' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.taxa_comissao()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.taxa_comissao_de(auth.uid());
$$;

-- Mudar a taxa. Só a gestão, e fica registado na auditoria.
CREATE OR REPLACE FUNCTION public.definir_taxa_comissao(
  p_rate                  numeric,
  p_recalcular_pendentes  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_antiga    numeric;
  v_pendentes integer := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode alterar a taxa de comissão' USING ERRCODE = '42501';
  END IF;

  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 1 THEN
    RAISE EXCEPTION 'Taxa inválida: tem de estar entre 0%% e 100%%';
  END IF;

  v_antiga := public.taxa_comissao_global();

  INSERT INTO public.platform_settings AS ps (key, value, updated_by, updated_at)
  VALUES ('commission_rate', jsonb_build_object('value', p_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  -- Recalcular comissões por pagar é opcional e explícito. Feito por omissão,
  -- subir a taxa inflacionava comissões de vendas antigas sem ninguém pedir.
  -- Só toca em quem não tem taxa pessoal: essa é uma decisão da gestão e não
  -- se sobrepõe em bloco.
  IF p_recalcular_pendentes THEN
    WITH alvo AS (
      UPDATE public.sale_commissions c
      SET rate = p_rate,
          amount = round(c.base_amount * p_rate, 2),
          updated_at = now()
      FROM public.sales s
      JOIN public.seller_profiles sp ON sp.id = s.seller_id
      WHERE c.sale_id = s.id
        AND c.status = 'pending'
        AND sp.commission_rate IS NULL
      RETURNING c.id
    )
    SELECT count(*) INTO v_pendentes FROM alvo;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update_commission_rate', 'platform_settings', NULL,
    jsonb_build_object('rate', v_antiga),
    jsonb_build_object('rate', p_rate, 'recalculadas', v_pendentes)
  );

  RETURN jsonb_build_object(
    'rate', p_rate,
    'anterior', v_antiga,
    'recalculadas', v_pendentes
  );
END;
$$;

-- Taxa pessoal de um colaborador: define-a, ou devolve-o à taxa da empresa.
--
-- Existe à parte de `atualizar_perfil_colaborador` de propósito: aquela função
-- trata o `commission_rate` ausente como 0 (herança do formulário antigo), e
-- mudá-la obrigaria a redefinir uma função de duzentas linhas. Aqui o `NULL`
-- tem um significado explícito — "usa a da empresa".
CREATE OR REPLACE FUNCTION public.definir_taxa_colaborador(
  p_id   uuid,
  p_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode alterar a taxa de um colaborador' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Sem permissão sobre colaboradores desta província' USING ERRCODE = '42501';
  END IF;

  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 1) THEN
    RAISE EXCEPTION 'Taxa inválida: tem de estar entre 0%% e 100%%';
  END IF;

  UPDATE public.seller_profiles sp
  SET commission_rate = p_rate, updated_at = now()
  WHERE sp.id = p_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (
    auth.uid(), 'update_seller_commission_rate', 'seller_profiles', p_id,
    jsonb_build_object('rate', p_rate)
  );

  RETURN public.taxa_comissao_de(p_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. A COMISSÃO PASSA A USAR A TAXA EFETIVA
-- -----------------------------------------------------------------------------
-- Substitui a versão da migração 0006, que lia `COALESCE(sp.commission_rate, 0)`
-- e portanto punha 0% em quem herdava.
CREATE OR REPLACE FUNCTION public.fill_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rate numeric(5,4);
BEGIN
  -- Só reage ao que muda o valor: evita recalcular em cada UPDATE da venda.
  IF TG_OP = 'UPDATE'
     AND NEW.status       IS NOT DISTINCT FROM OLD.status
     AND NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
     AND NEW.seller_id    IS NOT DISTINCT FROM OLD.seller_id THEN
    RETURN NEW;
  END IF;

  v_rate := public.taxa_comissao_efetiva(NEW.seller_id);

  IF NEW.status = 'cancelled' THEN
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate, 0, 'cancelled')
    ON CONFLICT (sale_id) DO UPDATE
      SET status = 'cancelled', amount = 0, base_amount = EXCLUDED.base_amount,
          updated_at = now()
      WHERE c.status <> 'paid';   -- uma comissão já paga não se anula sozinha
  ELSE
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate,
       round(NEW.total_amount * v_rate, 2), 'pending')
    ON CONFLICT (sale_id) DO UPDATE
      SET seller_id = EXCLUDED.seller_id,
          provincia_id = EXCLUDED.provincia_id,
          base_amount = EXCLUDED.base_amount,
          rate = EXCLUDED.rate,
          amount = EXCLUDED.amount,
          updated_at = now()
      WHERE c.status = 'pending';  -- paga ou anulada fica como está
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. PEDIDOS: O CLIENTE CONFIRMA A ENTREGA
-- -----------------------------------------------------------------------------
-- Antes o cliente só podia cancelar. Agora, quando a encomenda já saiu para
-- entrega (ou está pronta para levantamento), pode confirmar que a recebeu.
-- Quem muda para "concluída" continua a ser a gestão — e também o cliente, mas
-- só nesse passo final. É a diferença entre "a loja diz que entregou" e
-- "o comprador confirma que recebeu".
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
  v_sou_cliente boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda inexistente';
  END IF;

  -- Atenção: `seller_id` é opcional. `NULL = auth.uid()` devolve NULL, e
  -- `NOT (false OR NULL OR false)` é NULL — o IF não disparava e qualquer
  -- utilizador autenticado conseguia alterar a encomenda. Daí o COALESCE.
  IF NOT (
    public.is_manager()
    OR v_order.customer_id = auth.uid()
    OR COALESCE(v_order.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta encomenda' USING ERRCODE = '42501';
  END IF;

  -- O comprador: pode cancelar ou confirmar a recepção. Não é um "gestor da
  -- encomenda" — não lhe compete escolher "em preparação" ou "em entrega".
  v_sou_cliente := COALESCE(v_order.customer_id = auth.uid(), false)
                   AND NOT public.is_manager()
                   AND NOT COALESCE(v_order.seller_id = auth.uid(), false);

  IF v_sou_cliente AND p_status NOT IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'O cliente apenas pode cancelar a encomenda ou confirmar a entrega'
      USING ERRCODE = '42501';
  END IF;

  IF v_sou_cliente AND p_status = 'completed'
     AND v_order.status NOT IN ('in_delivery', 'ready_pickup') THEN
    RAISE EXCEPTION 'Ainda não pode confirmar esta entrega' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Encomenda já concluída não pode ser alterada';
  END IF;

  IF p_status = v_order.status THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'changed', false);
  END IF;

  -- Concluir: converter reserva em saída efetiva de stock
  IF p_status = 'completed' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      UPDATE public.inventory i
      SET quantity = i.quantity - v_item.quantity,
          reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_item.product_id;

      IF FOUND THEN
        INSERT INTO public.inventory_movements (
          product_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
        )
        SELECT
          v_item.product_id,
          'out',
          v_item.quantity,
          i.quantity + v_item.quantity,
          i.quantity,
          v_order.reference,
          CASE WHEN v_sou_cliente THEN 'Entrega confirmada pelo cliente'
               ELSE 'Encomenda concluída' END,
          auth.uid()
        FROM public.inventory i WHERE i.product_id = v_item.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Cancelar: libertar reserva
  IF p_status = 'cancelled' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      UPDATE public.inventory i
      SET reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_item.product_id;
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

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', p_status,
    'changed', true,
    'pelo_cliente', v_sou_cliente
  );
END;
$$;

-- O colaborador também tem de saber que entrou uma encomenda na sua carteira.
CREATE OR REPLACE FUNCTION public.on_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Gestão: vê todas.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    p.id,
    'new_order',
    'Nova encomenda',
    'Encomenda ' || NEW.reference || ' criada.',
    jsonb_build_object('order_id', NEW.id)
  FROM public.profiles p
  WHERE p.role = 'manager' AND p.is_active = true;

  -- Colaborador: só a dele. Sem este bloco a encomenda existia na base e
  -- ninguém na equipa de vendas era avisado.
  IF NEW.seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      NEW.seller_id,
      'new_order',
      'Nova encomenda na sua carteira',
      'Encomenda ' || NEW.reference || ' criada.',
      jsonb_build_object('order_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. CANDIDATURAS A REVENDEDOR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reseller_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  phone        text NOT NULL CHECK (char_length(btrim(phone)) BETWEEN 9 AND 24),
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  message      text CHECK (message IS NULL OR char_length(message) <= 800),
  -- Onde é que a pessoa já conhece a INUKA? Ajuda a triagem.
  source       text,
  status       text NOT NULL DEFAULT 'novo'
                 CHECK (status IN ('novo', 'em_contacto', 'aprovado', 'recusado')),
  handled_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reseller_applications_estado
  ON public.reseller_applications (status, created_at DESC);

ALTER TABLE public.reseller_applications ENABLE ROW LEVEL SECURITY;

-- Sem este GRANT a política de INSERT não serve de nada a quem não tem sessão:
-- o formulário é público e o papel `anon` não recebe INSERT por omissão.
GRANT INSERT ON public.reseller_applications TO anon, authenticated;

-- Qualquer pessoa pode candidatar-se — é um formulário público da loja.
DROP POLICY IF EXISTS reseller_applications_insert ON public.reseller_applications;
CREATE POLICY reseller_applications_insert ON public.reseller_applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    -- Nunca se aceita um estado já "tratado" nem um responsável vindos do
    -- browser: quem se candidata não decide o resultado da candidatura.
    status = 'novo'
    AND handled_by IS NULL
    AND handled_at IS NULL
  );

-- Ler e tratar é só da gestão. O telefone de quem se candidatou não é público.
DROP POLICY IF EXISTS reseller_applications_manager_read ON public.reseller_applications;
CREATE POLICY reseller_applications_manager_read ON public.reseller_applications
  FOR SELECT TO authenticated
  USING (public.is_manager());

DROP POLICY IF EXISTS reseller_applications_manager_update ON public.reseller_applications;
CREATE POLICY reseller_applications_manager_update ON public.reseller_applications
  FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS reseller_applications_manager_delete ON public.reseller_applications;
CREATE POLICY reseller_applications_manager_delete ON public.reseller_applications
  FOR DELETE TO authenticated
  USING (public.is_manager());

DROP TRIGGER IF EXISTS trg_reseller_applications_updated ON public.reseller_applications;
CREATE TRIGGER trg_reseller_applications_updated
BEFORE UPDATE ON public.reseller_applications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. "FALAR COM A EQUIPA INUKA"
-- -----------------------------------------------------------------------------
-- O cliente falava só com o colaborador. Uma conversa de grupo junta o
-- colaborador vinculado e a gestão, para não haver mensagens que morrem num
-- telefone que ninguém leu.
--
-- Porque é que isto é uma função e não um INSERT do cliente?
-- `conversations` e `conversation_members` não têm política de INSERT para
-- clientes — de propósito. Sem SECURITY DEFINER, o cliente não consegue criar
-- a conversa; e dar-lhe INSERT directo deixá-lo-ia acrescentar qualquer pessoa.
CREATE OR REPLACE FUNCTION public.abrir_conversa_equipa()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_role      public.user_role;
  v_provincia uuid;
  v_seller    uuid;
  v_manager   uuid;
  v_conv      uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.provincia_id INTO v_role, v_provincia
  FROM public.profiles p WHERE p.id = v_me;

  -- Colaborador vinculado (o mais recente, se por alguma razão houver mais do
  -- que um activo).
  SELECT sc.seller_id INTO v_seller
  FROM public.seller_customers sc
  WHERE sc.customer_id = v_me AND sc.is_active = true
  ORDER BY sc.assigned_at DESC
  LIMIT 1;

  -- Gestor: de preferência o da mesma província; senão o mais antigo activo.
  SELECT p.id INTO v_manager
  FROM public.profiles p
  WHERE p.role = 'manager' AND p.is_active = true
  ORDER BY (p.provincia_id IS NOT DISTINCT FROM v_provincia) DESC, p.created_at
  LIMIT 1;

  -- Uma conversa por cliente: reutiliza-se em vez de criar uma nova em cada
  -- clique. `created_by` é o cliente, por isso não se misturam equipas.
  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.type = 'group'
    AND c.created_by = v_me
    AND c.title = 'Equipa INUKA'
  LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, title, created_by)
    VALUES ('group', 'Equipa INUKA', v_me)
    RETURNING id INTO v_conv;
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv, v_me, 'admin')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF v_seller IS NOT NULL AND v_seller <> v_me THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_seller, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  IF v_manager IS NOT NULL AND v_manager <> v_me THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_manager, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conv;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. PERMISSÕES E REALTIME
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.taxa_comissao_global()               TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.taxa_comissao_efetiva(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxa_comissao_de(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxa_comissao()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_taxa_comissao(numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_taxa_colaborador(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_conversa_equipa()              TO authenticated;

-- A taxa muda no painel da gestão e tem de chegar ao colaborador que está com
-- a página aberta, sem ele recarregar.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_profiles';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.reseller_applications';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
