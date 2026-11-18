-- ============================================================================
-- El recargo de equivalencia del pedido, aparte del IVA
-- ============================================================================
-- WooCommerce manda en `total_tax` todos los impuestos juntos: IVA y recargo
-- de equivalencia. `pedidos.iva` los guarda así y así se queda, porque la base
-- de cada pedido (total − iva) la usan Gerencia, Cobros y Fiscal y no debe
-- cambiar. Esta columna dice cuánto de ese `iva` es recargo, para enseñar en
-- el pedido IVA y R.E por separado (DCUL-172-2026: 3,40 = 2,73 de IVA + 0,67
-- de R.E). La rellena la sincronización (recargoPedidoWoo) y, para los pedidos
-- antiguos, Ajustes de la tienda > «Recuperar recargo».
--
-- Reversible: supabase/reversiones/20261121100000_pedido_recargo.sql.

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS recargo NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pedidos.recargo IS
  'Recargo de equivalencia que cobró la web. Va DENTRO de pedidos.iva (que '
  'son todos los impuestos): el IVA solo es iva − recargo.';

COMMENT ON COLUMN public.pedidos.iva IS
  'Impuestos del pedido: IVA más el recargo de equivalencia si lo lleva '
  '(ver pedidos.recargo). La base es total − iva.';

NOTIFY pgrst, 'reload schema';
