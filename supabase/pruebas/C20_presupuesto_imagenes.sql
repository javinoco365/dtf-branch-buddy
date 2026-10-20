-- ============================================================================
-- Imágenes de los presupuestos (tiendas y textil)
-- ============================================================================
-- Prueba 20261030100000_presupuesto_imagenes.sql. Se aplica otra vez, dos
-- veces (tiene que poder repetirse sin duplicar triggers ni políticas, y deja
-- los permisos como los deja la migración).
--
-- Todo va dentro de una transacción que se deshace al final: las tiendas, los
-- usuarios, los presupuestos y las imágenes de la prueba no se quedan en la
-- base. El punto 11 recorre la cadena de auditoría antes de deshacer; el 12
-- comprueba, ya deshecha, que no ha quedado rastro.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261030100000_presupuesto_imagenes.sql
\ir ../migrations/20261030100000_presupuesto_imagenes.sql
RESET client_min_messages;

-- ---------------------------------------------------------------------------
-- 1. La tabla: columnas, empresa obligatoria con su FK, cascadas y RLS
-- ---------------------------------------------------------------------------
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'presupuesto_imagenes'
                     AND column_name IN ('id', 'empresa_id', 'presupuesto_id', 'textil_presupuesto_id',
                                         'ruta', 'nombre', 'tipo_mime', 'bytes', 'ancho', 'alto',
                                         'orden', 'created_at')) = 12
             AND (SELECT is_nullable = 'NO' FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'presupuesto_imagenes'
                     AND column_name = 'empresa_id')
             AND (SELECT data_type = 'timestamp with time zone' FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'presupuesto_imagenes'
                     AND column_name = 'created_at')
             AND EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'public.presupuesto_imagenes'::regclass
                            AND contype = 'f' AND confrelid = 'public.empresas'::regclass)
             AND EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'public.presupuesto_imagenes'::regclass
                            AND contype = 'f' AND confdeltype = 'c'
                            AND confrelid = 'public.presupuestos'::regclass)
             AND EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'public.presupuesto_imagenes'::regclass
                            AND contype = 'f' AND confdeltype = 'c'
                            AND confrelid = 'public.textil_presupuestos'::regclass)
             AND (SELECT relrowsecurity FROM pg_class
                   WHERE oid = 'public.presupuesto_imagenes'::regclass)
            THEN 'BIEN  1. presupuesto_imagenes: columnas, empresa_id NOT NULL con FK, '
                 'cascada desde los dos presupuestos y RLS activada'
            ELSE 'MAL   1. a presupuesto_imagenes le falta algo: columnas, FK o RLS' END;

-- ---------------------------------------------------------------------------
-- 2. Aplicada dos veces, un trigger de cada: auditoría y empresa
-- ---------------------------------------------------------------------------
-- tgtype: AFTER INSERT OR UPDATE OR DELETE por fila = 1 + 4 + 8 + 16 = 29.
SELECT CASE WHEN (SELECT count(*) FROM pg_trigger
                   WHERE tgrelid = 'public.presupuesto_imagenes'::regclass
                     AND NOT tgisinternal) = 2
             AND EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.presupuesto_imagenes'::regclass
                            AND tgname = 'presupuesto_imagenes_auditoria'
                            AND tgfoid = 'public.auditoria_registrar'::regproc
                            AND (tgtype & 127) = 29)
             AND EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.presupuesto_imagenes'::regclass
                            AND tgname = 'presupuesto_imagenes_empresa'
                            AND tgfoid = 'public.presupuesto_imagenes_empresa'::regproc)
            THEN 'BIEN  2. aplicada dos veces: un trigger de auditoría y uno de empresa'
            ELSE 'MAL   2. los triggers de presupuesto_imagenes no son los que deben, o están repetidos' END;

-- ---------------------------------------------------------------------------
-- 3. Una política por operación, ninguna FOR ALL
-- ---------------------------------------------------------------------------
SELECT CASE WHEN array_agg(cmd::TEXT ORDER BY cmd::TEXT) = ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']
             AND bool_and(roles = ARRAY['authenticated']::NAME[])
            THEN 'BIEN  3. cuatro políticas, una por operación y solo para authenticated; ninguna FOR ALL'
            ELSE 'MAL   3. políticas de presupuesto_imagenes: ' || string_agg(policyname || ' ' || cmd, ', ') END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'presupuesto_imagenes';

-- ---------------------------------------------------------------------------
-- 4. Permisos: anon nada; authenticated, las cuatro operaciones; servicio, todo
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT has_table_privilege('anon', 'public.presupuesto_imagenes', 'SELECT')
             AND NOT has_table_privilege('anon', 'public.presupuesto_imagenes', 'INSERT')
             AND has_table_privilege('authenticated', 'public.presupuesto_imagenes', 'SELECT')
             AND has_table_privilege('authenticated', 'public.presupuesto_imagenes', 'INSERT')
             AND has_table_privilege('authenticated', 'public.presupuesto_imagenes', 'UPDATE')
             AND has_table_privilege('authenticated', 'public.presupuesto_imagenes', 'DELETE')
             AND NOT has_table_privilege('authenticated', 'public.presupuesto_imagenes', 'TRUNCATE')
             AND has_table_privilege('service_role', 'public.presupuesto_imagenes', 'DELETE')
             AND NOT has_function_privilege('authenticated',
                   'public.presupuesto_imagenes_empresa()', 'EXECUTE')
            THEN 'BIEN  4. anon no toca la tabla; authenticated lee y escribe (lo decide la RLS); el servicio, todo'
            ELSE 'MAL   4. los permisos de presupuesto_imagenes no son los de la migración' END;

-- ---------------------------------------------------------------------------
-- 5. El bucket: privado, solo imágenes y 5 MB; y sus tres políticas
-- ---------------------------------------------------------------------------
SELECT CASE WHEN EXISTS (SELECT 1 FROM storage.buckets
                          WHERE id = 'presupuestos' AND NOT public
                            AND file_size_limit = 5242880
                            AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'])
             AND (SELECT array_agg(cmd::TEXT ORDER BY cmd::TEXT) FROM pg_policies
                   WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname LIKE 'presupuestos_imagenes_%') = ARRAY['DELETE', 'INSERT', 'SELECT']
            THEN 'BIEN  5. bucket presupuestos privado, solo JPG/PNG/WEBP de hasta 5 MB, con lectura, alta y borrado'
            ELSE 'MAL   5. el bucket presupuestos o sus políticas no son los de la migración' END;

-- ---------------------------------------------------------------------------
-- Datos: dos tiendas, un presupuesto en cada una y uno textil. UA es de la
-- tienda A; UB, de la B; UX no es de ninguna.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c2000000-0000-4000-8000-00000000000a', 'ua@c20.test'),
  ('c2000000-0000-4000-8000-00000000000b', 'ub@c20.test'),
  ('c2000000-0000-4000-8000-00000000000c', 'ux@c20.test');

SELECT set_config('c20.ua', 'c2000000-0000-4000-8000-00000000000a', true),
       set_config('c20.ub', 'c2000000-0000-4000-8000-00000000000b', true),
       set_config('c20.ux', 'c2000000-0000-4000-8000-00000000000c', true),
       set_config('c20.desde', (SELECT COALESCE(max(id), 0)::TEXT FROM public.auditoria), true);

DO $$
DECLARE
  v_a UUID; v_b UUID; v_pa UUID; v_pb UUID; v_pt UUID; v_e UUID;
BEGIN
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C20 A', 'tienda-c20-a') RETURNING id INTO v_a;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C20 B', 'tienda-c20-b') RETURNING id INTO v_b;
  INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES
    (v_a, current_setting('c20.ua')::UUID),
    (v_b, current_setting('c20.ub')::UUID);
  INSERT INTO public.presupuestos (tienda_id, numero) VALUES (v_a, 'PRES-C20-A') RETURNING id INTO v_pa;
  INSERT INTO public.presupuestos (tienda_id, numero) VALUES (v_b, 'PRES-C20-B') RETURNING id INTO v_pb;
  INSERT INTO public.textil_presupuestos (numero) VALUES ('PRES-C20-T') RETURNING id INTO v_pt;
  SELECT empresa_id INTO v_e FROM public.presupuestos WHERE id = v_pa;

  PERFORM set_config('c20.e', v_e::TEXT, true);
  PERFORM set_config('c20.pa', v_pa::TEXT, true);
  PERFORM set_config('c20.pb', v_pb::TEXT, true);
  PERFORM set_config('c20.pt', v_pt::TEXT, true);
END $$;

-- Una ruta válida para un presupuesto: <empresa>/<ámbito>/<presupuesto>/<id>.<ext>.
CREATE OR REPLACE FUNCTION pg_temp.ruta(_ambito TEXT, _presupuesto TEXT, _ext TEXT DEFAULT 'jpg')
RETURNS TEXT LANGUAGE sql AS $$
  SELECT current_setting('c20.e') || '/' || _ambito || '/' || current_setting('c20.' || _presupuesto)
         || '/' || gen_random_uuid()::TEXT || '.' || _ext
$$;

-- Ejecuta _sql como _quien (rol authenticated con su JWT). Devuelve las filas
-- (lo que cuenta un SELECT count(*), o las afectadas), o «error» y el SQLSTATE.
CREATE OR REPLACE FUNCTION pg_temp.como(_quien TEXT, _sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('c20.' || _quien), true);
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

-- ---------------------------------------------------------------------------
-- 6. Las restricciones: un solo presupuesto, tipo, tamaño y ruta
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fallos TEXT[] := ARRAY[]::TEXT[];
BEGIN
  BEGIN
    INSERT INTO public.presupuesto_imagenes (ruta, tipo_mime, bytes)
    VALUES (pg_temp.ruta('tienda', 'pa'), 'image/jpeg', 10);
    v_fallos := v_fallos || 'sin presupuesto aceptada'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (presupuesto_id, textil_presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pa')::UUID, current_setting('c20.pt')::UUID,
            pg_temp.ruta('tienda', 'pa'), 'image/jpeg', 10);
    v_fallos := v_fallos || 'con los dos presupuestos aceptada'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pa')::UUID, pg_temp.ruta('tienda', 'pa', 'gif'), 'image/gif', 10);
    v_fallos := v_fallos || 'un GIF aceptado'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pa')::UUID, pg_temp.ruta('tienda', 'pa'), 'image/jpeg', 6000000);
    v_fallos := v_fallos || 'más de 5 MB aceptado'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pa')::UUID, '../otra/cosa.jpg', 'image/jpeg', 10);
    v_fallos := v_fallos || 'una ruta fuera de su carpeta aceptada'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pa')::UUID, pg_temp.ruta('tienda', 'pb'), 'image/jpeg', 10);
    v_fallos := v_fallos || 'una ruta de otro presupuesto aceptada'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pa')::UUID,
            replace(pg_temp.ruta('tienda', 'pa'), current_setting('c20.e'), gen_random_uuid()::TEXT),
            'image/jpeg', 10);
    v_fallos := v_fallos || 'una ruta de otra empresa aceptada'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.presupuesto_imagenes (textil_presupuesto_id, ruta, tipo_mime, bytes)
    VALUES (current_setting('c20.pt')::UUID,
            replace(pg_temp.ruta('textil', 'pt'), '/textil/', '/tienda/'), 'image/jpeg', 10);
    v_fallos := v_fallos || 'una ruta textil en la carpeta de tienda aceptada'::TEXT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.informar('6. sin presupuesto, con los dos, un GIF, más de 5 MB, una ruta rara o la '
                           'carpeta de otro presupuesto, empresa o ámbito: rechazados',
                           v_fallos);
END $$;

-- ---------------------------------------------------------------------------
-- 7. La empresa la pone el trigger: la del presupuesto, llegue la que llegue
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_otra UUID; v_id UUID; v_emp UUID;
BEGIN
  INSERT INTO public.empresas (razon_social, activa) VALUES ('Otra empresa C20', false) RETURNING id INTO v_otra;
  INSERT INTO public.presupuesto_imagenes (empresa_id, presupuesto_id, ruta, tipo_mime, bytes)
  VALUES (v_otra, current_setting('c20.pa')::UUID, pg_temp.ruta('tienda', 'pa'), 'image/jpeg', 10)
  RETURNING id, empresa_id INTO v_id, v_emp;
  IF v_emp = current_setting('c20.e')::UUID THEN
    RAISE NOTICE 'BIEN  7. la imagen lleva la empresa de su presupuesto aunque llegue otra';
  ELSE
    RAISE WARNING 'MAL   7. la imagen se ha quedado con la empresa que llegaba';
  END IF;
  DELETE FROM public.presupuesto_imagenes WHERE id = v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 8. RLS: cada uno, las imágenes de lo que ve
-- ---------------------------------------------------------------------------
INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, nombre, tipo_mime, bytes, ancho, alto)
VALUES (current_setting('c20.pa')::UUID, pg_temp.ruta('tienda', 'pa'), 'diseño A', 'image/jpeg', 100, 800, 600),
       (current_setting('c20.pb')::UUID, pg_temp.ruta('tienda', 'pb'), 'diseño B', 'image/png', 100, 800, 600);
INSERT INTO public.presupuesto_imagenes (textil_presupuesto_id, ruta, nombre, tipo_mime, bytes)
VALUES (current_setting('c20.pt')::UUID, pg_temp.ruta('textil', 'pt', 'webp'), 'camiseta', 'image/webp', 100);

SELECT pg_temp.informar('8. UA ve y toca las de su tienda y las del textil de su empresa; ni las de la '
                        'otra tienda ni nada quien no es de ninguna', ARRAY[
  pg_temp.caso('UA ve las suyas', 'ua',
    format('SELECT count(*) FROM public.presupuesto_imagenes WHERE presupuesto_id = %L', current_setting('c20.pa')), '1'),
  pg_temp.caso('UA no ve las de B', 'ua',
    format('SELECT count(*) FROM public.presupuesto_imagenes WHERE presupuesto_id = %L', current_setting('c20.pb')), '0'),
  pg_temp.caso('UA ve las del textil de su empresa', 'ua',
    format('SELECT count(*) FROM public.presupuesto_imagenes WHERE textil_presupuesto_id = %L', current_setting('c20.pt')), '1'),
  pg_temp.caso('UX no ve ninguna', 'ux',
    'SELECT count(*) FROM public.presupuesto_imagenes', '0'),
  pg_temp.caso('UA da de alta en su presupuesto', 'ua',
    format('INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes) VALUES (%L, %L, %L, 5)',
           current_setting('c20.pa'), pg_temp.ruta('tienda', 'pa'), 'image/jpeg'), '1'),
  pg_temp.caso('UB no da de alta en el presupuesto de A', 'ub',
    format('INSERT INTO public.presupuesto_imagenes (presupuesto_id, ruta, tipo_mime, bytes) VALUES (%L, %L, %L, 5)',
           current_setting('c20.pa'), pg_temp.ruta('tienda', 'pa'), 'image/jpeg'), 'error 42501'),
  pg_temp.caso('UA no apunta una suya al fichero de otro presupuesto', 'ua',
    format('UPDATE public.presupuesto_imagenes SET ruta = %L WHERE presupuesto_id = %L',
           pg_temp.ruta('tienda', 'pb'), current_setting('c20.pa')), 'error 23514'),
  pg_temp.caso('UA cambia el orden de una suya', 'ua',
    format('UPDATE public.presupuesto_imagenes SET orden = 3 WHERE presupuesto_id = %L AND nombre = %L',
           current_setting('c20.pa'), 'diseño A'), '1'),
  pg_temp.caso('UB no borra las de A', 'ub',
    format('DELETE FROM public.presupuesto_imagenes WHERE presupuesto_id = %L', current_setting('c20.pa')), '0'),
  pg_temp.caso('UA borra una suya', 'ua',
    format('DELETE FROM public.presupuesto_imagenes WHERE presupuesto_id = %L AND nombre = %L',
           current_setting('c20.pa'), ''), '1')
]);

-- ---------------------------------------------------------------------------
-- 9. El bucket: el fichero lo lee quien ve la fila de su imagen
-- ---------------------------------------------------------------------------
GRANT SELECT ON storage.objects TO authenticated;
INSERT INTO storage.objects (bucket_id, name)
SELECT 'presupuestos', ruta FROM public.presupuesto_imagenes
 WHERE presupuesto_id IN (current_setting('c20.pa')::UUID, current_setting('c20.pb')::UUID);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('presupuestos', current_setting('c20.e') || '/tienda/huerfano/sin-fila.jpg');

SELECT pg_temp.informar('9. en el bucket, UA lee el fichero de su imagen y no el de la otra tienda '
                        'ni uno sin fila', ARRAY[
  pg_temp.caso('UA lee el de A', 'ua',
    format('SELECT count(*) FROM storage.objects o JOIN public.presupuesto_imagenes i ON i.ruta = o.name '
           'WHERE o.bucket_id = %L', 'presupuestos'), '1'),
  pg_temp.caso('UA no lee el de B ni el huérfano', 'ua',
    format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L', 'presupuestos'), '1'),
  pg_temp.caso('UB lee el de B', 'ub',
    format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L', 'presupuestos'), '1')
]);

-- ---------------------------------------------------------------------------
-- 10. Borrado el presupuesto, sus imágenes se van con él (y queda en la auditoría)
-- ---------------------------------------------------------------------------
SELECT set_config('c20.imagen_b',
  (SELECT id::TEXT FROM public.presupuesto_imagenes WHERE presupuesto_id = current_setting('c20.pb')::UUID),
  true);
DELETE FROM public.presupuestos WHERE id = current_setting('c20.pb')::UUID;
DELETE FROM public.textil_presupuestos WHERE id = current_setting('c20.pt')::UUID;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.presupuesto_imagenes
                              WHERE presupuesto_id = current_setting('c20.pb')::UUID
                                 OR textil_presupuesto_id = current_setting('c20.pt')::UUID)
             AND EXISTS (SELECT 1 FROM public.auditoria a
                          WHERE a.id > current_setting('c20.desde')::BIGINT
                            AND a.tabla = 'presupuesto_imagenes'
                            AND a.operacion = 'DELETE'
                            AND a.registro_id = current_setting('c20.imagen_b'))
            THEN 'BIEN  10. borrado el presupuesto (de tienda o textil), sus imágenes se borran en cascada y queda registrado'
            ELSE 'MAL   10. borrado el presupuesto, sus imágenes siguen ahí o la baja no está en la auditoría' END;

-- ---------------------------------------------------------------------------
-- 11. La cadena sigue intacta con las filas nuevas
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.auditoria_verificar())
            THEN 'BIEN  11. la cadena de auditoría sigue intacta'
            ELSE 'MAL   11. la cadena de auditoría está rota: '
                 || (SELECT string_agg(id || ' ' || motivo, '; ') FROM public.auditoria_verificar()) END;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 12. Deshecha la transacción, no queda nada de la prueba
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.presupuesto_imagenes)
             AND NOT EXISTS (SELECT 1 FROM public.tiendas WHERE slug LIKE 'tienda-c20-%')
             AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@c20.test')
             AND NOT EXISTS (SELECT 1 FROM public.auditoria WHERE tabla = 'presupuesto_imagenes')
            THEN 'BIEN  12. deshecha la prueba, no quedan ni imágenes, ni tiendas, ni usuarios, ni su auditoría'
            ELSE 'MAL   12. la prueba ha dejado datos en la base' END;
