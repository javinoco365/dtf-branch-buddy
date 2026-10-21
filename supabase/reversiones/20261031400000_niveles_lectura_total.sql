-- ============================================================================
-- REVERSIÓN de 20261031400000_niveles_lectura_total.sql
-- (Si está aplicada 20261031400100_niveles_secretos.sql, revierte antes esa:
-- su política de compras usa rol_puede_ver(), que esta borra.)
-- ============================================================================
-- Repone is_tienda_member(), es_miembro_empresa(), mis_tiendas(),
-- mis_empresas() y las políticas de lectura como las dejó 20261031300200, y
-- quita rol_puede_ver() y rol_ve_empresa(). No toca datos.
--
-- OJO: el editor y el visor vuelven a ver solo lo de sus tiendas asignadas
-- (sin ninguna, las pantallas vacías), y la auditoría, los perfiles, los
-- niveles de los demás y los PDF textil vuelven a ser solo de admin.
--
-- Orden: antes que la reversión de 20261031300200.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_tienda_member(_user_id UUID, _tienda_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.tienda_usuarios WHERE user_id = _user_id AND tienda_id = _tienda_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND NOT r.activo
    )
  ) OR public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.es_miembro_empresa(_user_id UUID, _empresa_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    EXISTS (
      SELECT 1
        FROM public.tienda_usuarios tu
        JOIN public.tiendas t ON t.id = tu.tienda_id
       WHERE tu.user_id = _user_id AND t.empresa_id = _empresa_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND NOT r.activo
    )
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
      OR (EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                   WHERE tu.user_id = auth.uid() AND tu.tienda_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                           WHERE r.user_id = auth.uid() AND NOT r.activo));
$$;

CREATE OR REPLACE FUNCTION public.mis_empresas()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(e.id), '{}')
    FROM public.empresas e
   WHERE public.has_role(auth.uid(), 'admin')
      OR (EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                    JOIN public.tiendas t ON t.id = tu.tienda_id
                   WHERE tu.user_id = auth.uid() AND t.empresa_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                           WHERE r.user_id = auth.uid() AND NOT r.activo));
$$;

COMMENT ON FUNCTION public.mis_tiendas() IS
  'Tiendas que puede leer quien llama (admin activo: todas; desactivado: ninguna). Para políticas de lectura: tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]).';
COMMENT ON FUNCTION public.mis_empresas() IS
  'Empresas que puede leer quien llama (admin activo: todas; desactivado: ninguna). Para políticas de lectura: empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]).';

DROP POLICY IF EXISTS "auditoria lectura" ON public.auditoria;
DROP POLICY IF EXISTS "auditoria lectura admin" ON public.auditoria;
CREATE POLICY "auditoria lectura admin" ON public.auditoria
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER POLICY "profiles select own or admin" ON public.profiles
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

ALTER POLICY "user_roles select own or admin" ON public.user_roles
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

ALTER POLICY "tienda_usuarios select" ON public.tienda_usuarios
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'empresa_global'
                AND policyname = 'empresa_global select miembros') THEN
    ALTER POLICY "empresa_global select miembros" ON public.empresa_global
      USING (
        public.has_role(auth.uid(), 'admin')
        OR (EXISTS (SELECT 1 FROM public.tienda_usuarios tu WHERE tu.user_id = auth.uid())
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                             WHERE r.user_id = auth.uid() AND NOT r.activo))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'Facturas textil lectura') THEN
    ALTER POLICY "Facturas textil lectura" ON storage.objects
      USING (
        bucket_id = 'facturas'
        AND (storage.foldername(name))[1] = 'textil'
        AND public.has_role(auth.uid(), 'admin')
      );
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.rol_ve_empresa(UUID, UUID);
DROP FUNCTION IF EXISTS public.rol_puede_ver(UUID);

NOTIFY pgrst, 'reload schema';
