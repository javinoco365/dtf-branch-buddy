-- ============================================================================
-- Compras textil: la factura del proveedor entra en el stock, una sola vez
-- ============================================================================

DO $$
DECLARE v_empresa UUID; v_stock UUID; v_compra UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.textil_stock (nombre, color, talla, cantidad, coste_unitario)
  VALUES ('Sudadera compra', 'gris', 'L', 0, 0) RETURNING id INTO v_stock;

  INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, iva, total)
  VALUES (v_empresa, 'Textiles del Sur S.L.', 'F-2026-114', '2026-09-01', 250, 52.50, 302.50)
  RETURNING id INTO v_compra;

  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
  PERFORM set_config('prueba.stock', v_stock::TEXT, false);
  PERFORM set_config('prueba.compra', v_compra::TEXT, false);
END $$;

-- 1. Una línea sin casar con una variante no puede registrarse: sería stock
--    que entra sin saber de qué es.
INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad, precio_unitario, importe)
VALUES (current_setting('prueba.compra')::UUID, 'Sudadera gris L', 50, 5.00, 250.00);

DO $$
BEGIN
  PERFORM public.textil_compra_registrar(current_setting('prueba.compra')::UUID);
  RAISE NOTICE 'MAL   1. registro una compra con lineas sin casar';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  1. no registra mientras haya lineas sin casar';
END $$;

-- 2. Casada, se registra y entra en el libro al coste de la factura.
UPDATE public.textil_compra_lineas
   SET stock_id = current_setting('prueba.stock')::UUID
 WHERE compra_id = current_setting('prueba.compra')::UUID;

SELECT CASE WHEN public.textil_compra_registrar(current_setting('prueba.compra')::UUID) = 1
            THEN 'BIEN  2. registra una linea'
            ELSE 'MAL   2. registro otro numero de lineas' END;

SELECT CASE WHEN cantidad = 50 AND coste_unitario = 5
            THEN 'BIEN  2b. el stock sube a 50 al coste de la factura'
            ELSE 'MAL   2b. cantidad ' || cantidad || ' coste ' || coste_unitario END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 3. LA PRUEBA QUE IMPORTA: el mismo albarán no entra dos veces.
DO $$
BEGIN
  PERFORM public.textil_compra_registrar(current_setting('prueba.compra')::UUID);
  RAISE NOTICE 'MAL   3. registro dos veces la misma compra';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. una compra registrada no se vuelve a registrar';
END $$;

-- 4. Ni se le tocan las líneas después.
DO $$
BEGIN
  UPDATE public.textil_compra_lineas SET cantidad = 500
   WHERE compra_id = current_setting('prueba.compra')::UUID;
  RAISE NOTICE 'MAL   4. dejo editar la linea de una compra registrada';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  4. las lineas de una compra registrada estan congeladas';
END $$;

-- 5. Y el mismo número del mismo proveedor no se da de alta dos veces.
DO $$
BEGIN
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero)
  VALUES (current_setting('prueba.empresa')::UUID, 'Textiles del Sur S.L.', 'F-2026-114');
  RAISE NOTICE 'MAL   5. dejo repetir numero y proveedor';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. el mismo numero del mismo proveedor no se repite';
END $$;

-- 6. Un borrador sí se borra entero: no ha tocado nada.
DO $$
DECLARE v_b UUID;
BEGIN
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero)
  VALUES (current_setting('prueba.empresa')::UUID, 'Otro proveedor', 'X-1')
  RETURNING id INTO v_b;
  INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad)
  VALUES (v_b, 'Algo', 1);
  DELETE FROM public.textil_compras WHERE id = v_b;
  RAISE NOTICE 'BIEN  6. un borrador se borra entero';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'MAL   6. no dejo borrar un borrador: %', SQLERRM;
END $$;

-- 7. El libro no se descuadra por nada de esto.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  7. sin descuadres entre el libro y el saldo'
            ELSE 'MAL   7. ' || count(*) || ' descuadre(s)' END
FROM public.stock_descuadres();
