-- ============================================================================
-- Niveles: el editor y el visor lo ven TODO (salvo secretos)
-- ============================================================================
--
-- LA PETICIÓN
--   «jacarrome es visor: solo quiero que mire, no puede editar, eliminar,
--   crear ni hacer nada, pero lo puede ver TODO.» Y CLAUDE.md: «editor: ve
--   todo, crea y modifica».
--
-- EL PROBLEMA
--   La lectura dependía de tienda_usuarios: un editor o un visor solo veía las
--   tiendas que tenía asignadas (y las empresas de esas tiendas). Sin ninguna,
--   veía las pantallas vacías. Además había lecturas solo de admin:
--     - auditoria                         «auditoria lectura admin»
--     - profiles, user_roles,
--       tienda_usuarios                   «... own or admin» (solo la suya)
--     - storage facturas/textil           «Facturas textil lectura» (PDF textil)
--     - empresa_global                    solo admin o miembro de alguna tienda
--
-- LA DECISIÓN (la más simple y segura)
--   Un usuario con nivel ACTIVO (admin, editor o visor) ve todas las tiendas y
--   todas las empresas. Hoy hay una sola empresa y no existe relación
--   usuario-empresa salvo tienda_usuarios, que solo dice qué tiendas tiene
--   asignadas. La regla vive en UN solo sitio, rol_ve_empresa(): el día que
--   haya una segunda empresa con usuarios distintos, se añade la relación
--   usuario-empresa y se cambia solo esa función; las políticas y las otras
--   funciones no se tocan.
--
--   Lo que NO cambia:
--     - Un desactivado no ve nada (20261031300200). rol_nivel() devuelve NULL
--       con activo = false, así que rol_puede_ver() es false, y la rama de
--       tienda_usuarios sigue exigiendo que no esté desactivado.
--     - Quien no tiene fila en user_roles (alta a medias) sigue como hasta
--       ahora: ve lo de sus tiendas asignadas y no escribe.
--     - La escritura: todas las políticas de escritura llevan
--       rol_puede_escribir()/rol_puede_borrar() (20261031200200), las
--       funciones SECURITY DEFINER rol_exigir_quien() (200300) y la guardia
--       por sentencia (200100). El visor sigue sin escribir por ningún camino.
--       El editor pasa a poder escribir en todas las tiendas de la empresa
--       (antes, solo en las asignadas): es lo que dice su nivel.
--     - Lo que es de admin para escribir (tiendas, tienda_usuarios, empresas,
--       empresa_global, plantillas, buckets de logos/compras/presupuestos/
--       facturas textil) sigue siéndolo: esas políticas exigen has_role admin.
--
--   Lo que el editor y el visor siguen SIN ver (secretos):
--     - tienda_credenciales y smtp_config: sin política de lectura para nadie
--       con JWT (solo el servidor, y solo para admin). Ni se tocan.
--     - auth_intentos_fallidos_login: sin política. Ni se toca.
--     - En auditoria, las filas de smtp_config y tienda_credenciales: aunque
--       las claves van enmascaradas, dicen host, usuario y cuándo se cambiaron
--       las credenciales. Solo admin.
--
-- QUÉ HACE
--   1. rol_puede_ver(_user_id): tiene nivel activo (cualquiera).
--      rol_ve_empresa(_user_id, _empresa_id): hoy = rol_puede_ver().
--   2. is_tienda_member(), es_miembro_empresa(), mis_tiendas() y
--      mis_empresas(): añaden la rama «nivel activo» a lo de 300200. Mismo
--      nombre, argumentos y permisos: ninguna política cambia por esto.
--   3. Políticas de lectura que eran solo de admin (las de arriba) pasan a
--      «admin, o nivel activo» (con las excepciones de auditoria).
--
-- DEPENDE DE 20261031200100 (rol_nivel, columna activo) y 20261031300200.
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031400000_niveles_lectura_total.sql
-- (repone las funciones y políticas de 300200 y anteriores y quita las dos
-- funciones nuevas). No toca datos.
-- ============================================================================

-- ---- 1. Quién ve -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rol_puede_ver(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.rol_nivel(_user_id) IS NOT NULL
$$;

COMMENT ON FUNCTION public.rol_puede_ver(UUID) IS
  'true si el usuario tiene un nivel activo (admin, editor o visor): lo ve todo salvo secretos. Un desactivado o sin nivel, false.';

CREATE OR REPLACE FUNCTION public.rol_ve_empresa(_user_id UUID, _empresa_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Hoy, con nivel activo se ven todas las empresas: no hay relación
  -- usuario-empresa. Cuando la haya, se limita aquí y en ningún otro sitio.
  SELECT public.rol_puede_ver(_user_id) AND _empresa_id IS NOT NULL
$$;

COMMENT ON FUNCTION public.rol_ve_empresa(UUID, UUID) IS
  'true si el usuario ve toda la empresa por su nivel. Hoy: nivel activo => todas. El único sitio que cambiar cuando haya usuarios por empresa.';

REVOKE EXECUTE ON FUNCTION public.rol_puede_ver(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rol_ve_empresa(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rol_puede_ver(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rol_ve_empresa(UUID, UUID) TO authenticated, service_role;

-- ---- 2. Pertenencia: nivel activo, o tienda asignada y no desactivado -------
CREATE OR REPLACE FUNCTION public.is_tienda_member(_user_id UUID, _tienda_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.tiendas t
         WHERE t.id = _tienda_id AND public.rol_ve_empresa(_user_id, t.empresa_id)
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.tienda_usuarios WHERE user_id = _user_id AND tienda_id = _tienda_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND NOT r.activo
        )
      );
$$;

CREATE OR REPLACE FUNCTION public.es_miembro_empresa(_user_id UUID, _empresa_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin')
      OR public.rol_ve_empresa(_user_id, _empresa_id)
      OR (
        EXISTS (
          SELECT 1
            FROM public.tienda_usuarios tu
            JOIN public.tiendas t ON t.id = tu.tienda_id
           WHERE tu.user_id = _user_id AND t.empresa_id = _empresa_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND NOT r.activo
        )
      );
$$;

CREATE OR REPLACE FUNCTION public.mis_tiendas()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(t.id), '{}')
    FROM public.tiendas t
   WHERE public.has_role(auth.uid(), 'admin')
      OR public.rol_ve_empresa(auth.uid(), t.empresa_id)
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
      OR public.rol_ve_empresa(auth.uid(), e.id)
      OR (EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                    JOIN public.tiendas t ON t.id = tu.tienda_id
                   WHERE tu.user_id = auth.uid() AND t.empresa_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                           WHERE r.user_id = auth.uid() AND NOT r.activo));
$$;

COMMENT ON FUNCTION public.mis_tiendas() IS
  'Tiendas que puede leer quien llama (nivel activo: todas las de sus empresas, hoy todas; sin nivel: las asignadas; desactivado: ninguna). Para políticas de lectura: tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]).';
COMMENT ON FUNCTION public.mis_empresas() IS
  'Empresas que puede leer quien llama (nivel activo: hoy todas; sin nivel: las de sus tiendas asignadas; desactivado: ninguna). Para políticas de lectura: empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]).';

-- ---- 3. Lecturas que eran solo de admin --------------------------------------

-- Auditoría: el registro de quién hizo qué. Todo salvo lo de los secretos.
DROP POLICY IF EXISTS "auditoria lectura admin" ON public.auditoria;
DROP POLICY IF EXISTS "auditoria lectura" ON public.auditoria;
CREATE POLICY "auditoria lectura" ON public.auditoria
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR ((SELECT public.rol_puede_ver(auth.uid()))
        AND tabla NOT IN ('smtp_config', 'tienda_credenciales')
        AND (empresa_id IS NULL
             OR empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])))
  );

-- Perfiles (nombre y correo de los usuarios): para saber quién hizo qué.
ALTER POLICY "profiles select own or admin" ON public.profiles
  USING (id = auth.uid() OR (SELECT public.rol_puede_ver(auth.uid())));

-- Niveles: la lista de usuarios y su nivel, de solo lectura.
ALTER POLICY "user_roles select own or admin" ON public.user_roles
  USING (user_id = auth.uid() OR (SELECT public.rol_puede_ver(auth.uid())));

-- Qué tiendas tiene asignadas cada usuario: las de las tiendas que ve.
ALTER POLICY "tienda_usuarios select" ON public.tienda_usuarios
  USING (user_id = auth.uid()
         OR ((SELECT public.rol_puede_ver(auth.uid()))
             AND tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[])));

-- Datos fiscales y costes globales de la sociedad.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'empresa_global'
                AND policyname = 'empresa_global select miembros') THEN
    ALTER POLICY "empresa_global select miembros" ON public.empresa_global
      USING (
        public.has_role(auth.uid(), 'admin')
        OR (SELECT public.rol_puede_ver(auth.uid()))
        OR (EXISTS (SELECT 1 FROM public.tienda_usuarios tu WHERE tu.user_id = auth.uid())
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                             WHERE r.user_id = auth.uid() AND NOT r.activo))
      );
  END IF;
END $$;

-- PDF de las facturas y tickets textil (bucket facturas, carpeta textil/).
-- Subirlos y reemplazarlos sigue siendo de admin (políticas aparte).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'Facturas textil lectura') THEN
    ALTER POLICY "Facturas textil lectura" ON storage.objects
      USING (
        bucket_id = 'facturas'
        AND (storage.foldername(name))[1] = 'textil'
        AND (SELECT public.rol_puede_ver(auth.uid()))
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
