-- ============================================================================
-- REVERSIÓN de 20261031200200_roles_politicas_escritura.sql
-- ============================================================================
-- Quita de cada política de escritura la condición de nivel que añadió la
-- migración, y deja la que tenía. No toca nada más.
--
-- La migración añadió al final « AND (SELECT public.rol_puede_X(auth.uid()))».
-- Postgres la guarda como « AND ( SELECT public.rol_puede_X(auth.uid()) AS
-- rol_puede_X)» y eso es lo que se quita. Probado en el banco de pruebas: tras
-- la migración y esta reversión, pg_policies queda igual que antes.
--
-- Va antes de revertir 20261031200100 (las políticas usan sus funciones).
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  v_sql TEXT;
  v_search_path TEXT := current_setting('search_path');
  v_patron CONSTANT TEXT :=
    ' AND \( SELECT public\.rol_puede_(escribir|borrar)\(auth\.uid\(\)\) AS rol_puede_(escribir|borrar)\)';
BEGIN
  -- Nombres calificados al leer y escribir las condiciones. Se repone al final.
  PERFORM set_config('search_path', '', true);
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_catalog.pg_policies
     WHERE schemaname IN ('public', 'storage')
       AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%rol_puede_%'
  LOOP
    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF r.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', regexp_replace(r.qual, v_patron, '', 'g'));
    END IF;
    IF r.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', regexp_replace(r.with_check, v_patron, '', 'g'));
    END IF;
    EXECUTE v_sql;
  END LOOP;

  PERFORM set_config('search_path', v_search_path, true);
END $$;
