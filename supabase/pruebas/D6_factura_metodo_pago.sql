-- ============================================================================
-- Método de pago de cada factura y ticket
-- ============================================================================
-- Prueba 20261106100000_factura_metodo_pago.sql. Se aplica dos veces (tiene
-- que poder repetirse) y todo va en una transacción que se deshace al final.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261106100000_factura_metodo_pago.sql
\ir ../migrations/20261106100000_factura_metodo_pago.sql
RESET client_min_messages;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda D6', 'tienda-d6');

-- 1. La forma: columnas, triggers y envolturas solo para el servidor.
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND column_name = 'metodo_pago'
                     AND table_name IN ('facturas', 'textil_facturas')) = 2
             AND (SELECT count(*) FROM pg_trigger
                   WHERE tgname IN ('facturas_metodo_pago_de_sesion',
                                    'textil_facturas_metodo_pago_de_sesion')) = 2
             AND NOT has_function_privilege('authenticated',
                   'public.emitir_factura_con_pago(text,uuid,uuid,jsonb,jsonb,date,date,uuid,uuid,text,uuid,text,boolean,uuid)', 'EXECUTE')
             AND NOT has_function_privilege('anon',
                   'public.emitir_factura_textil_con_pago(text,uuid,jsonb,jsonb,uuid,date,date,uuid,uuid,text,uuid,text,boolean,uuid,uuid)', 'EXECUTE')
             AND has_function_privilege('service_role',
                   'public.emitir_factura_con_pago(text,uuid,uuid,jsonb,jsonb,date,date,uuid,uuid,text,uuid,text,boolean,uuid)', 'EXECUTE')
            THEN 'BIEN  1. columnas, triggers y envolturas solo para el rol de servicio'
            ELSE 'MAL   1. falta algo en la forma de la migración' END;

-- 2. Una factura emitida con método de pago lo guarda; el número es el siguiente.
SELECT set_config('d6.f1', (public.emitir_factura_con_pago(
  _metodo_pago => '  Pago en efectivo  ',
  _usuario_id  => '11111111-1111-4111-8111-111111111111',
  _tienda_id   => (SELECT id FROM public.tiendas WHERE slug = 'tienda-d6'),
  _receptor    => '{"nombre":"Cliente D6","nif":"12345678Z"}'::jsonb,
  _lineas      => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
  _fecha       => DATE '2026-11-06') ->> 'id'), false) \g /dev/null
SELECT CASE WHEN metodo_pago = 'Pago en efectivo' AND total = 12.10
            THEN 'BIEN  2. la factura guarda el método de pago elegido (sin espacios de más)'
            ELSE 'MAL   2. metodo_pago = ' || COALESCE(metodo_pago, 'NULL') END
  FROM public.facturas WHERE id = current_setting('d6.f1')::UUID;

-- 3. Vacío: no guarda nada y el PDF usará el de Ajustes > Empresa.
SELECT set_config('d6.f2', (public.emitir_factura_con_pago(
  _metodo_pago => '',
  _usuario_id  => '11111111-1111-4111-8111-111111111111',
  _tienda_id   => (SELECT id FROM public.tiendas WHERE slug = 'tienda-d6'),
  _receptor    => '{"nombre":"Cliente D6","nif":"12345678Z"}'::jsonb,
  _lineas      => '[{"descripcion":"y","cantidad":2,"unidad":"ud","precio_unitario":5,"iva_rate":21}]'::jsonb,
  _fecha       => DATE '2026-11-06',
  _simplificada => true) ->> 'id'), false) \g /dev/null
SELECT CASE WHEN metodo_pago IS NULL AND tipo = 'simplificada'
            THEN 'BIEN  3. un ticket sin método de pago lo deja vacío'
            ELSE 'MAL   3. metodo_pago = ' || COALESCE(metodo_pago, 'NULL') END
  FROM public.facturas WHERE id = current_setting('d6.f2')::UUID;

-- 4. Textil: lo mismo.
SELECT set_config('d6.t1', (public.emitir_factura_textil_con_pago(
  _metodo_pago => 'Bizum al 600 000 000',
  _usuario_id  => '11111111-1111-4111-8111-111111111111',
  _receptor    => '{"nombre":"Club D6","nif":"G33333333"}'::jsonb,
  _lineas      => '[{"descripcion":"Camiseta","cantidad":3,"precio_unitario":10,"iva_rate":21}]'::jsonb,
  _fecha       => DATE '2026-11-06') ->> 'id'), false) \g /dev/null
SELECT CASE WHEN metodo_pago = 'Bizum al 600 000 000'
            THEN 'BIEN  4. la factura textil guarda el método de pago elegido'
            ELSE 'MAL   4. metodo_pago = ' || COALESCE(metodo_pago, 'NULL') END
  FROM public.textil_facturas WHERE id = current_setting('d6.t1')::UUID;

-- 5. La envoltura exige nivel: un usuario sin nivel no emite.
DO $$
BEGIN
  PERFORM public.emitir_factura_con_pago(
    _metodo_pago => 'x',
    _usuario_id  => gen_random_uuid(),
    _tienda_id   => (SELECT id FROM public.tiendas WHERE slug = 'tienda-d6'),
    _receptor    => '{"nombre":"Cliente D6","nif":"12345678Z"}'::jsonb,
    _lineas      => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha       => DATE '2026-11-06');
  RAISE WARNING 'MAL   5. un usuario sin nivel ha emitido';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. un usuario sin nivel no emite: %', SQLERRM;
END $$;

ROLLBACK;
