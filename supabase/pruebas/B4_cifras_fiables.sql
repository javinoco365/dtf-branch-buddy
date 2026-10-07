-- ============================================================================
-- Cifras fiables: cobro web neto de devoluciones y coste congelado
-- ============================================================================
-- Prueba 20261007100000_cifras_fiables.sql. El arnés ya la aplicó sobre una
-- base vacía; aquí se meten datos «de antes» con sus triggers apagados y se
-- vuelve a aplicar, para probar también el relleno y que se puede aplicar dos
-- veces.

DO $$
DECLARE v_tienda UUID;
BEGIN
  INSERT INTO public.tiendas (id, nombre, slug)
  VALUES ('b4b4b4b4-0000-4000-8000-0000000000a1', 'Tienda de cifras', 'tienda-cifras')
  RETURNING id INTO v_tienda;

  UPDATE public.empresas
     SET coste_consumibles_metro = 1.2, coste_packaging_metro = 0.3, coste_electricidad_metro = 0.15
   WHERE id = public.empresa_por_defecto();

  -- Un pedido web pagado de 100 € con una devolución de 30 € de antes de la
  -- migración: su cobro web era de 100 €.
  ALTER TABLE public.pedidos DISABLE TRIGGER pedidos_coste_congelado;
  ALTER TABLE public.pedido_items DISABLE TRIGGER pedido_items_coste_congelado;
  ALTER TABLE public.pedido_devoluciones DISABLE TRIGGER pedido_devoluciones_cobro_web;
  INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id, fecha_pedido)
  VALUES ('b4b4b4b4-0000-4000-8000-000000000001', v_tienda, 'W-B4-1', 'entregado', 100,
          'woocommerce', 7001, '2026-09-10 10:00:00+00');
  INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario)
  VALUES ('b4b4b4b4-0000-4000-8000-000000000001', 'Metro DTF', 5, 'm', 12),
         ('b4b4b4b4-0000-4000-8000-000000000001', 'Diseño', 1, 'ud', 20);
  INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, woo_refund_id, importe)
  VALUES ('b4b4b4b4-0000-4000-8000-000000000001', v_tienda, 70001, 30);
  ALTER TABLE public.pedidos ENABLE TRIGGER pedidos_coste_congelado;
  ALTER TABLE public.pedido_items ENABLE TRIGGER pedido_items_coste_congelado;
  ALTER TABLE public.pedido_devoluciones ENABLE TRIGGER pedido_devoluciones_cobro_web;
END $$;

-- La devolución de antes no tocó el cobro: sigue en 100.
SELECT CASE WHEN min(importe) = 100
            THEN 'BIEN  0. antes de la migracion el cobro web no restaba la devolucion'
            ELSE 'MAL   0. preparacion: cobro web ' || COALESCE(min(importe)::TEXT, 'ninguno') END
FROM public.cobros WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000001' AND metodo = 'web';

\ir ../migrations/20261007100000_cifras_fiables.sql

-- 1. Al aplicarla, el cobro web de los pedidos con devoluciones se recalcula.
SELECT CASE WHEN count(*) = 1 AND min(importe) = 70
            THEN 'BIEN  1. el cobro web resta lo ya devuelto al aplicar la migracion'
            ELSE 'MAL   1. cobro web tras migrar: ' || COALESCE(min(importe)::TEXT, 'ninguno') END
FROM public.cobros WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000001' AND metodo = 'web';

-- 2. Los pedidos y las líneas de antes quedan congelados con el coste de hoy.
SELECT CASE WHEN p.coste_metro_snapshot = 1.65
             AND (SELECT coste_unit_snapshot FROM public.pedido_items
                   WHERE pedido_id = p.id AND unidad = 'm') = 1.65
             AND (SELECT coste_unit_snapshot FROM public.pedido_items
                   WHERE pedido_id = p.id AND unidad = 'ud') = 0
            THEN 'BIEN  2. lo de antes se congela con el coste actual (metros 1,65; resto 0)'
            ELSE 'MAL   2. relleno del coste: ' || COALESCE(p.coste_metro_snapshot::TEXT, 'nulo') END
FROM public.pedidos p WHERE p.id = 'b4b4b4b4-0000-4000-8000-000000000001';

-- 3. Una devolución nueva vuelve a recalcular el cobro web.
INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, woo_refund_id, importe)
VALUES ('b4b4b4b4-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-0000000000a1', 70002, 20);
SELECT CASE WHEN min(importe) = 50
            THEN 'BIEN  3. una devolucion nueva baja el cobro web (100 - 30 - 20 = 50)'
            ELSE 'MAL   3. cobro web tras la segunda devolucion: ' || COALESCE(min(importe)::TEXT, 'ninguno') END
FROM public.cobros WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000001' AND metodo = 'web';

-- 4. Si se devuelve todo, el cobro web desaparece; si se borra la devolución, vuelve.
INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, woo_refund_id, importe)
VALUES ('b4b4b4b4-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-0000000000a1', 70003, 50);
SELECT set_config('prueba.b4_todo', count(*)::TEXT, false)
  FROM public.cobros WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000001' AND metodo = 'web' \g /dev/null
DELETE FROM public.pedido_devoluciones WHERE woo_refund_id = 70003;
SELECT CASE WHEN current_setting('prueba.b4_todo') = '0' AND min(importe) = 50
            THEN 'BIEN  4. devuelto todo no hay cobro web; al quitar la devolucion vuelve'
            ELSE 'MAL   4. devuelto todo: ' || current_setting('prueba.b4_todo')
                 || ' cobro(s); despues ' || COALESCE(min(importe)::TEXT, 'ninguno') END
FROM public.cobros WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000001' AND metodo = 'web';

-- 5. Un pedido nuevo congela el coste del momento, y las líneas lo copian del
--    pedido aunque el coste de la empresa cambie después.
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, fecha_pedido)
VALUES ('b4b4b4b4-0000-4000-8000-000000000002', 'b4b4b4b4-0000-4000-8000-0000000000a1',
        'M-B4-2', 'en_produccion', 60, 'manual', '2026-10-01 10:00:00+00');
UPDATE public.empresas SET coste_consumibles_metro = 9 WHERE id = public.empresa_por_defecto();
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario)
VALUES ('b4b4b4b4-0000-4000-8000-000000000002', 'Metro DTF', 3, 'm', 12);
SELECT CASE WHEN p.coste_metro_snapshot = 1.65
             AND (SELECT coste_unit_snapshot FROM public.pedido_items WHERE pedido_id = p.id) = 1.65
            THEN 'BIEN  5. el pedido congela el coste al crearse y sus lineas lo copian de el'
            ELSE 'MAL   5. coste congelado: pedido ' || COALESCE(p.coste_metro_snapshot::TEXT, 'nulo') END
FROM public.pedidos p WHERE p.id = 'b4b4b4b4-0000-4000-8000-000000000002';

-- 6. Ni un UPDATE directo ni volver a sincronizar las líneas lo descongelan.
UPDATE public.pedidos SET coste_metro_snapshot = 99, total = 61
 WHERE id = 'b4b4b4b4-0000-4000-8000-000000000002';
DELETE FROM public.pedido_items WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000002';
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario)
VALUES ('b4b4b4b4-0000-4000-8000-000000000002', 'Metro DTF', 3, 'm', 12);
SELECT CASE WHEN p.coste_metro_snapshot = 1.65 AND p.total = 61
             AND (SELECT coste_unit_snapshot FROM public.pedido_items WHERE pedido_id = p.id) = 1.65
            THEN 'BIEN  6. el coste no cambia con un UPDATE ni al reescribir las lineas'
            ELSE 'MAL   6. coste tras actualizar: ' || COALESCE(p.coste_metro_snapshot::TEXT, 'nulo') END
FROM public.pedidos p WHERE p.id = 'b4b4b4b4-0000-4000-8000-000000000002';

-- 7. Aplicarla otra vez no cambia nada de lo anterior.
\ir ../migrations/20261007100000_cifras_fiables.sql
SELECT CASE WHEN (SELECT importe FROM public.cobros
                   WHERE pedido_id = 'b4b4b4b4-0000-4000-8000-000000000001' AND metodo = 'web') = 50
             AND (SELECT coste_metro_snapshot FROM public.pedidos
                   WHERE id = 'b4b4b4b4-0000-4000-8000-000000000002') = 1.65
            THEN 'BIEN  7. aplicarla dos veces no cambia cobros ni costes'
            ELSE 'MAL   7. tras reaplicar cambia algo' END;

-- Deja el coste de la empresa como estaba para las pruebas que vengan detrás.
UPDATE public.empresas
   SET coste_consumibles_metro = 0, coste_packaging_metro = 0, coste_electricidad_metro = 0
 WHERE id = public.empresa_por_defecto();
