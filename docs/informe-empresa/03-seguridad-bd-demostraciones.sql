-- ============================================================================
-- Informe 03 · Seguridad de la base de datos: demostraciones en el banco local
-- ============================================================================
-- NO es una migración ni una prueba del CI, y no se ejecuta contra producción.
-- Todo va en una transacción que se deshace (ROLLBACK) y usa datos sintéticos.
--
-- Cómo se reproduce (como root en el contenedor; Postgres 16):
--
--   PG_DIR=/tmp/pg-segbd PG_PUERTO=55505 bash supabase/pruebas/probar-migraciones.sh
--   # (el script para el servidor al acabar; se vuelve a arrancar sobre el mismo directorio)
--   su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg-segbd/data \
--       -o \"-k /tmp/pg-segbd/sock -p 55505 -h ''\" -l /tmp/pg-segbd/log start"
--   # Base nueva "seg" = simulador + privilegios por defecto de Supabase + migraciones,
--   # SIN las pruebas (varias pruebas hacen GRANT ALL ON ALL TABLES y falsean el resultado):
--   mkdir -p /tmp/seg && cp supabase/pruebas/00_entorno_supabase.sql supabase/migrations/*.sql /tmp/seg/
--   sed -i 's/^CREATE EXTENSION IF NOT EXISTS supabase_vault.*$/-- simulado/' /tmp/seg/*_credenciales_vault.sql
--   printf '%s\n' \
--     'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;' \
--     'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;' \
--     'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;' \
--     > /tmp/seg/00a_privilegios_supabase.sql
--   chmod -R a+rX /tmp/seg
--   psql -h /tmp/pg-segbd/sock -p 55505 -U postgres -c 'CREATE DATABASE seg'
--   for f in $(ls /tmp/seg/*.sql | sort); do
--     psql -h /tmp/pg-segbd/sock -p 55505 -U postgres -d seg -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || break
--   done
--   psql -h /tmp/pg-segbd/sock -p 55505 -U postgres -d seg -q -f docs/informe-empresa/03-seguridad-bd-demostraciones.sql
--
-- Los privilegios por defecto de 00a son los que Supabase fija en el esquema
-- public de todo proyecto (por eso las tablas nuevas aparecen en la API sin
-- GRANT). El simulador 00_entorno_supabase.sql no los reproduce.
-- ============================================================================

\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
BEGIN;

-- ---------------------------------------------------------------- datos
DO $$
DECLARE e UUID; t UUID; p1 UUID; p2 UUID; f1 UUID; f2 UUID; m1 UUID; prod UUID; st UUID; tp UUID;
  a UUID := 'aaaaaaaa-0000-4000-8000-000000000001';  -- socio administrador
  o UUID := 'bbbbbbbb-0000-4000-8000-000000000002';  -- cuenta sin rol ni tienda
  c UUID := 'cccccccc-0000-4000-8000-000000000003';  -- usuario de una tienda (no admin)
BEGIN
  SELECT id INTO e FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO auth.users (id, email) VALUES (a, 'socio@demo.test'), (o, 'intruso@demo.test'), (c, 'tienda@demo.test');
  INSERT INTO public.user_roles (user_id, role) VALUES (a, 'admin');
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda demo', 'tienda-demo') RETURNING id INTO t;
  INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES (t, c);
  INSERT INTO public.clientes (empresa_id, tienda_id, nombre, email, nif)
  VALUES (e, t, 'Cliente Demo SL', 'compras@cliente-demo.test', 'B00000000'),
         (e, t, 'Cliente Demo', 'compras@cliente-demo.test', 'B00000000');
  INSERT INTO public.pedidos (tienda_id, numero, total) VALUES (t, 'P-DEMO-1', 121) RETURNING id INTO p1;
  INSERT INTO public.pedidos (tienda_id, numero, total) VALUES (t, 'P-DEMO-2', 242) RETURNING id INTO p2;
  SELECT (public.emitir_factura(_usuario_id => a, _tienda_id => t,
    _receptor => '{"nombre":"Cliente Demo SL"}'::jsonb,
    _lineas => '[{"descripcion":"DTF","cantidad":1,"unidad":"m","precio_unitario":100,"iva_rate":21}]'::jsonb,
    _pedido_id => p1) ->> 'id')::UUID INTO f1;
  SELECT (public.emitir_factura(_usuario_id => a, _tienda_id => t,
    _receptor => '{"nombre":"Cliente Demo SL"}'::jsonb,
    _lineas => '[{"descripcion":"DTF","cantidad":2,"unidad":"m","precio_unitario":100,"iva_rate":21}]'::jsonb,
    _pedido_id => p2) ->> 'id')::UUID INTO f2;
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
  VALUES (e, CURRENT_DATE, 'TRANSF CLIENTE DEMO', 121, 'demo-1') RETURNING id INTO m1;
  PERFORM public.banco_conciliar(a, m1, f1, 'cliente_e_importe');
  -- Textil: un artículo con 10 unidades y una reserva de 4 para un pedido.
  INSERT INTO public.textil_productos (empresa_id, nombre) VALUES (e, 'Camiseta demo') RETURNING id INTO prod;
  INSERT INTO public.textil_stock (empresa_id, producto_id, nombre, cantidad) VALUES (e, prod, 'Camiseta demo M', 0) RETURNING id INTO st;
  INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad) VALUES (e, st, 'inicial', 10);
  INSERT INTO public.textil_pedidos (empresa_id, numero, cliente_nombre) VALUES (e, 'T-DEMO-1', 'Cliente Demo') RETURNING id INTO tp;
  INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad) VALUES (e, st, tp, 4);
  PERFORM set_config('demo.e', e::TEXT, true);  PERFORM set_config('demo.t', t::TEXT, true);
  PERFORM set_config('demo.f2', f2::TEXT, true); PERFORM set_config('demo.st', st::TEXT, true);
  PERFORM set_config('demo.tp', tp::TEXT, true); PERFORM set_config('demo.a', a::TEXT, true);
END $$;

-- ---------------------------------------------------------------- 1. anon
-- Sin iniciar sesión: solo con la clave pública (anon) que va en el bundle.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT CASE WHEN count(*) > 0
  THEN 'DEMOSTRADO S1. anon (sin sesión) lee la vista clientes_duplicados_por_email: ' || string_agg(email || ' ' || array_to_string(nifs, ',') || ' ' || array_to_string(nombres, ' / '), '; ')
  ELSE 'NO REPRODUCIDO S1' END FROM public.clientes_duplicados_por_email;
SELECT CASE WHEN count(*) = 0 THEN 'control S1. anon NO lee la tabla clientes directamente (la RLS sí funciona ahí): 0 filas'
  ELSE 'control S1: anon lee clientes' END FROM public.clientes;
RESET ROLE;

-- ---------------------------------------------------------------- 2. cuenta sin rol
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);
SELECT CASE WHEN count(*) > 0 THEN 'DEMOSTRADO S2a. una cuenta sin rol ni tienda lee banco_movimientos: ' || count(*) || ' movimiento(s), p. ej. «' || min(concepto) || '» ' || min(importe)
  ELSE 'NO REPRODUCIDO S2a' END FROM public.banco_movimientos;
SELECT CASE WHEN count(*) > 0 THEN 'DEMOSTRADO S2b. y banco_conciliaciones, con el uuid del socio que concilió: ' || min(conciliado_por::TEXT) || ' y el id de la factura ' || min(factura_id::TEXT)
  ELSE 'NO REPRODUCIDO S2b' END FROM public.banco_conciliaciones;
SELECT CASE WHEN count(*) = 0 THEN 'control S2. la misma cuenta NO ve facturas (0 filas): la RLS de facturas sí filtra'
  ELSE 'control S2: ve facturas' END FROM public.facturas;
-- Inserta un ingreso falso en el banco de la empresa y lo concilia contra una
-- factura pendiente, firmando como el socio.
INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
VALUES (current_setting('demo.e')::UUID, CURRENT_DATE, 'INGRESO FALSO', 242, 'falso-1');
SELECT 'DEMOSTRADO S2c. la cuenta sin rol inserta un movimiento bancario falso en la empresa (WITH CHECK (true))';
SELECT CASE WHEN public.banco_conciliar(current_setting('demo.a')::UUID,
                   (SELECT id FROM public.banco_movimientos WHERE huella = 'falso-1'),
                   current_setting('demo.f2')::UUID, 'manual') IS NOT NULL
  THEN 'DEMOSTRADO S2d. y con banco_conciliar(_usuario_id => socio, ...) lo concilia contra una factura ajena'
  ELSE 'NO REPRODUCIDO S2d' END;
RESET ROLE;
SELECT CASE WHEN estado::TEXT = 'pagada' THEN 'DEMOSTRADO S2e. la factura emitida (numero ' || numero_completo_o_ref || ') queda «pagada» sin haber cobrado nada'
  ELSE 'NO REPRODUCIDO S2e: ' || estado END
FROM (SELECT estado, COALESCE(numero::TEXT, id::TEXT) AS numero_completo_o_ref FROM public.facturas WHERE id = current_setting('demo.f2')::UUID) x;
SELECT CASE WHEN count(*) > 0 AND bool_and(usuario_id = current_setting('demo.a')::UUID)
  THEN 'DEMOSTRADO S2f. la auditoría firma ' || count(*) || ' cambio(s) de ese movimiento/factura como hechos por el SOCIO (' || current_setting('demo.a') || '), no por el intruso'
  ELSE 'NO REPRODUCIDO S2f: ' || COALESCE(string_agg(COALESCE(usuario_id::TEXT,'NULL'), ','), 'sin filas') END
FROM public.auditoria WHERE tabla IN ('banco_conciliaciones', 'facturas')
  AND (datos_despues ->> 'factura_id' = current_setting('demo.f2') OR registro_id = current_setting('demo.f2'))
  AND operacion IN ('INSERT', 'UPDATE') AND created_at >= now();

-- ---------------------------------------------------------------- 3. funciones sin comprobación
-- (En PostgREST cada petición es su transacción: se limpia el autor que dejó S2d.)
SELECT set_config('app.usuario_id', '', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);
SELECT 'DEMOSTRADO S3a. textil_pedido_entregar() de un pedido ajeno convierte ' || public.textil_pedido_entregar(current_setting('demo.tp')::UUID) || ' reserva(s) en venta y descuenta stock';
SELECT 'DEMOSTRADO S3b. siguiente_numero() de la empresa ajena consume el número ' || public.siguiente_numero(current_setting('demo.e')::UUID, 'presupuesto', 2026) || ' de presupuestos';
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad)
VALUES (current_setting('demo.e')::UUID, current_setting('demo.st')::UUID, 'merma', -6);
SELECT 'DEMOSTRADO S3c. la cuenta sin rol anota una merma de -6 en el libro de stock de la empresa (WITH CHECK (true))';
SELECT CASE WHEN count(*) > 0 THEN 'DEMOSTRADO S3d. tienda_resumen_borrado() de una tienda ajena devuelve ' || min(public.tienda_resumen_borrado(id)::TEXT)
  ELSE 'NO REPRODUCIDO S3d' END FROM (SELECT current_setting('demo.t')::UUID AS id) x;
SELECT CASE WHEN public.has_role(current_setting('demo.a')::UUID, 'admin') THEN 'DEMOSTRADO S3e. has_role(uuid_ajeno, admin) confirma quién es administrador'
  ELSE 'NO REPRODUCIDO S3e' END;
RESET ROLE;
SELECT 'resultado S3: stock de la camiseta = ' || cantidad || ' (eran 10)' FROM public.textil_stock WHERE id = current_setting('demo.st')::UUID;
SELECT 'resultado S3: autor en auditoría de los movimientos del intruso = ' || COALESCE(string_agg(DISTINCT COALESCE(usuario_id::TEXT, 'NULL'), ','), '-')
FROM public.auditoria WHERE tabla = 'textil_stock_movimientos' AND created_at >= now() AND (datos_despues ->> 'motivo') IN ('venta', 'merma');

-- ---------------------------------------------------------------- 4. usuario de tienda (no admin)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000003', true);
SELECT CASE WHEN count(*) > 0 THEN 'DEMOSTRADO S4. un usuario solo de tienda ve y puede tocar todo el banco y el stock de la empresa: ' || count(*) || ' movimientos bancarios'
  ELSE 'NO REPRODUCIDO S4' END FROM public.banco_movimientos;
RESET ROLE;

-- ---------------------------------------------------------------- 4b. Storage y cabecera
-- Supabase concede storage.objects a authenticated; el simulador no.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES ('compras', 'empresa/factura-proveedor-demo.pdf');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);
SELECT CASE WHEN count(*) > 0 THEN 'DEMOSTRADO S6. la cuenta sin rol puede leer los PDF del bucket compras: ' || string_agg(name, ', ')
  ELSE 'NO REPRODUCIDO S6' END FROM storage.objects WHERE bucket_id = 'compras';
-- Control: x-usuario-id no se puede falsear sin la clave de servicio.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('app.usuario_id', '', true);
SELECT set_config('request.headers', '{"x-usuario-id":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
SELECT CASE WHEN public.auditoria_autor() IS NULL THEN 'control S7. con rol authenticated la cabecera x-usuario-id se ignora (auditoria_autor() = NULL): bien'
  ELSE 'S7: la cabecera se acepta con authenticated' END;
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ---------------------------------------------------------------- 5. privilegios
SELECT 'privilegios S5. authenticated tiene TRUNCATE (salta RLS y triggers de fila) en ' || count(*) || ' tablas, entre ellas facturas: ' || bool_or(relname = 'facturas')
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  AND has_table_privilege('authenticated', oid, 'TRUNCATE');

ROLLBACK;

-- ============================================================================
-- S8. La cadena de auditoría frente al rol propietario (el del SQL Editor)
-- ============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'socio@demo.test');
SELECT set_config('app.usuario_id', 'aaaaaaaa-0000-4000-8000-000000000001', true);
INSERT INTO public.clientes (empresa_id, nombre, email)
SELECT id, 'Cliente borrado a escondidas', 'x@demo.test' FROM public.empresas WHERE activa LIMIT 1;
SELECT 'antes: auditoria_verificar() = ' || count(*) || ' eslabones rotos' FROM public.auditoria_verificar();
-- Reescritura: se cambia el autor de la última fila y se recalcula la cadena.
ALTER TABLE public.auditoria DISABLE TRIGGER auditoria_inmutable_trg;
UPDATE public.auditoria SET usuario_id = NULL, datos_despues = jsonb_set(datos_despues, '{nombre}', '"Otro nombre"')
 WHERE id = (SELECT max(id) FROM public.auditoria);
DO $$
DECLARE r RECORD; v_ant TEXT := NULL;
BEGIN
  FOR r IN SELECT * FROM public.auditoria ORDER BY id LOOP
    UPDATE public.auditoria SET hash_anterior = v_ant,
      hash = encode(extensions.digest(COALESCE(v_ant, '') || '|' || r.tabla || '|' || r.registro_id || '|' ||
        r.operacion || '|' || COALESCE(r.datos_antes::TEXT, '') || '|' || COALESCE(r.datos_despues::TEXT, '') || '|' ||
        COALESCE(r.usuario_id::TEXT, '') || '|' || r.created_at::TEXT, 'sha256'), 'hex')
     WHERE id = r.id RETURNING hash INTO v_ant;
  END LOOP;
END $$;
ALTER TABLE public.auditoria ENABLE TRIGGER auditoria_inmutable_trg;
SELECT CASE WHEN count(*) = 0 THEN 'DEMOSTRADO S8. tras cambiar autor y contenido de una fila y recalcular la cadena, auditoria_verificar() = 0 eslabones rotos'
  ELSE 'NO REPRODUCIDO S8: ' || count(*) END FROM public.auditoria_verificar();
ROLLBACK;

-- ============================================================================
-- R1. Coste de las políticas: la función de pertenencia se evalúa fila a fila
-- ============================================================================
-- 50.000 pedidos sintéticos, leídos por un administrador con la política
-- actual y con la comprobación de administrador sacada a un initplan
-- ((SELECT ...) se evalúa una vez por consulta, no una por fila).
-- En el banco: ~1.150 ms la actual; ~1.180 ms envolviendo solo auth.uid();
-- ~7 ms con has_role en initplan. Los tiempos absolutos son de este
-- contenedor; la proporción es lo que importa.
\pset tuples_only on
\pset format unaligned
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'socio@demo.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'admin');
INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda rend', 'tienda-rend');
ALTER TABLE public.pedidos DISABLE TRIGGER USER;
INSERT INTO public.pedidos (tienda_id, empresa_id, numero, total)
SELECT t.id, t.empresa_id, 'R-' || g, 10 FROM public.tiendas t, generate_series(1, 50000) g WHERE t.slug = 'tienda-rend';
ALTER TABLE public.pedidos ENABLE TRIGGER USER;
ANALYZE public.pedidos;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
\timing on
SELECT 'R1 política actual: ' || count(*) FROM public.pedidos;
\timing off
RESET ROLE;
DROP POLICY "pedidos lectura" ON public.pedidos;
CREATE POLICY "pedidos lectura" ON public.pedidos FOR SELECT TO authenticated
  USING (public.is_tienda_member((SELECT auth.uid()), tienda_id));
SET LOCAL ROLE authenticated;
\timing on
SELECT 'R1 solo (SELECT auth.uid()): ' || count(*) FROM public.pedidos;
\timing off
RESET ROLE;
DROP POLICY "pedidos lectura" ON public.pedidos;
CREATE POLICY "pedidos lectura" ON public.pedidos FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
         OR public.is_tienda_member((SELECT auth.uid()), tienda_id));
SET LOCAL ROLE authenticated;
\timing on
SELECT 'R1 has_role en initplan: ' || count(*) FROM public.pedidos;
\timing off
ROLLBACK;
