-- ============================================================================
-- Stock textil: el libro manda, el contador es solo caché
-- ============================================================================

DO $$
DECLARE v_empresa UUID; v_stock UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.textil_stock (nombre, color, talla, cantidad, coste_unitario)
  VALUES ('Roly Basic', 'rojo', 'L', 0, 0) RETURNING id INTO v_stock;
  PERFORM set_config('prueba.stock', v_stock::TEXT, false);
  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
END $$;

-- 1. Una compra sube el saldo.
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario)
VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
        'compra', 100, 3.00);

SELECT CASE WHEN cantidad = 100 AND coste_unitario = 3
            THEN 'BIEN  1. la compra sube el saldo y fija el coste'
            ELSE 'MAL   1. cantidad ' || cantidad || ' coste ' || coste_unitario END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 2. Coste medio ponderado: 100 a 3,00 más 100 a 5,00 dan 4,00.
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario)
VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
        'compra', 100, 5.00);

SELECT CASE WHEN cantidad = 200 AND coste_unitario = 4
            THEN 'BIEN  2. coste medio ponderado: 100 a 3 + 100 a 5 = 4,00'
            ELSE 'MAL   2. cantidad ' || cantidad || ' coste ' || coste_unitario END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 3. La venta congela el coste vigente, que es lo que hace calculable el margen.
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad)
VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
        'venta', -30);

SELECT CASE WHEN coste_unitario = 4
            THEN 'BIEN  3. la salida congela el coste del momento: ' || coste_unitario
            ELSE 'MAL   3. congeló ' || coste_unitario END
FROM public.textil_stock_movimientos
WHERE motivo = 'venta' ORDER BY id DESC LIMIT 1;

-- 4. Y una venta no cambia el coste medio de lo que queda.
SELECT CASE WHEN cantidad = 170 AND coste_unitario = 4
            THEN 'BIEN  4. tras vender 30 quedan 170 al mismo coste medio'
            ELSE 'MAL   4. cantidad ' || cantidad || ' coste ' || coste_unitario END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 5. LA PRUEBA QUE JUSTIFICA TODO: no se puede tocar el contador a mano.
DO $$
BEGIN
  UPDATE public.textil_stock SET cantidad = 9999
   WHERE id = current_setting('prueba.stock')::UUID;
  RAISE NOTICE 'MAL   5. dejó escribir la cantidad directamente';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. no deja escribir la cantidad sin anotar un movimiento';
END $$;

-- 6. Otros campos sí se editan con normalidad.
UPDATE public.textil_stock SET nombre = 'Roly Basic (renombrada)'
 WHERE id = current_setting('prueba.stock')::UUID;

SELECT CASE WHEN nombre = 'Roly Basic (renombrada)'
            THEN 'BIEN  6. el resto de campos se editan con normalidad'
            ELSE 'MAL   6. no dejó renombrar' END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 7. Un movimiento no se modifica ni se borra.
DO $$
BEGIN
  DELETE FROM public.textil_stock_movimientos
   WHERE stock_id = current_setting('prueba.stock')::UUID;
  RAISE NOTICE 'MAL   7. dejó borrar un movimiento';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  7. un movimiento no se borra: para corregir, un ajuste';
END $$;

-- 8. Un ajuste de inventario puede ir en los dos sentidos.
INSERT INTO public.textil_stock_movimientos
  (empresa_id, stock_id, motivo, cantidad, nota)
VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
        'ajuste_inventario', -4, 'Conté 166, el sistema decía 170');

SELECT CASE WHEN cantidad = 166
            THEN 'BIEN  8. el recuento físico ajusta con su motivo anotado'
            ELSE 'MAL   8. quedó en ' || cantidad END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 9. Una merma no puede venir en positivo.
DO $$
BEGIN
  INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad)
  VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
          'merma', 5);
  RAISE NOTICE 'MAL   9. aceptó una merma positiva';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN  9. el signo tiene que corresponder al motivo';
END $$;

-- 10. La caché cuadra con el libro.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 10. la caché cuadra con la suma de movimientos'
            ELSE 'MAL  10. ' || count(*) || ' variante(s) descuadradas' END
FROM public.stock_descuadres();
