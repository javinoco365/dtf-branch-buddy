-- ============================================================================
-- Recargo de equivalencia: pedidos.recargo_equivalencia y facturas con recargo
-- ============================================================================
-- Prueba 20261120100000_recargo_equivalencia.sql. Se aplica dos veces (tiene
-- que poder repetirse) y todo va en una transacción que se deshace al final.
--   1. las columnas existen y por defecto no hay recargo;
--   2. sin recargo, el cálculo y la factura salen como siempre;
--   3. el pedido DCUL-172-2026: impresión 7,00 + envío 5,99 con IVA y R.E;
--   4. un ticket de un pedido con recargo se rechaza;
--   5. una factura sin recargo de ese pedido se rechaza;
--   6. la anulación lleva el recargo en negativo;
--   7. el recargo de una factura emitida no se cambia.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261120100000_recargo_equivalencia.sql
\ir ../migrations/20261120100000_recargo_equivalencia.sql
RESET client_min_messages;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda E7', 'tienda-e7');
INSERT INTO public.pedidos (tienda_id, empresa_id, numero, recargo_equivalencia)
  SELECT id, empresa_id, 'E7-RE', true FROM public.tiendas WHERE slug = 'tienda-e7';
INSERT INTO public.pedidos (tienda_id, empresa_id, numero)
  SELECT id, empresa_id, 'E7-NORMAL' FROM public.tiendas WHERE slug = 'tienda-e7';
SELECT set_config('e7.tienda', (SELECT id FROM public.tiendas WHERE slug = 'tienda-e7')::TEXT, false) \g /dev/null
SELECT set_config('e7.re', (SELECT id FROM public.pedidos WHERE numero = 'E7-RE')::TEXT, false) \g /dev/null
SELECT set_config('e7.normal', (SELECT id FROM public.pedidos WHERE numero = 'E7-NORMAL')::TEXT, false) \g /dev/null

-- Emite y devuelve el id o el error.
CREATE FUNCTION pg_temp.e7_emitir(_pedido UUID, _lineas JSONB, _ticket BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.emitir_factura(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _tienda_id    => current_setting('e7.tienda')::UUID,
    _receptor     => '{"nombre":"Mercería E7","nif":"12345678Z"}'::jsonb,
    _lineas       => _lineas,
    _fecha        => DATE '2026-12-31',
    _pedido_id    => _pedido,
    _simplificada => _ticket) ->> 'id';
EXCEPTION WHEN OTHERS THEN
  RETURN 'error: ' || SQLERRM;
END $$;

-- 1. Las columnas.
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND ((table_name = 'pedidos' AND column_name = 'recargo_equivalencia'
                           AND is_nullable = 'NO' AND column_default = 'false')
                       OR (table_name = 'facturas' AND column_name IN ('recargo_total', 'desglose_recargo')))) = 3
             AND (SELECT NOT recargo_equivalencia FROM public.pedidos WHERE numero = 'E7-NORMAL')
            THEN 'BIEN  1. pedidos.recargo_equivalencia y las columnas del recargo en facturas'
            ELSE 'MAL   1. faltan columnas del recargo o no están como se espera' END;

-- 2. Sin recargo, como siempre.
SELECT CASE WHEN c ->> 'total' = '12.10'
             AND (c ->> 'recargo_total')::NUMERIC = 0
             AND c -> 'desglose_recargo' = '[]'::JSONB
             AND NOT (c -> 'lineas' -> 0 ? 'recargo_rate')
            THEN 'BIEN  2. sin recargo, el cálculo es el de siempre'
            ELSE 'MAL   2. sin recargo ha cambiado el cálculo: ' || c::TEXT END
  FROM (SELECT public.factura_calcular(
          '[{"descripcion":"x","cantidad":1,"precio_unitario":10,"iva_rate":21}]') AS c) s;

SELECT pg_temp.e7_emitir(current_setting('e7.normal')::UUID,
  '[{"descripcion":"DTF","cantidad":1,"unidad":"m","precio_unitario":10,"iva_rate":21}]') AS r2 \gset
SELECT CASE WHEN total = 12.10 AND recargo_total = 0 AND desglose_recargo IS NULL
            THEN 'BIEN  2b. una factura sin recargo guarda recargo 0'
            ELSE 'MAL   2b. factura sin recargo: total ' || total || ', recargo ' || recargo_total END
  FROM public.facturas WHERE id::TEXT = :'r2';

-- 3. DCUL-172-2026: el recargo va sobre la base sumada, como el IVA.
SELECT pg_temp.e7_emitir(current_setting('e7.re')::UUID,
  '[{"descripcion":"DTI por Metros","cantidad":1,"unidad":"m","precio_unitario":7,"iva_rate":21,"recargo_rate":5.2},
    {"descripcion":"Gastos de envío","cantidad":1,"unidad":"ud","precio_unitario":5.99,"iva_rate":21,"recargo_rate":5.2}]') AS r3 \gset
SELECT CASE WHEN base_imponible = 12.99 AND iva_total = 2.73 AND recargo_total = 0.68
             AND total = 16.40
             AND desglose_recargo = '[{"tipo": 5.2, "base": 12.99, "cuota": 0.68}]'::JSONB
             AND (lineas_snapshot -> 0 ->> 'recargo')::NUMERIC = 0.36
            THEN 'BIEN  3. factura con recargo: 12,99 + 2,73 + 0,68 = 16,40'
            ELSE 'MAL   3. factura con recargo: ' || COALESCE(:'r3', '') || ' total ' || COALESCE(total::TEXT, '-')
                 || ', recargo ' || COALESCE(recargo_total::TEXT, '-') END
  FROM (SELECT 1) uno
  LEFT JOIN public.facturas f ON f.id::TEXT = :'r3';

-- 4. Ticket de un pedido con recargo.
-- (con otro pedido: E7-RE ya tiene su factura)
INSERT INTO public.pedidos (tienda_id, empresa_id, numero, recargo_equivalencia)
  SELECT id, empresa_id, 'E7-RE2', true FROM public.tiendas WHERE slug = 'tienda-e7';
SELECT pg_temp.e7_emitir((SELECT id FROM public.pedidos WHERE numero = 'E7-RE2'),
  '[{"descripcion":"DTF","cantidad":1,"unidad":"m","precio_unitario":7,"iva_rate":21}]', true) AS r4 \gset
SELECT CASE WHEN :'r4' LIKE 'error:%recargo de equivalencia%no ticket%'
            THEN 'BIEN  4. no se emite un ticket a un pedido con recargo'
            ELSE 'MAL   4. se ha emitido un ticket a un pedido con recargo: ' || :'r4' END;

-- 5. Factura sin recargo de un pedido con recargo.
SELECT pg_temp.e7_emitir((SELECT id FROM public.pedidos WHERE numero = 'E7-RE2'),
  '[{"descripcion":"DTF","cantidad":1,"unidad":"m","precio_unitario":7,"iva_rate":21}]') AS r5 \gset
SELECT CASE WHEN :'r5' LIKE 'error:%no lo incluye%'
            THEN 'BIEN  5. la factura de un pedido con recargo tiene que llevarlo'
            ELSE 'MAL   5. ha entrado una factura sin recargo de un pedido con recargo: ' || :'r5' END;

-- 6. La anulación lleva el recargo en negativo.
SELECT public.anular_factura('11111111-1111-4111-8111-111111111111', :'r3'::UUID) ->> 'id' AS r6 \gset
SELECT CASE WHEN tipo = 'rectificativa' AND recargo_total = -0.68 AND total = -16.40
            THEN 'BIEN  6. la rectificativa anula también el recargo'
            ELSE 'MAL   6. rectificativa: total ' || total || ', recargo ' || recargo_total END
  FROM public.facturas WHERE id::TEXT = :'r6';

-- 7. El recargo de una factura emitida no se cambia.
SELECT set_config('e7.r3', :'r3', false) \g /dev/null
DO $$
BEGIN
  UPDATE public.facturas SET recargo_total = 0 WHERE id::TEXT = current_setting('e7.r3');
  RAISE WARNING 'MAL   7. se ha cambiado el recargo de una factura emitida';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%recargo de equivalencia no se modifica%' THEN
    RAISE WARNING 'BIEN  7. el recargo de una factura emitida no se cambia';
  ELSE
    RAISE WARNING 'MAL   7. error inesperado: %', SQLERRM;
  END IF;
END $$;

-- 8. La reversión se aplica y la migración se puede volver a aplicar.
SET client_min_messages = warning;
\ir ../reversiones/20261120100000_recargo_equivalencia.sql
RESET client_min_messages;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public'
                                AND column_name IN ('recargo_equivalencia', 'recargo_total', 'desglose_recargo'))
             AND NOT (public.factura_calcular('[]') ? 'recargo_total')
            THEN 'BIEN  8a. la reversión quita las columnas y repone el cálculo de antes'
            ELSE 'MAL   8a. la reversión no deja la base como estaba' END;
SET client_min_messages = warning;
\ir ../migrations/20261120100000_recargo_equivalencia.sql
RESET client_min_messages;
SELECT CASE WHEN public.factura_calcular('[]') ? 'recargo_total'
            THEN 'BIEN  8b. y se puede volver a aplicar'
            ELSE 'MAL   8b. no se ha vuelto a aplicar' END;

ROLLBACK;
