-- ============================================================================
-- PEDIDOS · Los de WooCommerce decían que eran manuales
-- ============================================================================
--
-- QUÉ PASABA
--   La sincronización nunca escribía la columna `origen`, así que todo pedido
--   traído de WooCommerce se quedaba en 'manual', que es el valor por defecto.
--
-- POR QUÉ NO ERA SOLO UNA ETIQUETA MAL PUESTA
--   Dos sitios de la aplicación preguntan por ese campo antes de hablar con la
--   web de la tienda:
--
--     updatePedidoEstado    if (woo_order_id && origen === 'woocommerce')
--     updatePedidoTracking  if (woo_order_id && origen === 'woocommerce')
--
--   Como la condición nunca se cumplía, marcar un pedido como enviado en el CRM
--   NO cambiaba nada en WooCommerce, y el número de seguimiento no llegaba
--   nunca a la nota del pedido. El cliente veía su pedido igual que el primer
--   día. Y el aviso «Estado actualizado y sincronizado con WooCommerce» no
--   podía salir jamás.
--
-- LA CORRECCIÓN DE LOS DATOS
--   Se corrigen las filas ya guardadas. El criterio no admite duda: woo_order_id
--   solo lo pone la sincronización —un pedido manual nace sin él y la clave
--   UNIQUE (tienda_id, woo_order_id) lo confirma—, así que toda fila que lo
--   tenga vino de WooCommerce.
--
--   Es un UPDATE sobre datos reales. Solo toca la columna `origen` y solo en
--   filas donde hoy dice algo distinto de la verdad.
--
-- REVERSIBLE
--   La columna vuelve a 'manual' con un UPDATE simétrico, aunque hacerlo
--   restauraría el fallo.
-- ============================================================================

UPDATE public.pedidos
   SET origen = 'woocommerce'
 WHERE woo_order_id IS NOT NULL
   AND origen IS DISTINCT FROM 'woocommerce';

COMMENT ON COLUMN public.pedidos.origen IS
  'De dónde salió el pedido: woocommerce o manual. Lo escribe la '
  'sincronización, y de él depende que los cambios de estado y el tracking '
  'vuelvan a la web de la tienda.';
