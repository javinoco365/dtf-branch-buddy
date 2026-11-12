-- ============================================================================
-- Lectura de empresas por nivel
-- ============================================================================
-- Prueba 20261114100000_empresas_lectura_por_nivel.sql:
--   1. admin, editor y visor activos ven todas las empresas;
--   2. un desactivado no ve ninguna;
--   3. una cuenta sin nivel ni tiendas asignadas no ve ninguna;
--   4. una cuenta sin nivel con una tienda asignada ve la empresa de esa tienda.
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000d9001', 'd9-admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000d9002', 'd9-editor@prueba.test'),
  ('00000000-0000-0000-0000-0000000d9003', 'd9-visor@prueba.test'),
  ('00000000-0000-0000-0000-0000000d9004', 'd9-desactivado@prueba.test'),
  ('00000000-0000-0000-0000-0000000d9005', 'd9-sin-nivel@prueba.test'),
  ('00000000-0000-0000-0000-0000000d9006', 'd9-con-tienda@prueba.test');
INSERT INTO public.user_roles (user_id, role, activo) VALUES
  ('00000000-0000-0000-0000-0000000d9001', 'admin', true),
  ('00000000-0000-0000-0000-0000000d9002', 'editor', true),
  ('00000000-0000-0000-0000-0000000d9003', 'visor', true),
  ('00000000-0000-0000-0000-0000000d9004', 'editor', false);

DO $$
DECLARE v_emp UUID; v_tienda UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tienda FROM public.tiendas WHERE empresa_id = v_emp ORDER BY created_at LIMIT 1;
  IF v_tienda IS NULL THEN
    INSERT INTO public.tiendas (nombre, empresa_id) VALUES ('D9 tienda', v_emp)
    RETURNING id INTO v_tienda;
  END IF;
  INSERT INTO public.tienda_usuarios (tienda_id, user_id)
  VALUES (v_tienda, '00000000-0000-0000-0000-0000000d9006');
  PERFORM set_config('d9.empresa', v_emp::TEXT, true);
  PERFORM set_config('d9.total', (SELECT count(*) FROM public.empresas)::TEXT, true);
END $$;

CREATE FUNCTION pg_temp.d9_ve(_usuario UUID) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_total INT; v_suya BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _usuario::TEXT, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), bool_or(id = current_setting('d9.empresa')::UUID)
    INTO v_total, v_suya FROM public.empresas;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_total || '/' || COALESCE(v_suya, false);
END $$;

SELECT CASE WHEN pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9001') = current_setting('d9.total') || '/true'
             AND pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9002') = current_setting('d9.total') || '/true'
             AND pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9003') = current_setting('d9.total') || '/true'
            THEN 'BIEN  1. admin, editor y visor activos ven todas las empresas'
            ELSE 'MAL   1. admin, editor o visor activo no ve todas las empresas' END;

SELECT CASE WHEN pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9004') = '0/false'
            THEN 'BIEN  2. un desactivado no ve ninguna empresa'
            ELSE 'MAL   2. un desactivado ve empresas: '
                 || pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9004') END;

SELECT CASE WHEN pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9005') = '0/false'
            THEN 'BIEN  3. una cuenta sin nivel ni tiendas no ve ninguna empresa'
            ELSE 'MAL   3. una cuenta sin nivel ni tiendas ve empresas: '
                 || pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9005') END;

SELECT CASE WHEN pg_temp.d9_ve('00000000-0000-0000-0000-0000000d9006') LIKE '%/true'
            THEN 'BIEN  4. una cuenta sin nivel ve la empresa de su tienda asignada'
            ELSE 'MAL   4. una cuenta sin nivel no ve la empresa de su tienda' END;

ROLLBACK;
