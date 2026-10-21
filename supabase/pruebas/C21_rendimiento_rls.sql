-- ============================================================================
-- Rendimiento: índices y políticas de lectura con mis_tiendas()/mis_empresas()
-- ============================================================================
-- Prueba 20261031100000_rendimiento_indices.sql y 20261031100100_rendimiento_rls.sql.
--
-- Lo que importa: que cada usuario lea EXACTAMENTE las mismas filas que con
-- las políticas de antes (is_tienda_member / es_miembro_empresa por fila).
-- Para cada tabla y cada usuario se compara lo que ve con la RLS nueva con lo
-- que dejaría ver la condición vieja, evaluada fila a fila como superusuario.
--
-- Todo va dentro de una transacción que se deshace al final: crea una segunda
-- empresa (inactiva), tiendas, usuarios y documentos que no deben quedarse.
BEGIN;

-- Permisos que Supabase concede por defecto sobre public y el shim no (igual
-- que en C11). Así lo que decide en cada caso es la RLS.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Algunas pruebas anteriores vuelven a ejecutar las migraciones de cobros,
-- clientes y compras, que recrean su política de lectura con la condición
-- vieja. Se aplican aquí otra vez para probar el estado que deja la
-- migración (en producción se aplica una vez, después de todas esas).
SET client_min_messages = warning;
\ir ../migrations/20261031100000_rendimiento_indices.sql
\ir ../migrations/20261031100100_rendimiento_rls.sql
RESET client_min_messages;

-- ---------------------------------------------------------------------------
-- 1. Índices
-- ---------------------------------------------------------------------------
SELECT CASE WHEN count(*) = 14
            THEN 'BIEN  1. están los catorce índices nuevos'
            ELSE 'MAL   1. faltan índices: '
                 || (SELECT string_agg(n, ', ') FROM unnest(ARRAY[
                       'textil_pedido_items_por_pedido', 'textil_factura_items_por_factura',
                       'textil_presupuesto_items_por_presupuesto', 'pedidos_por_cliente',
                       'textil_pedidos_por_cliente', 'facturas_por_cliente',
                       'textil_facturas_por_cliente', 'textil_pedidos_por_fecha',
                       'textil_facturas_por_fecha', 'pedidos_abiertos',
                       'enlaces_seguimiento_por_fecha', 'textil_stock_mov_por_pedido',
                       'tienda_usuarios_por_usuario', 'textil_facturas_rectifica_idx']) AS n
                     WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i
                                        WHERE i.schemaname = 'public' AND i.indexname = n)) END
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('textil_pedido_items_por_pedido', 'textil_factura_items_por_factura',
                     'textil_presupuesto_items_por_presupuesto', 'pedidos_por_cliente',
                     'textil_pedidos_por_cliente', 'facturas_por_cliente',
                     'textil_facturas_por_cliente', 'textil_pedidos_por_fecha',
                     'textil_facturas_por_fecha', 'pedidos_abiertos',
                     'enlaces_seguimiento_por_fecha', 'textil_stock_mov_por_pedido',
                     'tienda_usuarios_por_usuario', 'textil_facturas_rectifica_idx');

SELECT CASE WHEN pg_get_indexdef('public.textil_facturas_rectifica_idx'::regclass)
                 LIKE '%(rectifica_a_id) WHERE (rectifica_a_id IS NOT NULL)'
            THEN 'BIEN  2. textil_facturas_rectifica_idx: por rectifica_a_id, solo las que rectifican'
            ELSE 'MAL   2. textil_facturas_rectifica_idx: '
                 || pg_get_indexdef('public.textil_facturas_rectifica_idx'::regclass) END;

-- ---------------------------------------------------------------------------
-- 2. Funciones y forma de las políticas
-- ---------------------------------------------------------------------------
SELECT CASE WHEN (SELECT bool_and(p.prosecdef AND p.provolatile = 's')
                    FROM pg_proc p
                   WHERE p.oid IN ('public.mis_tiendas()'::regprocedure, 'public.mis_empresas()'::regprocedure))
             AND has_function_privilege('authenticated', 'public.mis_tiendas()', 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.mis_empresas()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.mis_tiendas()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.mis_empresas()', 'EXECUTE')
            THEN 'BIEN  3. mis_tiendas() y mis_empresas(): STABLE SECURITY DEFINER, solo para authenticated'
            ELSE 'MAL   3. mis_tiendas()/mis_empresas() no son STABLE SECURITY DEFINER o anon puede ejecutarlas' END;

CREATE TEMP TABLE c21_tablas (tabla TEXT PRIMARY KEY, politica TEXT, vieja TEXT) ON COMMIT DROP;
INSERT INTO c21_tablas VALUES
  ('pedidos',              'pedidos lectura',                'public.is_tienda_member(%s, t.tienda_id)'),
  ('facturas',             'facturas lectura miembros',      'public.is_tienda_member(%s, t.tienda_id)'),
  ('pedido_devoluciones',  'pedido_devoluciones lectura',    'public.is_tienda_member(%s, t.tienda_id)'),
  ('pedido_items',         'pedido_items lectura',           'EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = t.pedido_id AND public.is_tienda_member(%s, p.tienda_id))'),
  ('enlaces_seguimiento',  'enlaces_seguimiento lectura',    'EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = t.pedido_id AND public.is_tienda_member(%s, p.tienda_id))'),
  ('factura_items',        'factura_items lectura miembros', 'EXISTS (SELECT 1 FROM public.facturas f WHERE f.id = t.factura_id AND public.is_tienda_member(%s, f.tienda_id))'),
  ('cobros',               'cobros lectura',                 'public.es_miembro_empresa(%s, t.empresa_id)'),
  ('clientes',             'clientes lectura',               'public.es_miembro_empresa(%s, t.empresa_id)'),
  ('textil_pedidos',       'textil_pedidos_lectura',         'public.es_miembro_empresa(%s, t.empresa_id)'),
  ('textil_facturas',      'textil_facturas_lectura',        'public.es_miembro_empresa(%s, t.empresa_id)'),
  ('textil_compras',       'compras lectura',                'public.es_miembro_empresa(%s, t.empresa_id)'),
  ('textil_pedido_items',  'textil_pedido_items lectura',    'EXISTS (SELECT 1 FROM public.textil_pedidos p WHERE p.id = t.pedido_id AND public.es_miembro_empresa(%s, p.empresa_id))'),
  ('textil_factura_items', 'textil_factura_items lectura',   'EXISTS (SELECT 1 FROM public.textil_facturas p WHERE p.id = t.factura_id AND public.es_miembro_empresa(%s, p.empresa_id))');

-- Cada tabla: una sola política de lectura (ninguna FOR ALL), la de siempre
-- por nombre, para authenticated, con mis_tiendas()/mis_empresas().
CREATE OR REPLACE FUNCTION pg_temp.forma_nueva()
RETURNS TEXT LANGUAGE sql AS $$
  SELECT string_agg(c.tabla, ', ' ORDER BY c.tabla)
    FROM c21_tablas c
   WHERE (SELECT count(*) FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.tabla
             AND p.cmd IN ('SELECT', 'ALL')) <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.tabla
                        AND p.policyname = c.politica AND p.cmd = 'SELECT'
                        AND p.permissive = 'PERMISSIVE' AND p.roles = '{authenticated}'
                        AND (p.qual LIKE '%mis_tiendas()%' OR p.qual LIKE '%mis_empresas()%')
                        AND p.qual NOT LIKE '%is_tienda_member%'
                        AND p.qual NOT LIKE '%es_miembro_empresa%');
$$;

SELECT CASE WHEN pg_temp.forma_nueva() IS NULL
            THEN 'BIEN  4. las trece tablas: una sola política de lectura, la de siempre, con mis_tiendas()/mis_empresas()'
            ELSE 'MAL   4. no tienen la forma nueva: ' || pg_temp.forma_nueva() END;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND cmd = 'ALL')
            THEN 'BIEN  5. sigue sin haber ninguna política FOR ALL en public'
            ELSE 'MAL   5. hay políticas FOR ALL: '
                 || (SELECT string_agg(tablename || ' «' || policyname || '»', ', ')
                       FROM pg_policies WHERE schemaname = 'public' AND cmd = 'ALL') END;

SELECT CASE WHEN (SELECT count(*) FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'auditoria'
                     AND (qual LIKE '%mis_tiendas%' OR qual LIKE '%mis_empresas%')) = 0
            THEN 'BIEN  6. la política de lectura de auditoria no se ha tocado'
            ELSE 'MAL   6. la migración ha tocado la lectura de auditoria' END;

-- ---------------------------------------------------------------------------
-- Datos: dos tiendas de la empresa (A y B), una tienda C de otra empresa y
-- cinco usuarios. UA es de A; UB, de B; UC, de C; ADM es administrador y no
-- es de ninguna tienda; NADIE no es de ninguna tienda ni administrador.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c2100000-0000-4000-8000-00000000000a', 'ua@c21.test'),
  ('c2100000-0000-4000-8000-00000000000b', 'ub@c21.test'),
  ('c2100000-0000-4000-8000-00000000000c', 'uc@c21.test'),
  ('c2100000-0000-4000-8000-00000000000d', 'adm@c21.test'),
  ('c2100000-0000-4000-8000-00000000000e', 'nadie@c21.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c2100000-0000-4000-8000-00000000000d', 'admin');

CREATE TEMP TABLE c21_usuarios (quien TEXT PRIMARY KEY, id UUID) ON COMMIT DROP;
INSERT INTO c21_usuarios VALUES
  ('ua',    'c2100000-0000-4000-8000-00000000000a'),
  ('ub',    'c2100000-0000-4000-8000-00000000000b'),
  ('uc',    'c2100000-0000-4000-8000-00000000000c'),
  ('adm',   'c2100000-0000-4000-8000-00000000000d'),
  ('nadie', 'c2100000-0000-4000-8000-00000000000e');

DO $$
DECLARE
  v_e1 UUID := public.empresa_por_defecto();
  v_e2 UUID;
  v_a UUID; v_b UUID; v_c UUID;
  v_pa UUID; v_pb UUID; v_pc UUID;
  v_fa UUID; v_fb UUID;
  v_tp1 UUID; v_tp2 UUID; v_tf1 UUID; v_tf2 UUID;
BEGIN
  INSERT INTO public.empresas (razon_social, activa) VALUES ('Otra empresa C21', false) RETURNING id INTO v_e2;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C21 A', 'tienda-c21-a') RETURNING id INTO v_a;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C21 B', 'tienda-c21-b') RETURNING id INTO v_b;
  INSERT INTO public.tiendas (nombre, slug, empresa_id) VALUES ('Tienda C21 C', 'tienda-c21-c', v_e2) RETURNING id INTO v_c;

  INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES
    (v_a, 'c2100000-0000-4000-8000-00000000000a'),
    (v_b, 'c2100000-0000-4000-8000-00000000000b'),
    (v_c, 'c2100000-0000-4000-8000-00000000000c');

  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_a, 'C21-A') RETURNING id INTO v_pa;
  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_b, 'C21-B') RETURNING id INTO v_pb;
  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_c, 'C21-C') RETURNING id INTO v_pc;
  INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES
    (v_pa, 'C21 línea A'), (v_pb, 'C21 línea B'), (v_pc, 'C21 línea C');
  INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, importe) VALUES
    (v_pa, v_a, 1), (v_pb, v_b, 1), (v_pc, v_c, 1);
  INSERT INTO public.enlaces_seguimiento (pedido_id, codigo_seguimiento) VALUES
    (v_pa, 'C21-SEG-A'), (v_pb, 'C21-SEG-B'), (v_pc, 'C21-SEG-C');

  INSERT INTO public.facturas (tienda_id, serie, numero, ejercicio, fecha, estado)
  VALUES (v_a, 'C21', 1, 2026, DATE '2026-10-20', 'borrador') RETURNING id INTO v_fa;
  INSERT INTO public.facturas (tienda_id, serie, numero, ejercicio, fecha, estado)
  VALUES (v_b, 'C21', 2, 2026, DATE '2026-10-20', 'borrador') RETURNING id INTO v_fb;
  INSERT INTO public.factura_items (factura_id, descripcion) VALUES
    (v_fa, 'C21 línea factura A'), (v_fb, 'C21 línea factura B');

  INSERT INTO public.cobros (empresa_id, pedido_id, importe, metodo) VALUES
    (v_e1, v_pa, 1, 'tarjeta'), (v_e2, v_pc, 1, 'tarjeta');
  INSERT INTO public.clientes (nombre, empresa_id) VALUES
    ('Cliente C21 E1', v_e1), ('Cliente C21 E2', v_e2);

  INSERT INTO public.textil_pedidos (numero, empresa_id) VALUES ('C21-TP1', v_e1) RETURNING id INTO v_tp1;
  INSERT INTO public.textil_pedidos (numero, empresa_id) VALUES ('C21-TP2', v_e2) RETURNING id INTO v_tp2;
  INSERT INTO public.textil_pedido_items (pedido_id, descripcion) VALUES
    (v_tp1, 'C21 línea textil E1'), (v_tp2, 'C21 línea textil E2');
  INSERT INTO public.textil_facturas (numero, estado, empresa_id) VALUES ('C21-TF1', 'borrador', v_e1) RETURNING id INTO v_tf1;
  INSERT INTO public.textil_facturas (numero, estado, empresa_id) VALUES ('C21-TF2', 'borrador', v_e2) RETURNING id INTO v_tf2;
  INSERT INTO public.textil_factura_items (factura_id, descripcion) VALUES
    (v_tf1, 'C21 línea factura textil E1'), (v_tf2, 'C21 línea factura textil E2');
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero) VALUES
    (v_e1, 'Proveedor C21', 'C21-COMPRA-E1'), (v_e2, 'Proveedor C21', 'C21-COMPRA-E2');

  PERFORM set_config('c21.pa', v_pa::TEXT, true);
  PERFORM set_config('c21.pb', v_pb::TEXT, true);
  PERFORM set_config('c21.pc', v_pc::TEXT, true);
  PERFORM set_config('c21.e1', v_e1::TEXT, true);
  PERFORM set_config('c21.e2', v_e2::TEXT, true);
END $$;

-- Ids que ve _quien en _tabla con la RLS, como llega desde el navegador
-- (rol authenticated y su JWT). Ordenados y unidos en un texto.
CREATE OR REPLACE FUNCTION pg_temp.ve(_quien UUID, _tabla TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_quien::TEXT, ''), true);
  IF _quien IS NULL THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
  EXECUTE format('SELECT coalesce(string_agg(id::TEXT, '','' ORDER BY id), '''') FROM public.%I', _tabla) INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE || ' ' || SQLERRM;
END $$;

-- Ids que dejaría ver la condición de antes, fila a fila, sin RLS.
CREATE OR REPLACE FUNCTION pg_temp.veia(_quien UUID, _tabla TEXT, _vieja TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(t.id::TEXT, '','' ORDER BY t.id), '''') FROM public.%I t WHERE %s',
                 _tabla, format(_vieja, quote_literal(_quien) || '::uuid')) INTO v;
  RETURN v;
END $$;

-- Cuántas filas de los datos de aquí ve _quien en _tabla.
CREATE OR REPLACE FUNCTION pg_temp.cuenta(_quien TEXT, _sql TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT id::TEXT FROM c21_usuarios WHERE quien = _quien), true);
  SET LOCAL ROLE authenticated;
  EXECUTE _sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
END $$;

-- ---------------------------------------------------------------------------
-- 7. El mismo acceso: para cada tabla y cada usuario, lo que ve con la RLS
--    nueva es exactamente lo que dejaba ver la condición vieja.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.diferencias()
RETURNS TEXT LANGUAGE sql AS $$
  SELECT string_agg(c.tabla || ' para ' || u.quien, ', ' ORDER BY c.tabla, u.quien)
    FROM c21_tablas c CROSS JOIN c21_usuarios u
   WHERE pg_temp.ve(u.id, c.tabla) IS DISTINCT FROM pg_temp.veia(u.id, c.tabla, c.vieja);
$$;

SELECT CASE WHEN pg_temp.diferencias() IS NULL
            THEN 'BIEN  7. las trece tablas, cinco usuarios: cada uno ve exactamente las filas de antes'
            ELSE 'MAL   7. ven otras filas que antes: ' || pg_temp.diferencias() END;

SELECT CASE WHEN (SELECT bool_and(pg_temp.ve(NULL, c.tabla) = '' OR pg_temp.ve(NULL, c.tabla) LIKE 'error 42501%')
                    FROM c21_tablas c)
            THEN 'BIEN  8. anon no lee nada de las trece tablas'
            ELSE 'MAL   8. anon lee algo de: '
                 || (SELECT string_agg(c.tabla, ', ') FROM c21_tablas c
                      WHERE NOT (pg_temp.ve(NULL, c.tabla) = '' OR pg_temp.ve(NULL, c.tabla) LIKE 'error 42501%')) END;

-- Y, por si la comparación de 7 coincidiera por estar todo vacío, los casos
-- concretos de los datos de aquí.
DO $$
DECLARE f TEXT[] := '{}';
  pa TEXT := current_setting('c21.pa'); pb TEXT := current_setting('c21.pb'); pc TEXT := current_setting('c21.pc');
  e1 TEXT := current_setting('c21.e1'); e2 TEXT := current_setting('c21.e2');
BEGIN
  IF pg_temp.cuenta('ua', format('SELECT count(*) FROM public.pedidos WHERE id IN (%L, %L, %L)', pa, pb, pc)) <> 1 THEN f := f || 'UA no ve solo su pedido'::TEXT; END IF;
  IF pg_temp.cuenta('ua', format('SELECT count(*) FROM public.pedidos WHERE id = %L', pa)) <> 1 THEN f := f || 'UA no ve el pedido de A'::TEXT; END IF;
  IF pg_temp.cuenta('ub', format('SELECT count(*) FROM public.pedido_items WHERE pedido_id IN (%L, %L, %L)', pa, pb, pc)) <> 1 THEN f := f || 'UB no ve solo sus líneas'::TEXT; END IF;
  IF pg_temp.cuenta('ua', 'SELECT count(*) FROM public.facturas WHERE serie = ''C21''') <> 1 THEN f := f || 'UA no ve solo su factura'::TEXT; END IF;
  IF pg_temp.cuenta('ua', 'SELECT count(*) FROM public.factura_items WHERE descripcion LIKE ''C21 línea factura _''') <> 1 THEN f := f || 'UA no ve solo sus líneas de factura'::TEXT; END IF;
  IF pg_temp.cuenta('uc', format('SELECT count(*) FROM public.enlaces_seguimiento WHERE pedido_id IN (%L, %L, %L)', pa, pb, pc)) <> 1 THEN f := f || 'UC no ve solo su seguimiento'::TEXT; END IF;
  IF pg_temp.cuenta('adm', format('SELECT count(*) FROM public.pedido_devoluciones WHERE pedido_id IN (%L, %L, %L)', pa, pb, pc)) <> 3 THEN f := f || 'ADM no ve las tres devoluciones'::TEXT; END IF;
  IF pg_temp.cuenta('nadie', format('SELECT count(*) FROM public.pedidos WHERE id IN (%L, %L, %L)', pa, pb, pc)) <> 0 THEN f := f || 'NADIE ve pedidos'::TEXT; END IF;
  IF pg_temp.cuenta('ua', format('SELECT count(*) FROM public.cobros WHERE empresa_id IN (%L, %L) AND pedido_id IN (%L, %L)', e1, e2, pa, pc)) <> 1 THEN f := f || 'UA no ve solo el cobro de su empresa'::TEXT; END IF;
  IF pg_temp.cuenta('uc', 'SELECT count(*) FROM public.clientes WHERE nombre LIKE ''Cliente C21 %''') <> 1 THEN f := f || 'UC no ve solo el cliente de su empresa'::TEXT; END IF;
  IF pg_temp.cuenta('uc', 'SELECT count(*) FROM public.textil_pedidos WHERE numero LIKE ''C21-TP_''') <> 1 THEN f := f || 'UC no ve solo su pedido textil'::TEXT; END IF;
  IF pg_temp.cuenta('ub', 'SELECT count(*) FROM public.textil_pedido_items WHERE descripcion LIKE ''C21 línea textil %''') <> 1 THEN f := f || 'UB no ve solo la línea textil de su empresa'::TEXT; END IF;
  IF pg_temp.cuenta('ua', 'SELECT count(*) FROM public.textil_facturas WHERE numero LIKE ''C21-TF_''') <> 1 THEN f := f || 'UA no ve solo su factura textil'::TEXT; END IF;
  IF pg_temp.cuenta('uc', 'SELECT count(*) FROM public.textil_factura_items WHERE descripcion LIKE ''C21 línea factura textil %''') <> 1 THEN f := f || 'UC no ve solo su línea de factura textil'::TEXT; END IF;
  IF pg_temp.cuenta('ua', 'SELECT count(*) FROM public.textil_compras WHERE numero LIKE ''C21-COMPRA-%''') <> 1 THEN f := f || 'UA no ve solo la compra de su empresa'::TEXT; END IF;
  IF pg_temp.cuenta('adm', 'SELECT count(*) FROM public.textil_compras WHERE numero LIKE ''C21-COMPRA-%''') <> 2 THEN f := f || 'ADM no ve las dos compras'::TEXT; END IF;
  IF pg_temp.cuenta('nadie', 'SELECT count(*) FROM public.textil_compras WHERE numero LIKE ''C21-COMPRA-%''') <> 0 THEN f := f || 'NADIE ve compras'::TEXT; END IF;
  IF cardinality(f) = 0 THEN
    RAISE NOTICE 'BIEN  9. de su tienda o empresa sí, de las otras no; el administrador todo; sin tienda, nada';
  ELSE
    RAISE WARNING 'MAL   9. %', array_to_string(f, '; ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. El plan: el conjunto de tiendas se calcula una vez (InitPlan) y ya no
--     se llama a is_tienda_member por fila.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD; v_plan TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c2100000-0000-4000-8000-00000000000a', true);
  SET LOCAL ROLE authenticated;
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT * FROM public.pedido_items i JOIN public.pedidos p ON p.id = i.pedido_id' LOOP
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_plan LIKE '%InitPlan%' AND v_plan NOT LIKE '%is_tienda_member%' THEN
    RAISE NOTICE 'BIEN  10. pedidos y líneas: InitPlan con mis_tiendas() y ninguna llamada por fila';
  ELSE
    RAISE WARNING 'MAL   10. el plan no es el esperado: %', v_plan;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 11. Se puede aplicar dos veces
-- ---------------------------------------------------------------------------
SET client_min_messages = warning;
\ir ../migrations/20261031100000_rendimiento_indices.sql
\ir ../migrations/20261031100100_rendimiento_rls.sql
RESET client_min_messages;

SELECT CASE WHEN pg_temp.forma_nueva() IS NULL AND pg_temp.diferencias() IS NULL
            THEN 'BIEN  11. aplicada dos veces: misma forma y mismo acceso'
            ELSE 'MAL   11. aplicada dos veces cambia algo: '
                 || coalesce(pg_temp.forma_nueva(), '') || ' ' || coalesce(pg_temp.diferencias(), '') END;

-- ---------------------------------------------------------------------------
-- 12. Si hay una política de lectura con otro nombre (creada a mano), la
--     migración se para ANTES de cambiar nada. Se ejecuta el fichero tal como
--     lo copia probar-migraciones.sh (al lado del directorio de datos).
-- ---------------------------------------------------------------------------
CREATE POLICY "C21 lectura a mano" ON public.pedidos FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DO $$
DECLARE
  v_sql TEXT;
  v_msg TEXT;
BEGIN
  v_sql := pg_read_file(regexp_replace(current_setting('data_directory'), '/data/?$', '')
                        || '/sql/20261031100100_rendimiento_rls.sql');
  BEGIN
    EXECUTE v_sql;
    RAISE WARNING 'MAL   12. la migración se ha aplicado con una política de lectura de más en pedidos';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE 'rendimiento_rls: hay políticas de lectura con un nombre%C21 lectura a mano%' THEN
      RAISE NOTICE 'BIEN  12. con una política de lectura de otro nombre, se para y dice cuál';
    ELSE
      RAISE WARNING 'MAL   12. se ha parado, pero con otro error: %', v_msg;
    END IF;
  END;
END $$;

DROP POLICY "C21 lectura a mano" ON public.pedidos;

-- ---------------------------------------------------------------------------
-- 13-14. La reversión vuelve a las políticas de antes con el mismo acceso, y
--        la migración se puede volver a aplicar después.
-- ---------------------------------------------------------------------------
-- Las reversiones van de la más nueva a la más vieja: 20261031300400 y
-- 20261031300100 (seguridad, escritura y lectura por empresa) usan
-- mis_empresas() y se revierten antes.
SET client_min_messages = warning;
\ir ../reversiones/20261031300400_seguridad_escritura_por_empresa.sql
\ir ../reversiones/20261031300100_seguridad_lectura_por_empresa.sql
\ir ../reversiones/20261031100100_rendimiento_rls.sql
RESET client_min_messages;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('mis_tiendas', 'mis_empresas'))
             AND (SELECT count(*) FROM c21_tablas c
                   WHERE (SELECT count(*) FROM pg_policies p
                           WHERE p.schemaname = 'public' AND p.tablename = c.tabla
                             AND p.cmd IN ('SELECT', 'ALL')) = 1
                     AND EXISTS (SELECT 1 FROM pg_policies p
                                  WHERE p.schemaname = 'public' AND p.tablename = c.tabla
                                    AND p.policyname = c.politica AND p.cmd = 'SELECT'
                                    AND (p.qual LIKE '%is_tienda_member%' OR p.qual LIKE '%es_miembro_empresa%'))) = 13
             AND pg_temp.diferencias() IS NULL
            THEN 'BIEN  13. la reversión deja las trece políticas de antes, con el mismo acceso, y quita las funciones'
            ELSE 'MAL   13. la reversión no deja las políticas de antes' END;

SET client_min_messages = warning;
\ir ../migrations/20261031100100_rendimiento_rls.sql
\ir ../migrations/20261031300100_seguridad_lectura_por_empresa.sql
\ir ../migrations/20261031300200_roles_desactivado_sin_acceso.sql
\ir ../migrations/20261031300400_seguridad_escritura_por_empresa.sql
RESET client_min_messages;

SELECT CASE WHEN pg_temp.forma_nueva() IS NULL AND pg_temp.diferencias() IS NULL
            THEN 'BIEN  14. tras la reversión, la migración se vuelve a aplicar igual'
            ELSE 'MAL   14. tras la reversión la migración no queda igual' END;

ROLLBACK;
