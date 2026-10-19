-- ============================================================================
-- Pedidos: cuándo se realizaron, coste real del envío y ajustes del Resumen
-- ============================================================================
-- Prueba 20261027100000_pedidos_realizado.sql. Se aplica dos veces (tiene que
-- poder repetirse) y todo va en una transacción que se deshace al final.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261027100000_pedidos_realizado.sql
\ir ../migrations/20261027100000_pedidos_realizado.sql
RESET client_min_messages;

INSERT INTO public.tiendas (id, nombre, slug)
VALUES ('c17c17c1-0000-4000-8000-0000000000a1', 'Tienda realizado', 'tienda-realizado');

-- 1. Un pedido manual que pasa a enviado toma la hora de ese momento.
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen)
VALUES ('c17c17c1-0000-4000-8000-000000000001', 'c17c17c1-0000-4000-8000-0000000000a1',
        'R-1', 'imprimiendo', 100, 'manual');
SELECT CASE WHEN realizado_en IS NULL THEN 'BIEN  1a. sin enviar, sin fecha de realizado'
            ELSE 'MAL   1a. tenía fecha de realizado sin estar enviado' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
UPDATE public.pedidos SET estado = 'enviado' WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
SELECT CASE WHEN realizado_en IS NOT NULL AND NOT realizado_manual
            THEN 'BIEN  1b. al pasar a enviado se pone la fecha'
            ELSE 'MAL   1b. al enviar no se puso la fecha' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000001';

-- 2. De enviado a entregado no cambia la fecha.
UPDATE public.pedidos SET realizado_en = '2026-10-01 10:00+00'
 WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
UPDATE public.pedidos SET estado = 'entregado' WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
SELECT CASE WHEN realizado_en = '2026-10-01 10:00+00'
            THEN 'BIEN  2. de enviado a entregado conserva la fecha'
            ELSE 'MAL   2. de enviado a entregado cambió la fecha' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000001';

-- 3. La corrección a mano manda: la sincronización no la pisa.
SELECT public.pedido_fijar_realizado('pedidos', 'c17c17c1-0000-4000-8000-000000000001',
                                     now() - interval '2 hours', NULL);
UPDATE public.pedidos SET realizado_en = '2020-01-01 00:00+00', estado = 'entregado'
 WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
SELECT CASE WHEN realizado_manual AND realizado_en > now() - interval '3 hours'
            THEN 'BIEN  3. la fecha corregida a mano no la pisa una actualización'
            ELSE 'MAL   3. una actualización pisó la fecha corregida' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000001';

-- 4. Si se cancela después de realizarse, la fecha se queda.
UPDATE public.pedidos SET estado = 'cancelado' WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
SELECT CASE WHEN realizado_en IS NOT NULL THEN 'BIEN  4. cancelado tras realizarse: conserva la fecha'
            ELSE 'MAL   4. al cancelar se perdió la fecha' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000001';

-- 5. Si vuelve a producción, deja de estar realizado.
UPDATE public.pedidos SET estado = 'listo' WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
UPDATE public.pedidos SET estado = 'enviado' WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
UPDATE public.pedidos SET estado = 'imprimiendo' WHERE id = 'c17c17c1-0000-4000-8000-000000000001';
SELECT CASE WHEN realizado_en IS NULL AND NOT realizado_manual
            THEN 'BIEN  5. de vuelta a producción se borra la fecha'
            ELSE 'MAL   5. de vuelta a producción seguía realizado' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000001';

-- 6. Un pedido de WooCommerce que llega ya completado: la fecha de la web, o ninguna.
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id, realizado_en)
VALUES ('c17c17c1-0000-4000-8000-000000000002', 'c17c17c1-0000-4000-8000-0000000000a1',
        'W-1', 'entregado', 50, 'woocommerce', 9001, '2026-09-15 08:30+00'),
       ('c17c17c1-0000-4000-8000-000000000003', 'c17c17c1-0000-4000-8000-0000000000a1',
        'W-2', 'entregado', 50, 'woocommerce', 9002, NULL);
SELECT CASE WHEN (SELECT realizado_en FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000002')
                 = '2026-09-15 08:30+00'
             AND (SELECT realizado_en FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000003') IS NULL
            THEN 'BIEN  6. un pedido web histórico lleva la fecha de la web o ninguna (no «ahora»)'
            ELSE 'MAL   6. un pedido web histórico se inventó la fecha' END;

-- 6b. La sincronización sin fecha de completado no borra la que había.
UPDATE public.pedidos SET realizado_en = NULL, estado = 'entregado'
 WHERE id = 'c17c17c1-0000-4000-8000-000000000002';
SELECT CASE WHEN realizado_en = '2026-09-15 08:30+00'
            THEN 'BIEN  6b. un vacío de la sincronización no borra la fecha'
            ELSE 'MAL   6b. la sincronización borró la fecha de realizado' END
  FROM public.pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000002';

-- 7. Textil: lo mismo.
INSERT INTO public.textil_pedidos (id, numero, estado, cliente_nombre, total)
VALUES ('c17c17c1-0000-4000-8000-000000000011', 'TPD-C17-1', 'listo', 'Club', 80);
UPDATE public.textil_pedidos SET estado = 'enviado' WHERE id = 'c17c17c1-0000-4000-8000-000000000011';
SELECT CASE WHEN realizado_en IS NOT NULL THEN 'BIEN  7. textil: al enviar se pone la fecha'
            ELSE 'MAL   7. textil: al enviar no se puso la fecha' END
  FROM public.textil_pedidos WHERE id = 'c17c17c1-0000-4000-8000-000000000011';

-- 8. La corrección a mano rechaza lo que no tiene sentido.
DO $$ BEGIN
  PERFORM public.pedido_fijar_realizado('pedidos', 'c17c17c1-0000-4000-8000-000000000001', now(), NULL);
  RAISE WARNING 'MAL   8a. se corrigió la fecha de un pedido en producción';
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE NOTICE 'BIEN 8a. un pedido en producción no admite fecha de realizado';
END $$;
DO $$ BEGIN
  PERFORM public.pedido_fijar_realizado('pedidos', 'c17c17c1-0000-4000-8000-000000000002',
                                        now() + interval '2 days', NULL);
  RAISE WARNING 'MAL   8b. se aceptó una fecha futura';
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE NOTICE 'BIEN 8b. una fecha futura se rechaza';
END $$;
DO $$ BEGIN
  PERFORM public.pedido_fijar_realizado('facturas', 'c17c17c1-0000-4000-8000-000000000002', now(), NULL);
  RAISE WARNING 'MAL   8c. se aceptó otra tabla';
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE NOTICE 'BIEN 8c. solo pedidos y textil_pedidos';
END $$;

-- 9. Solo el servidor puede corregir la fecha.
SELECT CASE WHEN NOT has_function_privilege('authenticated',
                  'public.pedido_fijar_realizado(text, uuid, timestamptz, uuid)', 'EXECUTE')
             AND NOT has_function_privilege('anon',
                  'public.pedido_fijar_realizado(text, uuid, timestamptz, uuid)', 'EXECUTE')
            THEN 'BIEN  9. pedido_fijar_realizado solo para service_role'
            ELSE 'MAL   9. pedido_fijar_realizado se puede llamar desde el navegador' END;

-- 10. Coste real del envío: entre 0 y 1000.
DO $$ BEGIN
  UPDATE public.pedidos SET coste_envio_real = -1 WHERE id = 'c17c17c1-0000-4000-8000-000000000002';
  RAISE WARNING 'MAL   10. entró un coste de envío negativo';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 10. un coste de envío negativo se rechaza';
END $$;

-- 11. Ajustes del Resumen con sus valores de partida.
INSERT INTO public.gerencia_ajustes (empresa_id) VALUES (public.empresa_por_defecto())
ON CONFLICT (empresa_id) DO NOTHING;
SELECT CASE WHEN hora_corte = '13:30' AND metros_hora = 70 AND jornada_inicio = '09:00'
             AND jornada_fin = '13:00' AND coste_envio_defecto = 5.00
            THEN 'BIEN  11. ajustes: corte 13:30, 70 m/h, 09:00–13:00, envío 5,00 €'
            ELSE 'MAL   11. ajustes del Resumen con otros valores' END
  FROM public.gerencia_ajustes WHERE empresa_id = public.empresa_por_defecto();
DO $$ BEGIN
  UPDATE public.gerencia_ajustes SET jornada_fin = '08:00' WHERE empresa_id = public.empresa_por_defecto();
  RAISE WARNING 'MAL   11b. entró una jornada que acaba antes de empezar';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 11b. una jornada que acaba antes de empezar se rechaza';
END $$;

ROLLBACK;
