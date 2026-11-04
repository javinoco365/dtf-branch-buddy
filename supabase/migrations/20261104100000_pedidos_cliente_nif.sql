-- ============================================================================
-- NIF del cliente congelado en el pedido
-- ============================================================================
-- QUÉ HACE
--   Añade pedidos.cliente_nif: el NIF/DNI de facturación tal como llegó con el
--   pedido (en WooCommerce, el meta _billing_nif / billing_nif que guarda el
--   plugin del checkout). Va junto a cliente_nombre, cliente_email y
--   cliente_telefono, que ya se congelan igual.
--
--   Sirve para que la factura de un pedido lleve NIF aunque el pedido no esté
--   enlazado a ninguna ficha de cliente, o la ficha no tenga NIF. Si la ficha
--   tiene NIF, manda la ficha.
--
--   Sin índice ni restricción: es un dato copiado, no una clave. Las políticas
--   RLS, la guardia de niveles y el trigger de auditoría de pedidos son por
--   tabla y lo cubren sin tocar nada.
--
-- REVERSIBLE
--   Sí: ALTER TABLE public.pedidos DROP COLUMN cliente_nif;
--   (pierde los NIF copiados; la siguiente sincronización los vuelve a traer
--   de los pedidos que WooCommerce devuelva).
-- ============================================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cliente_nif text;

COMMENT ON COLUMN public.pedidos.cliente_nif IS
  'NIF/DNI de facturación tal como llegó con el pedido (Woo: meta _billing_nif). '
  'Copia congelada: la ficha de cliente, si tiene NIF, manda sobre esta.';
