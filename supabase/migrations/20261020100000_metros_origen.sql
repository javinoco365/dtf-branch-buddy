-- ============================================================================
-- DE DÓNDE SALEN LOS METROS DE UNA LÍNEA DE PEDIDO
-- ============================================================================
--
-- QUÉ RESUELVE
--   Los pedidos de WooCommerce hechos con el montador de DTF (DTFBuild) llegan
--   con cantidad 1. Si la API trae la longitud del trabajo, esos son los
--   metros. Si no la trae, el CRM los ESTIMA dividiendo el importe de la línea
--   entre el precio por metro (12,27 € ÷ 7 €/m = 1,753 m). Un metro estimado
--   no puede pasar por medido: hay que guardar de dónde sale.
--
-- QUÉ CAMBIA
--   pedido_items.metros_origen: 'montador' (leído del pedido),
--     'precio_linea' (importe ÷ precio por metro de la propia línea) o
--     'precio_ajustes' (importe ÷ precio por metro de Ajustes de Gerencia).
--     Nulo en las líneas que no van en metros y en las de antes.
--   pedido_items.precio_metro_usado: el precio por metro con el que se estimó
--     o se comprobó la longitud.
--
-- REVERSIBLE
--   Sí: ALTER TABLE public.pedido_items DROP COLUMN metros_origen,
--   DROP COLUMN precio_metro_usado. No toca ningún dato existente.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

ALTER TABLE public.pedido_items
  ADD COLUMN IF NOT EXISTS metros_origen TEXT,
  ADD COLUMN IF NOT EXISTS precio_metro_usado NUMERIC(10,4);

DO $$ BEGIN
  ALTER TABLE public.pedido_items
    ADD CONSTRAINT pedido_item_metros_origen
    CHECK (metros_origen IS NULL OR metros_origen IN ('montador', 'precio_linea', 'precio_ajustes'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pedido_items
    ADD CONSTRAINT pedido_item_precio_metro_usado
    CHECK (precio_metro_usado IS NULL OR precio_metro_usado > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.pedido_items.metros_origen IS
  'De dónde salen los metros: montador (leídos del pedido), precio_linea o precio_ajustes (estimados: importe ÷ precio por metro). Nulo si la línea no va en metros.';
COMMENT ON COLUMN public.pedido_items.precio_metro_usado IS
  'Precio por metro (sin IVA) con el que se estimaron o comprobaron los metros de la línea.';
