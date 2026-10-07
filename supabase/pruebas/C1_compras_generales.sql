-- ============================================================================
-- Facturas de compra de todo el negocio
-- ============================================================================
-- Prueba 20261013100000_compras_generales.sql.

-- 1. Las compras de antes son de textil, sin IRPF ni gasto.
SELECT CASE WHEN bool_and(categoria = 'textil' AND irpf = 0 AND gasto_id IS NULL)
              OR count(*) = 0
            THEN 'BIEN  1. las compras de antes quedan como textil'
            ELSE 'MAL   1. las compras de antes cambiaron' END
FROM public.textil_compras;

-- 2. Una factura de tinta se registra sin líneas y sin tocar el stock.
DO $$
DECLARE v_empresa UUID; v_compra UUID; v_mov_antes INT; v_n INT;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  SELECT count(*) INTO v_mov_antes FROM public.textil_stock_movimientos;
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, iva, total, categoria)
  VALUES (v_empresa, 'Tintas DTF S.L.', 'T-1', '2026-10-05', 100, 21, 121, 'consumibles')
  RETURNING id INTO v_compra;
  v_n := public.textil_compra_registrar(v_compra);
  IF v_n = 0 AND (SELECT count(*) FROM public.textil_stock_movimientos) = v_mov_antes
     AND (SELECT estado FROM public.textil_compras WHERE id = v_compra) = 'registrada' THEN
    RAISE NOTICE 'BIEN  2. consumibles registrados sin tocar el stock';
  ELSE
    RAISE WARNING 'MAL   2. la compra de consumibles no se registró bien';
  END IF;
  -- Y no se registra dos veces.
  BEGIN
    PERFORM public.textil_compra_registrar(v_compra);
    RAISE WARNING 'MAL   2b. se registró dos veces';
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE 'BIEN 2b. una compra registrada no se vuelve a registrar';
  END;
END $$;

-- 3. La factura del alquiler, con su retención, enlazada a su gasto fijo.
DO $$
DECLARE v_empresa UUID; v_gasto UUID; v_compra UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde)
  VALUES ('Alquiler C1', 1000, '2026-10-01') RETURNING id INTO v_gasto;
  INSERT INTO public.textil_compras
    (empresa_id, proveedor, numero, fecha, base, iva, irpf, total, categoria, gasto_id)
  VALUES (v_empresa, 'Casero', 'A-10', '2026-10-01', 1000, 210, 190, 1020, 'servicios', v_gasto)
  RETURNING id INTO v_compra;
  RAISE NOTICE 'BIEN  3. factura de alquiler con IRPF y enlazada a su gasto';
  -- Si se borra el gasto, la factura se queda sin enlace, no se borra.
  DELETE FROM public.gerencia_gastos_fijos WHERE id = v_gasto;
  IF (SELECT gasto_id FROM public.textil_compras WHERE id = v_compra) IS NULL THEN
    RAISE NOTICE 'BIEN 3b. borrar el gasto deja la factura sin enlace';
  ELSE
    RAISE WARNING 'MAL   3b. la factura sigue enlazada a un gasto borrado';
  END IF;
END $$;

-- 4. Lo que no tiene sentido, no entra.
DO $$ BEGIN
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero, categoria)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'X', 'C1-4a', 'caprichos');
  RAISE WARNING 'MAL   4a. entró una categoría que no existe';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 4a. categoría desconocida rechazada';
END $$;

DO $$ BEGIN
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero, categoria, irpf)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'X', 'C1-4b', 'otros', -1);
  RAISE WARNING 'MAL   4b. entró un IRPF negativo';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 4b. IRPF negativo rechazado';
END $$;

DO $$
DECLARE v_gasto UUID;
BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde)
  VALUES ('Gasto C1-4c', 10, '2026-10-01') RETURNING id INTO v_gasto;
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero, categoria, gasto_id)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'X', 'C1-4c', 'textil', v_gasto);
  RAISE WARNING 'MAL   4c. una compra de textil se enlazó a un gasto fijo';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 4c. el textil no se enlaza a un gasto fijo';
END $$;

-- 5. El textil sigue exigiendo casar las líneas con el stock.
DO $$
DECLARE v_compra UUID;
BEGIN
  INSERT INTO public.textil_compras (empresa_id, proveedor, numero, base, total)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'Textiles C1', 'C1-5', 10, 10)
  RETURNING id INTO v_compra;
  INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad, precio_unitario, importe)
  VALUES (v_compra, 'Camiseta', 2, 5, 10);
  PERFORM public.textil_compra_registrar(v_compra);
  RAISE WARNING 'MAL   5. registró textil con líneas sin casar';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'BIEN  5. el textil sigue sin registrarse con líneas sin casar';
END $$;

-- 6. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261013100000_compras_generales.sql
SELECT CASE WHEN (SELECT categoria FROM public.textil_compras WHERE numero = 'T-1') = 'consumibles'
            THEN 'BIEN  6. aplicarla dos veces no cambia los datos'
            ELSE 'MAL   6. tras reaplicar cambian los datos' END;
