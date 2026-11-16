-- =============================================================================
-- 0021 — DESPESAS E INVESTIMENTO DA EMPRESA
-- =============================================================================
-- O PROBLEMA
-- A comissão de um colaborador só tinha uma saída: dinheiro para a mão dele
-- (XPRESS ou transferência). Mas a empresa também gasta e investe — compra
-- stock, paga rendas, equipamento, marketing — e esse dinheiro não existia em
-- lado nenhum do sistema. Quem quisesse usar a comissão para pagar uma despesa
-- da empresa não tinha por onde, e a gestão não tinha onde registar o que gastou.
--
-- A SOLUÇÃO
-- Uma tabela `despesas` (despesa corrente ou investimento) e um **terceiro
-- destino** no levantamento: em vez de receber, o colaborador aplica a comissão
-- numa despesa da empresa.
--
-- NÃO HÁ UM SEGUNDO LIVRO DE DINHEIRO
-- O dinheiro continua a fechar-se num só sítio: `commission_payouts`. Quando a
-- comissão vai para uma despesa, cria-se na mesma uma linha de pagamento, com
-- `method = 'despesa_empresa'`. Assim `levantamento_resumo()` — que calcula
-- `disponivel = ganho − pago − reservado` — continua certo sem uma linha de
-- código nova: o que foi para a despesa conta como pago, e o saldo baixa.
--
-- AS DUAS PORTAS
--   1. O colaborador, ao levantar, escolhe «Pagar despesa/investimento» em vez
--      de «Receber». Escolhe a despesa (ou escreve em que foi aplicado) e o
--      pedido segue o circuito normal: a gestão aprova e marca como pago.
--   2. A gestão registra a despesa e paga-a logo, descontando do saldo
--      disponível de um colaborador — «retirada para investimento».
--      Fica tudo no histórico dos dois lados.
--
-- IDEMPOTENTE: pode voltar a correr. As funções com assinatura nova são
-- removidas antes de serem criadas (senão ficam duas versões e a chamada por
-- RPC torna-se ambígua).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A TABELA
-- -----------------------------------------------------------------------------
-- `valor` é o que a empresa gastou. Quanto já foi coberto por comissões não se
-- guarda: deriva-se dos levantamentos pagos que apontam para esta despesa
-- (`despesa_coberto`). Um número guardado ficava errado no dia em que um
-- pedido fosse rejeitado.
CREATE TABLE IF NOT EXISTS public.despesas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referencia    text UNIQUE,
  tipo          text NOT NULL DEFAULT 'despesa',
  categoria     text NOT NULL DEFAULT 'outros',
  descricao     text NOT NULL,
  fornecedor    text,
  valor         numeric(12,2) NOT NULL CHECK (valor > 0),
  provincia_id  uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  estado        text NOT NULL DEFAULT 'pendente',
  notas         text,
  comprovativo  text,
  criado_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pago_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pago_em       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT despesas_tipo_valido CHECK (tipo IN ('despesa', 'investimento')),
  CONSTRAINT despesas_estado_valido CHECK (estado IN ('pendente', 'paga', 'anulada')),
  CONSTRAINT despesas_categoria_valida CHECK (
    categoria IN (
      'investimento_produto', 'equipamento', 'marketing', 'logistica',
      'instalacoes', 'salarios', 'formacao', 'tecnologia', 'outros'
    )
  ),
  CONSTRAINT despesas_descricao_preenchida CHECK (btrim(descricao) <> '')
);

CREATE INDEX IF NOT EXISTS idx_despesas_estado ON public.despesas (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_despesas_prov   ON public.despesas (provincia_id, estado);
CREATE INDEX IF NOT EXISTS idx_despesas_tipo   ON public.despesas (tipo, estado);

-- Referências `DES-2026-00001`.
CREATE SEQUENCE IF NOT EXISTS public.despesa_seq START 1;

-- O levantamento passa a poder apontar para a despesa que ajudou a pagar.
ALTER TABLE public.levantamentos
  ADD COLUMN IF NOT EXISTS despesa_id uuid REFERENCES public.despesas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_levantamentos_despesa ON public.levantamentos (despesa_id);

-- `empresa` é o terceiro método: o dinheiro não vai para o colaborador, fica na
-- empresa como pagamento de uma despesa ou investimento.
ALTER TABLE public.levantamentos DROP CONSTRAINT IF EXISTS levantamentos_metodo_valido;
ALTER TABLE public.levantamentos ADD CONSTRAINT levantamentos_metodo_valido
  CHECK (metodo IN ('xpress', 'transferencia', 'empresa'));

COMMENT ON TABLE public.despesas IS
  'Despesas correntes e investimentos da empresa. Podem ser pagos pela tesouraria ou descontados do saldo de comissões de um colaborador.';
COMMENT ON COLUMN public.levantamentos.despesa_id IS
  'Despesa da empresa que este levantamento ajudou a pagar (metodo = empresa).';

-- -----------------------------------------------------------------------------
-- 2. QUANTO JÁ ESTÁ COBERTO
-- -----------------------------------------------------------------------------
-- Soma dos levantamentos **pagos** que apontam para a despesa. Um pedido
-- pendente ou rejeitado não conta: o dinheiro ainda não saiu do saldo.
CREATE OR REPLACE FUNCTION public.despesa_coberto(p_despesa uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(SUM(l.valor), 0)::numeric(12,2)
  FROM public.levantamentos l
  WHERE l.despesa_id = p_despesa
    AND l.estado = 'pago';
$$;

-- -----------------------------------------------------------------------------
-- 3. REGISTAR
-- -----------------------------------------------------------------------------
-- Só a gestão. A província manda: um gestor provincial só registra despesas da
-- província que gere. Sem província indicada, fica na do gestor — ou na sede,
-- quando é administração nacional (que não tem província no perfil).
CREATE OR REPLACE FUNCTION public.registar_despesa(
  p_descricao     text,
  p_valor         numeric,
  p_tipo          text DEFAULT 'despesa',
  p_categoria     text DEFAULT 'outros',
  p_fornecedor    text DEFAULT NULL,
  p_provincia_id  uuid DEFAULT NULL,
  p_notas         text DEFAULT NULL,
  p_comprovativo  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prov uuid := p_provincia_id;
  v_tipo text := COALESCE(NULLIF(btrim(COALESCE(p_tipo, '')), ''), 'despesa');
  v_cat  text := COALESCE(NULLIF(btrim(COALESCE(p_categoria, '')), ''), 'outros');
  v_ref  text;
  v_id   uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão registra despesas' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(COALESCE(p_descricao, '')), '') = '' THEN
    RAISE EXCEPTION 'Descreva a despesa' USING ERRCODE = '22023';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Indique um valor válido' USING ERRCODE = '22023';
  END IF;

  IF v_tipo NOT IN ('despesa', 'investimento') THEN
    RAISE EXCEPTION 'Tipo inválido: use despesa ou investimento' USING ERRCODE = '22023';
  END IF;

  IF v_cat NOT IN (
       'investimento_produto', 'equipamento', 'marketing', 'logistica',
       'instalacoes', 'salarios', 'formacao', 'tecnologia', 'outros') THEN
    RAISE EXCEPTION 'Categoria inválida' USING ERRCODE = '22023';
  END IF;

  -- Sem província indicada: a do gestor. A administração nacional não tem
  -- província, por isso cai na sede (`is_default`).
  IF v_prov IS NULL THEN
    v_prov := public.my_province();
    IF v_prov IS NULL THEN
      v_prov := public.default_province();
    END IF;
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode registar despesas da província que gere' USING ERRCODE = '42501';
  END IF;

  v_ref := 'DES-' || to_char(now(), 'YYYY') || '-' ||
           lpad(nextval('public.despesa_seq')::text, 5, '0');

  INSERT INTO public.despesas (
    referencia, tipo, categoria, descricao, fornecedor, valor,
    provincia_id, notas, comprovativo, criado_por
  )
  VALUES (
    v_ref, v_tipo, v_cat, btrim(p_descricao),
    NULLIF(btrim(COALESCE(p_fornecedor, '')), ''),
    round(p_valor, 2), v_prov,
    NULLIF(btrim(COALESCE(p_notas, '')), ''),
    NULLIF(btrim(COALESCE(p_comprovativo, '')), ''),
    v_uid
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, 'despesa_registada', 'despesas', v_id,
          jsonb_build_object('referencia', v_ref, 'tipo', v_tipo,
                             'valor', round(p_valor, 2), 'categoria', v_cat));

  RETURN jsonb_build_object(
    'id', v_id,
    'referencia', v_ref,
    'tipo', v_tipo,
    'valor', round(p_valor, 2),
    'estado', 'pendente'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. PAGAR
-- -----------------------------------------------------------------------------
-- `p_seller_id` nulo = pagou a tesouraria da empresa (o dinheiro saiu da conta
-- da empresa, não do saldo de ninguém).
--
-- `p_seller_id` preenchido = o valor é descontado do saldo de comissões desse
-- colaborador. É o mesmo mecanismo de `decidir_levantamento`: cria-se uma linha
-- em `commission_payouts` com `method='despesa_empresa'` e fecham-se as
-- comissões mais antigas até cobrir o valor. O saldo dele baixa exactamente
-- como baixaria se tivesse recebido o dinheiro na mão.
CREATE OR REPLACE FUNCTION public.pagar_despesa(
  p_id        uuid,
  p_seller_id uuid DEFAULT NULL,
  p_nota      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_des       public.despesas;
  v_coberto   numeric(12,2);
  v_restante  numeric(12,2);
  v_resumo    jsonb;
  v_disponivel numeric(12,2);
  v_payout    uuid;
  v_prov      uuid;
  v_ref       text;
  v_lev       uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pagar despesas' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_des FROM public.despesas d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa inexistente' USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_manage_province(v_des.provincia_id) THEN
    RAISE EXCEPTION 'Só pode pagar despesas da província que gere' USING ERRCODE = '42501';
  END IF;

  IF v_des.estado = 'anulada' THEN
    RAISE EXCEPTION 'Esta despesa está anulada' USING ERRCODE = '23514';
  END IF;

  IF v_des.estado = 'paga' THEN
    RAISE EXCEPTION 'Esta despesa já está paga' USING ERRCODE = '23514';
  END IF;

  v_coberto  := public.despesa_coberto(p_id);
  v_restante := GREATEST(v_des.valor - v_coberto, 0);

  IF v_restante <= 0 THEN
    -- Já coberta por comissões mas o estado ficou pendente: fecha-se.
    UPDATE public.despesas
    SET estado = 'paga', pago_em = COALESCE(pago_em, now()),
        pago_por = COALESCE(pago_por, v_uid), updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id, 'estado', 'paga', 'payout_id', NULL,
                              'valor', v_des.valor, 'coberto', v_coberto);
  END IF;

  IF p_seller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      JOIN public.profiles p ON p.id = sp.id
      WHERE sp.id = p_seller_id AND p.is_active
    ) THEN
      RAISE EXCEPTION 'Esse colaborador não existe ou está inactivo' USING ERRCODE = '22023';
    END IF;

    SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller_id;
    IF NOT public.can_manage_province(v_prov) THEN
      RAISE EXCEPTION 'Esse colaborador não é da província que gere' USING ERRCODE = '42501';
    END IF;

    -- Trava o mesmo saldo que um levantamento normal: dois cliques ao mesmo
    -- tempo não podem descontar duas vezes.
    PERFORM pg_advisory_xact_lock(hashtext('levantamento:' || p_seller_id::text));

    v_resumo := public.levantamento_resumo(p_seller_id);

    IF NOT (v_resumo->>'habilitado')::boolean THEN
      RAISE EXCEPTION 'O colaborador ainda não desbloqueou o levantamento (faltam % vendas pagas)',
        (v_resumo->>'vendas_faltam')::int USING ERRCODE = '42501';
    END IF;

    v_disponivel := (v_resumo->>'disponivel')::numeric;

    IF v_restante > v_disponivel THEN
      RAISE EXCEPTION 'O saldo do colaborador (% Kz) não chega para os % Kz que faltam nesta despesa',
        round(v_disponivel), round(v_restante) USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
    VALUES (
      p_seller_id, v_prov, v_restante, 'despesa_empresa',
      'Despesa ' || COALESCE(v_des.referencia, v_des.id::text) || ' — ' || v_des.descricao,
      v_uid
    )
    RETURNING id INTO v_payout;

    -- Fecha as comissões mais antigas até cobrir o valor (mesma regra do
    -- levantamento: uma comissão maior do que o resto fica para o pedido
    -- seguinte).
    WITH pend AS (
      SELECT c.id,
             SUM(c.amount) OVER (ORDER BY c.created_at, c.id) AS acumulado
      FROM public.sale_commissions c
      JOIN public.sales s ON s.id = c.sale_id
      WHERE c.seller_id = p_seller_id
        AND c.status = 'pending'
        AND c.amount > 0
        AND s.status = 'completed'
        AND s.payment_status = 'paid'
    )
    UPDATE public.sale_commissions c
    SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
    FROM pend
    WHERE c.id = pend.id AND pend.acumulado <= v_restante;

    -- O colaborador tem de ver este dinheiro no histórico dele. Não é um
    -- pedido dele, mas é dinheiro que saiu do saldo — fica registado como um
    -- levantamento já pago, com a despesa e a nota de quem o retirou. Não
    -- reserva nada (`pago` não entra no `reservado`) e não duplica o
    -- pagamento: o valor só conta em `commission_payouts`.
    v_ref := 'LEV-' || to_char(now(), 'YYYY') || '-' ||
             lpad(nextval('public.levantamento_seq')::text, 5, '0');

    INSERT INTO public.levantamentos (
      referencia, seller_id, provincia_id, valor, metodo, dados, estado,
      notas, despesa_id, payout_id, solicitado_em,
      decidido_por, decidido_em, processado_em, pago_em
    )
    VALUES (
      v_ref, p_seller_id, v_prov, v_restante, 'empresa', '{}'::jsonb, 'pago',
      'Retirado pela gestão para pagar a despesa ' ||
        COALESCE(v_des.referencia, v_des.id::text),
      p_id, v_payout, now(), v_uid, now(), now(), now()
    )
    RETURNING id INTO v_lev;
  END IF;

  UPDATE public.despesas
  SET estado    = 'paga',
      pago_em   = now(),
      pago_por  = v_uid,
      notas     = COALESCE(NULLIF(btrim(COALESCE(p_nota, '')), ''), notas),
      updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, 'despesa_paga', 'despesas', p_id,
          jsonb_build_object(
            'valor', v_des.valor,
            'coberto', v_coberto,
            'restante_pago', v_restante,
            'seller_id', p_seller_id,
            'payout_id', v_payout,
            'levantamento_id', v_lev,
            'nota', p_nota
          ));

  RETURN jsonb_build_object(
    'id', p_id,
    'estado', 'paga',
    'payout_id', v_payout,
    'valor', v_des.valor,
    'coberto', v_coberto,
    'pago_agora', v_restante,
    'seller_id', p_seller_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. ANULAR
-- -----------------------------------------------------------------------------
-- Só uma despesa por pagar e sem nada coberto. Uma despesa paga é um facto:
-- corrige-se com outra despesa, não se apaga a história.
CREATE OR REPLACE FUNCTION public.anular_despesa(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_des     public.despesas;
  v_coberto numeric(12,2);
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode anular despesas' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_des FROM public.despesas d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa inexistente' USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_manage_province(v_des.provincia_id) THEN
    RAISE EXCEPTION 'Só pode anular despesas da província que gere' USING ERRCODE = '42501';
  END IF;

  IF v_des.estado = 'paga' THEN
    RAISE EXCEPTION 'Uma despesa paga não se anula' USING ERRCODE = '23514';
  END IF;

  v_coberto := public.despesa_coberto(p_id);
  IF v_coberto > 0 THEN
    RAISE EXCEPTION 'Esta despesa já tem % Kz cobertos por comissões', round(v_coberto)
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.despesas
  SET estado = 'anulada',
      notas = CASE
                WHEN COALESCE(btrim(COALESCE(p_motivo, '')), '') = '' THEN notas
                ELSE concat_ws(' · ', NULLIF(notas, ''), 'Anulada: ' || btrim(p_motivo))
              END,
      updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (v_uid, 'despesa_anulada', 'despesas', p_id,
          jsonb_build_object('estado', v_des.estado, 'valor', v_des.valor),
          jsonb_build_object('estado', 'anulada', 'motivo', p_motivo));

  RETURN jsonb_build_object('id', p_id, 'estado', 'anulada');
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. CONSULTAR — GESTÃO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.despesas_equipa(
  p_estado text DEFAULT NULL,
  p_tipo   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver as despesas' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'created_at') DESC), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
             'id',          d.id,
             'referencia',  d.referencia,
             'tipo',        d.tipo,
             'categoria',   d.categoria,
             'descricao',   d.descricao,
             'fornecedor',  d.fornecedor,
             'valor',       d.valor,
             'estado',      d.estado,
             'notas',       d.notas,
             'comprovativo', d.comprovativo,
             'provincia_id', d.provincia_id,
             'provincia',   pr.nome,
             'created_at',  d.created_at,
             'pago_em',     d.pago_em,
             'coberto',     public.despesa_coberto(d.id),
             'restante',    GREATEST(d.valor - public.despesa_coberto(d.id), 0),
             'financiadores', COALESCE((
               SELECT jsonb_agg(DISTINCT p.full_name)
               FROM public.levantamentos l
               JOIN public.profiles p ON p.id = l.seller_id
               WHERE l.despesa_id = d.id AND l.estado = 'pago'
             ), '[]'::jsonb)
           ) AS linha
    FROM public.despesas d
    LEFT JOIN public.provincias pr ON pr.id = d.provincia_id
    WHERE public.can_manage_province(d.provincia_id)
      AND (p_estado IS NULL OR d.estado = p_estado)
      AND (p_tipo   IS NULL OR d.tipo   = p_tipo)
  ) t;

  RETURN v_res;
END;
$$;

-- Totais para o topo da página. `mes` é o mês corrente.
CREATE OR REPLACE FUNCTION public.despesas_resumo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver as despesas' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'pendente_valor',   COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'pendente'), 0),
           'pendente_count',   COUNT(*) FILTER (WHERE d.estado = 'pendente'),
           'despesa_total',    COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'despesa'), 0),
           'investimento_total', COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'investimento'), 0),
           'mes_valor',        COALESCE(SUM(d.valor) FILTER (
                                 WHERE d.estado = 'paga'
                                   AND d.pago_em >= date_trunc('month', now())), 0),
           'pago_com_comissoes', COALESCE((
             SELECT SUM(p.amount) FROM public.commission_payouts p
             WHERE p.method = 'despesa_empresa'
           ), 0)
         )
  INTO v_res
  FROM public.despesas d
  WHERE public.can_manage_province(d.provincia_id);

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. CONSULTAR — COLABORADOR
-- -----------------------------------------------------------------------------
-- O que ele pode escolher pagar: despesas por pagar da sua província (ou
-- nacionais, com `provincia_id` nulo), ainda com valor em falta.
CREATE OR REPLACE FUNCTION public.despesas_para_colaborador()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_res  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'created_at') DESC), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
             'id',         d.id,
             'referencia', d.referencia,
             'tipo',       d.tipo,
             'categoria',  d.categoria,
             'descricao',  d.descricao,
             'fornecedor', d.fornecedor,
             'valor',      d.valor,
             'coberto',    public.despesa_coberto(d.id),
             'restante',   GREATEST(d.valor - public.despesa_coberto(d.id), 0),
             'provincia',  pr.nome,
             'created_at', d.created_at
           ) AS linha
    FROM public.despesas d
    LEFT JOIN public.provincias pr ON pr.id = d.provincia_id
    WHERE d.estado = 'pendente'
      AND public.can_see_province(d.provincia_id)
      AND GREATEST(d.valor - public.despesa_coberto(d.id), 0) > 0
  ) t;

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. PEDIR — O LEVANTAMENTO GANHA UM DESTINO
-- -----------------------------------------------------------------------------
-- Assinatura mudou (dois argumentos novos no fim) → DROP antes do CREATE,
-- senão ficam duas versões e a chamada por RPC torna-se ambígua.
DROP FUNCTION IF EXISTS public.solicitar_levantamento(numeric, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.solicitar_levantamento(
  p_valor      numeric,
  p_metodo     text,
  p_dados      jsonb DEFAULT NULL,
  p_notas      text  DEFAULT NULL,
  p_destino    text  DEFAULT 'receber',
  p_despesa_id uuid  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_destino    text := COALESCE(NULLIF(btrim(COALESCE(p_destino, '')), ''), 'receber');
  v_metodo     text := p_metodo;
  v_resumo     jsonb;
  v_disponivel numeric;
  v_dados      jsonb;
  v_prov       uuid;
  v_id         uuid;
  v_ref        text;
  v_abertos    int;
  v_des        public.despesas;
  v_restante   numeric(12,2);
  v_nota       text := NULLIF(btrim(COALESCE(p_notas, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  -- Um pedido de cada vez por colaborador: dois cliques ao mesmo tempo não
  -- podem reservar o mesmo saldo duas vezes.
  PERFORM pg_advisory_xact_lock(hashtext('levantamento:' || v_uid::text));

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas colaboradores com comissões podem levantar' USING ERRCODE = '42501';
  END IF;

  IF v_destino NOT IN ('receber', 'empresa') THEN
    RAISE EXCEPTION 'Destino inválido: use receber ou empresa' USING ERRCODE = '22023';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Indique um valor válido';
  END IF;

  -- ---------------------------------------------------------------- destino
  IF v_destino = 'empresa' THEN
    -- O dinheiro não vai para o colaborador: não há dados de recebimento.
    v_metodo := 'empresa';
    v_dados  := '{}'::jsonb;

    IF p_despesa_id IS NOT NULL THEN
      SELECT * INTO v_des FROM public.despesas d WHERE d.id = p_despesa_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Essa despesa não existe' USING ERRCODE = '22023';
      END IF;
      IF v_des.estado <> 'pendente' THEN
        RAISE EXCEPTION 'Essa despesa já não está por pagar' USING ERRCODE = '23514';
      END IF;
      IF NOT public.can_see_province(v_des.provincia_id) THEN
        RAISE EXCEPTION 'Essa despesa não é da sua província' USING ERRCODE = '42501';
      END IF;

      v_restante := GREATEST(v_des.valor - public.despesa_coberto(p_despesa_id), 0);
      IF p_valor > v_restante THEN
        RAISE EXCEPTION 'Faltam só % Kz nesta despesa', round(v_restante)
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_nota IS NULL THEN
      -- Sem despesa escolhida, a nota é o único registo do destino do dinheiro.
      RAISE EXCEPTION 'Indique em que foi aplicado o dinheiro ou escolha uma despesa'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_metodo NOT IN ('xpress', 'transferencia') THEN
      RAISE EXCEPTION 'Escolha o método de recebimento';
    END IF;
    IF p_despesa_id IS NOT NULL THEN
      RAISE EXCEPTION 'Uma despesa só se paga com destino «empresa»' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_resumo := public.levantamento_resumo(v_uid);

  IF NOT (v_resumo->>'habilitado')::boolean THEN
    RAISE EXCEPTION 'Faltam % vendas confirmadas e pagas para poder levantar',
      (v_resumo->>'vendas_faltam')::int USING ERRCODE = '42501';
  END IF;

  -- ------------------------------------------------ dados de recebimento
  -- Só fazem falta quando o dinheiro vai para o colaborador.
  IF v_destino = 'receber' THEN
    v_dados := NULLIF(p_dados, 'null'::jsonb);
    IF v_dados IS NULL OR jsonb_typeof(v_dados) <> 'object' OR v_dados = '{}'::jsonb THEN
      SELECT CASE WHEN v_metodo = 'xpress' THEN sp.xpress_dados ELSE sp.banco_dados END
        INTO v_dados
      FROM public.seller_profiles sp WHERE sp.id = v_uid;
    END IF;

    IF v_dados IS NULL OR jsonb_typeof(v_dados) <> 'object' OR v_dados = '{}'::jsonb THEN
      RAISE EXCEPTION 'Indique os dados de recebimento';
    END IF;

    -- Validação mínima do destino, para não mandar dinheiro para o vazio.
    IF v_metodo = 'xpress' THEN
      IF COALESCE(btrim(v_dados->>'conta'), '') = ''
         AND COALESCE(btrim(v_dados->>'telefone'), '') = '' THEN
        RAISE EXCEPTION 'Indique a conta ou o telefone XPRESS';
      END IF;
    ELSE
      IF COALESCE(btrim(v_dados->>'titular'), '') = ''
         OR COALESCE(btrim(v_dados->>'banco'), '') = ''
         OR COALESCE(btrim(v_dados->>'conta'), '') = '' THEN
        RAISE EXCEPTION 'Indique o titular, o banco e o número de conta';
      END IF;
    END IF;
  END IF;

  v_disponivel := (v_resumo->>'disponivel')::numeric;

  IF p_valor > v_disponivel THEN
    RAISE EXCEPTION 'O valor pedido (%,00 Kz) é superior ao disponível (% Kz)',
      round(p_valor), round(v_disponivel) USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int INTO v_abertos
  FROM public.levantamentos l
  WHERE l.seller_id = v_uid AND l.estado IN ('pendente', 'aprovado', 'em_processamento');

  IF v_abertos > 0 THEN
    RAISE EXCEPTION 'Já tem um levantamento em curso. Aguarde a decisão da gestão.';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = v_uid;

  v_ref := 'LEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.levantamento_seq')::text, 5, '0');

  INSERT INTO public.levantamentos (
    referencia, seller_id, provincia_id, valor, metodo, dados, notas, despesa_id
  )
  VALUES (
    v_ref, v_uid, v_prov, round(p_valor, 2), v_metodo, v_dados, v_nota, p_despesa_id
  )
  RETURNING id INTO v_id;

  -- Guarda os dados para a próxima vez (o colaborador não os escreve duas vezes).
  IF v_destino = 'receber' THEN
    IF v_metodo = 'xpress' THEN
      UPDATE public.seller_profiles SET xpress_dados = v_dados, updated_at = now() WHERE id = v_uid;
    ELSE
      UPDATE public.seller_profiles SET banco_dados = v_dados, updated_at = now() WHERE id = v_uid;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, 'levantamento_pedido', 'levantamentos', v_id,
          jsonb_build_object('valor', round(p_valor, 2), 'metodo', v_metodo,
                             'destino', v_destino, 'despesa_id', p_despesa_id,
                             'referencia', v_ref));

  RETURN jsonb_build_object(
    'id', v_id,
    'referencia', v_ref,
    'valor', round(p_valor, 2),
    'metodo', v_metodo,
    'destino', v_destino,
    'despesa_id', p_despesa_id,
    'estado', 'pendente',
    'resumo', public.levantamento_resumo(v_uid)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. DECIDIR — MARCAR COMO PAGO FECHA A DESPESA
-- -----------------------------------------------------------------------------
-- A assinatura não muda, mas o corpo sim: quando o pedido tem destino
-- «empresa», o pagamento leva `method='despesa_empresa'` e a despesa é
-- actualizada. Quando as comissões a cobrem por inteiro, fica «paga».
CREATE OR REPLACE FUNCTION public.decidir_levantamento(
  p_id      uuid,
  p_estado  public.levantamento_status,
  p_nota    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_lev      public.levantamentos;
  v_payout   uuid;
  v_ok       boolean := false;
  v_des      public.despesas;
  v_coberto  numeric(12,2);
  v_metodo   text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode decidir levantamentos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lev FROM public.levantamentos l WHERE l.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Levantamento inexistente';
  END IF;

  IF NOT public.can_manage_province(v_lev.provincia_id) THEN
    RAISE EXCEPTION 'Só pode gerir levantamentos da província que gere' USING ERRCODE = '42501';
  END IF;

  -- Transições permitidas. Um pedido pago é final; um rejeitado também.
  v_ok := CASE v_lev.estado
            WHEN 'pendente'         THEN p_estado IN ('aprovado', 'rejeitado')
            WHEN 'aprovado'         THEN p_estado IN ('em_processamento', 'rejeitado')
            WHEN 'em_processamento' THEN p_estado IN ('pago', 'rejeitado')
            ELSE false
          END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Não é possível passar de % para %', v_lev.estado, p_estado;
  END IF;

  IF p_estado = 'rejeitado' AND COALESCE(btrim(COALESCE(p_nota, '')), '') = '' THEN
    RAISE EXCEPTION 'Indique o motivo da rejeição';
  END IF;

  -- Marcar como PAGO é o único passo que mexe no dinheiro. Aprovar não paga
  -- nada: só liberta o pedido para processamento.
  IF p_estado = 'pago' THEN
    -- `empresa` no levantamento → `despesa_empresa` no pagamento. É o mesmo
    -- dinheiro, só com o destino escrito por extenso no livro de pagamentos.
    v_metodo := CASE WHEN v_lev.metodo = 'empresa' THEN 'despesa_empresa' ELSE v_lev.metodo END;

    IF v_lev.despesa_id IS NOT NULL THEN
      SELECT * INTO v_des FROM public.despesas d WHERE d.id = v_lev.despesa_id;
    END IF;

    INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
    VALUES (
      v_lev.seller_id,
      v_lev.provincia_id,
      v_lev.valor,
      v_metodo,
      CASE
        WHEN v_lev.metodo = 'empresa' AND v_des.id IS NOT NULL THEN
          'Levantamento ' || COALESCE(v_lev.referencia, v_lev.id::text) ||
          ' — despesa ' || COALESCE(v_des.referencia, v_des.id::text) ||
          ' (' || v_des.descricao || ')'
        WHEN v_lev.metodo = 'empresa' THEN
          'Levantamento ' || COALESCE(v_lev.referencia, v_lev.id::text) ||
          ' — aplicado em despesa/investimento da empresa'
        ELSE
          'Levantamento ' || COALESCE(v_lev.referencia, v_lev.id::text)
      END,
      auth.uid()
    )
    RETURNING id INTO v_payout;

    -- Fecha as comissões por ordem de antiguidade até cobrir o valor. Uma
    -- comissão maior do que o resto fica pendente e é paga no pedido seguinte.
    WITH pend AS (
      SELECT c.id,
             SUM(c.amount) OVER (ORDER BY c.created_at, c.id) AS acumulado
      FROM public.sale_commissions c
      JOIN public.sales s ON s.id = c.sale_id
      WHERE c.seller_id = v_lev.seller_id
        AND c.status = 'pending'
        AND c.amount > 0
        AND s.status = 'completed'
        AND s.payment_status = 'paid'
    )
    UPDATE public.sale_commissions c
    SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
    FROM pend
    WHERE c.id = pend.id AND pend.acumulado <= v_lev.valor;
  END IF;

  UPDATE public.levantamentos l
  SET estado          = p_estado,
      notas           = COALESCE(NULLIF(btrim(COALESCE(p_nota, '')), ''), l.notas),
      motivo_rejeicao = CASE WHEN p_estado = 'rejeitado' THEN btrim(p_nota) ELSE l.motivo_rejeicao END,
      payout_id       = COALESCE(v_payout, l.payout_id),
      decidido_por    = auth.uid(),
      decidido_em     = COALESCE(l.decidido_em, now()),
      processado_em   = CASE WHEN p_estado = 'em_processamento' THEN now() ELSE l.processado_em END,
      pago_em         = CASE WHEN p_estado = 'pago' THEN now() ELSE l.pago_em END,
      updated_at      = now()
  WHERE l.id = p_id;

  -- Depois do UPDATE, para a conta já incluir este pagamento.
  IF p_estado = 'pago' AND v_lev.despesa_id IS NOT NULL AND v_des.id IS NOT NULL THEN
    v_coberto := public.despesa_coberto(v_lev.despesa_id);

    IF v_coberto >= v_des.valor THEN
      UPDATE public.despesas d
      SET estado = 'paga', pago_em = COALESCE(d.pago_em, now()),
          pago_por = COALESCE(d.pago_por, auth.uid()), updated_at = now()
      WHERE d.id = v_des.id AND d.estado = 'pendente';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'levantamento_' || p_estado::text, 'levantamentos', p_id,
          jsonb_build_object('estado', v_lev.estado),
          jsonb_build_object('estado', p_estado, 'valor', v_lev.valor,
                             'metodo', v_metodo, 'nota', p_nota));

  RETURN jsonb_build_object(
    'id', p_id,
    'estado', p_estado,
    'payout_id', v_payout,
    'resumo', public.levantamento_resumo(v_lev.seller_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. O SALDO PASSA A MOSTRAR O QUE FOI PARA DESPESAS
-- -----------------------------------------------------------------------------
-- `pago` já inclui estes pagamentos (são linhas de `commission_payouts`), por
-- isso `disponivel` estava certo sem mexer. O campo novo é só leitura: quanto
-- do que já saiu foi aplicado em despesas da empresa.
CREATE OR REPLACE FUNCTION public.levantamento_resumo(p_seller uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_minimo     int := 5;
  v_vendas     int;
  v_operacoes  int;
  v_ganho      numeric(12,2);
  v_pendente   numeric(12,2);
  v_pago       numeric(12,2);
  v_reservado  numeric(12,2);
  v_disponivel numeric(12,2);
  v_despesas   numeric(12,2);
  v_cfg        jsonb;
BEGIN
  IF p_seller IS DISTINCT FROM auth.uid() AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sem permissão para ver o saldo de outra pessoa' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO v_cfg FROM public.platform_settings WHERE key = 'levantamento';
  IF v_cfg IS NOT NULL AND jsonb_typeof(v_cfg->'vendas_minimas') = 'number' THEN
    v_minimo := GREATEST((v_cfg->>'vendas_minimas')::int, 0);
  END IF;

  -- Vendas confirmadas e pagas: é o que conta para o desbloqueio.
  -- Cada unidade de produto é uma venda. Uma venda antiga, registada sem linhas
  -- de detalhe, continua a valer 1 — os dados existentes não mudam de leitura.
  SELECT COALESCE(SUM(GREATEST(COALESCE(it.unidades, 0), 1)), 0)::int INTO v_vendas
  FROM public.sales s
  LEFT JOIN LATERAL (
    SELECT SUM(si.quantity)::int AS unidades
    FROM public.sale_items si
    WHERE si.sale_id = s.id
  ) it ON TRUE
  WHERE s.seller_id = p_seller
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  -- Quantas operações (registos de venda) deram origem a essas vendas.
  SELECT COUNT(*)::int INTO v_operacoes
  FROM public.sales s
  WHERE s.seller_id = p_seller
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  SELECT COALESCE(SUM(c.amount), 0) INTO v_ganho
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller
    AND c.status <> 'cancelled'
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  -- Ainda por pagar ao colaborador: vendas por confirmar/pagar, e vendas
  -- canceladas ficam de fora (o gatilho marca-as 'cancelled').
  SELECT COALESCE(SUM(c.amount), 0) INTO v_pendente
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller
    AND c.status <> 'cancelled'
    AND NOT (s.status = 'completed' AND s.payment_status = 'paid');

  SELECT COALESCE(SUM(p.amount), 0) INTO v_pago
  FROM public.commission_payouts p
  WHERE p.seller_id = p_seller;

  -- Fatia desse total que foi para despesas/investimento da empresa.
  SELECT COALESCE(SUM(p.amount), 0) INTO v_despesas
  FROM public.commission_payouts p
  WHERE p.seller_id = p_seller
    AND p.method = 'despesa_empresa';

  SELECT COALESCE(SUM(l.valor), 0) INTO v_reservado
  FROM public.levantamentos l
  WHERE l.seller_id = p_seller
    AND l.estado IN ('pendente', 'aprovado', 'em_processamento');

  v_disponivel := GREATEST(v_ganho - v_pago - v_reservado, 0);

  RETURN jsonb_build_object(
    'seller_id',       p_seller,
    'vendas_pagas',    v_vendas,
    'vendas_registadas', v_operacoes,
    'vendas_minimas',  v_minimo,
    'vendas_faltam',   GREATEST(v_minimo - v_vendas, 0),
    'habilitado',      v_vendas >= v_minimo,
    'comissoes_ganhas',   v_ganho,
    'comissoes_pendentes', v_pendente,
    'total_pago',      v_pago,
    'pago_em_despesas', v_despesas,
    'reservado',       v_reservado,
    'disponivel',      v_disponivel,
    'taxa',            public.taxa_comissao_efetiva(p_seller)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. HISTÓRICO DO COLABORADOR — COM O DESTINO
-- -----------------------------------------------------------------------------
-- A coluna nova muda o tipo de retorno → DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.meus_levantamentos(int);

CREATE OR REPLACE FUNCTION public.meus_levantamentos(p_limite int DEFAULT 50)
RETURNS TABLE (
  id            uuid,
  referencia    text,
  valor         numeric,
  metodo        text,
  estado        public.levantamento_status,
  solicitado_em timestamptz,
  pago_em       timestamptz,
  motivo        text,
  despesa       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT l.id, l.referencia, l.valor, l.metodo, l.estado,
         l.solicitado_em, l.pago_em,
         COALESCE(l.motivo_rejeicao, l.notas),
         -- Referência + descrição da despesa, quando o dinheiro foi para lá.
         CASE
           WHEN l.despesa_id IS NULL THEN NULL
           ELSE COALESCE(d.referencia, 'Despesa') || ' · ' || d.descricao
         END
  FROM public.levantamentos l
  LEFT JOIN public.despesas d ON d.id = l.despesa_id
  WHERE l.seller_id = auth.uid()
  ORDER BY l.solicitado_em DESC
  LIMIT GREATEST(COALESCE(p_limite, 50), 1);
$$;

-- -----------------------------------------------------------------------------
-- 12. PAINEL DA GESTÃO — O PEDIDO MOSTRA A DESPESA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.levantamentos_equipa(p_estado text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver os levantamentos' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'solicitado_em') DESC), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
             'id',            l.id,
             'referencia',    l.referencia,
             'valor',         l.valor,
             'metodo',        l.metodo,
             'estado',        l.estado,
             'dados',         l.dados,
             'notas',         l.notas,
             'motivo',        l.motivo_rejeicao,
             'solicitado_em', l.solicitado_em,
             'pago_em',       l.pago_em,
             'seller_id',     l.seller_id,
             'seller_nome',   p.full_name,
             'seller_ref',    p.referencia,
             'seller_phone',  p.phone,
             'provincia',     pr.nome,
             'despesa_id',    l.despesa_id,
             'despesa_ref',   d.referencia,
             'despesa_desc',  d.descricao
           ) AS linha
    FROM public.levantamentos l
    JOIN public.profiles p   ON p.id  = l.seller_id
    LEFT JOIN public.provincias pr ON pr.id = l.provincia_id
    LEFT JOIN public.despesas d ON d.id = l.despesa_id
    WHERE public.can_manage_province(l.provincia_id)
      AND (p_estado IS NULL OR l.estado::text = p_estado)
  ) t;

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. RLS E ACESSOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.despesas ENABLE ROW LEVEL SECURITY;

-- A gestão lê as despesas da província que gere. O colaborador lê as que estão
-- por pagar e que pode ajudar a pagar — precisa delas para escolher no painel
-- de levantamento. As anuladas e as pagas não lhe dizem respeito.
DROP POLICY IF EXISTS despesas_select ON public.despesas;
CREATE POLICY despesas_select ON public.despesas
  FOR SELECT TO authenticated
  USING (
    (public.is_manager() AND public.can_manage_province(provincia_id))
    OR (
      estado = 'pendente'
      AND public.is_seller()
      AND public.can_see_province(provincia_id)
    )
  );

-- Sem INSERT/UPDATE directo: tudo passa pelas funções acima, que validam
-- província, estado e saldo. Uma escrita directa conseguia marcar uma despesa
-- como paga sem criar o pagamento correspondente.
DROP POLICY IF EXISTS despesas_manager_write ON public.despesas;
CREATE POLICY despesas_manager_write ON public.despesas
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

GRANT SELECT ON public.despesas TO authenticated;

GRANT EXECUTE ON FUNCTION public.despesa_coberto(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.registar_despesa(text, numeric, text, text, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pagar_despesa(uuid, uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_despesa(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.despesas_equipa(text, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.despesas_resumo()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.despesas_para_colaborador()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_levantamento(numeric, text, jsonb, text, text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 14. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
-- Falha alto se as assinaturas não forem as esperadas: um DROP a menos deixa
-- duas versões da mesma função e a chamada por RPC responde PGRST203.
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'solicitar_levantamento';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'solicitar_levantamento tem % versões (esperava 1)', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'meus_levantamentos';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'meus_levantamentos tem % versões (esperava 1)', v_n;
  END IF;
END $$;
