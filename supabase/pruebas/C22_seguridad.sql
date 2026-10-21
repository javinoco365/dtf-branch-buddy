-- ============================================================================
-- Seguridad: vistas, funciones SECURITY DEFINER y privilegios
-- ============================================================================
-- Prueba 20261031300000_seguridad_funciones_y_privilegios.sql y, además, deja
-- tres controles generales que fallan si vuelve a aparecer el mismo tipo de
-- fallo en una migración futura (SEG-11):
--   - una vista de public sin security_invoker, o que anon pueda leer;
--   - una función con _usuario_id que authenticated o anon puedan ejecutar sin
--     comprobar que _usuario_id es auth.uid();
--   - una función SECURITY DEFINER que anon pueda ejecutar (salvo triggers);
--   - TRUNCATE, TRIGGER o REFERENCES para anon o authenticated.
-- Las políticas USING(true) en tablas con empresa_id (SEG-03) se listan como
-- PENDIENTE (las cierra la rama de políticas); una que no esté en la lista de
-- conocidas sale MAL. Las cuatro de lectura que quedaban las cierra
-- 20261031300100 (casos 37 a 40) y ya no están entre las conocidas.
--
-- Todo va dentro de una transacción que se deshace al final.
-- ============================================================================

-- Varias pruebas anteriores vuelven a aplicar migraciones viejas (C5, C18,
-- C19...) y con eso recrean banco_conciliar, textil_stock_retirar o
-- serie_estado como estaban. En producción las migraciones van en orden una
-- vez; aquí se vuelve a aplicar la de seguridad para probar lo que de verdad
-- queda.
SET client_min_messages = warning;
\ir ../migrations/20261031300000_seguridad_funciones_y_privilegios.sql
\ir ../migrations/20261031300100_seguridad_lectura_por_empresa.sql
RESET client_min_messages;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('c2100000-0000-0000-0000-00000000000a', 'c21-admin@ejemplo.es'),
  ('c2100000-0000-0000-0000-00000000000b', 'c21-ajeno@ejemplo.es');
INSERT INTO public.user_roles (user_id, role)
VALUES ('c2100000-0000-0000-0000-00000000000a', 'admin');

SELECT set_config('c21.adm',   'c2100000-0000-0000-0000-00000000000a', true),
       set_config('c21.ajeno', 'c2100000-0000-0000-0000-00000000000b', true),
       set_config('c21.empresa', (SELECT id::TEXT FROM public.empresas WHERE activa
                                   ORDER BY created_at LIMIT 1), true),
       set_config('c21.tienda', (SELECT id::TEXT FROM public.tiendas ORDER BY created_at LIMIT 1), true);

-- Una variante y un pedido textil de la empresa, para probar las funciones
-- que escriben.
DO $$
DECLARE v_prod UUID; v_stock UUID; v_ped UUID;
BEGIN
  INSERT INTO public.textil_productos (empresa_id, nombre)
  VALUES (current_setting('c21.empresa')::uuid, 'C21 camiseta') RETURNING id INTO v_prod;
  INSERT INTO public.textil_stock (empresa_id, producto_id, nombre, talla, color)
  VALUES (current_setting('c21.empresa')::uuid, v_prod, 'C21 camiseta', 'M', 'Negro')
  RETURNING id INTO v_stock;
  INSERT INTO public.textil_pedidos (empresa_id, numero)
  VALUES (current_setting('c21.empresa')::uuid, 'C21-PED-1') RETURNING id INTO v_ped;
  PERFORM set_config('c21.stock', v_stock::TEXT, true);
  PERFORM set_config('c21.pedido', v_ped::TEXT, true);
END $$;

-- Ejecuta una sentencia como un usuario con sesión (rol authenticated) o como
-- anon, y devuelve lo que salga: el número, el texto o 'error <SQLSTATE>'.
CREATE OR REPLACE FUNCTION pg_temp.como(_quien TEXT, _sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  IF _quien = 'anon' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE anon;
  ELSE
    PERFORM set_config('request.jwt.claim.sub', current_setting('c21.' || _quien), true);
    SET LOCAL ROLE authenticated;
  END IF;
  IF _sql ~* '^\s*select' THEN
    EXECUTE _sql INTO v;
  ELSE
    EXECUTE _sql;
    v := 'hecho';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.caso(_n TEXT, _que TEXT, _quien TEXT, _sql TEXT, _esperado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT := pg_temp.como(_quien, _sql);
BEGIN
  IF v IS NOT DISTINCT FROM _esperado THEN RETURN 'BIEN  ' || _n || '. ' || _que; END IF;
  RETURN 'MAL   ' || _n || '. ' || _que || ' (esperaba ' || coalesce(_esperado, 'nulo')
         || ', salió ' || coalesce(v, 'nulo') || ')';
END $$;

-- ---------------------------------------------------------------------------
-- SEG-01: la vista de duplicados
-- ---------------------------------------------------------------------------
SELECT pg_temp.caso('1', 'anon no lee clientes_duplicados_por_email', 'anon',
  $q$SELECT count(*)::text FROM public.clientes_duplicados_por_email$q$, 'error 42501');
SELECT pg_temp.caso('2', 'anon no lee pedidos_pendientes_cobro', 'anon',
  $q$SELECT count(*)::text FROM public.pedidos_pendientes_cobro$q$, 'error 42501');
SELECT CASE WHEN (SELECT reloptions FROM pg_class
                   WHERE oid = 'public.clientes_duplicados_por_email'::regclass)
                 @> ARRAY['security_invoker=true']
            THEN 'BIEN  3. clientes_duplicados_por_email respeta la RLS (security_invoker)'
            ELSE 'MAL   3. clientes_duplicados_por_email sigue sin security_invoker' END;

-- Con dos fichas con el mismo correo, quien no es de la empresa no ve nada.
INSERT INTO public.clientes (empresa_id, tienda_id, nombre, email)
SELECT current_setting('c21.empresa')::uuid, NULL, 'C21 Cliente ' || g, 'c21-dup@ejemplo.es'
  FROM generate_series(1, 2) g;
SELECT pg_temp.caso('4', 'una cuenta sin rol ni tienda no ve los duplicados de la empresa', 'ajeno',
  $q$SELECT count(*)::text FROM public.clientes_duplicados_por_email WHERE email = 'c21-dup@ejemplo.es'$q$, '0');
SELECT pg_temp.caso('5', 'el administrador sí los ve', 'adm',
  $q$SELECT count(*)::text FROM public.clientes_duplicados_por_email WHERE email = 'c21-dup@ejemplo.es'$q$, '1');

-- ---------------------------------------------------------------------------
-- SEG-02: conciliar firmando como otro
-- ---------------------------------------------------------------------------
SELECT pg_temp.caso('6', 'banco_conciliar con el _usuario_id de otro se niega', 'ajeno',
  format($q$SELECT public.banco_conciliar(%L::uuid, gen_random_uuid(), gen_random_uuid(), 'manual')::text$q$,
         current_setting('c21.adm')), 'error 42501');
SELECT pg_temp.caso('7', 'banco_desconciliar con el _usuario_id de otro se niega', 'ajeno',
  format($q$SELECT public.banco_desconciliar(%L::uuid, gen_random_uuid())::text$q$,
         current_setting('c21.adm')), 'error 42501');
SELECT pg_temp.caso('8', 'banco_desconciliar con el propio _usuario_id pasa la comprobación', 'adm',
  format($q$SELECT public.banco_desconciliar(%L::uuid, gen_random_uuid())::text$q$,
         current_setting('c21.adm')), 'false');

-- ---------------------------------------------------------------------------
-- SEG-04: funciones que escriben en lo ajeno
-- ---------------------------------------------------------------------------
SELECT pg_temp.caso('9', 'textil_pedido_entregar de un pedido ajeno se niega', 'ajeno',
  format($q$SELECT public.textil_pedido_entregar(%L::uuid)::text$q$, current_setting('c21.pedido')),
  'error 42501');
SELECT pg_temp.caso('10', 'textil_pedido_entregar del propio pedido funciona', 'adm',
  format($q$SELECT public.textil_pedido_entregar(%L::uuid)::text$q$, current_setting('c21.pedido')),
  '0');
SELECT pg_temp.caso('11', 'textil_stock_retirar de una variante ajena se niega', 'ajeno',
  format($q$SELECT public.textil_stock_retirar(%L::uuid)$q$, current_setting('c21.stock')),
  'error 42501');
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.textil_stock WHERE id = current_setting('c21.stock')::uuid)
            THEN 'BIEN  12. y la variante sigue ahí'
            ELSE 'MAL   12. la variante ajena se ha borrado' END;
SELECT pg_temp.caso('13', 'siguiente_numero de otra empresa se niega', 'ajeno',
  format($q$SELECT public.siguiente_numero(%L::uuid, 'c21', 2026)::text$q$, current_setting('c21.empresa')),
  'error 42501');
SELECT pg_temp.caso('14', 'siguiente_numero de la propia empresa funciona', 'adm',
  format($q$SELECT public.siguiente_numero(%L::uuid, 'c21', 2026)::text$q$, current_setting('c21.empresa')),
  '1');
SELECT CASE WHEN public.siguiente_numero(current_setting('c21.empresa')::uuid, 'c21', 2026) = 2
            THEN 'BIEN  15. desde el servidor (sin sesión) sigue igual'
            ELSE 'MAL   15. sin sesión ya no numera' END;
SELECT pg_temp.caso('16', 'plantillas_correo_sembrar de una tienda ajena se niega', 'ajeno',
  format($q$SELECT public.plantillas_correo_sembrar(%L::uuid)::text$q$, current_setting('c21.tienda')),
  'error 42501');

-- ---------------------------------------------------------------------------
-- SEG-04: funciones que leen lo ajeno
-- ---------------------------------------------------------------------------
SELECT pg_temp.caso('17', 'tienda_resumen_borrado de una tienda ajena se niega', 'ajeno',
  format($q$SELECT public.tienda_resumen_borrado(%L::uuid)::text$q$, current_setting('c21.tienda')),
  'error 42501');
SELECT pg_temp.caso('18', 'tienda_resumen_borrado de la propia tienda funciona', 'adm',
  format($q$SELECT (public.tienda_resumen_borrado(%L::uuid) ? 'pedidos')::text$q$, current_setting('c21.tienda')),
  'true');
SELECT pg_temp.caso('19', 'serie_estado de otra empresa no devuelve nada', 'ajeno',
  format($q$SELECT count(*)::text FROM public.serie_estado(%L::uuid, 2026)$q$, current_setting('c21.empresa')),
  '0');
SELECT pg_temp.caso('20', 'serie_estado de la propia empresa: las tres series', 'adm',
  format($q$SELECT count(*)::text FROM public.serie_estado(%L::uuid, 2026)$q$, current_setting('c21.empresa')),
  '3');
SELECT pg_temp.caso('21', 'smtp_estado general: nada para quien no es de la empresa', 'ajeno',
  $q$SELECT count(*)::text FROM public.smtp_estado(NULL)$q$, '0');

-- Un descuadre a propósito (solo en esta transacción) para ver quién lo ve.
ALTER TABLE public.textil_stock DISABLE TRIGGER USER;
UPDATE public.textil_stock SET cantidad = 7, cantidad_reservada = 3
 WHERE id = current_setting('c21.stock')::uuid;
ALTER TABLE public.textil_stock ENABLE TRIGGER USER;
SELECT pg_temp.caso('22', 'stock_descuadres: quien no es de la empresa no lo ve', 'ajeno',
  $q$SELECT count(*)::text FROM public.stock_descuadres() WHERE stock_id = current_setting('c21.stock')::uuid$q$, '0');
SELECT pg_temp.caso('23', 'stock_descuadres: el administrador sí', 'adm',
  $q$SELECT count(*)::text FROM public.stock_descuadres() WHERE stock_id = current_setting('c21.stock')::uuid$q$, '1');
SELECT pg_temp.caso('24', 'stock_reservas_descuadres: quien no es de la empresa no lo ve', 'ajeno',
  $q$SELECT count(*)::text FROM public.stock_reservas_descuadres() WHERE stock_id = current_setting('c21.stock')::uuid$q$, '0');
SELECT pg_temp.caso('25', 'facturas_huecos_en_serie: quien no es de la empresa no ve nada', 'ajeno',
  $q$SELECT count(*)::text FROM public.facturas_huecos_en_serie()$q$, '0');
SELECT pg_temp.caso('26', 'auditoria_verificar ya no se llama desde el navegador', 'adm',
  $q$SELECT count(*)::text FROM public.auditoria_verificar()$q$, 'error 42501');
SELECT pg_temp.caso('27', 'serie_mayor_numero ya no se llama desde el navegador', 'adm',
  format($q$SELECT public.serie_mayor_numero(%L::uuid, 'F', 2026)::text$q$, current_setting('c21.empresa')),
  'error 42501');

-- ---------------------------------------------------------------------------
-- SEG-10: TRUNCATE
-- ---------------------------------------------------------------------------
SELECT pg_temp.caso('28', 'authenticated no puede vaciar facturas con TRUNCATE', 'adm',
  $q$TRUNCATE public.facturas CASCADE$q$, 'error 42501');

-- ---------------------------------------------------------------------------
-- SEG-07: límites de los buckets
-- ---------------------------------------------------------------------------
SELECT CASE WHEN file_size_limit = 10485760 AND allowed_mime_types @> ARRAY['application/pdf']
                 AND NOT allowed_mime_types @> ARRAY['text/html']
            THEN 'BIEN  29. el bucket compras limita tamaño y tipo'
            ELSE 'MAL   29. el bucket compras no limita tamaño o tipo' END
  FROM storage.buckets WHERE id = 'compras';
SELECT CASE WHEN allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
            THEN 'BIEN  30. el bucket logos solo admite imágenes PNG, JPG y WEBP'
            ELSE 'MAL   30. el bucket logos admite cualquier tipo' END
  FROM storage.buckets WHERE id = 'logos';

-- ---------------------------------------------------------------------------
-- Controles generales (SEG-11): fallan si vuelve el mismo tipo de fallo
-- ---------------------------------------------------------------------------
SELECT CASE WHEN count(*) = 0 THEN 'BIEN  31. todas las vistas de public usan security_invoker'
            ELSE 'MAL   31. vistas sin security_invoker: ' || string_agg(c.relname, ', ') END
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
   AND NOT coalesce(array_to_string(c.reloptions, ',') ~ 'security_invoker=(true|on|1)', false);

SELECT CASE WHEN count(*) = 0 THEN 'BIEN  32. anon no tiene ningún permiso sobre las vistas de public'
            ELSE 'MAL   32. anon puede leer: ' || string_agg(c.relname, ', ') END
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
   AND has_table_privilege('anon', c.oid, 'SELECT');

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  33. ninguna función con _usuario_id se deja al navegador sin comprobar quién llama'
            ELSE 'MAL   33. funciones con _usuario_id abiertas: ' || string_agg(p.proname, ', ') END
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND pg_get_function_identity_arguments(p.oid) ~ '(^|, )_usuario_id '
   AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'))
   AND p.prosrc !~ '_usuario_id IS DISTINCT FROM auth\.uid\(\)'
   -- rol_exigir_quien() (niveles, 20261031200100) no escribe ni fija autor:
   -- solo exige el nivel de _usuario_id, del JWT y del autor, y nunca afloja
   -- (el usuario del JWT se comprueba siempre). Es la primera línea de las
   -- funciones que sí escriben.
   AND p.proname <> 'rol_exigir_quien';

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  34. anon no ejecuta ninguna función SECURITY DEFINER (salvo triggers)'
            ELSE 'MAL   34. SECURITY DEFINER para anon: ' || string_agg(p.proname, ', ') END
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
   AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
   AND has_function_privilege('anon', p.oid, 'EXECUTE');

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  35. ni anon ni authenticated tienen TRUNCATE, TRIGGER o REFERENCES en public'
            ELSE 'MAL   35. permisos de más en: ' || string_agg(DISTINCT c.relname, ', ') END
  FROM pg_class c
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rol)
  CROSS JOIN (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS p(priv)
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
   AND has_table_privilege(r.rol, c.oid, p.priv);

-- Políticas abiertas en tablas con empresa_id. Las conocidas (SEG-03) salen
-- como PENDIENTE hasta que la rama de políticas las cierre; una nueva, MAL.
WITH abiertas AS (
  SELECT p.tablename || ' ' || p.cmd AS cual
    FROM pg_policies p
    JOIN information_schema.columns col
      ON col.table_schema = 'public' AND col.table_name = p.tablename
     AND col.column_name = 'empresa_id'
   WHERE p.schemaname = 'public'
     AND (btrim(coalesce(p.qual, '')) = 'true' OR btrim(coalesce(p.with_check, '')) = 'true')
), conocidas(cual) AS (VALUES
  ('banco_conciliaciones SELECT'), ('banco_movimientos INSERT'),
  ('textil_stock_movimientos INSERT'), ('textil_stock_reservas INSERT'),
  ('textil_stock_reservas UPDATE'), ('textil_stock_reservas DELETE'))
SELECT CASE WHEN a.cual IN (SELECT cual FROM conocidas)
            THEN 'PENDIENTE (SEG-03) política abierta: ' || a.cual
            ELSE 'MAL   36. política USING/WITH CHECK (true) nueva en una tabla con empresa_id: ' || a.cual END
  FROM abiertas a ORDER BY 1;
SELECT 'BIEN  36. ninguna política abierta nueva en tablas con empresa_id'
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_policies p
     JOIN information_schema.columns col
       ON col.table_schema = 'public' AND col.table_name = p.tablename AND col.column_name = 'empresa_id'
    WHERE p.schemaname = 'public'
      AND (btrim(coalesce(p.qual, '')) = 'true' OR btrim(coalesce(p.with_check, '')) = 'true')
      AND p.tablename || ' ' || p.cmd NOT IN (
        'banco_conciliaciones SELECT', 'banco_movimientos INSERT',
        'textil_stock_movimientos INSERT', 'textil_stock_reservas INSERT',
        'textil_stock_reservas UPDATE', 'textil_stock_reservas DELETE'));


-- ---------------------------------------------------------------------------
-- SEG-03 (lectura): 20261031300100 cierra las cuatro políticas de SELECT
-- ---------------------------------------------------------------------------
INSERT INTO public.contadores (empresa_id, ambito, ejercicio, ultimo)
VALUES (current_setting('c21.empresa')::uuid, 'c22_prueba', 2026, 7);

SELECT CASE WHEN count(*) = 4
            THEN 'BIEN  37. las cuatro políticas de lectura filtran por mis_empresas()'
            ELSE 'MAL   37. políticas de lectura sin mis_empresas(): ' || (4 - count(*))::text END
  FROM pg_policies
 WHERE schemaname = 'public' AND cmd = 'SELECT'
   AND (tablename, policyname) IN (
     ('banco_movimientos', 'banco lectura'),
     ('contadores', 'contadores lectura'),
     ('textil_stock_movimientos', 'movimientos lectura autenticados'),
     ('textil_stock_reservas', 'reservas lectura'))
   AND qual ~ 'mis_empresas';
SELECT pg_temp.caso('38', 'una cuenta sin rol ni tienda no lee los contadores de la empresa', 'ajeno',
  $q$SELECT count(*)::text FROM public.contadores WHERE ambito = 'c22_prueba'$q$, '0');
SELECT pg_temp.caso('39', 'el admin sigue leyendo los contadores de la empresa', 'adm',
  $q$SELECT count(*)::text FROM public.contadores WHERE ambito = 'c22_prueba'$q$, '1');

SET client_min_messages = warning;
\ir ../reversiones/20261031300100_seguridad_lectura_por_empresa.sql
RESET client_min_messages;
SELECT pg_temp.caso('40a', 'tras la reversión vuelve la lectura abierta (como antes)', 'ajeno',
  $q$SELECT count(*)::text FROM public.contadores WHERE ambito = 'c22_prueba'$q$, '1');
SET client_min_messages = warning;
\ir ../migrations/20261031300100_seguridad_lectura_por_empresa.sql
RESET client_min_messages;
SELECT pg_temp.caso('40b', 'y se puede volver a aplicar', 'ajeno',
  $q$SELECT count(*)::text FROM public.contadores WHERE ambito = 'c22_prueba'$q$, '0');

ROLLBACK;
