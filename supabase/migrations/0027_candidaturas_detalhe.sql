-- =============================================================================
-- 0027 — CANDIDATURA A REVENDEDOR: DETALHE, RESPOSTA E ANTI-DUPLICADO
-- =============================================================================
-- O formulário público passou a ter dois percursos — INDIVIDUAL (pessoa
-- singular) e EMPRESARIAL (empresa) — com campos próprios. O tipo já existia
-- (`pessoa` / `empresa`); o que faltava eram os campos que só fazem sentido
-- numa empresa e a resposta registada pela gestão.
--
-- O que entra:
--   1. `area_atuacao`    — em que ramo a empresa trabalha (opcional)
--   2. `representante`   — nome do proprietário / representante (opcional)
--   3. `resposta`        — o que a gestão escreveu ao candidato (opcional)
--   4. índice parcial para travar candidaturas repetidas do mesmo número
--   5. `decidir_candidatura_revendedor` passa a aceitar a resposta
--
-- Nada aqui apaga dados: só acrescenta colunas e substitui uma função por uma
-- versão compatível (os dois argumentos antigos continuam a funcionar).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CAMPOS NOVOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.revendedor_candidaturas
  ADD COLUMN IF NOT EXISTS area_atuacao  text,
  ADD COLUMN IF NOT EXISTS representante text,
  ADD COLUMN IF NOT EXISTS resposta      text;

COMMENT ON COLUMN public.revendedor_candidaturas.area_atuacao IS
  'Ramo de actividade da empresa candidata (opcional).';
COMMENT ON COLUMN public.revendedor_candidaturas.representante IS
  'Proprietário ou representante legal da empresa candidata (opcional).';
COMMENT ON COLUMN public.revendedor_candidaturas.resposta IS
  'Resposta/nota registada pela gestão ao tratar a candidatura.';

-- Um número não pode ter duas candidaturas em aberto ao mesmo tempo. O índice
-- parcial serve à verificação da API (que corre com `service_role`) e impede
-- que um clique repetido ou um segundo envio minutos depois criem duas linhas.
CREATE INDEX IF NOT EXISTS revendedor_candidaturas_abertas_idx
  ON public.revendedor_candidaturas (telefone)
  WHERE status IN ('novo', 'em_contacto');

-- -----------------------------------------------------------------------------
-- 2. TRATAR A CANDIDATURA (ESTADO + RESPOSTA)
-- -----------------------------------------------------------------------------
-- A versão de 0026 só mudava o estado. A gestão precisa de deixar escrito o
-- que disse ao candidato — sem isso, «em contacto» não diz nada a quem pega no
-- processo duas semanas depois.
--
-- A assinatura antiga é removida e recriada com `p_resposta` por omissão, para
-- não ficarem duas funções iguais com aridades diferentes (chamadas de dois
-- argumentos tornam-se ambíguas na API).
DROP FUNCTION IF EXISTS public.decidir_candidatura_revendedor(uuid, text);

CREATE OR REPLACE FUNCTION public.decidir_candidatura_revendedor(
  p_id       uuid,
  p_estado   text,
  p_resposta text DEFAULT NULL
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

  IF p_estado NOT IN ('novo', 'em_contacto', 'aprovado', 'recusado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;

  SELECT * INTO v_cand FROM public.revendedor_candidaturas WHERE id = p_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidatura não encontrada';
  END IF;

  -- `can_manage_province(NULL)` é falso para gestor provincial e verdadeiro
  -- para a administração nacional: uma candidatura sem província só o gestor
  -- máximo a pode tratar, porque não há província a que pertença.
  IF NOT public.can_manage_province(v_cand.provincia_id) THEN
    RAISE EXCEPTION 'Esta candidatura não é da província que gere.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.revendedor_candidaturas
  SET status = p_estado,
      resposta = CASE
                   WHEN p_resposta IS NULL THEN resposta
                   WHEN btrim(p_resposta) = '' THEN NULL
                   ELSE left(btrim(p_resposta), 1000)
                 END,
      handled_at = now(),
      handled_by = auth.uid()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decidir_candidatura_revendedor(uuid, text, text) TO authenticated;
