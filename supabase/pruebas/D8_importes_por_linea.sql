-- ============================================================================
-- Importes del pedido por línea de producto (DTF y DTF UV)
-- ============================================================================
-- Prueba 20261111100000_importes_por_linea.sql: el relleno de los pedidos que
-- ya llevan UV, que solo toca esos, y que se puede aplicar dos veces. Todo va
-- en una transacción que se deshace al final.
BEGIN;

INSERT INTO public.tiendas (id, nombre, slug)
VALUES ('d8d8d8d8-0000-4000-8000-0000000000a1', 'Tienda D8', 'tienda-d8');

-- Tres pedidos de antes de la migración: uno de DTF, uno solo de UV y uno mixto.
INSERT INTO public.pedidos (id, tienda_id, numero, estado, subtotal, iva, total, origen,
                            woo_order_id, fecha_pedido, metros_total, metros_uv)
VALUES ('d8d8d8d8-0000-4000-8000-000000000001', 'd8d8d8d8-0000-4000-8000-0000000000a1',
        'D8-DTF', 'pendiente', 28, 5.88, 33.88, 'woocommerce', 8001, now(), 4, 0),
       ('d8d8d8d8-0000-4000-8000-000000000002', 'd8d8d8d8-0000-4000-8000-0000000000a1',
        'D8-UV', 'pendiente', 112, 23.52, 135.52, 'woocommerce', 8002, now(), 0, 7),
       ('d8d8d8d8-0000-4000-8000-000000000003', 'd8d8d8d8-0000-4000-8000-0000000000a1',
        'D8-MIX', 'pendiente', 63, 13.23, 76.23, 'woocommerce', 8003, now(), 4, 2);
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario,
                                 subtotal, iva, total, linea)
VALUES ('d8d8d8d8-0000-4000-8000-000000000001', 'DTF por Metros', 4, 'm', 7, 28, 5.88, 33.88, 'dtf'),
       ('d8d8d8d8-0000-4000-8000-000000000002', 'DTF UV por Metros Manual', 7, 'm', 16, 112, 23.52, 135.52, 'uv'),
       ('d8d8d8d8-0000-4000-8000-000000000003', 'DTF por Metros', 4, 'm', 7, 28, 5.88, 33.88, 'dtf'),
       ('d8d8d8d8-0000-4000-8000-000000000003', 'DTF UV por metros', 2, 'm', 17.5, 35, 7.35, 42.35, 'uv');

SELECT set_config('d8.auditoria_antes', (SELECT count(*) FROM public.auditoria)::TEXT, true);

SET client_min_messages = warning;
\ir ../migrations/20261111100000_importes_por_linea.sql
\ir ../migrations/20261111100000_importes_por_linea.sql
RESET client_min_messages;

-- 1. Cada pedido, con lo que es de UV en su importe.
SELECT CASE WHEN (SELECT bruta_uv || '/' || iva_uv FROM public.pedidos WHERE numero = 'D8-DTF') = '0.00/0.00'
             AND (SELECT bruta_uv || '/' || iva_uv FROM public.pedidos WHERE numero = 'D8-UV') = '112.00/23.52'
             AND (SELECT bruta_uv || '/' || iva_uv FROM public.pedidos WHERE numero = 'D8-MIX') = '35.00/7.35'
            THEN 'BIEN  1. el relleno pone a cada pedido la base y el IVA de sus líneas de UV'
            ELSE 'MAL   1. relleno de bruta_uv / iva_uv incorrecto' END;

-- 2. El relleno solo toca los pedidos con UV (dos), y aplicarla otra vez no
--    vuelve a escribir: dos filas de auditoría, no tres ni cuatro.
SELECT CASE WHEN (SELECT count(*) FROM public.auditoria)
                 - current_setting('d8.auditoria_antes')::INT = 2
            THEN 'BIEN  2. solo se reescriben los pedidos con UV, y una sola vez'
            ELSE 'MAL   2. filas de auditoría nuevas: '
                 || ((SELECT count(*) FROM public.auditoria) - current_setting('d8.auditoria_antes')::INT) END;

-- 3. No entran importes negativos.
DO $$
BEGIN
  BEGIN
    UPDATE public.pedidos SET bruta_uv = -1 WHERE numero = 'D8-UV';
    PERFORM set_config('d8.negativo', 'entra', true);
  EXCEPTION WHEN check_violation THEN
    PERFORM set_config('d8.negativo', 'rechazado', true);
  END;
END $$;
SELECT CASE WHEN current_setting('d8.negativo') = 'rechazado'
            THEN 'BIEN  3. un importe de UV negativo se rechaza'
            ELSE 'MAL   3. un importe de UV negativo entra' END;

ROLLBACK;
