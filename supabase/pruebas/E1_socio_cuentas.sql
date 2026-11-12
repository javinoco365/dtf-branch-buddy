-- ============================================================================
-- Quién usa cada cuenta
-- ============================================================================
-- Prueba 20261115100000_socio_cuentas.sql:
--   1. un admin deja una cuenta con dos socios con socio_cuentas_fijar();
--   2. la empresa de la fila es la del socio;
--   3. un socio que estaba en otra cuenta pasa a la nueva (un socio, una cuenta);
--   4. volver a fijar quita los socios que ya no están;
--   5. un editor no puede usar socio_cuentas_fijar();
--   6. un editor no puede dar de alta una fila desde el navegador (RLS);
--   7. cada cuenta lee sus propias filas, aunque no tenga nivel;
--   8. un visor lee todas las filas de su empresa;
--   9. un socio que no existe se rechaza;
--  10. el cambio queda en la auditoría con el admin como autor.
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e1001', 'e1-admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000e1002', 'e1-editor@prueba.test'),
  ('00000000-0000-0000-0000-0000000e1003', 'e1-visor@prueba.test'),
  ('00000000-0000-0000-0000-0000000e1004', 'e1-gerencia@prueba.test'),
  ('00000000-0000-0000-0000-0000000e1005', 'e1-otra@prueba.test');
INSERT INTO public.user_roles (user_id, role, activo) VALUES
  ('00000000-0000-0000-0000-0000000e1001', 'admin', true),
  ('00000000-0000-0000-0000-0000000e1002', 'editor', true),
  ('00000000-0000-0000-0000-0000000e1003', 'visor', true);

DO $$
DECLARE v_emp UUID; v_a UUID; v_b UUID; v_c UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  INSERT INTO public.caja_socios (empresa_id, nombre, orden) VALUES (v_emp, 'E1 Ana', 901) RETURNING id INTO v_a;
  INSERT INTO public.caja_socios (empresa_id, nombre, orden) VALUES (v_emp, 'E1 Berta', 902) RETURNING id INTO v_b;
  INSERT INTO public.caja_socios (empresa_id, nombre, orden) VALUES (v_emp, 'E1 Carla', 903) RETURNING id INTO v_c;
  PERFORM set_config('e1.emp', v_emp::TEXT, true);
  PERFORM set_config('e1.a', v_a::TEXT, true);
  PERFORM set_config('e1.b', v_b::TEXT, true);
  PERFORM set_config('e1.c', v_c::TEXT, true);
END $$;

-- Ejecuta una sentencia como un usuario con sesión (RLS activa) y dice si
-- falló, con su mensaje.
CREATE FUNCTION pg_temp.e1_como(_usuario UUID, _sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _usuario::TEXT, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'error: ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN 'ok';
END $$;

CREATE FUNCTION pg_temp.e1_cuenta_lee(_usuario UUID) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _usuario::TEXT, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v FROM public.socio_cuentas
   WHERE socio_id IN (current_setting('e1.a')::UUID, current_setting('e1.b')::UUID, current_setting('e1.c')::UUID);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.e1_socios_de(_cuenta UUID) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(s.nombre, ',' ORDER BY s.nombre), '')
    FROM public.socio_cuentas sc JOIN public.caja_socios s ON s.id = sc.socio_id
   WHERE sc.usuario_id = _cuenta
$$;

-- 1. El admin deja la cuenta de gerencia con Ana y Berta.
SELECT pg_temp.e1_como('00000000-0000-0000-0000-0000000e1001',
  format('SELECT public.socio_cuentas_fijar(%L, %L, ARRAY[%L, %L]::UUID[])',
         '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e1004',
         current_setting('e1.a'), current_setting('e1.b'))) AS r1 \gset
SELECT CASE WHEN :'r1' = 'ok' AND pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') = 'E1 Ana,E1 Berta'
            THEN 'BIEN  1. el admin deja la cuenta con dos socios'
            ELSE 'MAL   1. el admin no ha podido fijar los socios: ' || :'r1' || ' / '
                 || pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') END;

-- 2. La empresa es la del socio.
SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM public.socio_cuentas sc JOIN public.caja_socios s ON s.id = sc.socio_id
          WHERE sc.usuario_id = '00000000-0000-0000-0000-0000000e1004' AND sc.empresa_id <> s.empresa_id)
            THEN 'BIEN  2. la fila lleva la empresa de su socio'
            ELSE 'MAL   2. hay filas con una empresa distinta de la del socio' END;

-- 3. Berta pasa a la otra cuenta: deja la de gerencia.
SELECT pg_temp.e1_como('00000000-0000-0000-0000-0000000e1001',
  format('SELECT public.socio_cuentas_fijar(%L, %L, ARRAY[%L]::UUID[])',
         '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e1005',
         current_setting('e1.b'))) AS r3 \gset
SELECT CASE WHEN :'r3' = 'ok'
             AND pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1005') = 'E1 Berta'
             AND pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') = 'E1 Ana'
            THEN 'BIEN  3. un socio que estaba en otra cuenta pasa a la nueva'
            ELSE 'MAL   3. el socio no ha cambiado de cuenta: ' || :'r3' END;

-- 4. Volver a fijar la de gerencia con Carla quita a Ana.
SELECT pg_temp.e1_como('00000000-0000-0000-0000-0000000e1001',
  format('SELECT public.socio_cuentas_fijar(%L, %L, ARRAY[%L]::UUID[])',
         '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e1004',
         current_setting('e1.c'))) AS r4 \gset
SELECT CASE WHEN :'r4' = 'ok' AND pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') = 'E1 Carla'
            THEN 'BIEN  4. fijar otra vez quita los socios que ya no están'
            ELSE 'MAL   4. quedan socios de antes: ' || pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') END;

-- 5. Un editor no puede.
SELECT pg_temp.e1_como('00000000-0000-0000-0000-0000000e1002',
  format('SELECT public.socio_cuentas_fijar(%L, %L, ARRAY[%L]::UUID[])',
         '00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-0000000e1004',
         current_setting('e1.a'))) AS r5 \gset
SELECT CASE WHEN :'r5' LIKE 'error:%administrador%'
             AND pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') = 'E1 Carla'
            THEN 'BIEN  5. un editor no puede cambiar quién usa cada cuenta'
            ELSE 'MAL   5. un editor ha podido usar socio_cuentas_fijar: ' || :'r5' END;

-- 6. Ni escribiendo directamente en la tabla.
SELECT pg_temp.e1_como('00000000-0000-0000-0000-0000000e1002',
  format('INSERT INTO public.socio_cuentas (socio_id, usuario_id) VALUES (%L, %L)',
         current_setting('e1.a'), '00000000-0000-0000-0000-0000000e1002')) AS r6 \gset
SELECT CASE WHEN :'r6' LIKE 'error:%'
            THEN 'BIEN  6. un editor no puede dar de alta filas desde el navegador'
            ELSE 'MAL   6. un editor ha dado de alta una fila' END;

-- 7. La cuenta de gerencia, sin nivel, lee su propia fila.
SELECT CASE WHEN pg_temp.e1_cuenta_lee('00000000-0000-0000-0000-0000000e1004') = 1
            THEN 'BIEN  7. cada cuenta lee sus propias filas aunque no tenga nivel'
            ELSE 'MAL   7. la cuenta lee ' || pg_temp.e1_cuenta_lee('00000000-0000-0000-0000-0000000e1004') || ' filas (esperaba 1)' END;

-- 8. Un visor lee todas.
SELECT CASE WHEN pg_temp.e1_cuenta_lee('00000000-0000-0000-0000-0000000e1003') = 2
            THEN 'BIEN  8. un visor lee todas las filas de su empresa'
            ELSE 'MAL   8. el visor lee ' || pg_temp.e1_cuenta_lee('00000000-0000-0000-0000-0000000e1003') || ' filas (esperaba 2)' END;

-- 9. Un socio que no existe.
SELECT pg_temp.e1_como('00000000-0000-0000-0000-0000000e1001',
  format('SELECT public.socio_cuentas_fijar(%L, %L, ARRAY[%L]::UUID[])',
         '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e1004',
         gen_random_uuid())) AS r9 \gset
SELECT CASE WHEN :'r9' LIKE 'error:%no existe%'
             AND pg_temp.e1_socios_de('00000000-0000-0000-0000-0000000e1004') = 'E1 Carla'
            THEN 'BIEN  9. un socio que no existe se rechaza sin tocar nada'
            ELSE 'MAL   9. un socio inexistente no se ha rechazado: ' || :'r9' END;

-- 10. Auditoría con el admin como autor.
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM public.auditoria a
          WHERE a.tabla = 'socio_cuentas'
            AND a.usuario_id = '00000000-0000-0000-0000-0000000e1001')
            THEN 'BIEN 10. los cambios quedan en la auditoría a nombre del admin'
            ELSE 'MAL  10. no hay filas de auditoría de socio_cuentas a nombre del admin' END;

ROLLBACK;
