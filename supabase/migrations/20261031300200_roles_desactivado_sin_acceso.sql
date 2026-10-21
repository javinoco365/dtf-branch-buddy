-- ============================================================================
-- Un usuario desactivado deja de ver y de escribir (hallazgos R1 y SEG-REV-3)
-- ============================================================================
--
-- EL FALLO
--   Desactivar a alguien (usuario_fijar_nivel(..., false)) solo pone
--   user_roles.activo = false. rol_nivel() lo mira, pero has_role() no:
--
--     - Un admin desactivado seguía siendo admin para has_role(). Las
--       políticas que exigen has_role(auth.uid(), 'admin') (tiendas,
--       tienda_usuarios, empresas, empresa_global, tienda_plantillas_correo,
--       plantillas_presupuesto, profiles, auditoria y los buckets logos,
--       compras, presupuestos y facturas/textil) le dejaban crear, cambiar y
--       borrar. Probado: INSERT en tienda_usuarios, UPDATE y DELETE de tiendas
--       con su JWT salían bien.
--     - Con mis_tiendas(), mis_empresas(), is_tienda_member() y
--       es_miembro_empresa() seguía leyendo todo. Un editor o visor
--       desactivado con filas en tienda_usuarios seguía leyendo sus tiendas.
--
--   El baneo de Supabase Auth no corta el token que ya tiene (hasta 1 h), y si
--   updateUserById falla, no lo corta nunca.
--
-- QUÉ HACE
--   1. has_role() exige activo. Cierra de una vez todas las políticas y
--      funciones que lo usan (también las de storage).
--   2. is_tienda_member(), es_miembro_empresa(), mis_tiendas() y
--      mis_empresas(): la rama de tienda_usuarios no cuenta a quien tiene su
--      fila de user_roles desactivada. Quien no tiene fila (alta a medias)
--      sigue como hasta ahora: ve sus tiendas y no escribe.
--   3. «empresa_global select miembros», la única política que mira
--      tienda_usuarios directamente: igual.
--
--   Mismo nombre, mismos argumentos y mismos permisos: no hay que tocar
--   ninguna política ni el código. Las funciones siguen siendo STABLE y
--   SECURITY DEFINER, y las políticas las siguen llamando igual.
--
-- DEPENDE DE 20261031200100 (la columna activo).
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031300200_roles_desactivado_sin_acceso.sql
-- (repone las definiciones de antes). Va antes que la de 20261031200100, que
-- quita la columna activo.
-- ============================================================================

-- ---- 1. has_role() exige activo ---------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id AND role = _role AND activo
  );
$$;

COMMENT ON FUNCTION public.has_role(UUID, public.app_role) IS
  'true si el usuario tiene ese nivel y está activo. Un desactivado no es nada.';

-- ---- 2. Pertenencia: los desactivados no cuentan ----------------------------
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

-- ---- 3. La política que mira tienda_usuarios directamente -------------------
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

NOTIFY pgrst, 'reload schema';
