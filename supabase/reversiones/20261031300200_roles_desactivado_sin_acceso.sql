-- ============================================================================
-- REVERSIÓN de 20261031300200_roles_desactivado_sin_acceso.sql
-- ============================================================================
-- Repone has_role(), is_tienda_member(), es_miembro_empresa(), mis_tiendas(),
-- mis_empresas() y «empresa_global select miembros» como estaban. No toca
-- datos.
--
-- OJO: vuelve a abrir R1 y SEG-REV-3: un admin desactivado vuelve a escribir
-- en tiendas, tienda_usuarios, empresas y los buckets, y cualquier desactivado
-- vuelve a leer lo de sus tiendas mientras le dure el token.
--
-- Orden: antes que la reversión de 20261031200100 (que quita la columna activo
-- y dejaría has_role() rota).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
COMMENT ON FUNCTION public.has_role(UUID, public.app_role) IS NULL;

CREATE OR REPLACE FUNCTION public.is_tienda_member(_user_id UUID, _tienda_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tienda_usuarios WHERE user_id = _user_id AND tienda_id = _tienda_id
  ) OR public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.es_miembro_empresa(_user_id UUID, _empresa_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tienda_usuarios tu
    JOIN public.tiendas t ON t.id = tu.tienda_id
    WHERE tu.user_id = _user_id AND t.empresa_id = _empresa_id
  ) OR public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.mis_tiendas()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(t.id), '{}')
    FROM public.tiendas t
   WHERE public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                  WHERE tu.user_id = auth.uid() AND tu.tienda_id = t.id);
$$;

CREATE OR REPLACE FUNCTION public.mis_empresas()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(e.id), '{}')
    FROM public.empresas e
   WHERE public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                   JOIN public.tiendas t ON t.id = tu.tienda_id
                  WHERE tu.user_id = auth.uid() AND t.empresa_id = e.id);
$$;

COMMENT ON FUNCTION public.mis_tiendas() IS
  'Tiendas que puede leer quien llama (admin: todas). Para políticas de lectura: tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]).';
COMMENT ON FUNCTION public.mis_empresas() IS
  'Empresas que puede leer quien llama (admin: todas). Para políticas de lectura: empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'empresa_global'
                AND policyname = 'empresa_global select miembros') THEN
    ALTER POLICY "empresa_global select miembros" ON public.empresa_global
      USING (
        public.has_role(auth.uid(), 'admin')
        OR EXISTS (SELECT 1 FROM public.tienda_usuarios tu WHERE tu.user_id = auth.uid())
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
