-- ============================================================================
-- REVERSIÓN de 20261031200100_roles_permisos.sql
-- ============================================================================
-- Orden: primero 20261031200300 y 20261031200200 (usan estas funciones).
--
-- Quita la guardia de todas las tablas, las funciones de nivel,
-- usuario_fijar_nivel(), el trigger del último admin, la restricción de un
-- nivel por usuario y la columna activo.
--
-- OJO, dos cosas que esta reversión NO deshace solas:
--   - Las filas de user_roles con 'editor' o 'visor' se quedan. Sin la
--     guardia ni las funciones no dan ni quitan nada (has_role() solo mira
--     'admin'), pero son datos: se borran solo con autorización expresa.
--   - DROP COLUMN activo pierde qué usuarios estaban desactivados. Antes de
--     revertir, apunta la lista:
--       SELECT user_id FROM public.user_roles WHERE NOT activo;
--     Los desactivados siguen baneados en Supabase Auth hasta que se les quite
--     el ban desde el panel.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = 'rol_guardia' AND c.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS rol_guardia ON public.%I', r.relname);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.rol_guardia();
DROP TRIGGER IF EXISTS user_roles_queda_un_admin ON public.user_roles;
DROP FUNCTION IF EXISTS public.user_roles_queda_un_admin();
DROP FUNCTION IF EXISTS public.usuario_fijar_nivel(UUID, UUID, public.app_role, BOOLEAN);
DROP FUNCTION IF EXISTS public.rol_hay_admin_activo();
DROP FUNCTION IF EXISTS public.rol_exigir_quien(UUID, TEXT);
DROP FUNCTION IF EXISTS public.rol_exigir(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mi_nivel();
DROP FUNCTION IF EXISTS public.rol_es_admin(UUID);
DROP FUNCTION IF EXISTS public.rol_puede_borrar(UUID);
DROP FUNCTION IF EXISTS public.rol_puede_escribir(UUID);
DROP FUNCTION IF EXISTS public.rol_nivel(UUID);

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_un_nivel_por_usuario;
ALTER TABLE public.user_roles DROP COLUMN IF EXISTS activo;

NOTIFY pgrst, 'reload schema';
