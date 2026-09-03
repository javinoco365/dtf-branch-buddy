-- ============================================================================
-- Stock textil: reservar no es vender
-- ============================================================================
--
-- Lo que se comprueba aquí es que el físico y lo comprometido son dos números
-- distintos, que solo la entrega mueve el primero, y que cancelar deja el
-- almacén exactamente como estaba.

DO $$
DECLARE v_empresa UUID; v_stock UUID; v_pedido UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.textil_stock (nombre, color, talla, cantidad, coste_unitario)
  VALUES ('Camiseta reservas', 'negro', 'M', 0, 0) RETURNING id INTO v_stock;
  INSERT INTO public.textil_pedidos (numero, estado) VALUES ('TPD-RES-1', 'pendiente')
    RETURNING id INTO v_pedido;

  INSERT INTO public.textil_stock_movimientos
    (empresa_id, stock_id, motivo, cantidad, coste_unitario)
  VALUES (v_empresa, v_stock, 'compra', 20, 4.00);

  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
  PERFORM set_config('prueba.stock', v_stock::TEXT, false);
  PERFORM set_config('prueba.pedido', v_pedido::TEXT, false);
END $$;

-- 1. Reservar 15 no mueve el físico. Es lo que motiva toda esta tabla: antes
--    la pantalla decía 5 y no dejaba prometerle 8 a otro cliente teniendo 20.
INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad)
VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
        current_setting('prueba.pedido')::UUID, 15);

SELECT CASE WHEN cantidad = 20 AND cantidad_reservada = 15
            THEN 'BIEN  1. reservar 15 deja 20 en el armario y 15 comprometidas'
            ELSE 'MAL   1. fisico ' || cantidad || ' reservado ' || cantidad_reservada END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 2. Editar el pedido actualiza la reserva, no la acumula.
INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad)
VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
        current_setting('prueba.pedido')::UUID, 12)
ON CONFLICT (textil_pedido_id, stock_id) DO UPDATE SET cantidad = EXCLUDED.cantidad;

SELECT CASE WHEN cantidad_reservada = 12
            THEN 'BIEN  2. editar el pedido sustituye la reserva, no la suma'
            ELSE 'MAL   2. reservado ' || cantidad_reservada END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 3. Una reserva de cero o negativa no tiene sentido.
DO $$
BEGIN
  INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad)
  VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
          gen_random_uuid(), -3);
  RAISE NOTICE 'MAL   3. dejó reservar una cantidad negativa';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. no deja reservar cantidades que no son positivas';
END $$;

-- 4. Entregar: la reserva se convierte en salida y el físico baja de verdad.
SELECT CASE WHEN public.textil_pedido_entregar(current_setting('prueba.pedido')::UUID) = 1
            THEN 'BIEN  4. la entrega mueve una linea'
            ELSE 'MAL   4. la entrega movio otro numero de lineas' END;

SELECT CASE WHEN cantidad = 8 AND cantidad_reservada = 0
            THEN 'BIEN  4b. tras entregar quedan 8 fisicas y 0 comprometidas'
            ELSE 'MAL   4b. fisico ' || cantidad || ' reservado ' || cantidad_reservada END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

SELECT CASE WHEN motivo = 'venta' AND cantidad = -12 AND coste_unitario = 4
            THEN 'BIEN  4c. la entrega anota una venta de 12 al coste vigente'
            ELSE 'MAL   4c. anoto ' || motivo || ' ' || cantidad END
FROM public.textil_stock_movimientos
WHERE stock_id = current_setting('prueba.stock')::UUID
ORDER BY id DESC LIMIT 1;

-- 5. Entregar dos veces no vuelve a descontar: sin reservas no hay nada que mover.
SELECT CASE WHEN public.textil_pedido_entregar(current_setting('prueba.pedido')::UUID) = 0
            THEN 'BIEN  5. entregar dos veces no descuenta dos veces'
            ELSE 'MAL   5. la segunda entrega volvio a mover stock' END;

-- 6. Cancelar antes de entregar deja el almacén como estaba.
DO $$
DECLARE v_pedido UUID;
BEGIN
  INSERT INTO public.textil_pedidos (numero, estado) VALUES ('TPD-RES-2', 'pendiente')
    RETURNING id INTO v_pedido;
  INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad)
  VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
          v_pedido, 5);
  DELETE FROM public.textil_stock_reservas WHERE textil_pedido_id = v_pedido;
END $$;

SELECT CASE WHEN cantidad = 8 AND cantidad_reservada = 0
            THEN 'BIEN  6. cancelar libera lo comprometido sin tocar el fisico'
            ELSE 'MAL   6. fisico ' || cantidad || ' reservado ' || cantidad_reservada END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 7. Borrar el pedido se lleva sus reservas por delante.
DO $$
DECLARE v_pedido UUID;
BEGIN
  INSERT INTO public.textil_pedidos (numero, estado) VALUES ('TPD-RES-3', 'pendiente')
    RETURNING id INTO v_pedido;
  INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad)
  VALUES (current_setting('prueba.empresa')::UUID, current_setting('prueba.stock')::UUID,
          v_pedido, 6);
  DELETE FROM public.textil_pedidos WHERE id = v_pedido;
END $$;

SELECT CASE WHEN cantidad_reservada = 0
            THEN 'BIEN  7. borrar el pedido libera su reserva'
            ELSE 'MAL   7. quedo reservado ' || cantidad_reservada END
FROM public.textil_stock WHERE id = current_setting('prueba.stock')::UUID;

-- 8. Y la caché no se separa nunca de la suma de reservas.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  8. sin descuadres entre la cache y las reservas'
            ELSE 'MAL   8. ' || count(*) || ' descuadre(s)' END
FROM public.stock_reservas_descuadres();
