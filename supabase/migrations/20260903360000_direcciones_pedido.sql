-- ============================================================================
-- PEDIDOS · Las direcciones de facturación y envío
-- ============================================================================
--
-- QUÉ FALTA
--   Un pedido no guarda ninguna dirección. La sincronización de WooCommerce lee
--   `billing` para la ficha del CLIENTE, pero tira los objetos `billing` y
--   `shipping` del PEDIDO. Así que al abrir un pedido no se sabe adónde va, y
--   hay que ir a la web de la tienda a mirarlo.
--
--   Peor: en un pedido de invitado (sin cuenta) WooCommerce no manda
--   customer_id, así que no se enlaza ninguna ficha y el pedido se queda sin
--   nombre ni correo. Es el «—» de la columna Cliente.
--
-- POR QUÉ SNAPSHOT Y NO UNA REFERENCIA AL CLIENTE
--   La dirección de un pedido es la de ESE pedido. Si el cliente se muda, sus
--   pedidos antiguos siguieron yendo a la casa antigua, y la etiqueta de envío
--   que se imprimió decía eso. Leerla de la ficha del cliente reescribiría la
--   historia. Es el mismo criterio que ya siguen las facturas.
--
--   Y no siempre coinciden: se factura a la empresa y se envía a la nave.
--
-- REVERSIBLE
--   Sí. Añade tres columnas. No toca ninguna fila.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS direccion_facturacion JSONB,
  ADD COLUMN IF NOT EXISTS direccion_envio JSONB,
  ADD COLUMN IF NOT EXISTS cliente_telefono TEXT;

COMMENT ON COLUMN public.pedidos.direccion_facturacion IS
  'A quién se factura, congelado tal como venía en el pedido. Claves: nombre, '
  'empresa, direccion, codigo_postal, ciudad, provincia, pais, telefono, email.';
COMMENT ON COLUMN public.pedidos.direccion_envio IS
  'Adónde se envía. Misma forma. Puede diferir de la de facturación: se '
  'factura a la empresa y se envía a la nave.';
