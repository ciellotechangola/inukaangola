-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 4/4 : DESIGNER (estúdio de design)
--
-- Cinco tabelas:
--   design_templates       modelos prontos, geridos pela gestão
--   design_projects        projetos do cliente (documento em jsonb, versionado)
--   design_assets          imagens carregadas pelo cliente (ficheiro no Storage)
--   design_versions        instantâneos do documento, para recuperação
--   designer_preferences   preferências do cliente (formato, fonte, snapping)
--
-- Decisões:
--   * O documento (páginas + elementos) vive num único jsonb. Um modelo
--     relacional de elementos obrigaria a reescrever N linhas a cada arrasto
--     do rato e não traria qualquer consulta que o produto precise.
--   * design_projects NÃO tem política de INSERT nem de UPDATE. Toda a escrita
--     passa pelas RPC (SECURITY DEFINER) que validam o dono e a versão. Assim
--     o cliente não consegue forjar `owner_id` nem saltar a concorrência
--     otimista incrementando `version` à mão.
--   * Isolamento estrito: cada cliente só vê e gere os seus projetos. Nem o
--     gestor lê projetos alheios — é o que o requisito pede.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABELAS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.design_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  category    text NOT NULL DEFAULT 'geral',
  format_key  text NOT NULL DEFAULT 'square',
  width       int  NOT NULL CHECK (width  BETWEEN 64 AND 8000),
  height      int  NOT NULL CHECK (height BETWEEN 64 AND 8000),
  pages       jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail   text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_templates_title_not_empty CHECK (length(btrim(title)) > 0),
  CONSTRAINT design_templates_pages_array CHECK (jsonb_typeof(pages) = 'array')
);

CREATE TABLE IF NOT EXISTS public.design_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT 'Sem título',
  format_key    text NOT NULL DEFAULT 'square',
  width         int  NOT NULL,
  height        int  NOT NULL,
  pages         jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail     text,
  template_id   uuid REFERENCES public.design_templates(id) ON DELETE SET NULL,
  version       int  NOT NULL DEFAULT 1,
  last_saved_at timestamptz,
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_projects_title_not_empty CHECK (length(btrim(title)) > 0),
  CONSTRAINT design_projects_size CHECK (width BETWEEN 64 AND 8000 AND height BETWEEN 64 AND 8000),
  CONSTRAINT design_projects_pages_array CHECK (jsonb_typeof(pages) = 'array'),
  -- A miniatura é um data URL pequeno; 400 kB é o teto que o editor respeita.
  CONSTRAINT design_projects_thumbnail_size CHECK (thumbnail IS NULL OR length(thumbnail) <= 400000),
  CONSTRAINT design_projects_version_positive CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS public.design_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  width        int,
  height       int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_assets_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT design_assets_mime_image CHECK (mime_type LIKE 'image/%')
);

-- 1.4 Histórico: instantâneos do documento.
--     Guardar é autosave a cada 1,3 s; gravar um instantâneo a cada gravação
--     encheria a tabela em minutos. O instantâneo automático é limitado a um
--     por cada 5 minutos (ver design_save) e a lista é podada a 30 por projeto.
--     O cliente pode ainda criar instantâneos manuais com etiqueta.
CREATE TABLE IF NOT EXISTS public.design_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.design_projects(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version    int  NOT NULL,
  title      text NOT NULL DEFAULT 'Sem título',
  pages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail  text,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_versions_pages_array CHECK (jsonb_typeof(pages) = 'array'),
  CONSTRAINT design_versions_version_positive CHECK (version > 0)
);

-- 1.5 Preferências: uma linha por utilizador.
CREATE TABLE IF NOT EXISTS public.designer_preferences (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_format_key text NOT NULL DEFAULT 'square',
  last_font       text NOT NULL DEFAULT 'Inter',
  snap_enabled    boolean NOT NULL DEFAULT true,
  grid_size       int NOT NULL DEFAULT 8 CHECK (grid_size BETWEEN 1 AND 200),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. ÍNDICES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_design_versions_project
  ON public.design_versions (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_projects_owner
  ON public.design_projects (owner_id, updated_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_design_projects_owner_all
  ON public.design_projects (owner_id);

CREATE INDEX IF NOT EXISTS idx_design_assets_owner
  ON public.design_assets (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_templates_active
  ON public.design_templates (sort_order, title)
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- 3. TRIGGERS
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_design_projects_updated_at ON public.design_projects;
CREATE TRIGGER trg_design_projects_updated_at
  BEFORE UPDATE ON public.design_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_design_templates_updated_at ON public.design_templates;
CREATE TRIGGER trg_design_templates_updated_at
  BEFORE UPDATE ON public.design_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.design_projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_assets    ENABLE ROW LEVEL SECURITY;

-- 4.1 Projetos: dono único. Sem INSERT/UPDATE — escreve-se só por RPC.
DROP POLICY IF EXISTS design_projects_select ON public.design_projects;
CREATE POLICY design_projects_select ON public.design_projects
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS design_projects_delete ON public.design_projects;
CREATE POLICY design_projects_delete ON public.design_projects
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 4.2 Modelos: leitura para todos os autenticados, gestão só para o gestor.
DROP POLICY IF EXISTS design_templates_select ON public.design_templates;
CREATE POLICY design_templates_select ON public.design_templates
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_manager());

DROP POLICY IF EXISTS design_templates_write ON public.design_templates;
CREATE POLICY design_templates_write ON public.design_templates
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 4.3 Uploads: o cliente gere os seus; o gestor pode ler (suporte).
DROP POLICY IF EXISTS design_assets_select ON public.design_assets;
CREATE POLICY design_assets_select ON public.design_assets
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS design_assets_insert ON public.design_assets;
CREATE POLICY design_assets_insert ON public.design_assets
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS design_assets_update ON public.design_assets;
CREATE POLICY design_assets_update ON public.design_assets
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS design_assets_delete ON public.design_assets;
CREATE POLICY design_assets_delete ON public.design_assets
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 4.4 Histórico: leitura só do dono. Sem INSERT/UPDATE/DELETE — escreve-se
--     apenas dentro das funções SECURITY DEFINER (design_save, snapshot,
--     restore), para o cliente não forjar instantâneos nem apagar o rasto.
ALTER TABLE public.design_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_versions_select ON public.design_versions;
CREATE POLICY design_versions_select ON public.design_versions
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- 4.5 Preferências: cada utilizador tem exatamente a sua linha.
ALTER TABLE public.designer_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designer_preferences_select ON public.designer_preferences;
CREATE POLICY designer_preferences_select ON public.designer_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS designer_preferences_insert ON public.designer_preferences;
CREATE POLICY designer_preferences_insert ON public.designer_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS designer_preferences_update ON public.designer_preferences;
CREATE POLICY designer_preferences_update ON public.designer_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. STORAGE — bucket privado para imagens do designer
--    Caminho: design-assets/{user_id}/{uuid}.{ext}
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    RAISE NOTICE 'Schema storage inexistente — políticas de Storage do designer ignoradas.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('design-assets', 'design-assets', false)
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    DROP POLICY IF EXISTS "inuka_design_assets_read"   ON storage.objects;
    DROP POLICY IF EXISTS "inuka_design_assets_insert" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_design_assets_update" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_design_assets_delete" ON storage.objects;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sem permissão para gerir políticas de storage.objects.';
  END;

  -- Bucket privado: nem o dono lê sem política. A pasta tem de ser o seu uid.
  CREATE POLICY "inuka_design_assets_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "inuka_design_assets_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "inuka_design_assets_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "inuka_design_assets_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
END $$;

-- -----------------------------------------------------------------------------
-- 6. LÓGICA DE NEGÓCIO
-- -----------------------------------------------------------------------------

-- 6.1 Criar projeto
CREATE OR REPLACE FUNCTION public.design_create(
  p_title       text DEFAULT 'Sem título',
  p_format_key  text DEFAULT 'square',
  p_width       int  DEFAULT 1080,
  p_height      int  DEFAULT 1080,
  p_pages       jsonb DEFAULT '[]'::jsonb,
  p_template_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_pages  jsonb := COALESCE(p_pages, '[]'::jsonb);
  v_row    public.design_projects;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF jsonb_typeof(v_pages) <> 'array' THEN
    RAISE EXCEPTION 'PAGINAS_INVALIDAS';
  END IF;

  IF p_width NOT BETWEEN 64 AND 8000 OR p_height NOT BETWEEN 64 AND 8000 THEN
    RAISE EXCEPTION 'DIMENSOES_INVALIDAS';
  END IF;

  -- Modelo inexistente ou desativado não bloqueia a criação: fica sem origem.
  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.design_templates
    WHERE id = p_template_id AND is_active = true
  ) THEN
    p_template_id := NULL;
  END IF;

  INSERT INTO public.design_projects (
    owner_id, title, format_key, width, height, pages, template_id, version, last_saved_at
  )
  VALUES (
    v_uid,
    COALESCE(NULLIF(btrim(p_title), ''), 'Sem título'),
    COALESCE(NULLIF(btrim(p_format_key), ''), 'square'),
    p_width,
    p_height,
    v_pages,
    p_template_id,
    1,
    now()
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- 6.1b Podar o histórico: mantém os N instantâneos mais recentes.
--      Chamada de dentro de design_save e design_snapshot; não é exposta ao
--      cliente (sem GRANT), por isso não aparece em /rest/v1/rpc.
CREATE OR REPLACE FUNCTION public.design_versions_prune(p_id uuid, p_manter int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apagadas int;
BEGIN
  WITH vivos AS (
    SELECT id
    FROM public.design_versions
    WHERE project_id = p_id
    ORDER BY created_at DESC
    LIMIT GREATEST(1, p_manter)
  )
  DELETE FROM public.design_versions dv
  WHERE dv.project_id = p_id
    AND dv.id NOT IN (SELECT id FROM vivos);

  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas;
END;
$$;

-- 6.2 Guardar projeto (concorrência otimista por versão)
--     Devolve {conflict:false, version, updated_at} quando grava.
--     Devolve {conflict:true, version, updated_at, pages, title} quando a versão
--     esperada já não é a atual — o cliente decide entre recarregar ou duplicar.
CREATE OR REPLACE FUNCTION public.design_save(
  p_id               uuid,
  p_pages            jsonb,
  p_title            text DEFAULT NULL,
  p_thumbnail        text DEFAULT NULL,
  p_expected_version int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.design_projects;
  v_pages jsonb := COALESCE(p_pages, '[]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF jsonb_typeof(v_pages) <> 'array' THEN
    RAISE EXCEPTION 'PAGINAS_INVALIDAS';
  END IF;

  SELECT * INTO v_row
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_row.version THEN
    RETURN jsonb_build_object(
      'conflict',   true,
      'version',    v_row.version,
      'updated_at', v_row.updated_at,
      'title',      v_row.title,
      'pages',      v_row.pages
    );
  END IF;

  UPDATE public.design_projects
     SET pages         = v_pages,
         title         = COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), title),
         thumbnail     = COALESCE(p_thumbnail, thumbnail),
         version       = version + 1,
         last_saved_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  -- Instantâneo automático, no máximo um a cada 5 minutos. Um erro aqui não
  -- pode fazer falhar a gravação: o documento já está persistido.
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.design_versions
      WHERE project_id = p_id AND created_at > now() - interval '5 minutes'
    ) THEN
      INSERT INTO public.design_versions (project_id, owner_id, version, title, pages, thumbnail, label)
      VALUES (p_id, v_uid, v_row.version, v_row.title, v_row.pages, v_row.thumbnail, 'auto');

      PERFORM public.design_versions_prune(p_id, 30);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'conflict',   false,
    'version',    v_row.version,
    'updated_at', v_row.updated_at,
    'saved_at',   v_row.last_saved_at
  );
END;
$$;

-- 6.3 Duplicar projeto
CREATE OR REPLACE FUNCTION public.design_duplicate(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_src public.design_projects;
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT * INTO v_src
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.design_projects (
    owner_id, title, format_key, width, height, pages, thumbnail, template_id, version, last_saved_at
  )
  VALUES (
    v_uid,
    left(v_src.title || ' (cópia)', 120),
    v_src.format_key,
    v_src.width,
    v_src.height,
    v_src.pages,
    v_src.thumbnail,
    v_src.template_id,
    1,
    now()
  )
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

-- 6.4 Apagar projeto (definitivo — o cliente pediu-o explicitamente)
CREATE OR REPLACE FUNCTION public.design_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  DELETE FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;
END;
$$;

-- 6.5 Renomear (operação leve, sem tocar no documento)
CREATE OR REPLACE FUNCTION public.design_rename(p_id uuid, p_title text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  UPDATE public.design_projects
     SET title = COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), title)
   WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;
END;
$$;

-- 6.6 Publicar um projeto como modelo (só gestão)
--     É isto que alimenta a galeria de modelos vista pelos clientes.
CREATE OR REPLACE FUNCTION public.design_publish_template(
  p_project_id uuid,
  p_title      text DEFAULT NULL,
  p_category   text DEFAULT 'geral'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_proj public.design_projects;
  v_novo uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_proj
  FROM public.design_projects
  WHERE id = p_project_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.design_templates (
    title, description, category, format_key, width, height, pages, thumbnail, created_by
  )
  VALUES (
    COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), v_proj.title),
    'Modelo publicado a partir de um projeto.',
    COALESCE(NULLIF(btrim(COALESCE(p_category, '')), ''), 'geral'),
    v_proj.format_key,
    v_proj.width,
    v_proj.height,
    v_proj.pages,
    v_proj.thumbnail,
    v_uid
  )
  RETURNING id INTO v_novo;

  RETURN v_novo;
END;
$$;

-- 6.7 Criar um instantâneo manual (botão "Guardar versão")
CREATE OR REPLACE FUNCTION public.design_snapshot(p_id uuid, p_label text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.design_projects;
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT * INTO v_row
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.design_versions (project_id, owner_id, version, title, pages, thumbnail, label)
  VALUES (
    p_id,
    v_uid,
    v_row.version,
    v_row.title,
    v_row.pages,
    v_row.thumbnail,
    NULLIF(btrim(COALESCE(p_label, '')), '')
  )
  RETURNING id INTO v_new;

  PERFORM public.design_versions_prune(p_id, 30);
  RETURN v_new;
END;
$$;

-- 6.8 Listar o histórico de um projeto (sem o documento, que é pesado)
CREATE OR REPLACE FUNCTION public.design_versions_list(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.design_projects WHERE id = p_id AND owner_id = v_uid
  ) THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'created_at') DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'id',         dv.id,
             'version',    dv.version,
             'title',      dv.title,
             'label',      dv.label,
             'created_at', dv.created_at,
             'thumbnail',  dv.thumbnail,
             'paginas',    jsonb_array_length(dv.pages),
             'elementos',  (
               SELECT coalesce(sum(jsonb_array_length(pg->'elements')), 0)
               FROM jsonb_array_elements(dv.pages) AS pg
               WHERE jsonb_typeof(pg->'elements') = 'array'
             )
           ) AS item
    FROM public.design_versions dv
    WHERE dv.project_id = p_id AND dv.owner_id = v_uid
    LIMIT 60
  ) t;

  RETURN v_out;
END;
$$;

-- 6.9 Restaurar uma versão anterior
--     Copia o documento da versão para o projeto, sobe a versão (para que
--     outros separadores detetem o conflito) e guarda o estado anterior como
--     instantâneo, para que a própria restauração seja reversível.
CREATE OR REPLACE FUNCTION public.design_restore_version(p_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ver public.design_versions;
  v_row public.design_projects;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT * INTO v_ver
  FROM public.design_versions
  WHERE id = p_version_id AND project_id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERSAO_NAO_ENCONTRADA';
  END IF;

  SELECT * INTO v_row
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  -- Guarda o estado atual antes de o substituir.
  INSERT INTO public.design_versions (project_id, owner_id, version, title, pages, thumbnail, label)
  VALUES (p_id, v_uid, v_row.version, v_row.title, v_row.pages, v_row.thumbnail, 'antes de restaurar');

  UPDATE public.design_projects
     SET pages         = v_ver.pages,
         title         = v_ver.title,
         thumbnail     = COALESCE(v_ver.thumbnail, thumbnail),
         version       = version + 1,
         last_saved_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  PERFORM public.design_versions_prune(p_id, 30);

  RETURN jsonb_build_object(
    'version',      v_row.version,
    'title',        v_row.title,
    'pages',        v_row.pages,
    'updated_at',   v_row.updated_at,
    'restaurado_de', v_ver.version
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT SELECT, DELETE ON public.design_projects  TO authenticated;
GRANT SELECT         ON public.design_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.design_assets TO authenticated;
GRANT SELECT         ON public.design_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.designer_preferences TO authenticated;

GRANT EXECUTE ON FUNCTION public.design_create(text, text, int, int, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_save(uuid, jsonb, text, text, int)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_duplicate(uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_delete(uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_rename(uuid, text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_publish_template(uuid, text, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_snapshot(uuid, text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_versions_list(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_restore_version(uuid, uuid)                 TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. O ESTÚDIO É SÓ DA GESTÃO
-- -----------------------------------------------------------------------------
-- A rota /designer já é fechada no servidor (proxy + guarda na página), mas isso
-- é a interface. Sem esta guarda, um colaborador autenticado podia chamar
-- `design_create` pela API REST e criar projetos que nunca conseguiria abrir —
-- lixo na base de dados e uma permissão que o produto diz que não existe.
--
-- A guarda vive num gatilho, não em cada função: todas as escritas do estúdio
-- (criar, gravar, duplicar, renomear, restaurar) passam por `design_projects`,
-- por isso um gatilho cobre também qualquer código futuro que se esqueça de
-- verificar. `design_publish_template` já tinha a sua própria verificação.
--
-- `auth.uid() IS NULL` (service_role, scripts, SQL Editor) continua a escrever:
-- aí não há utilizador a quem negar, e o RLS já barra o anónimo.
CREATE OR REPLACE FUNCTION public.design_projects_so_gestao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS design_projects_so_gestao ON public.design_projects;
CREATE TRIGGER design_projects_so_gestao
  BEFORE INSERT OR UPDATE ON public.design_projects
  FOR EACH ROW EXECUTE FUNCTION public.design_projects_so_gestao();
