-- ============================================================================
-- Cobros de todos los pedidos, de tienda y textil
-- ============================================================================
-- Sustituye a A6_textil_cobros.sql: las funciones que probaba ya no existen y
-- sus comprobaciones se hacen aquí contra registrar_cobro() y borrar_cobro().
--
-- Cuando el arnés aplica las migraciones no hay datos, así que lo que la
-- migración rellena como «previo» se prueba metiendo datos a la antigua y
-- volviendo a aplicarla. Eso prueba también que se puede aplicar dos veces.

DO $$
DECLARE v_tienda UUID; v_caja UUID;
BEGIN
  INSERT INTO public.tiendas (id, nombre, slug)
  VALUES ('a8a8a8a8-0000-4000-8000-0000000000a1', 'Tienda de cobros', 'tienda-cobros')
  RETURNING id INTO v_tienda;

  -- Un cobro textil de antes, con tarjeta, y uno en efectivo con su apunte.
  INSERT INTO public.textil_pedidos (id, numero, estado, cliente_nombre, subtotal, iva, total)
  VALUES ('a8a8a8a8-0000-4000-8000-000000000001', 'TPD-A8-1', 'pendiente',
          'Peña La Charanga', 82.64, 17.36, 100.00);
  INSERT INTO public.caja_movimientos
    (empresa_id, fecha, categoria, concepto_id, concepto_nombre, cliente_nombre, importe)
  VALUES ((SELECT empresa_id FROM public.textil_pedidos
            WHERE id = 'a8a8a8a8-0000-4000-8000-000000000001'),
          '2026-09-20', 'ingreso', (SELECT id FROM public.caja_conceptos WHERE nombre = 'Metros'),
          '', 'Peña La Charanga', 20)
  RETURNING id INTO v_caja;
  INSERT INTO public.textil_cobros (id, empresa_id, pedido_id, fecha, importe, metodo, notas)
  VALUES ('a8a8a8a8-0000-4000-8000-0000000000c1', public.empresa_por_defecto(),
          'a8a8a8a8-0000-4000-8000-000000000001',
          '2026-09-20', 30, 'tarjeta', 'de antes');
  INSERT INTO public.textil_cobros
    (id, empresa_id, pedido_id, fecha, importe, metodo, caja_movimiento_id)
  VALUES ('a8a8a8a8-0000-4000-8000-0000000000c2', public.empresa_por_defecto(),
          'a8a8a8a8-0000-4000-8000-000000000001',
          '2026-09-20', 20, 'efectivo', v_caja);

  -- Pedidos de tienda de antes: el trigger nuevo apagado, como si no existiera.
  ALTER TABLE public.pedidos DISABLE TRIGGER pedidos_cobro_web;
  INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id, fecha_pedido)
  VALUES
    -- web pagado: cobro web previo
    ('a8a8a8a8-0000-4000-8000-000000000011', v_tienda, 'W-1', 'entregado', 60.50,
     'woocommerce', 9001, '2026-09-01 23:30:00+00'),
    -- web pendiente de pago: sin cobro
    ('a8a8a8a8-0000-4000-8000-000000000012', v_tienda, 'W-2', 'pendiente', 40,
     'woocommerce', 9002, '2026-09-02 10:00:00+00'),
    -- web cancelado: sin cobro
    ('a8a8a8a8-0000-4000-8000-000000000013', v_tienda, 'W-3', 'cancelado', 30,
     'woocommerce', 9003, '2026-09-03 10:00:00+00');
  INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, fecha_pedido)
  VALUES
    -- manual pagado: cobro previo sin especificar
    ('a8a8a8a8-0000-4000-8000-000000000021', v_tienda, 'M-1', 'en_produccion', 80,
     'manual', '2026-09-04 10:00:00+00'),
    -- manual sin pagar: sin cobro, se cobra a mano
    ('a8a8a8a8-0000-4000-8000-000000000022', v_tienda, 'M-2', 'pendiente', 100,
     'manual', '2026-09-05 10:00:00+00');
  ALTER TABLE public.pedidos ENABLE TRIGGER pedidos_cobro_web;
END $$;

\ir ../migrations/20260929100000_cobros.sql

-- 1. Los cobros textil de antes están en cobros, con su id, como previo.
SELECT CASE WHEN count(*) = 2
             AND bool_and(previo) AND NOT bool_or(automatico)
             AND bool_and(textil_pedido_id = 'a8a8a8a8-0000-4000-8000-000000000001')
             AND count(*) FILTER (WHERE metodo = 'efectivo' AND caja_movimiento_id IS NOT NULL) = 1
             AND count(*) FILTER (WHERE metodo = 'tarjeta' AND notas = 'de antes') = 1
            THEN 'BIEN  1. los cobros textil de antes se copian con su id y su apunte'
            ELSE 'MAL   1. copia de textil_cobros: ' || count(*) || ' fila(s)' END
FROM public.cobros
WHERE id IN ('a8a8a8a8-0000-4000-8000-0000000000c1', 'a8a8a8a8-0000-4000-8000-0000000000c2');

-- 2. El pedido web pagado tiene su cobro web previo, fechado en hora de Madrid
--    (23:30 UTC del día 1 es ya el día 2 en Madrid).
SELECT CASE WHEN count(*) = 1 AND min(importe) = 60.50 AND bool_and(previo)
             AND bool_and(automatico) AND min(fecha) = '2026-09-02'
            THEN 'BIEN  2. el pedido web pagado entra con su cobro web previo'
            ELSE 'MAL   2. cobro web previo: ' || count(*) || ' fila(s), fecha ' || COALESCE(min(fecha)::TEXT, '-') END
FROM public.cobros
WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000011' AND metodo = 'web';

-- 3. Ni el web sin pagar ni el cancelado tienen cobro.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  3. el web sin pagar y el cancelado no tienen cobro'
            ELSE 'MAL   3. ' || count(*) || ' cobro(s) de mas' END
FROM public.cobros
WHERE pedido_id IN ('a8a8a8a8-0000-4000-8000-000000000012', 'a8a8a8a8-0000-4000-8000-000000000013');

-- 4. El manual pagado, cobro previo sin especificar; el manual pendiente, nada.
SELECT CASE WHEN count(*) FILTER (WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000021'
                                    AND metodo = 'sin_especificar' AND importe = 80
                                    AND previo AND automatico AND caja_movimiento_id IS NULL) = 1
             AND count(*) FILTER (WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000022') = 0
            THEN 'BIEN  4. el manual pagado entra como previo sin especificar, sin caja'
            ELSE 'MAL   4. previos de pedidos manuales mal' END
FROM public.cobros;

-- 5. Aplicar la migración otra vez no duplica nada. Se cuenta todo, no solo
--    lo de esta prueba: las anteriores dejaron pedidos que también rellena.
SELECT set_config('prueba.cobros_antes', count(*)::TEXT, false) FROM public.cobros \g /dev/null
\ir ../migrations/20260929100000_cobros.sql
SELECT CASE WHEN count(*) = current_setting('prueba.cobros_antes')::INT
            THEN 'BIEN  5. aplicarla dos veces no duplica los previos'
            ELSE 'MAL   5. tras reaplicar hay ' || count(*) || ' cobros, antes '
                 || current_setting('prueba.cobros_antes') END
FROM public.cobros;

-- 6. El cobro web sigue al pedido: al pagarse aparece...
UPDATE public.pedidos SET estado = 'en_produccion'
 WHERE id = 'a8a8a8a8-0000-4000-8000-000000000012';
SELECT CASE WHEN count(*) = 1 AND min(importe) = 40 AND NOT bool_or(previo)
            THEN 'BIEN  6. al pagarse en la web aparece su cobro web'
            ELSE 'MAL   6. cobro web al pagarse: ' || count(*) END
FROM public.cobros WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000012' AND metodo = 'web';

-- 7. ...si cambia el total se ajusta, y sincronizar sin cambios no escribe.
DO $$
DECLARE v_antes INT; v_despues INT;
BEGIN
  UPDATE public.pedidos SET total = 45 WHERE id = 'a8a8a8a8-0000-4000-8000-000000000012';
  SELECT count(*) INTO v_antes FROM public.auditoria WHERE tabla = 'cobros';
  UPDATE public.pedidos SET total = 45 WHERE id = 'a8a8a8a8-0000-4000-8000-000000000012';
  SELECT count(*) INTO v_despues FROM public.auditoria WHERE tabla = 'cobros';
  IF (SELECT importe FROM public.cobros
       WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000012' AND metodo = 'web') = 45
     AND v_antes = v_despues THEN
    RAISE NOTICE 'BIEN  7. el cobro web se ajusta al total y no reescribe sin cambios';
  ELSE
    RAISE WARNING 'MAL   7. ajuste del cobro web (auditoria % -> %)', v_antes, v_despues;
  END IF;
END $$;

-- 8. ...y al cancelarse desaparece.
UPDATE public.pedidos SET estado = 'cancelado'
 WHERE id = 'a8a8a8a8-0000-4000-8000-000000000012';
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  8. al cancelarse el pedido web se quita su cobro'
            ELSE 'MAL   8. el pedido cancelado conserva su cobro web' END
FROM public.cobros WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000012';

-- 9. Un pedido de la web no se cobra a mano.
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000011', NULL,
    '2026-09-28', 10, 'tarjeta', true);
  RAISE WARNING 'MAL   9. se ha cobrado a mano un pedido de la web';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  9. un pedido de la web no se cobra a mano';
END $$;

-- 10. El cobro web no se borra a mano.
DO $$ BEGIN
  PERFORM public.borrar_cobro((SELECT id FROM public.cobros
    WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000011' AND metodo = 'web'));
  RAISE WARNING 'MAL  10. se ha borrado a mano un cobro web';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 10. el cobro web no se borra a mano';
END $$;

-- 11. Cobro parcial en efectivo de un pedido de tienda: apunte en caja.
SELECT public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000022', NULL,
  '2026-09-28', 40, 'efectivo', false,
  (SELECT id FROM public.caja_conceptos WHERE nombre = 'Metros'), 'anticipo');
SELECT CASE WHEN m.categoria = 'ingreso' AND m.importe = 40 AND c.importe = 40
             AND c.propina = 0 AND c.notas = 'anticipo'
             AND m.observaciones = 'Cobro del pedido M-2'
            THEN 'BIEN 11. el cobro en efectivo de tienda deja su apunte en caja'
            ELSE 'MAL  11. apunte: ' || COALESCE(m.observaciones, 'ninguno') END
FROM public.cobros c
LEFT JOIN public.caja_movimientos m ON m.id = c.caja_movimiento_id
WHERE c.pedido_id = 'a8a8a8a8-0000-4000-8000-000000000022';

-- 12. Con tarjeta, sin caja.
DO $$
DECLARE v_antes INT; v_despues INT;
BEGIN
  SELECT count(*) INTO v_antes FROM public.caja_movimientos;
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000022', NULL,
    '2026-09-28', 30, 'tarjeta');
  SELECT count(*) INTO v_despues FROM public.caja_movimientos;
  IF v_antes = v_despues THEN
    RAISE NOTICE 'BIEN 12. el cobro con tarjeta no crea apunte de caja';
  ELSE
    RAISE WARNING 'MAL  12. el cobro con tarjeta ha creado % apunte(s)', v_despues - v_antes;
  END IF;
END $$;

-- 13. Quedan 30. Cobrar 35 sin marcar propina: rechazado.
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000022', NULL,
    '2026-09-28', 35, 'transferencia');
  RAISE WARNING 'MAL  13. se ha cobrado de mas sin marcar propina';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%propina%' THEN
    RAISE NOTICE 'BIEN 13. cobrar de mas sin marcar propina: rechazado, y lo dice';
  ELSE
    RAISE WARNING 'MAL  13. rechazado por otra cosa: %', SQLERRM;
  END IF;
END $$;

-- 14. Marcar propina sin que sobre nada: rechazado.
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000022', NULL,
    '2026-09-28', 10, 'tarjeta', true);
  RAISE WARNING 'MAL  14. se ha aceptado una propina que no existe';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 14. propina marcada sin exceso: rechazada';
END $$;

-- 15. 35 en efectivo con propina: 30 al pedido, 5 de propina, 35 a caja.
SELECT public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000022', NULL,
  '2026-09-28', 35, 'efectivo', true,
  (SELECT id FROM public.caja_conceptos WHERE nombre = 'Metros'));
SELECT CASE WHEN c.importe = 30 AND c.propina = 5 AND m.importe = 35
             AND m.observaciones LIKE '%5.00 € de propina%'
            THEN 'BIEN 15. el exceso va a propina y a caja entra todo el efectivo'
            ELSE 'MAL  15. propina: ' || c.importe || ' + ' || c.propina || ', caja ' || COALESCE(m.importe::TEXT, '-') END
FROM public.cobros c
JOIN public.caja_movimientos m ON m.id = c.caja_movimiento_id
WHERE c.pedido_id = 'a8a8a8a8-0000-4000-8000-000000000022' AND c.propina > 0;

-- 16. Cobrado entero, una propina después sigue siendo posible.
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000022', NULL,
    '2026-09-29', 2, 'tarjeta', true);
  IF (SELECT sum(importe) FROM public.cobros
       WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000022') = 100 THEN
    RAISE NOTICE 'BIEN 16. con el pedido cobrado, la propina no suma al pedido';
  ELSE
    RAISE WARNING 'MAL  16. la propina ha sumado al pedido';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  16. no se ha podido dar propina: %', SQLERRM;
END $$;

-- 17. Textil: sigue funcionando. Quedan 50; efectivo con concepto de gasto, sin
--     concepto, y tarjeta con concepto: rechazados.
DO $$ BEGIN
  PERFORM public.registrar_cobro(NULL, 'a8a8a8a8-0000-4000-8000-000000000001',
    '2026-09-28', 10, 'efectivo', false,
    (SELECT id FROM public.caja_conceptos WHERE nombre = 'Nómina'));
  RAISE WARNING 'MAL 17a. un cobro ha entrado en caja con un concepto de gasto';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 17a. efectivo con concepto de gasto: rechazado';
END $$;
DO $$ BEGIN
  PERFORM public.registrar_cobro(NULL, 'a8a8a8a8-0000-4000-8000-000000000001',
    '2026-09-28', 10, 'efectivo');
  RAISE WARNING 'MAL 17b. efectivo sin concepto de caja aceptado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 17b. efectivo sin concepto de caja: rechazado';
END $$;
DO $$ BEGIN
  PERFORM public.registrar_cobro(NULL, 'a8a8a8a8-0000-4000-8000-000000000001',
    '2026-09-28', 10, 'tarjeta', false,
    (SELECT id FROM public.caja_conceptos WHERE nombre = 'Metros'));
  RAISE WARNING 'MAL 17c. un cobro con tarjeta ha aceptado concepto de caja';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 17c. tarjeta con concepto de caja: rechazado';
END $$;

-- 18. Textil: lo pendiente justo se cobra, y el cobro textil lleva su pedido.
DO $$ BEGIN
  PERFORM public.registrar_cobro(NULL, 'a8a8a8a8-0000-4000-8000-000000000001',
    '2026-09-28', 50, 'transferencia');
  RAISE NOTICE 'BIEN 18. el textil cobra exactamente lo pendiente';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  18. el textil no cobra lo pendiente: %', SQLERRM;
END $$;

-- 19. Pedido cancelado, importe cero, método web a mano, y los dos pedidos a
--     la vez: rechazados.
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000013', NULL,
    '2026-09-28', 10, 'tarjeta');
  RAISE WARNING 'MAL 19a. un pedido cancelado ha admitido un cobro';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 19a. pedido cancelado: no admite cobros';
END $$;
DO $$ BEGIN
  PERFORM public.registrar_cobro(NULL, 'a8a8a8a8-0000-4000-8000-000000000001',
    '2026-09-28', 0, 'tarjeta');
  RAISE WARNING 'MAL 19b. se ha aceptado un cobro de cero';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 19b. cobro de cero: rechazado';
END $$;
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000021', NULL,
    '2026-09-28', 1, 'web', true);
  RAISE WARNING 'MAL 19c. se ha registrado a mano un cobro web';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 19c. un cobro web no se registra a mano';
END $$;
DO $$ BEGIN
  PERFORM public.registrar_cobro('a8a8a8a8-0000-4000-8000-000000000021',
    'a8a8a8a8-0000-4000-8000-000000000001', '2026-09-28', 1, 'tarjeta', true);
  RAISE WARNING 'MAL 19d. un cobro de dos pedidos a la vez';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 19d. un cobro es de un solo pedido';
END $$;

-- 20. El apunte de caja de un cobro no se borra desde Caja.
DO $$ BEGIN
  DELETE FROM public.caja_movimientos
   WHERE id = (SELECT caja_movimiento_id FROM public.cobros
                WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000022'
                  AND metodo = 'efectivo' AND propina = 0);
  RAISE WARNING 'MAL  20. se ha borrado desde caja el apunte de un cobro';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'BIEN 20. el apunte de un cobro no se borra desde caja';
END $$;

-- 21. Borrar el cobro textil en efectivo que venía de antes se lleva su
--     apunte: la fila vieja de textil_cobros ya no lo sujeta.
DO $$
DECLARE v_caja UUID;
BEGIN
  SELECT caja_movimiento_id INTO v_caja FROM public.cobros
   WHERE id = 'a8a8a8a8-0000-4000-8000-0000000000c2';
  PERFORM public.borrar_cobro('a8a8a8a8-0000-4000-8000-0000000000c2');
  IF NOT EXISTS (SELECT 1 FROM public.caja_movimientos WHERE id = v_caja) THEN
    RAISE NOTICE 'BIEN 21. borrar un cobro en efectivo de antes se lleva su apunte';
  ELSE
    RAISE WARNING 'MAL  21. el apunte de caja ha sobrevivido al cobro';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  21. no se ha podido borrar el cobro de antes: %', SQLERRM;
END $$;

-- 22. Un pedido con cobros hechos a mano no se borra; el textil tampoco.
DO $$ BEGIN
  DELETE FROM public.pedidos WHERE id = 'a8a8a8a8-0000-4000-8000-000000000022';
  RAISE WARNING 'MAL 22a. se ha borrado un pedido con cobros';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'BIEN 22a. un pedido con cobros a mano no se borra';
END $$;
DO $$ BEGIN
  DELETE FROM public.textil_pedidos WHERE id = 'a8a8a8a8-0000-4000-8000-000000000001';
  RAISE WARNING 'MAL 22b. se ha borrado un pedido textil con cobros';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'BIEN 22b. un pedido textil con cobros no se borra';
END $$;

-- 23. Un pedido con solo cobros automáticos sí: se van con él.
DO $$ BEGIN
  DELETE FROM public.pedidos WHERE id = 'a8a8a8a8-0000-4000-8000-000000000021';
  IF NOT EXISTS (SELECT 1 FROM public.cobros
                  WHERE pedido_id = 'a8a8a8a8-0000-4000-8000-000000000021') THEN
    RAISE NOTICE 'BIEN 23. el pedido con solo cobros automaticos se borra y se los lleva';
  ELSE
    RAISE WARNING 'MAL  23. quedan cobros del pedido borrado';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  23. no se ha podido borrar: %', SQLERRM;
END $$;

-- 24. La tienda con cobros a mano no se borra, y el mensaje lo explica.
DO $$ BEGIN
  DELETE FROM public.tiendas WHERE id = 'a8a8a8a8-0000-4000-8000-0000000000a1';
  RAISE WARNING 'MAL  24. se ha borrado una tienda con cobros';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%cobro(s)%Desactívala%' THEN
    RAISE NOTICE 'BIEN 24. una tienda con cobros a mano no se borra, y lo dice';
  ELSE
    RAISE WARNING 'MAL  24. rechazada con otro mensaje: %', SQLERRM;
  END IF;
END $$;

-- 25. Sin los cobros a mano, la tienda se borra y los web se van en cascada.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT c.id FROM public.cobros c
             JOIN public.pedidos p ON p.id = c.pedido_id
            WHERE p.tienda_id = 'a8a8a8a8-0000-4000-8000-0000000000a1' AND NOT c.automatico
  LOOP
    PERFORM public.borrar_cobro(r.id);
  END LOOP;
  DELETE FROM public.tiendas WHERE id = 'a8a8a8a8-0000-4000-8000-0000000000a1';
  IF NOT EXISTS (SELECT 1 FROM public.cobros c WHERE c.pedido_id IN (
       'a8a8a8a8-0000-4000-8000-000000000011', 'a8a8a8a8-0000-4000-8000-000000000022')) THEN
    RAISE NOTICE 'BIEN 25. sin cobros a mano la tienda se borra con sus cobros web';
  ELSE
    RAISE WARNING 'MAL  25. quedan cobros de la tienda borrada';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  25. no se ha podido borrar la tienda: %', SQLERRM;
END $$;

-- 26. authenticated lee, pero no escribe ni llama a las funciones. Los GRANT
--     de tabla no sirven de prueba: 20_auditoria_autor.sql concede ALL a
--     authenticated. Protegen la RLS sin política de escritura y las
--     funciones sin permiso de ejecución.
SELECT CASE WHEN NOT has_function_privilege('authenticated',
                   'public.registrar_cobro(uuid, uuid, date, numeric, public.cobro_metodo, boolean, uuid, text)',
                   'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.borrar_cobro(uuid)', 'EXECUTE')
            THEN 'BIEN 26. authenticated no puede llamar a las funciones de cobro'
            ELSE 'MAL  26. authenticated puede llamar a las funciones de cobro' END;

DO $$
DECLARE v_empresa UUID;
BEGIN
  SELECT empresa_id INTO v_empresa FROM public.textil_pedidos
   WHERE id = 'a8a8a8a8-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  INSERT INTO public.cobros (empresa_id, textil_pedido_id, importe, metodo)
  VALUES (v_empresa, 'a8a8a8a8-0000-4000-8000-000000000001', 1, 'tarjeta');
  RAISE WARNING 'MAL 26b. authenticated ha insertado un cobro saltandose la funcion';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 26b. authenticated no inserta cobros por su cuenta';
END $$;
RESET ROLE;

-- Sin fila borrada o sin permiso siquiera: las dos cosas son lo que se
-- quiere. Aquí es lo segundo, porque volver a aplicar la migración le ha
-- quitado a authenticated el DELETE que le dio 20_auditoria_autor.sql.
DO $$
DECLARE v_filas INT;
BEGIN
  SET LOCAL ROLE authenticated;
  DELETE FROM public.cobros;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RESET ROLE;
  IF v_filas = 0 THEN
    RAISE NOTICE 'BIEN 26c. authenticated no borra cobros por su cuenta';
  ELSE
    RAISE WARNING 'MAL 26c. authenticated ha borrado % cobro(s)', v_filas;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'BIEN 26c. authenticated no borra cobros por su cuenta';
END $$;
RESET ROLE;

-- 27. Las funciones textil viejas ya no existen: nadie escribe en la tabla
--     obsoleta sin darse cuenta.
SELECT CASE WHEN to_regproc('public.textil_registrar_cobro') IS NULL
             AND to_regproc('public.textil_borrar_cobro') IS NULL
            THEN 'BIEN 27. las funciones de textil_cobros se han retirado'
            ELSE 'MAL  27. siguen existiendo funciones que escriben en textil_cobros' END;

-- 28. Los cobros, también los previos, quedan en la auditoría.
SELECT CASE WHEN count(*) FILTER (WHERE registro_id = 'a8a8a8a8-0000-4000-8000-0000000000c1') >= 1
             AND count(*) >= 10
            THEN 'BIEN 28. la auditoria registra los cobros, tambien los previos'
            ELSE 'MAL  28. solo ' || count(*) || ' filas de auditoria' END
FROM public.auditoria WHERE tabla = 'cobros';

-- 29. Sin política FOR ALL.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 29. ninguna politica FOR ALL en cobros'
            ELSE 'MAL  29. ' || count(*) || ' politica(s) FOR ALL en cobros' END
FROM pg_policies WHERE tablename = 'cobros' AND cmd = 'ALL';
