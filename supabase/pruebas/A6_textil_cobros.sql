-- ============================================================================
-- Cobros de los pedidos textil
-- ============================================================================
-- Lo que se comprueba: que el cobro en efectivo arrastra su apunte de caja en
-- la misma transacción, que el de tarjeta no, que nunca se cobra más que el
-- total, y que borrar un cobro se lleva su apunte.

DO $$ BEGIN
  INSERT INTO public.textil_pedidos (id, numero, estado, cliente_nombre, subtotal, iva, total)
  VALUES ('a6a6a6a6-0000-4000-8000-000000000001', 'TPD-COBRO-1', 'pendiente',
          'Peña La Charanga', 82.64, 17.36, 100.00);
  INSERT INTO public.textil_pedidos (id, numero, estado, total)
  VALUES ('a6a6a6a6-0000-4000-8000-000000000002', 'TPD-COBRO-2', 'cancelado', 50.00);
END $$;

-- 1. Cobro parcial en efectivo: crea el apunte de ingreso en caja.
SELECT public.textil_registrar_cobro(
  'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-24', 40, 'efectivo',
  (SELECT id FROM public.caja_conceptos WHERE nombre = 'Metros'), 'el textil');

SELECT CASE WHEN m.categoria = 'ingreso' AND m.importe = 40
             AND m.cliente_nombre = 'Peña La Charanga'
             AND m.observaciones = 'Cobro del pedido textil TPD-COBRO-1'
             AND c.notas = 'el textil'
            THEN 'BIEN  1. el cobro en efectivo deja su apunte de ingreso en caja'
            ELSE 'MAL   1. apunte: ' || COALESCE(m.categoria::TEXT, 'ninguno') END
FROM public.textil_cobros c
LEFT JOIN public.caja_movimientos m ON m.id = c.caja_movimiento_id
WHERE c.pedido_id = 'a6a6a6a6-0000-4000-8000-000000000001' AND c.metodo = 'efectivo';

-- 2. Cobro con tarjeta: no toca la caja.
DO $$
DECLARE v_antes INT; v_despues INT;
BEGIN
  SELECT count(*) INTO v_antes FROM public.caja_movimientos;
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 35, 'tarjeta');
  SELECT count(*) INTO v_despues FROM public.caja_movimientos;
  IF v_antes = v_despues THEN
    RAISE NOTICE 'BIEN  2. el cobro con tarjeta no crea apunte de caja';
  ELSE
    RAISE WARNING 'MAL   2. el cobro con tarjeta ha creado % apunte(s)', v_despues - v_antes;
  END IF;
END $$;

-- 3. Cobrar más de lo pendiente (quedan 25): rechazado.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 25.01, 'transferencia');
  RAISE WARNING 'MAL   3. se ha cobrado mas que el total';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. cobrar mas de lo pendiente: rechazado';
END $$;

-- 4. Lo pendiente justo, en cambio, sí.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 25, 'transferencia');
  RAISE NOTICE 'BIEN  4. se puede cobrar exactamente lo pendiente';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   4. no se ha podido cobrar lo pendiente: %', SQLERRM;
END $$;

-- Se deshace ese último para que queden 25 pendientes: así lo que sigue falla
-- por lo que comprueba y no por falta de saldo.
SELECT public.textil_borrar_cobro(
  (SELECT id FROM public.textil_cobros WHERE importe = 25 AND metodo = 'transferencia'));

-- 5. Efectivo con un concepto de gasto: rechazado, no se cuela como gasto.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 10, 'efectivo',
    (SELECT id FROM public.caja_conceptos WHERE nombre = 'Nómina'));
  RAISE WARNING 'MAL   5. un cobro ha entrado en caja con un concepto de gasto';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. efectivo con concepto de gasto: rechazado';
END $$;

-- 6. Efectivo sin concepto: rechazado.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 10, 'efectivo');
  RAISE WARNING 'MAL   6. efectivo sin concepto de caja aceptado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6. efectivo sin concepto de caja: rechazado';
END $$;

-- 7. Tarjeta con concepto de caja: rechazado, la tarjeta no pasa por caja.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 10, 'tarjeta',
    (SELECT id FROM public.caja_conceptos WHERE nombre = 'Metros'));
  RAISE WARNING 'MAL   7. un cobro con tarjeta ha aceptado concepto de caja';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  7. tarjeta con concepto de caja: rechazado';
END $$;

-- 8. Un pedido cancelado no admite cobros.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000002', '2026-09-30', 10, 'tarjeta');
  RAISE WARNING 'MAL   8. un pedido cancelado ha admitido un cobro';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  8. pedido cancelado: no admite cobros';
END $$;

-- 9. Importe cero: rechazado.
DO $$ BEGIN
  PERFORM public.textil_registrar_cobro(
    'a6a6a6a6-0000-4000-8000-000000000001', '2026-09-30', 0, 'tarjeta');
  RAISE WARNING 'MAL   9. se ha aceptado un cobro de cero';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  9. cobro de cero: rechazado';
END $$;

-- 10. El apunte de caja de un cobro no se borra desde Caja.
DO $$ BEGIN
  DELETE FROM public.caja_movimientos
   WHERE id = (SELECT caja_movimiento_id FROM public.textil_cobros WHERE metodo = 'efectivo');
  RAISE WARNING 'MAL  10. se ha borrado desde caja el apunte de un cobro';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'BIEN 10. el apunte de un cobro no se borra desde caja';
END $$;

-- 11. Un pedido con cobros no se borra.
DO $$ BEGIN
  DELETE FROM public.textil_pedidos WHERE id = 'a6a6a6a6-0000-4000-8000-000000000001';
  RAISE WARNING 'MAL  11. se ha borrado un pedido con cobros';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'BIEN 11. un pedido con cobros no se borra';
END $$;

-- 12. Borrar el cobro en efectivo se lleva su apunte de caja.
DO $$
DECLARE v_cobro UUID; v_caja UUID;
BEGIN
  SELECT id, caja_movimiento_id INTO v_cobro, v_caja
    FROM public.textil_cobros WHERE metodo = 'efectivo';
  PERFORM public.textil_borrar_cobro(v_cobro);
  IF NOT EXISTS (SELECT 1 FROM public.caja_movimientos WHERE id = v_caja) THEN
    RAISE NOTICE 'BIEN 12. borrar el cobro en efectivo se lleva su apunte de caja';
  ELSE
    RAISE WARNING 'MAL  12. el apunte de caja ha sobrevivido al cobro';
  END IF;
END $$;

-- 13. authenticated lee, pero no escribe ni llama a las funciones.
--     Los GRANT de tabla no sirven de prueba aquí: 20_auditoria_autor.sql
--     concede ALL ON ALL TABLES a authenticated para sus propias pruebas. Lo
--     que protege de verdad, también en producción, es que la RLS no tiene
--     política de escritura y que las funciones no se pueden ejecutar.
SELECT CASE WHEN NOT has_function_privilege('authenticated',
                   'public.textil_registrar_cobro(uuid, date, numeric, public.textil_cobro_metodo, uuid, text)',
                   'EXECUTE')
             AND NOT has_function_privilege('authenticated',
                   'public.textil_borrar_cobro(uuid)', 'EXECUTE')
            THEN 'BIEN 13. authenticated no puede llamar a las funciones de cobro'
            ELSE 'MAL  13. authenticated puede llamar a las funciones de cobro' END;

-- Con VALUES y no con INSERT ... SELECT: como authenticated, la RLS de
-- textil_pedidos esconde el pedido, el SELECT sale vacío y se insertarían 0
-- filas sin error, que parecería un fallo sin serlo.
DO $$
DECLARE v_empresa UUID;
BEGIN
  SELECT empresa_id INTO v_empresa FROM public.textil_pedidos
   WHERE id = 'a6a6a6a6-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  INSERT INTO public.textil_cobros (empresa_id, pedido_id, importe, metodo)
  VALUES (v_empresa, 'a6a6a6a6-0000-4000-8000-000000000001', 1, 'tarjeta');
  RAISE WARNING 'MAL 13b. authenticated ha insertado un cobro saltandose la funcion';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 13b. authenticated no inserta cobros por su cuenta';
END $$;
RESET ROLE;

DO $$
DECLARE v_filas INT;
BEGIN
  SET LOCAL ROLE authenticated;
  DELETE FROM public.textil_cobros;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RESET ROLE;
  IF v_filas = 0 THEN
    RAISE NOTICE 'BIEN 13c. authenticated no borra cobros por su cuenta';
  ELSE
    RAISE WARNING 'MAL 13c. authenticated ha borrado % cobro(s)', v_filas;
  END IF;
END $$;
RESET ROLE;

-- 14. Los cobros quedan en la auditoria.
SELECT CASE WHEN count(*) >= 3
            THEN 'BIEN 14. la auditoria registro los cobros textil'
            ELSE 'MAL  14. solo ' || count(*) || ' filas de auditoria' END
FROM public.auditoria WHERE tabla = 'textil_cobros';

-- 15. Sin politica FOR ALL.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 15. ninguna politica FOR ALL en textil_cobros'
            ELSE 'MAL  15. ' || count(*) || ' politica(s) FOR ALL' END
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'textil_cobros' AND cmd = 'ALL';
