-- ============================================================================
-- Línea de producto: DTF y DTF UV
-- ============================================================================
-- Prueba 20261110100000_linea_dtf_uv.sql. Se aplica dos veces (tiene que
-- poder repetirse) y todo va en una transacción que se deshace al final.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261110100000_linea_dtf_uv.sql
\ir ../migrations/20261110100000_linea_dtf_uv.sql
RESET client_min_messages;

INSERT INTO public.tiendas (id, nombre, slug)
VALUES ('d7d7d7d7-0000-4000-8000-0000000000a1', 'Tienda D7', 'tienda-d7');
UPDATE public.empresas
   SET coste_consumibles_metro = 1.2, coste_packaging_metro = 0.3, coste_electricidad_metro = 0.15
 WHERE id = public.empresa_por_defecto();

-- 1. La forma.
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND (table_name, column_name) IN (
                       ('productos', 'linea'), ('pedido_items', 'linea'),
                       ('pedido_items', 'woo_product_id'), ('pedido_items', 'sku'),
                       ('pedidos', 'metros_uv'), ('pedidos', 'coste_uv_snapshot'),
                       ('empresas', 'coste_uv_metro'))) = 7
             AND (SELECT coste_uv_metro FROM public.empresas
                   WHERE id = public.empresa_por_defecto()) = 15
            THEN 'BIEN  1. columnas nuevas y 15 €/m de coste del UV por defecto'
            ELSE 'MAL   1. falta algo en la forma de la migración' END;

-- 2. Un pedido nuevo congela el coste del UV de la empresa.
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id,
                            fecha_pedido, metros_total, metros_uv)
VALUES ('d7d7d7d7-0000-4000-8000-000000000001', 'd7d7d7d7-0000-4000-8000-0000000000a1',
        'DCUL-146-2026', 'pendiente', 135.52, 'woocommerce', 9146,
        '2026-11-10 10:00:00+00', 0, 7);
SELECT CASE WHEN coste_uv_snapshot = 15 AND metros_uv = 7
            THEN 'BIEN  2. el pedido guarda 7 m de UV y congela 15 €/m'
            ELSE 'MAL   2. coste_uv_snapshot = ' || COALESCE(coste_uv_snapshot::TEXT, 'nulo') END
  FROM public.pedidos WHERE id = 'd7d7d7d7-0000-4000-8000-000000000001';

-- 3. Las líneas: la de UV copia su coste; la de metros DTF, el del DTF; el resto, 0.
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario,
                                 linea, woo_product_id, sku, metros_origen)
VALUES ('d7d7d7d7-0000-4000-8000-000000000001', 'DTF UV por Metros Manual', 7, 'm', 16,
        'uv', 501, 'UV-M', 'cantidad'),
       ('d7d7d7d7-0000-4000-8000-000000000001', 'DTF por Metros', 2, 'm', 7,
        'dtf', 500, NULL, 'montador'),
       ('d7d7d7d7-0000-4000-8000-000000000001', 'Diseño', 1, 'ud', 10,
        'dtf', NULL, NULL, NULL);
SELECT CASE WHEN (SELECT coste_unit_snapshot FROM public.pedido_items
                   WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000001' AND linea = 'uv') = 15
             AND (SELECT coste_unit_snapshot FROM public.pedido_items
                   WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000001'
                     AND descripcion = 'DTF por Metros') = 1.65
             AND (SELECT coste_unit_snapshot FROM public.pedido_items
                   WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000001'
                     AND descripcion = 'Diseño') = 0
            THEN 'BIEN  3. UV a 15 €/m, metros DTF a 1,65 €/m y unidades a 0'
            ELSE 'MAL   3. costes de las líneas mal congelados' END;

-- 4. Cambiar el coste de la empresa no toca el pedido; uno nuevo lleva el nuevo.
UPDATE public.empresas SET coste_uv_metro = 16 WHERE id = public.empresa_por_defecto();
UPDATE public.pedidos SET coste_uv_snapshot = 99
 WHERE id = 'd7d7d7d7-0000-4000-8000-000000000001';
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id,
                            fecha_pedido, metros_uv)
VALUES ('d7d7d7d7-0000-4000-8000-000000000002', 'd7d7d7d7-0000-4000-8000-0000000000a1',
        'DCUL-147-2026', 'pendiente', 21.18, 'woocommerce', 9147,
        '2026-11-10 11:00:00+00', 1);
SELECT CASE WHEN (SELECT coste_uv_snapshot FROM public.pedidos
                   WHERE id = 'd7d7d7d7-0000-4000-8000-000000000001') = 15
             AND (SELECT coste_uv_snapshot FROM public.pedidos
                   WHERE id = 'd7d7d7d7-0000-4000-8000-000000000002') = 16
            THEN 'BIEN  4. el coste congelado no cambia; el pedido nuevo lleva el de hoy'
            ELSE 'MAL   4. el coste del UV del pedido no se mantiene congelado' END;

-- 5. Un pedido de antes de la migración (sin coste del UV): su línea UV toma el de hoy.
ALTER TABLE public.pedidos DISABLE TRIGGER pedidos_coste_uv_congelado;
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id, fecha_pedido)
VALUES ('d7d7d7d7-0000-4000-8000-000000000003', 'd7d7d7d7-0000-4000-8000-0000000000a1',
        'DCUL-140-2026', 'pendiente', 19.36, 'woocommerce', 9140, '2026-11-09 10:00:00+00');
ALTER TABLE public.pedidos ENABLE TRIGGER pedidos_coste_uv_congelado;
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario, linea)
VALUES ('d7d7d7d7-0000-4000-8000-000000000003', 'DTF UV por Metros Manual', 1, 'm', 16, 'uv');
SELECT CASE WHEN coste_unit_snapshot = 16
            THEN 'BIEN  5. sin coste congelado en el pedido, la línea UV toma el de hoy'
            ELSE 'MAL   5. coste_unit_snapshot = ' || COALESCE(coste_unit_snapshot::TEXT, 'nulo') END
  FROM public.pedido_items WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000003';

-- 6. Lo que no vale, no entra.
DO $$
DECLARE v_rechazos INT := 0;
BEGIN
  BEGIN
    INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario, linea)
    VALUES ('d7d7d7d7-0000-4000-8000-000000000001', 'x', 1, 'ud', 1, 'otra');
  EXCEPTION WHEN check_violation THEN v_rechazos := v_rechazos + 1; END;
  BEGIN
    UPDATE public.pedidos SET metros_uv = -1 WHERE id = 'd7d7d7d7-0000-4000-8000-000000000001';
  EXCEPTION WHEN check_violation THEN v_rechazos := v_rechazos + 1; END;
  BEGIN
    INSERT INTO public.productos (tienda_id, nombre, linea)
    VALUES ('d7d7d7d7-0000-4000-8000-0000000000a1', 'x', 'otra');
  EXCEPTION WHEN check_violation THEN v_rechazos := v_rechazos + 1; END;
  BEGIN
    UPDATE public.empresas SET coste_uv_metro = -1 WHERE id = public.empresa_por_defecto();
  EXCEPTION WHEN check_violation THEN v_rechazos := v_rechazos + 1; END;
  PERFORM set_config('d7.rechazos', v_rechazos::TEXT, true);
END $$;
SELECT CASE WHEN current_setting('d7.rechazos') = '4'
            THEN 'BIEN  6. se rechazan una línea desconocida, metros negativos y costes negativos'
            ELSE 'MAL   6. rechazados ' || current_setting('d7.rechazos') || ' de 4' END;

-- 7. Una línea sin línea dicha (las de antes, las manuales) es DTF.
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario)
VALUES ('d7d7d7d7-0000-4000-8000-000000000002', 'Metros', 1, 'm', 7);
SELECT CASE WHEN linea = 'dtf'
            THEN 'BIEN  7. una línea sin línea de producto es DTF'
            ELSE 'MAL   7. linea = ' || linea END
  FROM public.pedido_items
 WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000002' AND descripcion = 'Metros';

ROLLBACK;
