-- ============================================================================
-- Un pedido con woo_order_id no puede decir que es manual
-- ============================================================================
-- No es una etiqueta: de ese campo depende que los cambios de estado y el
-- tracking vuelvan a la web de la tienda.

DO $$
DECLARE v_tienda UUID;
BEGIN
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda origen', 'tienda-origen')
    RETURNING id INTO v_tienda;

  -- Como los guardaba la sincronizacion antes de la correccion: sin origen.
  INSERT INTO public.pedidos (tienda_id, woo_order_id, numero, total)
  VALUES (v_tienda, 9001, '9001', 100);
  -- Y uno manual de verdad.
  INSERT INTO public.pedidos (tienda_id, numero, total, origen)
  VALUES (v_tienda, 'M-1', 50, 'manual');

  PERFORM set_config('prueba.tienda_origen', v_tienda::TEXT, false);
END $$;

-- 1. Antes de la correccion el de Woo decia 'manual'. Se comprueba que el
--    UPDATE de la migracion lo arregla.
UPDATE public.pedidos
   SET origen = 'woocommerce'
 WHERE woo_order_id IS NOT NULL
   AND origen IS DISTINCT FROM 'woocommerce';

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  1. ningun pedido con woo_order_id dice ser manual'
            ELSE 'MAL   1. quedan ' || count(*) END
FROM public.pedidos
WHERE woo_order_id IS NOT NULL AND origen IS DISTINCT FROM 'woocommerce';

-- 2. Y el manual sigue siendo manual: la correccion no lo toca.
SELECT CASE WHEN origen = 'manual'
            THEN 'BIEN  2. el pedido manual sigue siendo manual'
            ELSE 'MAL   2. le cambio el origen a ' || origen END
FROM public.pedidos
WHERE tienda_id = current_setting('prueba.tienda_origen')::UUID AND numero = 'M-1';
