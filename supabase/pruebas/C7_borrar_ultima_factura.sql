-- ============================================================================
-- Borrar la última factura o ticket de una serie, y solo la última
-- ============================================================================
-- Prueba 20261019100000_borrar_ultima_factura.sql. Al acabar, el script
-- general comprueba que no queda ningún hueco en ninguna serie.

-- B3 vuelve a aplicar 20261004100100_tickets.sql, que deja factura_inmutable()
-- como estaba antes de esta migración: se aplica otra vez aquí.
\ir ../migrations/20261019100000_borrar_ultima_factura.sql

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

CREATE OR REPLACE FUNCTION pg_temp.emitir(_tienda UUID, _simplificada BOOLEAN DEFAULT false)
RETURNS UUID LANGUAGE sql AS $$
  SELECT (public.emitir_factura(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _tienda_id  => _tienda,
    _receptor   => '{"nombre":"Cliente C7","nif":"12345678Z"}'::jsonb,
    _lineas     => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _simplificada => _simplificada) ->> 'id')::UUID
$$;

CREATE OR REPLACE FUNCTION pg_temp.ref(_id UUID) RETURNS TEXT LANGUAGE sql AS $$
  SELECT public.factura_referencia(serie, ejercicio, numero) FROM public.facturas WHERE id = _id
$$;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C7', 'tienda-c7');
SELECT set_config('prueba.tienda', (SELECT id::TEXT FROM public.tiendas WHERE slug = 'tienda-c7'), false);
SELECT set_config('prueba.a', pg_temp.emitir(current_setting('prueba.tienda')::UUID)::TEXT, false);
SELECT set_config('prueba.b', pg_temp.emitir(current_setting('prueba.tienda')::UUID)::TEXT, false);
SELECT set_config('prueba.ref_b', pg_temp.ref(current_setting('prueba.b')::UUID), false);

-- 1. La penúltima no se borra, y el mensaje dice cuál es la última.
DO $$ BEGIN
  PERFORM public.factura_borrar_ultima('tienda', current_setting('prueba.a')::UUID);
  RAISE WARNING 'MAL   1. se borró una factura que no era la última';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%' || current_setting('prueba.ref_b') || '%' THEN
    RAISE NOTICE 'BIEN  1. la penúltima no se borra y dice cuál es la última';
  ELSE
    RAISE WARNING 'MAL   1. mensaje inesperado: %', SQLERRM;
  END IF;
END $$;

-- 2. Un DELETE directo de una emitida sigue sin poder hacerse.
DO $$ BEGIN
  DELETE FROM public.facturas WHERE id = current_setting('prueba.b')::UUID;
  RAISE WARNING 'MAL   2. un DELETE directo borró una factura emitida';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  2. un DELETE directo no borra una emitida';
END $$;

-- 3. La última se borra del todo, con sus líneas, y su número lo coge la siguiente.
SELECT public.factura_borrar_ultima('tienda', current_setting('prueba.b')::UUID);
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.facturas WHERE id = current_setting('prueba.b')::UUID)
             AND NOT EXISTS (SELECT 1 FROM public.factura_items WHERE factura_id = current_setting('prueba.b')::UUID)
            THEN 'BIEN  3a. borrada con sus líneas'
            ELSE 'MAL   3a. quedó la factura o sus líneas' END;
SELECT set_config('prueba.c', pg_temp.emitir(current_setting('prueba.tienda')::UUID)::TEXT, false);
SELECT CASE WHEN pg_temp.ref(current_setting('prueba.c')::UUID) = current_setting('prueba.ref_b')
            THEN 'BIEN  3b. la siguiente reutiliza el número (' || current_setting('prueba.ref_b') || ')'
            ELSE 'MAL   3b. la siguiente es ' || pg_temp.ref(current_setting('prueba.c')::UUID) END;

-- 4. El borrado queda en la auditoría.
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.auditoria
                          WHERE tabla = 'facturas' AND operacion = 'DELETE'
                            AND registro_id = current_setting('prueba.b'))
            THEN 'BIEN  4. el borrado queda en la auditoría'
            ELSE 'MAL   4. el borrado no está en la auditoría' END;

-- 5. Conciliada con el banco: primero se deshace.
INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
SELECT empresa_id, CURRENT_DATE, 'COBRO C7', total, 'c7-1'
  FROM public.facturas WHERE id = current_setting('prueba.c')::UUID;
SELECT set_config('prueba.g', public.banco_enlazar(
  ARRAY[(SELECT id FROM public.banco_movimientos WHERE huella = 'c7-1')],
  jsonb_build_array(jsonb_build_object('tipo', 'factura', 'id', current_setting('prueba.c'))))::TEXT, false);
DO $$ BEGIN
  PERFORM public.factura_borrar_ultima('tienda', current_setting('prueba.c')::UUID);
  RAISE WARNING 'MAL   5. se borró una factura conciliada';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. una factura conciliada no se borra: primero se deshace';
END $$;
SELECT public.banco_desenlazar(current_setting('prueba.g')::UUID);
DELETE FROM public.banco_movimientos WHERE huella = 'c7-1';

-- 6. Con rectificativa: se borra antes la rectificativa (última de su serie).
SELECT set_config('prueba.r', (public.anular_factura(
  '11111111-1111-4111-8111-111111111111', current_setting('prueba.c')::UUID, 'R1') ->> 'id'), false);
DO $$ BEGIN
  PERFORM public.factura_borrar_ultima('tienda', current_setting('prueba.c')::UUID);
  RAISE WARNING 'MAL   6a. se borró una factura con rectificativa';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6a. con rectificativa, primero se borra la rectificativa';
END $$;
SELECT public.factura_borrar_ultima('tienda', current_setting('prueba.r')::UUID);
SELECT public.factura_borrar_ultima('tienda', current_setting('prueba.c')::UUID);
SELECT 'BIEN  6b. borrada la rectificativa, se borra la original';

-- 7. Los tickets también, y la serie compartida con textil manda.
SELECT set_config('prueba.t', pg_temp.emitir(current_setting('prueba.tienda')::UUID, true)::TEXT, false);
SELECT set_config('prueba.tt', (public.emitir_factura_textil(
  _usuario_id => '11111111-1111-4111-8111-111111111111',
  _receptor   => '{"nombre":"Cliente C7"}'::jsonb,
  _lineas     => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":5,"iva_rate":21}]'::jsonb,
  _simplificada => true) ->> 'id'), false);
DO $$ BEGIN
  PERFORM public.factura_borrar_ultima('tienda', current_setting('prueba.t')::UUID);
  RAISE WARNING 'MAL   7a. se borró un ticket que no era el último (hay uno de textil después)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  7a. el último ticket de la serie es el de textil: el de tienda espera';
END $$;
SELECT public.factura_borrar_ultima('textil', current_setting('prueba.tt')::UUID);
SELECT public.factura_borrar_ultima('tienda', current_setting('prueba.t')::UUID);
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.textil_facturas WHERE id = current_setting('prueba.tt')::UUID)
             AND NOT EXISTS (SELECT 1 FROM public.facturas WHERE id = current_setting('prueba.t')::UUID)
            THEN 'BIEN  7b. borrados el ticket de textil y luego el de tienda'
            ELSE 'MAL   7b. quedó algún ticket' END;

-- 8. Sin usuario no se borra nada.
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  PERFORM public.factura_borrar_ultima('tienda', current_setting('prueba.a')::UUID);
  RAISE WARNING 'MAL   8. se borró sin usuario';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN  8. sin usuario no se borra';
END $$;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

-- 9. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261019100000_borrar_ultima_factura.sql
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.facturas WHERE id = current_setting('prueba.a')::UUID)
            THEN 'BIEN  9. aplicarla dos veces no cambia nada'
            ELSE 'MAL   9. falta una factura' END;
