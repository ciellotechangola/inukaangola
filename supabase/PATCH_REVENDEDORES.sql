-- =============================================================================
--  INUKA ANGOLA — PATCH: REVENDEDOR (PREÇO DE GROSSO, PEDIDOS E CANDIDATURAS)
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0026_revendedores.sql (mesmo conteúdo).
--  Requer a 0025 (lojas) já aplicada.
--
--  O QUE RESOLVE
--    Cria o perfil `reseller` — quem compra ao preço de grosso e revende em
--    Angola. Não é colaborador (sem comissão, sem carteira de clientes) nem
--    cliente final (não paga preço de montra).
--
--    · `precos_revenda`: preço de grosso por produto. Sem preço escrito, vale
--      o desconto da empresa (35% por omissão), configurável em
--      `platform_settings` (`revenda_desconto`, `revenda_minimo`).
--    · `revendedores`: ficha aprovada (empresa ou pessoa, NIF, telefone,
--      província, desconto próprio, mínimo de unidades, estado).
--    · `revendedor_candidaturas`: o formulário público de /revendedor.
--    · `revendedor_pedidos` + `revendedor_pedido_itens`: pedidos de grosso com
--      o preço congelado no momento do pedido.
--    · Funções: catálogo de grosso, registo de pedido com mínimo de unidades,
--      resposta da gestão, painel do revendedor e preços por produto.
--
--  Sem este patch, /revendedor não grava candidaturas e /gerente/revendedores
--  fica vazio (o PostgREST responde «Could not find the table»).

-- =============================================================================

-- =============================================================================
--  0026 — REVENDEDOR: COMPRA AO PREÇO DE GROSSO E REVENDE EM ANGOLA
-- =============================================================================
--  O QUE É
--    Um perfil novo — `reseller` — para quem compra em quantidade e revende.
--    Não é colaborador (não ganha comissão, não tem carteira de clientes) e
--    não é cliente final (não paga o preço de montra). Compra ao preço de
--    grosso, a partir de um mínimo de unidades, e trabalha com a gestão da sua
--    província e com a administração nacional.
--
--  O QUE ENTRA
--    1. Papel `reseller` e as competências que lhe pertencem.
--    2. `precos_revenda` — o preço de grosso de cada produto. Quando não está
--       escrito, cai num desconto sobre o preço de montra (configurável em
--       `platform_settings`), que é o «preço perto da África do Sul».
--    3. `revendedores` — a ficha aprovada: empresa ou pessoa, NIF, telefone,
--       província, loja, desconto próprio, mínimo de unidades e estado.
--    4. `revendedor_candidaturas` — o formulário público «Ser revendedor».
--    5. `revendedor_pedidos` + `revendedor_pedido_itens` — as solicitações de
--       grosso, com preço congelado no momento do pedido (o preço de amanhã
--       não reescreve o pedido de ontem).
--    6. Funções: `preco_revendedor`, `revendedor_catalogo`, `minha_revenda`,
--       `registar_pedido_revendedor`, `responder_pedido_revendedor`,
--       `decidir_candidatura_revendedor`, `actualizar_revendedor`.
--    7. RLS: o revendedor só vê o que é dele; o gestor vê a sua província; a
--       administração nacional vê tudo. O preço de grosso **nunca** é legível
--       por um cliente.
--
--  Idempotente. Nada é apagado. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O PAPEL NOVO
-- -----------------------------------------------------------------------------
-- `ADD VALUE` não pode ser usado como valor do enum na mesma transacção em que
-- é criado. Tudo o que está abaixo compara `::text`; quem escreve o papel usa
-- `EXECUTE` (resolvido em tempo de execução, já depois do commit).
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'reseller';

-- -----------------------------------------------------------------------------
-- 2. COMPETÊNCIAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_reseller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role()::text = 'reseller';
$$;

-- -----------------------------------------------------------------------------
-- 3. PREÇO DE GROSSO
-- -----------------------------------------------------------------------------
-- Uma linha por produto, escrita pela gestão. A ausência de linha **não** é
-- erro: significa «aplica o desconto da empresa». `NULL` nunca é zero.
CREATE TABLE IF NOT EXISTS public.precos_revenda (
  product_id  uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  preco       numeric(12,2) NOT NULL CHECK (preco >= 0),
  nota        text,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Os dois números que mandam no grosso. Ficam em `platform_settings` para não
-- haver um valor mágico escondido no código.
INSERT INTO public.platform_settings (key, value)
VALUES
  ('revenda_desconto', '{"value": 0.35}'::jsonb),
  ('revenda_minimo',   '{"value": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.config_revenda(p_chave text, p_fallback numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(ps.value ->> 'value', '')::numeric
     FROM public.platform_settings ps WHERE ps.key = p_chave),
    p_fallback
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. A FICHA DO REVENDEDOR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revendedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo            text NOT NULL DEFAULT 'pessoa' CHECK (tipo IN ('pessoa', 'empresa')),
  nome            text NOT NULL CHECK (length(btrim(nome)) >= 2),
  nif             text,
  telefone        text NOT NULL,
  email           text,
  provincia_id    uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  loja_id         uuid REFERENCES public.lojas(id) ON DELETE SET NULL,
  manager_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  desconto        numeric(5,4) CHECK (desconto IS NULL OR (desconto >= 0 AND desconto <= 0.9)),
  minimo_unidades int NOT NULL DEFAULT 5 CHECK (minimo_unidades >= 1),
  status          text NOT NULL DEFAULT 'activo'
                  CHECK (status IN ('activo', 'suspenso', 'encerrado')),
  nota            text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revendedores_provincia_idx ON public.revendedores (provincia_id);
CREATE INDEX IF NOT EXISTS revendedores_status_idx    ON public.revendedores (status);
CREATE UNIQUE INDEX IF NOT EXISTS revendedores_nif_uidx
  ON public.revendedores (upper(nif)) WHERE nif IS NOT NULL;

-- Agora que a tabela existe, as funções que a leem podem ser criadas. Uma
-- função `LANGUAGE sql` é analisada na criação: se apontasse para uma tabela
-- ainda inexistente, a migração parava aqui.
CREATE OR REPLACE FUNCTION public.meu_revendedor()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT r.id
  FROM public.revendedores r
  WHERE r.user_id = auth.uid()
  ORDER BY r.created_at
  LIMIT 1;
$$;

/** Revendedor activo? É esta a condição para comprar ao preço de grosso. */
CREATE OR REPLACE FUNCTION public.revendedor_activo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.revendedores r
    WHERE r.user_id = auth.uid() AND r.status = 'activo'
  );
$$;

-- -----------------------------------------------------------------------------
-- 5. CANDIDATURAS PÚBLICAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revendedor_candidaturas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          text NOT NULL DEFAULT 'pessoa' CHECK (tipo IN ('pessoa', 'empresa')),
  nome          text NOT NULL CHECK (length(btrim(nome)) >= 2),
  telefone      text NOT NULL,
  email         text,
  nif           text,
  provincia_id  uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  mensagem      text,
  status        text NOT NULL DEFAULT 'novo'
                CHECK (status IN ('novo', 'em_contacto', 'aprovado', 'recusado')),
  origem        text,
  revendedor_id uuid REFERENCES public.revendedores(id) ON DELETE SET NULL,
  handled_at    timestamptz,
  handled_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revendedor_candidaturas_provincia_idx
  ON public.revendedor_candidaturas (provincia_id);
CREATE INDEX IF NOT EXISTS revendedor_candidaturas_status_idx
  ON public.revendedor_candidaturas (status);
CREATE INDEX IF NOT EXISTS revendedor_candidaturas_telefone_idx
  ON public.revendedor_candidaturas (telefone);

-- -----------------------------------------------------------------------------
-- 6. PEDIDOS DE GROSSO
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.revendedor_pedido_numero;

CREATE TABLE IF NOT EXISTS public.revendedor_pedidos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          text UNIQUE NOT NULL,
  revendedor_id   uuid NOT NULL REFERENCES public.revendedores(id) ON DELETE CASCADE,
  provincia_id    uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  loja_id         uuid REFERENCES public.lojas(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'novo'
                  CHECK (status IN ('novo', 'em_analise', 'cotado', 'aprovado',
                                    'enviado', 'entregue', 'cancelado')),
  mensagem        text,
  total_unidades  int NOT NULL DEFAULT 0 CHECK (total_unidades >= 0),
  valor_estimado  numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_estimado >= 0),
  resposta        text,
  respondido_por  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  respondido_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revendedor_pedidos_revendedor_idx
  ON public.revendedor_pedidos (revendedor_id);
CREATE INDEX IF NOT EXISTS revendedor_pedidos_provincia_idx
  ON public.revendedor_pedidos (provincia_id);
CREATE INDEX IF NOT EXISTS revendedor_pedidos_status_idx
  ON public.revendedor_pedidos (status);

CREATE TABLE IF NOT EXISTS public.revendedor_pedido_itens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES public.revendedor_pedidos(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES public.products(id) ON DELETE SET NULL,
  -- Nome e preço ficam congelados: o catálogo muda, o pedido de ontem não.
  nome_produto    text NOT NULL,
  sku             text,
  quantidade      int NOT NULL CHECK (quantidade > 0),
  preco_unitario  numeric(12,2) NOT NULL CHECK (preco_unitario >= 0),
  subtotal        numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revendedor_pedido_itens_pedido_idx
  ON public.revendedor_pedido_itens (pedido_id);

-- -----------------------------------------------------------------------------
-- 7. CATÁLOGO DE GROSSO
-- -----------------------------------------------------------------------------
-- Preço de uma unidade para revenda.
--
--   1. Se a gestão escreveu um preço de grosso para o produto, é esse.
--   2. Senão, desconto sobre o preço de montra: o do revendedor quando tem um
--      próprio; o da empresa quando não tem.
--
-- Nunca desce abaixo de 0 e nunca passa dos 90% de desconto — um erro de
-- digitação (ex.: 3,5 em vez de 0,35) não pode dar produto de graça.
CREATE OR REPLACE FUNCTION public.preco_revendedor(
  p_produto     uuid,
  p_revendedor  uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT pr.preco FROM public.precos_revenda pr WHERE pr.product_id = p_produto),
    round(
      prod.official_price * (
        1 - LEAST(0.9, GREATEST(0,
          COALESCE(
            (SELECT r.desconto FROM public.revendedores r WHERE r.id = p_revendedor),
            public.config_revenda('revenda_desconto', 0.35)
          )
        ))
      ),
      2
    )
  )
  FROM public.products prod
  WHERE prod.id = p_produto;
$$;

-- Devolve uma linha por produto activo, com o preço de montra ao lado do preço
-- de grosso — o revendedor tem de ver a margem, não só o número final.
--
-- `stock` é o disponível nas lojas da província do revendedor. `NULL` quer
-- dizer «sem inventário registado» (≠ 0): mostra-se «sob consulta».
CREATE OR REPLACE FUNCTION public.revendedor_catalogo(p_provincia uuid DEFAULT NULL)
RETURNS TABLE (
  product_id     uuid,
  nome           text,
  sku            text,
  categoria      text,
  imagem         text,
  preco_loja     numeric,
  preco_grosso   numeric,
  desconto_pct   numeric,
  minimo         int,
  stock          int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev     uuid := public.meu_revendedor();
  v_prov    uuid := p_provincia;
  v_minimo  int;
BEGIN
  IF NOT (public.is_reseller() OR public.is_manager()) THEN
    RAISE EXCEPTION 'Catálogo de grosso reservado a revendedores.'
      USING ERRCODE = '42501';
  END IF;

  IF v_prov IS NULL THEN
    SELECT COALESCE(r.provincia_id, public.my_province()) INTO v_prov
    FROM public.revendedores r WHERE r.id = v_rev;
    v_prov := COALESCE(v_prov, p_provincia);
  END IF;

  SELECT COALESCE(r.minimo_unidades,
                  public.config_revenda('revenda_minimo', 5)::int)
  INTO v_minimo
  FROM (SELECT 1) x
  LEFT JOIN public.revendedores r ON r.id = v_rev;

  RETURN QUERY
  SELECT p.id,
         p.name,
         p.sku,
         c.name,
         (SELECT pi.url FROM public.product_images pi
          WHERE pi.product_id = p.id AND pi.url IS NOT NULL
          ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1),
         COALESCE(p.promotional_price, p.official_price)::numeric,
         public.preco_revendedor(p.id, v_rev),
         round(
           100 * (1 - public.preco_revendedor(p.id, v_rev)
                      / NULLIF(COALESCE(p.promotional_price, p.official_price), 0)),
           1
         ),
         v_minimo,
         (SELECT CASE WHEN count(*) = 0 THEN NULL
                      ELSE GREATEST(0, sum(i.quantity - i.reserved_quantity))::int
                 END
          FROM public.inventory i
          WHERE i.product_id = p.id
            AND (v_prov IS NULL OR i.provincia_id = v_prov))
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.is_active
  ORDER BY c.name NULLS LAST, p.name;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. REGISTAR UM PEDIDO
-- -----------------------------------------------------------------------------
-- O preço é calculado **aqui**, nunca vem do browser. O mínimo de unidades é
-- validado por linha — pedir 3 de um produto que exige 5 é recusado antes de
-- existir pedido.
CREATE OR REPLACE FUNCTION public.registar_pedido_revendedor(
  p_itens    jsonb,
  p_mensagem text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev        public.revendedores;
  v_item       jsonb;
  v_prod       uuid;
  v_qtd        int;
  v_preco      numeric;
  v_nome       text;
  v_sku        text;
  v_pedido     uuid;
  v_numero     text;
  v_total_u    int := 0;
  v_total_v    numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rev
  FROM public.revendedores r
  WHERE r.user_id = auth.uid() AND r.status = 'activo';

  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'Só revendedores activos podem fazer pedidos.'
      USING ERRCODE = '42501';
  END IF;

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O pedido está vazio.';
  END IF;

  v_numero := 'RV-' || to_char(now(), 'YYYY') || '-' ||
              lpad(nextval('public.revendedor_pedido_numero')::text, 4, '0');

  INSERT INTO public.revendedor_pedidos
    (numero, revendedor_id, provincia_id, loja_id, mensagem)
  VALUES
    (v_numero, v_rev.id, v_rev.provincia_id,
     COALESCE(v_rev.loja_id, public.loja_da_provincia(v_rev.provincia_id)),
     NULLIF(btrim(COALESCE(p_mensagem, '')), ''))
  RETURNING id INTO v_pedido;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_prod := NULLIF(v_item ->> 'product_id', '')::uuid;
    v_qtd  := COALESCE(NULLIF(v_item ->> 'quantidade', '')::int, 0);

    IF v_prod IS NULL THEN
      RAISE EXCEPTION 'Há uma linha sem produto.';
    END IF;

    IF v_qtd < v_rev.minimo_unidades THEN
      RAISE EXCEPTION 'Cada produto exige pelo menos % unidades.',
        v_rev.minimo_unidades;
    END IF;

    SELECT p.name, p.sku INTO v_nome, v_sku
    FROM public.products p
    WHERE p.id = v_prod AND p.is_active;

    IF v_nome IS NULL THEN
      RAISE EXCEPTION 'Há um produto indisponível no pedido.';
    END IF;

    v_preco := public.preco_revendedor(v_prod, v_rev.id);

    INSERT INTO public.revendedor_pedido_itens
      (pedido_id, product_id, nome_produto, sku, quantidade, preco_unitario, subtotal)
    VALUES
      (v_pedido, v_prod, v_nome, v_sku, v_qtd, v_preco, round(v_preco * v_qtd, 2));

    v_total_u := v_total_u + v_qtd;
    v_total_v := v_total_v + round(v_preco * v_qtd, 2);
  END LOOP;

  UPDATE public.revendedor_pedidos
  SET total_unidades = v_total_u,
      valor_estimado = v_total_v,
      updated_at = now()
  WHERE id = v_pedido;

  RETURN jsonb_build_object(
    'id', v_pedido,
    'numero', v_numero,
    'total_unidades', v_total_u,
    'valor_estimado', v_total_v
  );
END;
$$;

-- A gestão responde: marca o estado e deixa uma nota ao revendedor.
CREATE OR REPLACE FUNCTION public.responder_pedido_revendedor(
  p_pedido   uuid,
  p_status   text,
  p_resposta text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ped public.revendedor_pedidos;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão responde a pedidos' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('em_analise', 'cotado', 'aprovado', 'enviado',
                      'entregue', 'cancelado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  SELECT * INTO v_ped FROM public.revendedor_pedidos WHERE id = p_pedido;
  IF v_ped.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF NOT public.can_manage_province(v_ped.provincia_id) THEN
    RAISE EXCEPTION 'Este pedido não é da província que gere.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.revendedor_pedidos
  SET status = p_status,
      resposta = COALESCE(NULLIF(btrim(COALESCE(p_resposta, '')), ''), resposta),
      respondido_por = auth.uid(),
      respondido_at = now(),
      updated_at = now()
  WHERE id = p_pedido;

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. PAINEL DO REVENDEDOR
-- -----------------------------------------------------------------------------
-- Tudo o que o ecrã de entrada precisa numa só chamada: a ficha, os números e
-- as duas pessoas com quem pode falar (gerente da província e administração
-- nacional).
CREATE OR REPLACE FUNCTION public.minha_revenda()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev      public.revendedores;
  v_prov     text;
  v_gestor   uuid;
  v_gestor_n text;
  v_nac      uuid;
  v_nac_n    text;
BEGIN
  SELECT * INTO v_rev FROM public.revendedores r WHERE r.user_id = auth.uid();
  IF v_rev.id IS NULL THEN
    RETURN jsonb_build_object('revendedor', NULL);
  END IF;

  SELECT pr.nome INTO v_prov
  FROM public.provincias pr WHERE pr.id = v_rev.provincia_id;

  -- Gerente da província (o que acompanha este revendedor, se existir). A
  -- administração nacional fica de fora desta escolha mesmo quando está
  -- sediada na província: quem responde ao revendedor é o gerente local.
  SELECT p.id, p.full_name INTO v_gestor, v_gestor_n
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role
    AND p.is_active
    AND (
      p.id = v_rev.manager_id
      OR (v_rev.manager_id IS NULL
          AND p.provincia_id = v_rev.provincia_id
          AND NOT p.is_national_admin)
    )
  ORDER BY (p.id = v_rev.manager_id) DESC, p.created_at
  LIMIT 1;

  -- Província sem gerente próprio: aceita-se qualquer gestor da província,
  -- para o revendedor não ficar sem ninguém com quem falar.
  IF v_gestor IS NULL THEN
    SELECT p.id, p.full_name INTO v_gestor, v_gestor_n
    FROM public.profiles p
    WHERE p.role = 'manager'::public.user_role
      AND p.is_active
      AND p.provincia_id = v_rev.provincia_id
    ORDER BY p.created_at
    LIMIT 1;
  END IF;

  -- Administração nacional: sem província ou marcada como nacional.
  SELECT p.id, p.full_name INTO v_nac, v_nac_n
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role
    AND p.is_active
    AND (p.is_national_admin OR p.provincia_id IS NULL)
    AND p.id <> COALESCE(v_gestor, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY p.created_at
  LIMIT 1;

  RETURN jsonb_build_object(
    'revendedor', jsonb_build_object(
      'id', v_rev.id,
      'tipo', v_rev.tipo,
      'nome', v_rev.nome,
      'nif', v_rev.nif,
      'telefone', v_rev.telefone,
      'email', v_rev.email,
      'provincia_id', v_rev.provincia_id,
      'provincia', v_prov,
      'loja_id', v_rev.loja_id,
      'desconto', COALESCE(v_rev.desconto,
                           public.config_revenda('revenda_desconto', 0.35)),
      'minimo_unidades', v_rev.minimo_unidades,
      'status', v_rev.status,
      'nota', v_rev.nota
    ),
    'stats', jsonb_build_object(
      'pedidos', (SELECT count(*) FROM public.revendedor_pedidos p
                  WHERE p.revendedor_id = v_rev.id),
      'em_curso', (SELECT count(*) FROM public.revendedor_pedidos p
                   WHERE p.revendedor_id = v_rev.id
                     AND p.status IN ('novo','em_analise','cotado','aprovado')),
      'entregues', (SELECT count(*) FROM public.revendedor_pedidos p
                    WHERE p.revendedor_id = v_rev.id AND p.status = 'entregue'),
      'valor_total', (SELECT COALESCE(sum(p.valor_estimado), 0)
                      FROM public.revendedor_pedidos p
                      WHERE p.revendedor_id = v_rev.id AND p.status <> 'cancelado'),
      'valor_em_curso', (SELECT COALESCE(sum(p.valor_estimado), 0)
                         FROM public.revendedor_pedidos p
                         WHERE p.revendedor_id = v_rev.id
                           AND p.status IN ('novo','em_analise','cotado','aprovado'))
    ),
    'gestores', jsonb_build_object(
      'provincia', CASE WHEN v_gestor IS NULL THEN NULL
                        ELSE jsonb_build_object('id', v_gestor, 'nome', v_gestor_n) END,
      'nacional',  CASE WHEN v_nac IS NULL THEN NULL
                        ELSE jsonb_build_object('id', v_nac, 'nome', v_nac_n) END
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. GESTÃO DE CANDIDATURAS E FICHAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decidir_candidatura_revendedor(
  p_id     uuid,
  p_estado text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_cand public.revendedor_candidaturas;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão trata candidaturas' USING ERRCODE = '42501';
  END IF;

  IF p_estado NOT IN ('em_contacto', 'aprovado', 'recusado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;

  SELECT * INTO v_cand FROM public.revendedor_candidaturas WHERE id = p_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidatura não encontrada';
  END IF;

  IF NOT public.can_manage_province(v_cand.provincia_id) THEN
    RAISE EXCEPTION 'Esta candidatura não é da província que gere.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.revendedor_candidaturas
  SET status = p_estado,
      handled_at = now(),
      handled_by = auth.uid()
  WHERE id = p_id;
END;
$$;

-- Editar o que a gestão controla numa ficha já criada. `NULL` = não mexer;
-- `p_limpar_desconto` devolve o revendedor ao desconto da empresa.
CREATE OR REPLACE FUNCTION public.actualizar_revendedor(
  p_id              uuid,
  p_desconto        numeric DEFAULT NULL,
  p_minimo          int     DEFAULT NULL,
  p_status          text    DEFAULT NULL,
  p_nota            text    DEFAULT NULL,
  p_limpar_desconto boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev public.revendedores;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão altera fichas de revendedor' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rev FROM public.revendedores WHERE id = p_id;
  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'Revendedor não encontrado';
  END IF;

  IF NOT public.can_manage_province(v_rev.provincia_id) THEN
    RAISE EXCEPTION 'Este revendedor não é da província que gere.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('activo', 'suspenso', 'encerrado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  UPDATE public.revendedores
  SET desconto = CASE
        WHEN p_limpar_desconto THEN NULL
        WHEN p_desconto IS NULL THEN desconto
        ELSE LEAST(0.9, GREATEST(0, p_desconto))
      END,
      minimo_unidades = COALESCE(p_minimo, minimo_unidades),
      status = COALESCE(p_status, status),
      nota = COALESCE(NULLIF(btrim(COALESCE(p_nota, '')), ''), nota),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Definir o preço de grosso de um produto (gestão).
CREATE OR REPLACE FUNCTION public.definir_preco_revenda(
  p_produto uuid,
  p_preco   numeric,
  p_nota    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão define preços de grosso' USING ERRCODE = '42501';
  END IF;

  IF p_preco IS NULL OR p_preco < 0 THEN
    RAISE EXCEPTION 'Preço inválido';
  END IF;

  INSERT INTO public.precos_revenda (product_id, preco, nota, updated_by, updated_at)
  VALUES (p_produto, p_preco, NULLIF(btrim(COALESCE(p_nota, '')), ''), auth.uid(), now())
  ON CONFLICT (product_id) DO UPDATE
  SET preco = EXCLUDED.preco,
      nota = COALESCE(EXCLUDED.nota, public.precos_revenda.nota),
      updated_by = EXCLUDED.updated_by,
      updated_at = now();
END;
$$;

-- Voltar ao desconto da empresa num produto.
CREATE OR REPLACE FUNCTION public.limpar_preco_revenda(p_produto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão define preços de grosso' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.precos_revenda WHERE product_id = p_produto;
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.precos_revenda          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revendedores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revendedor_candidaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revendedor_pedidos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revendedor_pedido_itens ENABLE ROW LEVEL SECURITY;

-- Preços de grosso: só revendedores e gestão. Um cliente nunca lê isto.
DROP POLICY IF EXISTS precos_revenda_read ON public.precos_revenda;
CREATE POLICY precos_revenda_read ON public.precos_revenda
  FOR SELECT TO authenticated
  USING (public.is_reseller() OR public.is_manager());

DROP POLICY IF EXISTS precos_revenda_manager_write ON public.precos_revenda;
CREATE POLICY precos_revenda_manager_write ON public.precos_revenda
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- Fichas: cada revendedor vê a sua; a gestão vê a província que acompanha.
DROP POLICY IF EXISTS revendedores_select ON public.revendedores;
CREATE POLICY revendedores_select ON public.revendedores
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

DROP POLICY IF EXISTS revendedores_manager_write ON public.revendedores;
CREATE POLICY revendedores_manager_write ON public.revendedores
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- Candidaturas: a gestão lê e trata. A escrita pública entra pela API, com
-- `service_role`, que não passa por estas políticas.
DROP POLICY IF EXISTS revendedor_candidaturas_select ON public.revendedor_candidaturas;
CREATE POLICY revendedor_candidaturas_select ON public.revendedor_candidaturas
  FOR SELECT TO authenticated
  USING (public.is_manager() AND public.can_see_province(provincia_id));

DROP POLICY IF EXISTS revendedor_candidaturas_update ON public.revendedor_candidaturas;
CREATE POLICY revendedor_candidaturas_update ON public.revendedor_candidaturas
  FOR UPDATE TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- Pedidos: o revendedor vê os seus; a gestão vê os da sua província.
DROP POLICY IF EXISTS revendedor_pedidos_select ON public.revendedor_pedidos;
CREATE POLICY revendedor_pedidos_select ON public.revendedor_pedidos
  FOR SELECT TO authenticated
  USING (
    revendedor_id IN (
      SELECT r.id FROM public.revendedores r WHERE r.user_id = auth.uid()
    )
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

DROP POLICY IF EXISTS revendedor_pedidos_update ON public.revendedor_pedidos;
CREATE POLICY revendedor_pedidos_update ON public.revendedor_pedidos
  FOR UPDATE TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

DROP POLICY IF EXISTS revendedor_pedido_itens_select ON public.revendedor_pedido_itens;
CREATE POLICY revendedor_pedido_itens_select ON public.revendedor_pedido_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.revendedor_pedidos p
      JOIN public.revendedores r ON r.id = p.revendedor_id
      WHERE p.id = revendedor_pedido_itens.pedido_id
        AND (
          r.user_id = auth.uid()
          OR (public.is_manager() AND public.can_see_province(p.provincia_id))
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 12. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_reseller()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_revendedor()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.revendedor_activo()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.config_revenda(text, numeric)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.preco_revendedor(uuid, uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.revendedor_catalogo(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.registar_pedido_revendedor(jsonb, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.responder_pedido_revendedor(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_revenda()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.decidir_candidatura_revendedor(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_revendedor(uuid, numeric, int, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_preco_revenda(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_preco_revenda(uuid)               TO authenticated;
