-- ============================================================================
-- PDF de presupuestos: la plantilla de cada tienda y la del textil
-- ============================================================================
-- Prueba 20261026100000_plantillas_presupuesto.sql. Se aplica otra vez, dos
-- veces (tiene que poder repetirse sin duplicar triggers ni políticas; y las
-- pruebas anteriores dan ALL en todas las tablas a todos los roles: volver a
-- aplicarla deja los permisos como los deja la migración).
--
-- Todo va dentro de una transacción que se deshace al final: las tiendas, la
-- segunda empresa, los usuarios y las plantillas que escribe la prueba no se
-- quedan en la base (con dos empresas activas empresa_por_defecto() falla; la
-- de aquí se crea inactiva, pero ni así se deja). El punto 14 recorre la
-- cadena de auditoría con las filas nuevas dentro, antes de deshacer; el 15
-- comprueba, ya deshecha, que no ha quedado rastro.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261026100000_plantillas_presupuesto.sql
\ir ../migrations/20261026100000_plantillas_presupuesto.sql
RESET client_min_messages;

-- ---------------------------------------------------------------------------
-- 1. La tabla: columnas, empresa obligatoria con su FK, RLS y restricciones
-- ---------------------------------------------------------------------------
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'plantillas_presupuesto'
                     AND column_name IN ('id', 'empresa_id', 'ambito', 'tienda_id', 'config',
                                         'logo_url', 'created_at', 'updated_at')) = 8
             AND (SELECT is_nullable = 'NO' FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'plantillas_presupuesto'
                     AND column_name = 'empresa_id')
             AND (SELECT data_type = 'timestamp with time zone' FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'plantillas_presupuesto'
                     AND column_name = 'updated_at')
             AND EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'public.plantillas_presupuesto'::regclass
                            AND contype = 'f'
                            AND confrelid = 'public.empresas'::regclass)
             AND EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'public.plantillas_presupuesto'::regclass
                            AND contype = 'f' AND confdeltype = 'c'
                            AND confrelid = 'public.tiendas'::regclass)
             AND (SELECT relrowsecurity FROM pg_class
                   WHERE oid = 'public.plantillas_presupuesto'::regclass)
            THEN 'BIEN  1. plantillas_presupuesto: sus columnas, empresa_id NOT NULL con FK, '
                 'tienda con borrado en cascada y RLS activada'
            ELSE 'MAL   1. a plantillas_presupuesto le falta algo: columnas, FK o RLS' END;

-- ---------------------------------------------------------------------------
-- 2. Aplicada dos veces, un trigger de cada: auditoría, empresa y updated_at
-- ---------------------------------------------------------------------------
-- tgtype: 1 = por fila, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE.
-- Auditoría: AFTER INSERT OR UPDATE OR DELETE por fila = 1 + 4 + 8 + 16 = 29.
SELECT CASE WHEN (SELECT count(*) FROM pg_trigger
                   WHERE tgrelid = 'public.plantillas_presupuesto'::regclass
                     AND NOT tgisinternal) = 3
             AND EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.plantillas_presupuesto'::regclass
                            AND tgname = 'plantillas_presupuesto_auditoria'
                            AND tgfoid = 'public.auditoria_registrar'::regproc
                            AND (tgtype & 127) = 29)
             AND EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.plantillas_presupuesto'::regclass
                            AND tgname = 'plantillas_presupuesto_touch'
                            AND tgfoid = 'public.touch_updated_at'::regproc)
             AND EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.plantillas_presupuesto'::regclass
                            AND tgname = 'plantillas_presupuesto_empresa'
                            AND tgfoid = 'public.plantillas_presupuesto_empresa_de_tienda'::regproc)
            THEN 'BIEN  2. aplicada dos veces: un trigger de auditoría (AFTER INSERT OR UPDATE OR DELETE), '
                 'uno de empresa y uno de updated_at'
            ELSE 'MAL   2. los triggers de plantillas_presupuesto no son los que deben, o están repetidos' END;

-- ---------------------------------------------------------------------------
-- 3. Una política por operación, ninguna FOR ALL
-- ---------------------------------------------------------------------------
SELECT CASE WHEN array_agg(cmd::TEXT ORDER BY cmd::TEXT) = ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']
             AND bool_and(roles = ARRAY['authenticated']::NAME[])
            THEN 'BIEN  3. cuatro políticas, una por operación y solo para authenticated; ninguna FOR ALL'
            ELSE 'MAL   3. políticas de plantillas_presupuesto: ' || string_agg(policyname || ' ' || cmd, ', ') END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'plantillas_presupuesto';

-- ---------------------------------------------------------------------------
-- 4. Permisos: anon nada; authenticated, las cuatro operaciones; servicio, todo
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT has_table_privilege('anon', 'public.plantillas_presupuesto', 'SELECT')
             AND NOT has_table_privilege('anon', 'public.plantillas_presupuesto', 'INSERT')
             AND NOT has_table_privilege('anon', 'public.plantillas_presupuesto', 'UPDATE')
             AND NOT has_table_privilege('anon', 'public.plantillas_presupuesto', 'DELETE')
             AND has_table_privilege('authenticated', 'public.plantillas_presupuesto', 'SELECT')
             AND has_table_privilege('authenticated', 'public.plantillas_presupuesto', 'INSERT')
             AND has_table_privilege('authenticated', 'public.plantillas_presupuesto', 'UPDATE')
             AND has_table_privilege('authenticated', 'public.plantillas_presupuesto', 'DELETE')
             AND NOT has_table_privilege('authenticated', 'public.plantillas_presupuesto', 'TRUNCATE')
             AND has_table_privilege('service_role', 'public.plantillas_presupuesto', 'SELECT')
             AND has_table_privilege('service_role', 'public.plantillas_presupuesto', 'INSERT')
             AND has_table_privilege('service_role', 'public.plantillas_presupuesto', 'UPDATE')
             AND has_table_privilege('service_role', 'public.plantillas_presupuesto', 'DELETE')
             AND NOT has_function_privilege('authenticated',
                   'public.plantillas_presupuesto_empresa_de_tienda()', 'EXECUTE')
            THEN 'BIEN  4. anon no toca la tabla; authenticated lee y escribe (lo decide la RLS); el servicio, todo'
            ELSE 'MAL   4. los permisos de plantillas_presupuesto no son los de la migración' END;

-- ---------------------------------------------------------------------------
-- Datos: dos tiendas de la empresa, una segunda empresa (inactiva) y cuatro
-- usuarios. UA es de la tienda A; UB, de la B; UX no es de ninguna; ADM es
-- administrador y no es de ninguna tienda.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c1600000-0000-4000-8000-00000000000a', 'ua@c16.test'),
  ('c1600000-0000-4000-8000-00000000000b', 'ub@c16.test'),
  ('c1600000-0000-4000-8000-00000000000c', 'ux@c16.test'),
  ('c1600000-0000-4000-8000-00000000000d', 'adm@c16.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c1600000-0000-4000-8000-00000000000d', 'admin');

SELECT set_config('c16.ua',  'c1600000-0000-4000-8000-00000000000a', true),
       set_config('c16.ub',  'c1600000-0000-4000-8000-00000000000b', true),
       set_config('c16.ux',  'c1600000-0000-4000-8000-00000000000c', true),
       set_config('c16.adm', 'c1600000-0000-4000-8000-00000000000d', true),
       set_config('c16.desde', (SELECT COALESCE(max(id), 0)::TEXT FROM public.auditoria), true);

DO $$
DECLARE
  v_e2 UUID;
  v_a UUID; v_b UUID;
BEGIN
  INSERT INTO public.empresas (razon_social, activa) VALUES ('Otra empresa C16', false) RETURNING id INTO v_e2;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C16 A', 'tienda-c16-a') RETURNING id INTO v_a;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C16 B', 'tienda-c16-b') RETURNING id INTO v_b;
  INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES
    (v_a, current_setting('c16.ua')::UUID),
    (v_b, current_setting('c16.ub')::UUID);

  PERFORM set_config('c16.e1', public.empresa_por_defecto()::TEXT, true);
  PERFORM set_config('c16.e2', v_e2::TEXT, true);
  PERFORM set_config('c16.a', v_a::TEXT, true);
  PERFORM set_config('c16.b', v_b::TEXT, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.plantilla(_tienda TEXT) RETURNS UUID
LANGUAGE sql AS $$
  SELECT id FROM public.plantillas_presupuesto
   WHERE tienda_id = current_setting('c16.' || _tienda)::UUID
$$;

-- ---------------------------------------------------------------------------
-- 5. Dar de alta: la de una tienda y la del textil, con lo de por defecto
-- ---------------------------------------------------------------------------
INSERT INTO public.plantillas_presupuesto (ambito, tienda_id, config, logo_url)
VALUES ('tienda', current_setting('c16.a')::UUID,
        '{"prueba": "c16", "cabecera": {"titulo": {"texto": "OFERTA"}}}',
        'https://proyecto.supabase.co/storage/v1/object/public/logos/c16/logo.png');
INSERT INTO public.plantillas_presupuesto (ambito, config)
VALUES ('textil', '{"prueba": "c16"}');

SELECT CASE WHEN (SELECT count(*) FROM public.plantillas_presupuesto WHERE config ? 'prueba') = 2
             AND (SELECT empresa_id::TEXT = current_setting('c16.e1')
                    FROM public.plantillas_presupuesto WHERE ambito = 'textil' AND config ? 'prueba')
             AND (SELECT config #>> '{cabecera,titulo,texto}' = 'OFERTA'
                    FROM public.plantillas_presupuesto WHERE id = pg_temp.plantilla('a'))
             AND (SELECT config = '{}'::JSONB AND logo_url IS NULL FROM (
                    SELECT config - 'prueba' AS config, logo_url
                      FROM public.plantillas_presupuesto WHERE ambito = 'textil' AND config ? 'prueba') x)
            THEN 'BIEN  5. se da de alta la plantilla de una tienda y la del textil (con la empresa por defecto)'
            ELSE 'MAL   5. las altas de plantilla no han quedado como debían' END;

-- ---------------------------------------------------------------------------
-- 6-10. Lo que no tiene sentido, la base lo rechaza
-- ---------------------------------------------------------------------------
-- Ejecuta una sentencia y devuelve el SQLSTATE con que falla, u «ok».
CREATE OR REPLACE FUNCTION pg_temp.falla(_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- 23505: unique_violation. 23514: check_violation.
SELECT CASE WHEN pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id)
                                  VALUES ('tienda', current_setting('c16.a')::UUID)$q$) = '23505'
            THEN 'BIEN  6. una segunda plantilla para la misma tienda se rechaza (unique_violation)'
            ELSE 'MAL   6. se ha aceptado una segunda plantilla para la misma tienda' END;

SELECT CASE WHEN pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, empresa_id)
                                  VALUES ('textil', current_setting('c16.e1')::UUID)$q$) = '23505'
             AND pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, empresa_id, config)
                                  VALUES ('textil', current_setting('c16.e2')::UUID, '{"prueba": "c16"}')$q$) = 'ok'
            THEN 'BIEN  7. una segunda plantilla de textil en la misma empresa se rechaza; en otra empresa, no'
            ELSE 'MAL   7. el textil no tiene una plantilla, y solo una, por empresa' END;

SELECT CASE WHEN pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito)
                                  VALUES ('tienda')$q$) = '23514'
             AND pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id, empresa_id)
                                  VALUES ('textil', current_setting('c16.b')::UUID,
                                          current_setting('c16.e2')::UUID)$q$) = '23514'
             AND pg_temp.falla($q$UPDATE public.plantillas_presupuesto SET tienda_id = NULL
                                   WHERE id = pg_temp.plantilla('a')$q$) = '23514'
            THEN 'BIEN  8. una plantilla de tienda sin tienda, o una de textil con tienda, se rechaza (check_violation)'
            ELSE 'MAL   8. se ha aceptado una plantilla con el ámbito y la tienda que no casan' END;

SELECT CASE WHEN pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id)
                                  VALUES ('otra', current_setting('c16.b')::UUID)$q$) = '23514'
             AND pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id, config)
                                  VALUES ('tienda', current_setting('c16.b')::UUID, '[]')$q$) = '23514'
             AND pg_temp.falla($q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id, config)
                                  VALUES ('tienda', current_setting('c16.b')::UUID, '"texto"')$q$) = '23514'
             AND pg_temp.falla($q$UPDATE public.plantillas_presupuesto SET config = '3'
                                   WHERE id = pg_temp.plantilla('a')$q$) = '23514'
             AND pg_temp.falla($q$UPDATE public.plantillas_presupuesto SET config = NULL
                                   WHERE id = pg_temp.plantilla('a')$q$) = '23502'
            THEN 'BIEN  9. un ámbito que no existe, o una config que no es un objeto JSON, se rechaza'
            ELSE 'MAL   9. se ha aceptado un ámbito desconocido o una config que no es un objeto' END;

SELECT CASE WHEN pg_temp.falla($q$UPDATE public.plantillas_presupuesto SET logo_url = 'javascript:alert(1)'
                                   WHERE id = pg_temp.plantilla('a')$q$) = '23514'
             AND pg_temp.falla($q$UPDATE public.plantillas_presupuesto SET logo_url = 'https://x.test/a b.png'
                                   WHERE id = pg_temp.plantilla('a')$q$) = '23514'
             AND pg_temp.falla($q$UPDATE public.plantillas_presupuesto SET logo_url = NULL
                                   WHERE id = pg_temp.plantilla('a')$q$) = 'ok'
            THEN 'BIEN  10. el logo, si lo hay, es una dirección http(s); lo demás se rechaza'
            ELSE 'MAL   10. se ha guardado como logo algo que no es una dirección http(s)' END;

-- ---------------------------------------------------------------------------
-- 11. La plantilla de una tienda lleva la empresa de la tienda
-- ---------------------------------------------------------------------------
INSERT INTO public.plantillas_presupuesto (ambito, tienda_id, empresa_id, config)
VALUES ('tienda', current_setting('c16.b')::UUID, current_setting('c16.e2')::UUID, '{"prueba": "c16"}');
UPDATE public.plantillas_presupuesto SET empresa_id = current_setting('c16.e2')::UUID
 WHERE id = pg_temp.plantilla('a');

SELECT CASE WHEN (SELECT bool_and(empresa_id::TEXT = current_setting('c16.e1'))
                    FROM public.plantillas_presupuesto WHERE ambito = 'tienda' AND config ? 'prueba')
             AND (SELECT count(*) FROM public.plantillas_presupuesto
                   WHERE ambito = 'textil' AND empresa_id = current_setting('c16.e2')::UUID) = 1
            THEN 'BIEN  11. la plantilla de una tienda se queda con la empresa de la tienda, aunque llegue otra; '
                 'la del textil, con la que se le da'
            ELSE 'MAL   11. una plantilla de tienda ha quedado en otra empresa que la de su tienda' END;

-- ---------------------------------------------------------------------------
-- 12-13. La RLS, como llega desde el navegador
-- ---------------------------------------------------------------------------
-- Ejecuta una sentencia como el usuario _quien, con el rol authenticated y su
-- JWT. Devuelve el número de filas (lo que cuenta un SELECT count(*), o las
-- afectadas por un INSERT, UPDATE o DELETE), o «error» y el SQLSTATE. Si
-- falla, el bloque se deshace entero y el rol y el JWT vuelven a ser los de
-- antes. (La misma que en C11_politicas_por_operacion.sql.)
CREATE OR REPLACE FUNCTION pg_temp.como(_quien TEXT, _sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('c16.' || _quien), true);
  SET LOCAL ROLE authenticated;
  IF _sql ~* '^\s*select' THEN
    EXECUTE _sql INTO v_n;
  ELSE
    EXECUTE _sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_n::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE;
END $$;

-- Un caso: NULL si sale lo esperado; si no, qué ha fallado.
CREATE OR REPLACE FUNCTION pg_temp.caso(_que TEXT, _quien TEXT, _sql TEXT, _esperado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT := pg_temp.como(_quien, _sql);
BEGIN
  IF v = _esperado THEN RETURN NULL; END IF;
  RETURN _que || ' (esperaba ' || _esperado || ', salió ' || v || ')';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.informar(_etiqueta TEXT, _fallos TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v TEXT[] := array_remove(_fallos, NULL);
BEGIN
  IF cardinality(v) = 0 THEN
    RAISE NOTICE 'BIEN  %', _etiqueta;
  ELSE
    RAISE WARNING 'MAL   %: %', _etiqueta, array_to_string(v, '; ');
  END IF;
END $$;

-- 42501 es «insufficient_privilege»: lo que devuelve Postgres cuando la RLS
-- rechaza una fila nueva (WITH CHECK). En UPDATE y DELETE, la RLS no da error:
-- las filas que no puede tocar no las ve, y cambia 0.
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee la de su tienda', 'ua',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.a')::uuid$q$, '1');
  f := f || pg_temp.caso('ve la de B', 'ua',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.b')::uuid$q$, '0');
  f := f || pg_temp.caso('lee la de textil de su empresa', 'ua',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE ambito = 'textil' AND empresa_id = current_setting('c16.e1')::uuid$q$, '1');
  f := f || pg_temp.caso('ve la de textil de otra empresa', 'ua',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE ambito = 'textil' AND empresa_id = current_setting('c16.e2')::uuid$q$, '0');
  f := f || pg_temp.caso('cambia la de su tienda', 'ua',
    $q$UPDATE public.plantillas_presupuesto SET config = '{"prueba": "c16", "hackeo": true}' WHERE tienda_id = current_setting('c16.a')::uuid$q$, '0');
  f := f || pg_temp.caso('cambia la de textil', 'ua',
    $q$UPDATE public.plantillas_presupuesto SET logo_url = NULL WHERE ambito = 'textil'$q$, '0');
  f := f || pg_temp.caso('borra la de su tienda', 'ua',
    $q$DELETE FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.a')::uuid$q$, '0');
  f := f || pg_temp.caso('borra la de textil', 'ua',
    $q$DELETE FROM public.plantillas_presupuesto WHERE ambito = 'textil'$q$, '0');
  f := f || pg_temp.caso('da de alta la de textil de otra empresa', 'ua',
    $q$INSERT INTO public.plantillas_presupuesto (ambito, empresa_id) VALUES ('textil', gen_random_uuid())$q$, 'error 42501');
  f := f || pg_temp.caso('B lee la de A', 'ub',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.a')::uuid$q$, '0');
  f := f || pg_temp.caso('B lee la suya', 'ub',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.b')::uuid$q$, '1');
  f := f || pg_temp.caso('sin tienda lee algo', 'ux',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE config ? 'prueba'$q$, '0');
  PERFORM pg_temp.informar('12. quien no es administrador lee la plantilla de su tienda y la de textil de su '
                           'empresa, no ve las demás y no cambia ni borra ninguna', f);
END $$;

-- Las altas de quien no es administrador: en una tienda sin plantilla todavía,
-- para que lo que lo rechace sea la RLS y no el índice único.
DELETE FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.b')::UUID;
DELETE FROM public.plantillas_presupuesto WHERE ambito = 'textil' AND empresa_id = current_setting('c16.e1')::UUID;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('UB da de alta la de su tienda', 'ub',
    $q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id) VALUES ('tienda', current_setting('c16.b')::uuid)$q$, 'error 42501');
  f := f || pg_temp.caso('UA da de alta la de textil', 'ua',
    $q$INSERT INTO public.plantillas_presupuesto (ambito) VALUES ('textil')$q$, 'error 42501');
  f := f || pg_temp.caso('ADM da de alta la de B', 'adm',
    $q$INSERT INTO public.plantillas_presupuesto (ambito, tienda_id, config) VALUES ('tienda', current_setting('c16.b')::uuid, '{"prueba": "c16"}')$q$, '1');
  f := f || pg_temp.caso('ADM da de alta la de textil', 'adm',
    $q$INSERT INTO public.plantillas_presupuesto (ambito, config) VALUES ('textil', '{"prueba": "c16"}')$q$, '1');
  f := f || pg_temp.caso('ADM lee todas', 'adm',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE config ? 'prueba'$q$, '4');
  f := f || pg_temp.caso('ADM cambia la de A', 'adm',
    $q$UPDATE public.plantillas_presupuesto SET config = '{"prueba": "c16", "pie": {"texto": "{razon_social}"}}' WHERE tienda_id = current_setting('c16.a')::uuid$q$, '1');
  f := f || pg_temp.caso('ADM cambia la de textil', 'adm',
    $q$UPDATE public.plantillas_presupuesto SET logo_url = 'https://proyecto.supabase.co/storage/v1/object/public/logos/c16/marca.png' WHERE ambito = 'textil' AND empresa_id = current_setting('c16.e1')::uuid$q$, '1');
  f := f || pg_temp.caso('ADM borra la de B (vuelve a la de por defecto)', 'adm',
    $q$DELETE FROM public.plantillas_presupuesto WHERE tienda_id = current_setting('c16.b')::uuid$q$, '1');
  f := f || pg_temp.caso('el cambio de UA no ha llegado', 'adm',
    $q$SELECT count(*) FROM public.plantillas_presupuesto WHERE config ? 'hackeo'$q$, '0');
  PERFORM pg_temp.informar('13. quien no es administrador no da de alta ninguna; el administrador da de alta, '
                           'cambia y borra la de cualquier tienda y la del textil', f);
END $$;

-- ---------------------------------------------------------------------------
-- 14. La auditoría: alta, cambio y baja, con el autor de la sesión
-- ---------------------------------------------------------------------------
SELECT CASE WHEN array_agg(a.operacion ORDER BY a.id) @> ARRAY['INSERT', 'UPDATE', 'DELETE']
             AND bool_and(a.usuario_id = current_setting('c16.adm')::UUID)
             AND bool_and(a.empresa_id IS NOT NULL)
            THEN 'BIEN  14. las altas, cambios y bajas del administrador quedan en la auditoría, con él de autor y con la empresa'
            ELSE 'MAL   14. la auditoría de plantillas_presupuesto no tiene las tres operaciones con autor y empresa' END
  FROM public.auditoria a
 WHERE a.id > current_setting('c16.desde')::BIGINT
   AND a.tabla = 'plantillas_presupuesto'
   AND a.usuario_id IS NOT NULL;

SELECT CASE WHEN count(*) FILTER (WHERE a.operacion = 'INSERT') >= 5
             AND count(*) FILTER (WHERE a.operacion = 'UPDATE') >= 3
             AND count(*) FILTER (WHERE a.operacion = 'DELETE') >= 3
             AND NOT bool_or(COALESCE((a.datos_despues -> 'config') ? 'hackeo', false))
            THEN 'BIEN  14b. cada escritura deja su fila de auditoría (también las de sin sesión), '
                 'y los intentos rechazados no dejan ninguna'
            ELSE 'MAL   14b. faltan filas de auditoría o hay una de un cambio rechazado' END
  FROM public.auditoria a
 WHERE a.id > current_setting('c16.desde')::BIGINT
   AND a.tabla = 'plantillas_presupuesto';

-- ---------------------------------------------------------------------------
-- 15. Borrada la tienda, su plantilla se va con ella (y queda en la auditoría)
-- ---------------------------------------------------------------------------
SELECT set_config('c16.plantilla_a', pg_temp.plantilla('a')::TEXT, true);
DELETE FROM public.tiendas WHERE id = current_setting('c16.a')::UUID;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.plantillas_presupuesto
                              WHERE id = current_setting('c16.plantilla_a')::UUID)
             AND EXISTS (SELECT 1 FROM public.auditoria a
                          WHERE a.id > current_setting('c16.desde')::BIGINT
                            AND a.tabla = 'plantillas_presupuesto'
                            AND a.operacion = 'DELETE'
                            AND a.registro_id = current_setting('c16.plantilla_a'))
            THEN 'BIEN  15. borrada la tienda, su plantilla se borra en cascada y la baja queda registrada'
            ELSE 'MAL   15. borrada la tienda, su plantilla sigue ahí o su baja no está en la auditoría' END;

-- ---------------------------------------------------------------------------
-- 16. La cadena sigue intacta con las filas nuevas
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.auditoria_verificar())
            THEN 'BIEN  16. la cadena de auditoría sigue intacta'
            ELSE 'MAL   16. la cadena de auditoría está rota: '
                 || (SELECT string_agg(id || ' ' || motivo, '; ') FROM public.auditoria_verificar()) END;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 17. Deshecha la transacción, no queda nada de la prueba
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.plantillas_presupuesto WHERE config ? 'prueba')
             AND NOT EXISTS (SELECT 1 FROM public.tiendas WHERE slug LIKE 'tienda-c16-%')
             AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE razon_social = 'Otra empresa C16')
             AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@c16.test')
             AND NOT EXISTS (SELECT 1 FROM public.auditoria
                              WHERE tabla = 'plantillas_presupuesto'
                                AND COALESCE(datos_despues, datos_antes) ? 'config'
                                AND COALESCE(datos_despues, datos_antes) -> 'config' ? 'prueba')
            THEN 'BIEN  17. deshecha la prueba, no quedan ni las plantillas, ni las tiendas, ni los usuarios, ni su auditoría'
            ELSE 'MAL   17. la prueba ha dejado datos en la base' END;
