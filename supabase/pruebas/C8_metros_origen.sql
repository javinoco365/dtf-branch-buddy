-- ============================================================================
-- De dónde salen los metros de una línea de pedido
-- ============================================================================
-- Prueba 20261020100000_metros_origen.sql.

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C8', 'tienda-c8');
INSERT INTO public.pedidos (tienda_id, numero, total)
SELECT id, 'P-C8-1', 14.85 FROM public.tiendas WHERE slug = 'tienda-c8';

-- 1. Una línea estimada guarda su origen y el precio usado.
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario,
                                 subtotal, iva, total, metros_origen, precio_metro_usado)
SELECT id, 'DTF por Metros', 1.753, 'm', 6.9994, 12.27, 2.58, 14.85, 'precio_ajustes', 7
  FROM public.pedidos WHERE numero = 'P-C8-1';
SELECT CASE WHEN metros_origen = 'precio_ajustes' AND precio_metro_usado = 7 AND cantidad = 1.753
            THEN 'BIEN  1. la línea estimada guarda su origen y el precio usado'
            ELSE 'MAL   1. no se guardó el origen' END
  FROM public.pedido_items WHERE descripcion = 'DTF por Metros'
   AND pedido_id = (SELECT id FROM public.pedidos WHERE numero = 'P-C8-1');

-- 2. Un origen desconocido no entra.
DO $$ BEGIN
  INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, metros_origen)
  SELECT id, 'x', 1, 'adivinado' FROM public.pedidos WHERE numero = 'P-C8-1';
  RAISE WARNING 'MAL   2. entró un origen desconocido';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'BIEN  2. el origen es uno de los tres';
END $$;

-- 3. Las líneas de antes siguen valiendo (sin origen).
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad)
SELECT id, 'Línea antigua', 2 FROM public.pedidos WHERE numero = 'P-C8-1';
SELECT CASE WHEN metros_origen IS NULL THEN 'BIEN  3. una línea sin origen sigue entrando'
            ELSE 'MAL   3. ' || metros_origen END
  FROM public.pedido_items WHERE descripcion = 'Línea antigua';

-- 4. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261020100000_metros_origen.sql
SELECT CASE WHEN (SELECT count(*) FROM public.pedido_items
                   WHERE pedido_id = (SELECT id FROM public.pedidos WHERE numero = 'P-C8-1')) = 2
            THEN 'BIEN  4. aplicarla dos veces no cambia nada'
            ELSE 'MAL   4. cambiaron los datos' END;
