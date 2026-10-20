-- ============================================================================
-- REVERSIÓN de 20261028100100_escaner_textil_datos.sql
-- ============================================================================
-- La segunda de las tres reversiones del escáner textil: después de la de
-- 20261028100200 (que quita el NOT NULL de producto_id y la cabecera inmutable
-- de las compras) y antes de la de 20261028100000. Solo con autorización
-- expresa de Javier.
--
-- Deshace solo lo que hizo la migración de datos:
--   - las variantes de productos con origen 'migracion' se quedan sin
--     producto, y ninguna variante queda marcada como repetida;
--   - las compras de proveedores con origen 'migracion' se quedan sin
--     proveedor, salvo las registradas con el escáner (las que tienen
--     entradas de stock enlazadas o líneas casadas por el escáner);
--   - se borra la memoria con origen 'migracion', los productos con origen
--     'migracion' y los proveedores con origen 'migracion' que ya no use
--     ninguna compra ni ninguna memoria (los que siga usando una compra
--     registrada con el escáner se quedan, y se dice con un NOTICE);
--   - se quita escaner_textil_migrar_datos().
-- No toca stock, movimientos ni compras registradas (más allá de su
-- proveedor_id).
-- ============================================================================

BEGIN;

UPDATE public.textil_stock s
   SET producto_id = NULL
  FROM public.textil_productos p
 WHERE p.id = s.producto_id AND p.origen = 'migracion';

UPDATE public.textil_stock SET repetida = false WHERE repetida;

UPDATE public.textil_compras c
   SET proveedor_id = NULL
  FROM public.proveedores p
 WHERE p.id = c.proveedor_id AND p.origen = 'migracion'
   AND NOT EXISTS (SELECT 1 FROM public.textil_stock_movimientos m WHERE m.compra_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.textil_compra_lineas l
                    WHERE l.compra_id = c.id AND l.casado_metodo IS NOT NULL);

DELETE FROM public.textil_referencias_proveedor WHERE origen = 'migracion';

DELETE FROM public.textil_productos p
 WHERE p.origen = 'migracion'
   AND NOT EXISTS (SELECT 1 FROM public.textil_stock s WHERE s.producto_id = p.id);

DO $$
DECLARE v_quedan INT;
BEGIN
  SELECT count(*) INTO v_quedan
    FROM public.proveedores p
   WHERE p.origen = 'migracion'
     AND (EXISTS (SELECT 1 FROM public.textil_compras c WHERE c.proveedor_id = p.id)
          OR EXISTS (SELECT 1 FROM public.textil_referencias_proveedor r WHERE r.proveedor_id = p.id));
  IF v_quedan > 0 THEN
    RAISE NOTICE 'Se quedan % proveedor(es) de la migración: los usa alguna compra registrada con el escáner.', v_quedan;
  END IF;
END $$;

DELETE FROM public.proveedores p
 WHERE p.origen = 'migracion'
   AND NOT EXISTS (SELECT 1 FROM public.textil_compras c WHERE c.proveedor_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.textil_referencias_proveedor r WHERE r.proveedor_id = p.id);

DROP FUNCTION IF EXISTS public.escaner_textil_migrar_datos();

NOTIFY pgrst, 'reload schema';

COMMIT;
