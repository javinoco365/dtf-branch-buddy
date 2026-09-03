-- ============================================================================
-- Conciliación bancaria: un ingreso paga una factura, y solo una vez
-- ============================================================================

DO $$
DECLARE v_empresa UUID; v_tienda UUID; v_ped UUID; v_fac UUID; v_mov UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda banco', 'tienda-banco')
    RETURNING id INTO v_tienda;
  INSERT INTO public.pedidos (tienda_id, numero, total) VALUES (v_tienda, 'P-BANCO-1', 121)
    RETURNING id INTO v_ped;

  SELECT (public.emitir_factura(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _tienda_id  => v_tienda,
    _receptor   => '{"nombre":"Cliente del banco"}'::jsonb,
    _lineas     => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":100,"iva_rate":21}]'::jsonb,
    _pedido_id  => v_ped) ->> 'id')::UUID INTO v_fac;

  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
  VALUES (v_empresa, CURRENT_DATE, 'TRANSF CLIENTE DEL BANCO', 121.00, 'h1')
  RETURNING id INTO v_mov;

  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
  PERFORM set_config('prueba.factura', v_fac::TEXT, false);
  PERFORM set_config('prueba.mov', v_mov::TEXT, false);
END $$;

-- 1. La huella impide que reimportar un periodo solapado duplique movimientos.
DO $$
BEGIN
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
  VALUES (current_setting('prueba.empresa')::UUID, CURRENT_DATE, 'TRANSF CLIENTE DEL BANCO',
          121.00, 'h1');
  RAISE NOTICE 'MAL   1. dejo importar dos veces el mismo movimiento';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  1. la huella impide duplicar un movimiento al reimportar';
END $$;

-- 2. Conciliar marca la factura como pagada, por la función de siempre.
SELECT CASE WHEN public.banco_conciliar(
              '11111111-1111-4111-8111-111111111111',
              current_setting('prueba.mov')::UUID,
              current_setting('prueba.factura')::UUID,
              'cliente_e_importe') IS NOT NULL
            THEN 'BIEN  2. concilia y devuelve el enlace'
            ELSE 'MAL   2. no devolvio enlace' END;

SELECT CASE WHEN estado::TEXT = 'pagada'
            THEN 'BIEN  2b. la factura queda pagada'
            ELSE 'MAL   2b. estado ' || estado END
FROM public.facturas WHERE id = current_setting('prueba.factura')::UUID;

-- 3. Y el documento fiscal no se ha tocado: el total sigue siendo el mismo.
SELECT CASE WHEN total = 121
            THEN 'BIEN  3. el total de la factura no se ha tocado'
            ELSE 'MAL   3. total ' || total END
FROM public.facturas WHERE id = current_setting('prueba.factura')::UUID;

-- 4. LA PRUEBA QUE IMPORTA: la misma factura no se cobra dos veces.
DO $$
DECLARE v_mov2 UUID;
BEGIN
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
  VALUES (current_setting('prueba.empresa')::UUID, CURRENT_DATE, 'OTRA TRANSF', 121.00, 'h2')
  RETURNING id INTO v_mov2;

  PERFORM public.banco_conciliar('11111111-1111-4111-8111-111111111111',
                                 v_mov2, current_setting('prueba.factura')::UUID);
  RAISE NOTICE 'MAL   4. cobro la misma factura dos veces';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  4. una factura no se cobra dos veces';
END $$;

-- 5. Un cargo no paga una factura.
DO $$
DECLARE v_cargo UUID;
BEGIN
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella)
  VALUES (current_setting('prueba.empresa')::UUID, CURRENT_DATE, 'RECIBO LUZ', -121.00, 'h3')
  RETURNING id INTO v_cargo;
  PERFORM public.banco_conciliar('11111111-1111-4111-8111-111111111111',
                                 v_cargo, current_setting('prueba.factura')::UUID);
  RAISE NOTICE 'MAL   5. dejo pagar una factura con un cargo';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. un cargo no paga una factura';
END $$;

-- 6. Un movimiento conciliado no se borra: se deshace primero.
DO $$
BEGIN
  DELETE FROM public.banco_movimientos WHERE id = current_setting('prueba.mov')::UUID;
  RAISE NOTICE 'MAL   6. borro un movimiento conciliado y dejo la factura pagada sin respaldo';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6. no deja borrar un movimiento conciliado: primero se deshace';
END $$;

-- 7. Deshacer devuelve la factura a emitida. Casar mal no es grave si se puede
--    deshacer; el documento fiscal nunca se tocó.
SELECT CASE WHEN public.banco_desconciliar('11111111-1111-4111-8111-111111111111',
                                           current_setting('prueba.mov')::UUID)
            THEN 'BIEN  7. deshace la conciliacion'
            ELSE 'MAL   7. no deshizo nada' END;

SELECT CASE WHEN estado::TEXT = 'emitida'
            THEN 'BIEN  7b. la factura vuelve a emitida'
            ELSE 'MAL   7b. estado ' || estado END
FROM public.facturas WHERE id = current_setting('prueba.factura')::UUID;

-- 8. Deshacer algo que no estaba conciliado no revienta, devuelve false.
SELECT CASE WHEN NOT public.banco_desconciliar('11111111-1111-4111-8111-111111111111',
                                               current_setting('prueba.mov')::UUID)
            THEN 'BIEN  8. deshacer dos veces no revienta'
            ELSE 'MAL   8. dijo que deshizo algo que no habia' END;
